// Banco SQLite em memória com todas as migrações — os testes nunca tocam o Turso.
import { createClient } from '@libsql/client';
import { aplicarMigracoes } from '../lib/migracoes.mjs';
import { normalizarBusca } from '../shared/texto.mjs';
import { calcularDv } from '../shared/cnpj.mjs';

export async function bancoTeste() {
  const db = createClient({ url: ':memory:' });
  await db.execute('PRAGMA foreign_keys = ON');
  await aplicarMigracoes(db);
  return db;
}

export const cnpjTeste = (n) => {
  const base = String(n).padStart(8, '0') + '0001';
  return base + calcularDv(base);
};

/** Equipe mínima: 1 supervisor (id 1), 2 vendedores (ids 2 e 3), 1 admin (id 4), 1 supervisor sem equipe (id 5). */
export async function criarEquipe(db) {
  const u = (perfil, cod, nome, sup) => ({
    sql: 'INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES (?, ?, ?, ?, ?, ?)',
    args: [perfil, cod, nome, normalizarBusca(nome), `${perfil}${cod}`, sup],
  });
  await db.batch([
    u('supervisor', '90', 'Sup Um', null),
    u('vendedor', '10', 'Vend Dez', 1),
    u('vendedor', '11', 'Vend Onze', 1),
    u('administrador', null, 'Admin', null),
    u('supervisor', '91', 'Sup Dois', null),
  ], 'write');
}

export async function criarProspect(db, { n, vendedorId = 2, cidade = 'Santa Cruz do Sul' }) {
  const cnpj = cnpjTeste(n);
  const r = await db.execute({
    sql: `INSERT INTO prospects (cnpj, cnpj_raiz, razao_social, cidade, cidade_busca, uf, busca, vendedor_id, dt_entrada_base)
          VALUES (?, ?, ?, ?, ?, 'RS', ?, ?, '2026-01-01') RETURNING id`,
    args: [cnpj, cnpj.slice(0, 8), `Empresa ${n}`, cidade, normalizarBusca(cidade), `EMPRESA ${n}`, vendedorId],
  });
  return Number(r.rows[0].id);
}

let seq = 0;
export async function registrarContato(db, { prospectId, usuarioId = 2, resultado, data, motivo = null, retorno = null, observacao = null }) {
  const p = (await db.execute({ sql: 'SELECT tentativas FROM prospects WHERE id = ?', args: [prospectId] })).rows[0];
  const id = `teste-${++seq}`;
  await db.execute({
    sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado, motivo_id, observacao, data_retorno)
          VALUES (?, ?, ?, ?, ?, 'visita', ?, (SELECT id FROM motivos_sem_interesse WHERE codigo = ?), ?, ?)`,
    args: [id, prospectId, usuarioId, Number(p.tentativas) + 1, data, resultado, motivo, observacao, retorno],
  });
  return id;
}

export async function prospect(db, id) {
  return (await db.execute({ sql: 'SELECT * FROM vw_prospects WHERE id = ?', args: [id] })).rows[0];
}

export async function evento(db, { prospectId, tipo, data, documento = null }) {
  const imp = await db.execute({
    sql: `INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES (?, 'teste', 'x', 'teste') RETURNING id`,
    args: [{ cadastro: 'cadastro_erp', pedido: 'pedido_erp', baixa: 'cnpj_baixado' }[tipo]],
  });
  await db.execute({
    sql: 'INSERT INTO eventos_erp (prospect_id, tipo, data_evento, documento, importacao_id) VALUES (?, ?, ?, ?, ?)',
    args: [prospectId, tipo, data, documento, imp.rows[0].id],
  });
}
