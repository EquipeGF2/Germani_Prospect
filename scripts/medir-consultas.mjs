#!/usr/bin/env node
// Mede as consultas das telas com volume de produção (padrão: 50 mil prospects) num banco SQLite temporário.
//   node scripts/medir-consultas.mjs [prospects] [--plano]
// Mostra o tempo médio de cada consulta e, com --plano, o plano do SQLite (SCAN = varre a tabela; SEARCH = usa índice).
// Serve para decidir índices com número, não com palpite. Nunca toca o Turso.
import { createClient } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { aplicarMigracoes } from '../lib/migracoes.mjs';
import { normalizarBusca } from '../shared/texto.mjs';
import { consultaCarteira, consultaOndas } from '../shared/carteira.mjs';
import { consultaPainel } from '../shared/painel.mjs';
import { consultaPedidosResumo, consultaResumo } from '../shared/explorar.mjs';

const N = Number(process.argv[2]) || 50000;
const PLANO = process.argv.includes('--plano');
const pasta = await mkdtemp(path.join(os.tmpdir(), 'germani-medir-'));
const db = createClient({ url: `file:${path.join(pasta, 'medir.db')}` });
await aplicarMigracoes(db);

// equipe: 10 supervisores × 8 vendedores
const usuarios = [];
for (let s = 1; s <= 10; s++) {
  usuarios.push({ sql: "INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login) VALUES ('supervisor', ?, ?, ?, ?)", args: [`9${s}`, `Sup ${s}`, `SUP ${s}`, `sup${s}`] });
}
await db.batch(usuarios, 'write');
const vend = [];
for (let s = 1; s <= 10; s++) for (let v = 1; v <= 8; v++) {
  vend.push({ sql: "INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id, tipo_atuacao) VALUES ('vendedor', ?, ?, ?, ?, ?, ?)",
    args: [`${s}${v}0`, `Vend ${s}-${v}`, `VEND ${s}-${v}`, `v${s}${v}`, s, v % 2 ? 'vendedor' : 'representante'] });
}
await db.batch(vend, 'write');
const cidades = ['Santa Cruz do Sul', 'Venâncio Aires', 'Lajeado', 'Passo Fundo', 'Santa Maria', 'Cachoeira do Sul', 'Porto Alegre', 'Canoas'];
let semente = 7;
const r = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
const t0 = Date.now();
for (let i = 0; i < N; i += 1000) {
  const lote = [];
  for (let n = i; n < Math.min(N, i + 1000); n++) {
    const cnpj = String(10000000 + n).padStart(8, '0') + '000199';
    const cidade = cidades[Math.floor(r() * cidades.length)];
    const razao = `Mercado ${['Central', 'Bom Preço', 'Esperança', 'do Vale', 'São João'][n % 5]} ${n} Ltda`;
    const ultimo = r() < 0.4 ? `2026-${String(1 + Math.floor(r() * 9)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` : null;
    lote.push({ sql: `INSERT INTO prospects (cnpj, cnpj_raiz, razao_social, cidade, cidade_busca, bairro, bairro_busca, rota, subrota, onda, uf, busca,
                        vendedor_id, dt_entrada_base, status_atual, dt_ultimo_contato, dt_primeiro_contato)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RS', ?, ?, '2026-01-01', ?, ?, ?)`,
      args: [cnpj, cnpj.slice(0, 8), razao, cidade, normalizarBusca(cidade), `Bairro ${n % 40}`, `BAIRRO ${n % 40}`, `R${n % 12}`, `S${n % 5}`, String(1 + (n % 3)),
        normalizarBusca(`${razao} ${cnpj} ${cidade}`), 11 + (n % 80), ultimo ? (r() < 0.7 ? 'em_prospeccao' : 'sem_interesse') : 'nao_contactado', ultimo, ultimo] });
  }
  await db.batch(lote, 'write');
}
// 3 contatos por prospect contactado (histórico), inseridos direto (sem regras: só volume para as consultas)
await db.execute('PRAGMA foreign_keys = OFF');
await db.executeMultiple(`
  DROP TRIGGER IF EXISTS trg_contatos_validar; DROP TRIGGER IF EXISTS trg_contatos_aplicar;`).catch(() => {});
