// Console do analista financeiro: cadastro → Análise financeira → OK do analista (condição + restrição + limite)
// → Aguardando pedido → pedido → Venda. A liberação sempre ocorre.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, prospect, registrarContato } from './auxiliar.mjs';
import { comandoLiberarCredito, consultaFilaAnalise, validarLiberacao } from '../shared/financeiro.mjs';
import { normalizarBusca } from '../shared/texto.mjs';

let db, id;
const FIN = { id: 6, perfil: 'financeiro' };
beforeEach(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  await db.execute({ sql: "INSERT INTO usuarios (perfil, nome, nome_busca, login) VALUES ('financeiro', 'Analista Fin', ?, 'fin')", args: [normalizarBusca('Analista Fin')] });
  id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C1' });
});

test('fila do console mostra quem teve o cadastro realizado', async () => {
  const fila = (await db.execute(consultaFilaAnalise({ usuario: FIN }))).rows;
  assert.equal(fila.length, 1);
  assert.equal(fila[0].codigo_cliente_erp, 'C1');
  assert.equal(fila[0].dt_cadastro_erp, '2026-10-05');
  assert.ok(Number(fila[0].dias_em_analise) > 0);
  assert.throws(() => consultaFilaAnalise({ usuario: { id: 2, perfil: 'vendedor' } }), /analista financeiro/);
});

test('OK do analista: boleto 28 dias, sem restrição, limite → Aguardando pedido, no histórico; depois o pedido → Venda', async () => {
  await db.execute(comandoLiberarCredito({ usuario: FIN, prospectId: id, formaPagamento: 'boleto', prazoDias: 28, comRestricao: false, limiteCredito: '15.000,00', dataLiberacao: '2026-10-07' }));
  let p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_pedido');
  assert.equal(p.limite_credito, 15000);
  assert.equal(p.forma_pagamento, 'boleto');
  assert.equal(p.prazo_pagamento_dias, 28);
  assert.equal(p.com_restricao_credito, 0);
  assert.equal(p.na_lista, 0);
  assert.equal((await db.execute(consultaFilaAnalise({ usuario: FIN }))).rows.length, 0);
  const mv = (await db.execute({ sql: "SELECT * FROM vw_movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [id] })).rows[0];
  assert.equal(mv.detalhe, 'boleto 28 dias · limite R$ 15000.00 · sem restrição · console');
  assert.equal(mv.usuario_nome, 'Analista Fin');
  assert.equal(mv.status_anterior, 'analise_financeira');
  // registro do vendedor não muda o status; novo cadastro também não
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-08' });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-08', documento: 'C2' });
  assert.equal((await prospect(db, id)).status_atual, 'aguardando_pedido');
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-09', documento: 'P1' });
  p = await prospect(db, id);
  assert.equal(p.status_atual, 'venda_realizada');
  const tipos = (await db.execute({ sql: 'SELECT tipo FROM movimentacoes WHERE prospect_id = ? ORDER BY id', args: [id] })).rows.map((r) => r.tipo);
  assert.deepEqual(tipos, ['entrada_base', 'atendido', 'cadastro', 'liberacao_credito', 'atendido', 'cadastro', 'pedido']);
});

test('liberação sempre ocorre: antecipado com restrição e limite zero é aceita', async () => {
  await db.execute(comandoLiberarCredito({ usuario: FIN, prospectId: id, formaPagamento: 'antecipado', comRestricao: true, limiteCredito: 0, dataLiberacao: '2026-10-07' }));
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_pedido');
  assert.equal(p.com_restricao_credito, 1);
  assert.equal(p.limite_credito, 0);
  const mv = (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [id] })).rows[0];
  assert.equal(mv.detalhe, 'antecipado · limite R$ 0.00 · com restrição de crédito · console');
  // correção = nova liberação (fica no histórico)
  await db.execute(comandoLiberarCredito({ usuario: FIN, prospectId: id, formaPagamento: 'boleto', prazoDias: 30, comRestricao: true, limiteCredito: 5000, dataLiberacao: '2026-10-08' }));
  assert.equal((await prospect(db, id)).limite_credito, 5000);
});

test('regras: só analista/admin, só em análise, boleto exige limite, forma válida, data não anterior ao cadastro', async () => {
  const ins = (usuarioId, data = '2026-10-07', valor = 1000, forma = 'a_vista', restr = 0) => db.execute({
    sql: "INSERT INTO liberacoes_credito (prospect_id, origem, usuario_id, data_liberacao, limite_credito, limite_origem, forma_pagamento, com_restricao) VALUES (?, 'console', ?, ?, ?, 'informado', ?, ?)",
    args: [id, usuarioId, data, valor, forma, restr] });
  await assert.rejects(ins(2), /somente o analista/);
  await assert.rejects(ins(6, '2026-10-04'), /anterior ao cadastro/);
  await assert.rejects(ins(6, '2026-10-07', 0, 'boleto'), /CHECK constraint/);   // boleto exige limite
  await assert.rejects(ins(6, '2026-10-07', -1), /CHECK constraint/);
  await assert.rejects(ins(6, '2026-10-07', 10, 'cheque'), /CHECK constraint/);
  await ins(4); // administrador
  const outro = await criarProspect(db, { n: 2 });
  await assert.rejects(db.execute({ sql: "INSERT INTO liberacoes_credito (prospect_id, origem, usuario_id, data_liberacao, limite_credito, limite_origem, forma_pagamento, com_restricao) VALUES (?, 'console', 6, '2026-10-07', 10, 'informado', 'a_vista', 0)", args: [outro] }), /não está em análise financeira/);
  await assert.rejects(db.execute('DELETE FROM liberacoes_credito'), /somente inclusão/);
  assert.deepEqual(validarLiberacao({ limiteCredito: '', formaPagamento: '', dataLiberacao: '' }).erros.length, 4);
  assert.match(validarLiberacao({ limiteCredito: '0', formaPagamento: 'boleto', prazoDias: 30, comRestricao: false, dataLiberacao: '2026-10-07' }).erros.join(), /boleto exige limite/);
  assert.deepEqual(validarLiberacao({ limiteCredito: '0', formaPagamento: 'antecipado', comRestricao: true, dataLiberacao: '2026-10-07' }).erros, []);
  assert.match(validarLiberacao({ limiteCredito: '10', formaPagamento: 'boleto', prazoDias: '-3', comRestricao: true, dataLiberacao: '2026-10-07' }).erros.join(), /quantidade de dias/);
});
