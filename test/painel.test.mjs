import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtemp, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { aplicarMigracoes, PASTA_MIGRACOES } from '../lib/migracoes.mjs';
import { consultaPainel, diasUteis, diasUteisCampanha, lerParametrosPainel, somarPainel, supervisoresDoPainel, valoresPainel } from '../shared/painel.mjs';
import { excluirFeriado, incluirFeriado, listarFeriados } from '../shared/feriados.mjs';
import { alterarParametro } from '../shared/administracao.mjs';
import { criarUsuarioSistema } from '../shared/usuarios.mjs';
import { consultaCarteira } from '../shared/carteira.mjs';

test('dias úteis: seg–sex menos feriados; campanha de 01/10/2026 até 19/10/2026 = 12 (12/10 é feriado)', async () => {
  assert.equal(diasUteis('2026-10-01', '2026-10-19'), 13);
  assert.equal(diasUteis('2026-10-01', '2026-10-19', new Set(['2026-10-12'])), 12);
  assert.equal(diasUteis('2026-10-03', '2026-10-04'), 0);          // sábado e domingo
  assert.equal(diasUteis('2026-10-20', '2026-10-19'), 0);
  const db = await bancoTeste();
  assert.equal(await diasUteisCampanha(db, { inicio: '2026-10-01', hoje: '2026-10-19' }), 12);   // 12/10 vem da migração
  await incluirFeriado(db, { data: '2026-10-15', descricao: 'Feriado municipal teste', abrangencia: 'municipal', uf: 'rs', cidade: 'Santa Cruz do Sul', executadoPor: 't' });
  assert.equal(await diasUteisCampanha(db, { inicio: '2026-10-01', hoje: '2026-10-19' }), 11);
  await assert.rejects(incluirFeriado(db, { data: '2026-10-15', descricao: 'x', abrangencia: 'municipal', uf: 'RS', cidade: 'Santa Cruz do Sul' }), /já cadastrado/);
  await assert.rejects(incluirFeriado(db, { data: '2026-10-16', descricao: 'x', abrangencia: 'municipal', uf: 'RS' }), /cidade/);
  const f = (await listarFeriados(db, { ano: 2026 })).find((x) => x.data === '2026-10-15');
  assert.equal(f.uf, 'RS');
  await excluirFeriado(db, { id: f.id });
  assert.equal(await diasUteisCampanha(db, { inicio: '2026-10-01', hoje: '2026-10-19' }), 12);
});

test('parâmetros do painel: data validada, valores do pipeline e conversão', async () => {
  const db = await bancoTeste();
  const p = await lerParametrosPainel(db);
  assert.deepEqual(p, { data_inicio_campanha: '2026-10-01', percentual_pipeline: '30', valor_medio_cliente: '1200' });
  assert.deepEqual(valoresPainel({ total: 23038, venda_realizada: 6 }, p), { pipeline: 8293680, conversao: 7200 });
  await assert.rejects(alterarParametro(db, { chave: 'data_inicio_campanha', valor: '01/10/2026', executadoPor: 't' }), /data/);
  await assert.rejects(alterarParametro(db, { chave: 'percentual_pipeline', valor: 'trinta', executadoPor: 't' }), /inteiro/);
  await alterarParametro(db, { chave: 'data_inicio_campanha', valor: '2026-09-01', executadoPor: 't' });
  await assert.rejects(db.execute("UPDATE parametros SET valor = '2026-13-45' WHERE chave = 'data_inicio_campanha'"), /AAAA-MM-DD/);
});