const imp = Number((await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('base_prospects', 'medir', 'x', 'medir') RETURNING id")).rows[0].id);
const ids = (await db.execute('SELECT id, vendedor_id, dt_ultimo_contato FROM prospects WHERE dt_ultimo_contato IS NOT NULL')).rows;
for (let i = 0; i < ids.length; i += 500) {
  const lote = [];
  for (const p of ids.slice(i, i + 500)) for (let k = 1; k <= 3; k++) {
    lote.push({ sql: "INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado, origem, importacao_id) VALUES (?, ?, ?, ?, ?, 'visita', 'contato_planilha', 'importacao', ?)",
      args: [`${p.id}-${k}`, p.id, p.vendedor_id, k, p.dt_ultimo_contato, imp] });
  }
  await db.batch(lote, 'write');
}
console.log(`Base: ${N} prospects, ${ids.length * 3} contatos (${((Date.now() - t0) / 1000).toFixed(1)} s para montar)\n`);
await db.execute('ANALYZE');

const ADM = { id: 1000, perfil: 'administrador' };
const SUP = { id: 3, perfil: 'supervisor' };
const VEN = { id: 11, perfil: 'vendedor', tipo_atuacao: 'vendedor' };
const pag = { limite: 51, deslocamento: 0, ordemNatural: true, rotaEmNiveis: true };
const CASOS = [
  ['Lista principal (admin, 1ª página)', consultaCarteira({ usuario: ADM, ...pag })],
  ['Lista principal (supervisor)', consultaCarteira({ usuario: SUP, ...pag })],
  ['Lista principal (vendedor)', consultaCarteira({ usuario: VEN, ...pag })],
  ['Busca por nome "esperanca"', consultaCarteira({ usuario: ADM, busca: 'esperanca', ...pag })],
  ['Busca por nome seletiva "joao 4123"', consultaCarteira({ usuario: ADM, busca: 'joao 4123', ...pag })],
  ['Busca por CNPJ (início)', consultaCarteira({ usuario: ADM, busca: '10012', ...pag })],
  ['Filtro onda 2', consultaCarteira({ usuario: ADM, filtros: { onda: '2' }, ...pag })],
  ['Filtro cidade', consultaCarteira({ usuario: ADM, filtros: { cidadeBusca: 'LAJEADO', uf: 'RS' }, ...pag })],
  ['Filtro vendedor', consultaCarteira({ usuario: ADM, filtros: { vendedorId: 20 }, ...pag })],
  ['Filtro último registro (mês)', consultaCarteira({ usuario: ADM, filtros: { dataDe: '2026-05-01', dataAte: '2026-05-31' }, ...pag })],
  ['Ordenar por prospect', consultaCarteira({ usuario: ADM, ordenar: { campo: 'prospect' }, ...pag })],
  ['Acompanhamento (lista)', consultaCarteira({ usuario: ADM, filtros: { foraDaLista: true }, ...pag })],
  ['Acompanhamento (cards de status)', consultaCarteira({ usuario: ADM, visao: 'status', filtros: { foraDaLista: true } })],
  ['Visão cidade (grupos)', consultaCarteira({ usuario: ADM, visao: 'cidade', ...pag })],
  ['Visão onda (grupos)', consultaCarteira({ usuario: ADM, visao: 'onda', ...pag })],
  ['Ondas do filtro', consultaOndas()],
  ['Início (posição atual, resumo 0012)', consultaPainel({ usuario: ADM })],
  ['Início (posição atual, índice 0011)', consultaPainel({ usuario: ADM, fonte: 'indice' })],
  ['Explorar carteira: resumo (admin)', consultaResumo({ usuario: ADM })],
  ['Explorar carteira: resumo (supervisor)', consultaResumo({ usuario: SUP })],
  ['Explorar carteira: pedidos', consultaPedidosResumo({ usuario: ADM })],
  ['Início (período: mês)', consultaPainel({ usuario: ADM, periodo: { inicio: '2026-05-01', fim: '2026-05-31' } })],
  ['Início (supervisor)', consultaPainel({ usuario: SUP })],
];
const largura = Math.max(...CASOS.map(([n]) => n.length));
for (const [nome, q] of CASOS) {
  await db.execute(q);   // aquece
  const ini = performance.now();
  let linhas = 0;
  for (let i = 0; i < 3; i++) linhas = (await db.execute(q)).rows.length;
  const ms = (performance.now() - ini) / 3;
  console.log(`${nome.padEnd(largura)}  ${ms.toFixed(1).padStart(8)} ms  (${linhas} linhas)`);
  if (PLANO) {
    const plano = (await db.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.args })).rows.map((x) => `      ${x.detail}`);
    console.log(plano.join('\n'));
  }
}
