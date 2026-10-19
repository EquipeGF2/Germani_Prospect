// Amostra montada à mão para conferir as fórmulas (critério de aceite: "batem com a conta feita à mão").
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { calcularPercentuais, consultaAtividade, consultaPosicao } from '../shared/indicadores.mjs';

let db;
// Vendedor 2 (Vend Dez): 6 prospects | Vendedor 3 (Vend Onze): 4 prospects — ambos do supervisor 1
//  P1 v2 não contactado
//  P2 v2 nao_atendido 01/10                      → em_prospeccao
//  P3 v2 atendido 02/10, cadastro 10/10       → cadastrado_erp
//  P4 v2 atendido 03/10, pedido 12/10         → venda_realizada
//  P5 v2 baixa 05/10                               → invalido (sai do denominador)
//  P6 v2 sem_interesse 01/10 + nao_atendido 08/10 → sem_interesse
//  P7 v3 não contactado (Lajeado)
//  P8 v3 atendido 15/10                       → em_negociacao (Lajeado)
//  P9 v3 pedido 16/10 sem contato                  → venda_realizada (convertido sem registro)
//  P10 v3 não contactado
before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  const p = {};
  for (let i = 1; i <= 10; i++) p[i] = await criarProspect(db, { n: i, vendedorId: i <= 6 ? 2 : 3, cidade: [7, 8].includes(i) ? 'Lajeado' : 'Santa Cruz do Sul' });
  await registrarContato(db, { prospectId: p[2], resultado: 'nao_atendido', data: '2026-10-01' });
  await registrarContato(db, { prospectId: p[3], resultado: 'atendido', retorno: '2026-10-05', data: '2026-10-02' });
  await evento(db, { prospectId: p[3], tipo: 'cadastro', data: '2026-10-10', documento: 'C3' });
  await registrarContato(db, { prospectId: p[4], resultado: 'atendido', retorno: '2026-10-05', data: '2026-10-03' });
  await evento(db, { prospectId: p[4], tipo: 'pedido', data: '2026-10-12', documento: 'P4' });
  await evento(db, { prospectId: p[5], tipo: 'baixa', data: '2026-10-05' });
  await registrarContato(db, { prospectId: p[6], resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await registrarContato(db, { prospectId: p[6], resultado: 'nao_atendido', data: '2026-10-08' });
  await registrarContato(db, { prospectId: p[8], usuarioId: 3, resultado: 'atendido', retorno: '2026-10-20', data: '2026-10-15' });
  await evento(db, { prospectId: p[9], tipo: 'pedido', data: '2026-10-16', documento: 'P9' });
});

const rodar = async (q) => (await db.execute(q)).rows.map((r) => ({ ...r, ...calcularPercentuais(r) }));

test('posição atual — total geral', async () => {
  const [g] = await rodar(consultaPosicao({ agrupar: 'geral' }));
  assert.equal(Number(g.total), 10);
  assert.equal(Number(g.invalidos), 1);
  assert.equal(Number(g.carteira_valida), 9);
  assert.equal(Number(g.contactados), 6);   // P2 P3 P4 P6 P8 P9
  assert.equal(Number(g.vendas), 2);
  assert.equal(Number(g.cadastrados_erp), 1);
  assert.equal(g.pct_contactado, 6 / 9);
  assert.equal(g.pct_conversao, 2 / 6);
  assert.equal(g.pct_cadastro, 3 / 6);
});

test('posição atual — por vendedor e por cidade', async () => {
  const v = Object.fromEntries((await rodar(consultaPosicao({ agrupar: 'vendedor' }))).map((r) => [r.rotulo, r]));
  assert.equal(Number(v['Vend Dez'].carteira_valida), 5);
  assert.equal(Number(v['Vend Dez'].contactados), 4);
  assert.equal(v['Vend Dez'].pct_conversao, 1 / 4);
  assert.equal(Number(v['Vend Onze'].carteira_valida), 4);
  assert.equal(v['Vend Onze'].pct_contactado, 2 / 4);
  const c = Object.fromEntries((await rodar(consultaPosicao({ agrupar: 'cidade' }))).map((r) => [r.rotulo, r]));
  assert.equal(Number(c['Lajeado/RS'].total), 2);
  assert.equal(Number(c['Lajeado/RS'].contactados), 1);
  const [s] = await rodar(consultaPosicao({ agrupar: 'supervisor' }));
  assert.equal(s.rotulo, 'Sup Um');
  assert.equal(Number(s.total), 10);
});

test('posição numa data passada usa o histórico (09/10)', async () => {
  const [g] = await rodar(consultaPosicao({ agrupar: 'geral', data: '2026-10-09' }));
  assert.equal(Number(g.invalidos), 1);       // P5 baixado em 05/10
  assert.equal(Number(g.contactados), 4);     // P2 P3 P4 P6
  assert.equal(Number(g.em_negociacao), 2);   // P3 P4 aguardando cadastro
  assert.equal(Number(g.sem_interesse), 1);   // P6 encerrado em 08/10
  assert.equal(Number(g.vendas), 0);
});

test('filtros por vendedor e supervisor', async () => {
  const [g] = await rodar(consultaPosicao({ agrupar: 'geral', filtros: { vendedorId: 3 } }));
  assert.equal(Number(g.total), 4);
  const vazio = await rodar(consultaPosicao({ agrupar: 'geral', filtros: { supervisorId: 5 } }));
  assert.equal(vazio.length, 0);
});

test('atividade no período 01/10–10/10', async () => {
  const [a] = (await db.execute(consultaAtividade({ agrupar: 'geral', inicio: '2026-10-01', fim: '2026-10-10' }))).rows;
  assert.equal(Number(a.contatos_registrados), 5);     // P2, P3, P4, P6×2
  assert.equal(Number(a.contatos_atendidos), 2);   // P3, P4
  assert.equal(Number(a.prospects_contactados), 4);
  assert.equal(Number(a.primeiros_contatos), 4);
  assert.equal(Number(a.encerrados_sem_interesse), 1); // P6
  assert.equal(Number(a.cadastros_erp), 1);            // P3
  assert.equal(Number(a.pedidos), 0);
  assert.equal(Number(a.baixas), 1);
});

test('percentuais com denominador zero viram null (sem divisão por zero)', () => {
  assert.deepEqual(calcularPercentuais({ contactados: 0, carteira_valida: 0, vendas: 0, cadastrados_erp: 0 }), { pct_contactado: null, pct_cadastro: null, pct_conversao: null });
});