test('painel: números por agente, escopo do supervisor, do vendedor e visão total do gerente', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);   // sup 1 (vend 2 e 3), admin 4, sup 5 (sem equipe)
  await db.execute("INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id, tipo_atuacao) VALUES ('vendedor', '12', 'Vend Doze', 'VEND DOZE', 'v12', 5, 'vendedor')");
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'vendedor' WHERE id = 2");
  const ids = [];
  for (let n = 1; n <= 6; n++) ids.push(await criarProspect(db, { n, vendedorId: n <= 3 ? 2 : n <= 5 ? 3 : 6 }));
  await registrarContato(db, { prospectId: ids[0], resultado: 'sem_interesse', data: '2026-10-02', motivo: 'PRECO' });
  await registrarContato(db, { prospectId: ids[1], resultado: 'atendido', data: '2026-10-02' });
  await evento(db, { prospectId: ids[1], tipo: 'pedido', data: '2026-10-05', documento: 'P1' });
  await evento(db, { prospectId: ids[5], tipo: 'baixa', data: '2026-10-05' });   // inválido sai da conta

  const gerente = await criarUsuarioSistema(db, { perfil: 'gerente', login: 'gerente', nome: 'Gerente Comercial', executadoPor: 't' });
  const G = { id: gerente.id, perfil: 'gerente' };
  const linhas = (await db.execute(consultaPainel({ usuario: G }))).rows;
  const geral = somarPainel(linhas);
  assert.deepEqual([geral.total, geral.nao_contactado, geral.sem_interesse, geral.venda_realizada, geral.contactados], [5, 3, 1, 1, 2]);
  assert.equal(geral.pct_conversao, 50);
  assert.deepEqual(supervisoresDoPainel(linhas).map((s) => s.nome), ['Sup Um']);    // Vend Doze só tinha o baixado
  const v2 = linhas.find((l) => Number(l.agente_id) === 2);
  assert.equal(v2.tipo_atuacao, 'vendedor');

  const sup = (await db.execute(consultaPainel({ usuario: { id: 1, perfil: 'supervisor' } }))).rows;
  assert.deepEqual(sup.map((l) => Number(l.agente_id)).sort(), [2, 3]);
  assert.equal((await db.execute(consultaPainel({ usuario: { id: 5, perfil: 'supervisor' } }))).rows.length, 0);
  const vend = (await db.execute(consultaPainel({ usuario: { id: 3, perfil: 'vendedor' } }))).rows;
  assert.deepEqual(vend.map((l) => Number(l.agente_id)), [3]);

  // gerente: enxerga todas as carteiras e registra em qualquer uma, mas não libera crédito
  assert.equal((await db.execute(consultaCarteira({ usuario: G, incluirForaDaLista: true }))).rows.length, 6);
  await registrarContato(db, { prospectId: ids[3], usuarioId: G.id, resultado: 'atendido', data: '2026-10-06' });
  await evento(db, { prospectId: ids[3], tipo: 'cadastro', data: '2026-10-07', documento: 'C9' });
  await assert.rejects(db.execute({ sql: "INSERT INTO liberacoes_credito (prospect_id, origem, usuario_id, data_liberacao, forma_pagamento, limite_credito, limite_origem, com_restricao) VALUES (?, 'console', ?, '2026-10-08', 'a_vista', 0, 'informado', 0)", args: [ids[3], G.id] }), /somente o analista financeiro/);
});

test('migração 0002 preserva usuários e carteira já existentes', async () => {
  const pasta = await mkdtemp(path.join(os.tmpdir(), 'mig-'));
  await copyFile(path.join(PASTA_MIGRACOES, '0001_inicial.sql'), path.join(pasta, '0001_inicial.sql'));
  const db = createClient({ url: ':memory:' });
  await db.execute('PRAGMA foreign_keys = ON');
  await aplicarMigracoes(db, { pasta });
  await criarEquipe(db);
  const id = await criarProspect(db, { n: 1, vendedorId: 2 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-02' });
  await copyFile(path.join(PASTA_MIGRACOES, '0002_gerente_feriados_painel.sql'), path.join(pasta, '0002_gerente_feriados_painel.sql'));
  assert.deepEqual(await aplicarMigracoes(db, { pasta }), ['0002_gerente_feriados_painel.sql']);
  assert.equal(Number((await db.execute('SELECT count(*) n FROM usuarios')).rows[0].n), 5);
  assert.equal((await db.execute('PRAGMA foreign_key_check')).rows.length, 0);
  assert.equal((await db.execute("SELECT vendedor_nome FROM vw_prospects")).rows[0].vendedor_nome, 'Vend Dez');
  // triggers de usuarios recriados
  await assert.rejects(db.execute("INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES ('vendedor', '99', 'X', 'X', 'x99', 2)"), /perfil supervisor/);
  await db.execute("INSERT INTO usuarios (perfil, nome, nome_busca, login) VALUES ('gerente', 'G', 'G', 'g')");
});

test('período: presets, posição atual × eventos no período, funil cumulativo e dias úteis no período', async () => {
  const { resolverPeriodo, funilPainel } = await import('../shared/painel.mjs');
  const base = { hoje: '2026-10-21', inicioCampanha: '2026-10-01' };
  assert.equal(resolverPeriodo('atual', base), null);
  assert.deepEqual(resolverPeriodo('campanha', base), { inicio: '2026-10-01', fim: '2026-10-21' });
  assert.deepEqual(resolverPeriodo('semana', base), { inicio: '2026-10-19', fim: '2026-10-21' });   // 21/10/2026 é quarta
  assert.deepEqual(resolverPeriodo('mes', base), { inicio: '2026-10-01', fim: '2026-10-21' });
  assert.deepEqual(resolverPeriodo('dias30', base), { inicio: '2026-09-22', fim: '2026-10-21' });
  assert.deepEqual(resolverPeriodo('personalizado', { ...base, de: '2026-10-10', ate: '2026-10-05' }), { inicio: '2026-10-05', fim: '2026-10-10' });
  assert.equal(resolverPeriodo('personalizado', { ...base, de: '' }), null);

  const db = await bancoTeste();
  await criarEquipe(db);
  const ids = [];
  for (let n = 1; n <= 4; n++) ids.push(await criarProspect(db, { n, vendedorId: 2 }));
  await registrarContato(db, { prospectId: ids[0], resultado: 'atendido', data: '2026-09-20' });          // antes do período
  await registrarContato(db, { prospectId: ids[1], resultado: 'atendido', data: '2026-10-05' });
  await evento(db, { prospectId: ids[1], tipo: 'pedido', data: '2026-10-08', documento: 'P' });            // venda sem crédito: entra no funil inteiro
  await registrarContato(db, { prospectId: ids[2], resultado: 'sem_interesse', data: '2026-10-06', motivo: 'PRECO' });
  const ADM = { id: 4, perfil: 'administrador' };
  const atual = somarPainel((await db.execute(consultaPainel({ usuario: ADM }))).rows);
  assert.deepEqual([atual.total, atual.contactados, atual.atendidos, atual.cadastrados, atual.credito_liberado, atual.venda_realizada, atual.sem_interesse], [4, 3, 2, 1, 1, 1, 1]);
  assert.deepEqual(funilPainel(atual).map((e) => e.valor), [4, 3, 2, 1, 1, 1]);   // nunca cresce
  const out = somarPainel((await db.execute(consultaPainel({ usuario: ADM, periodo: { inicio: '2026-10-01', fim: '2026-10-31' } }))).rows);
  assert.deepEqual([out.total, out.nao_contactado, out.contactados, out.atendidos, out.cadastrados, out.venda_realizada, out.sem_interesse], [4, 1, 2, 1, 1, 1, 1]);
  assert.deepEqual(funilPainel(out).map((e) => e.valor), [4, 2, 1, 1, 1, 1]);
  assert.equal(out.pct_conversao, 50);
  assert.equal(await diasUteisCampanha(db, { inicio: '2026-10-01', hoje: '2026-10-21', periodo: { inicio: '2026-10-12', fim: '2026-10-16' } }), 4); // 12/10 feriado
  assert.equal(await diasUteisCampanha(db, { inicio: '2026-10-01', hoje: '2026-10-21', periodo: { inicio: '2026-09-01', fim: '2026-12-31' } }), 14);
});

test('feriados automáticos: nacionais calculados para qualquer ano (Páscoa) e cadastrados que repetem todo ano', async () => {
  const { pascoa, feriadosNacionais, datasDeFeriado } = await import('../shared/feriados.mjs');
  assert.equal(pascoa(2026), '2026-04-05');
  assert.equal(pascoa(2027), '2027-03-28');
  assert.equal(pascoa(2028), '2028-04-16');
  const n2028 = feriadosNacionais(2028);
  assert.equal(n2028.length, 10);
  assert.ok(n2028.some((f) => f.data === '2028-04-14' && f.descricao === 'Sexta-feira Santa'));
  assert.ok(!feriadosNacionais(2023).some((f) => f.data === '2023-11-20'));     // Consciência Negra nacional só desde 2024
  const db = await bancoTeste();
  // 0003: nacionais semeados saíram da tabela (vêm do cálculo); 20/09 (RS) ficou um só, repetindo todo ano
  assert.equal(Number((await db.execute("SELECT count(*) n FROM feriados WHERE abrangencia = 'nacional'")).rows[0].n), 0);
  assert.deepEqual((await db.execute('SELECT data, recorrente FROM feriados')).rows.map((f) => [f.data, Number(f.recorrente)]), [['2026-09-20', 1]]);
  const d2030 = await datasDeFeriado(db, { inicio: '2030-01-01', fim: '2030-12-31' });
  assert.ok(d2030.has('2030-09-20') && d2030.has('2030-10-12') && d2030.has('2030-04-19'));   // RS todo ano, Aparecida, Sexta-feira Santa
  await incluirFeriado(db, { data: '2026-12-08', descricao: 'Aniversário da cidade', abrangencia: 'municipal', uf: 'RS', cidade: 'Teste', recorrente: true, executadoPor: 't' });
  const l2031 = await listarFeriados(db, { ano: 2031 });
  assert.ok(l2031.some((f) => f.data === '2031-12-08' && !f.automatico));
  assert.ok(l2031.some((f) => f.data === '2031-12-25' && f.automatico));
  await assert.rejects(incluirFeriado(db, { data: '2031-12-25', descricao: 'Natal', abrangencia: 'nacional' }), /automaticamente/);
  assert.equal(await diasUteisCampanha(db, { inicio: '2031-12-01', hoje: '2031-12-31' }), 21);   // 23 dias úteis − 08/12 − 25/12
});

test('painel: valor dos pedidos = soma real dos pedidos importados (posição atual e no período)', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const ids = [];
  for (let n = 1; n <= 3; n++) ids.push(await criarProspect(db, { n, vendedorId: 2 }));
  await evento(db, { prospectId: ids[0], tipo: 'pedido', data: '2026-10-05', documento: 'P1', valor: 1500.5 });
  await evento(db, { prospectId: ids[0], tipo: 'pedido', data: '2026-10-12', documento: 'P2', valor: 499.5 });
  await evento(db, { prospectId: ids[1], tipo: 'pedido', data: '2026-10-12', documento: 'P3' });          // sem valor no arquivo
  const G = { id: 4, perfil: 'administrador' };
  const atual = somarPainel((await db.execute(consultaPainel({ usuario: G }))).rows);
  assert.deepEqual([atual.qtd_pedidos, atual.valor_pedidos, atual.venda_realizada], [3, 2000, 2]);
  const semana = somarPainel((await db.execute(consultaPainel({ usuario: G, periodo: { inicio: '2026-10-10', fim: '2026-10-19' } }))).rows);
  assert.deepEqual([semana.qtd_pedidos, semana.valor_pedidos], [2, 499.5]);
  const vend = somarPainel((await db.execute(consultaPainel({ usuario: { id: 3, perfil: 'vendedor' } }))).rows);
  assert.equal(vend.valor_pedidos, 0);
});
