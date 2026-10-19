import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe } from './auxiliar.mjs';
import { importarTipos, interpretarTipo } from '../lib/importar-tipos.mjs';

const base = { arquivoNome: 't.xlsx', arquivoSha256: 'x', executadoPor: 'teste' };

test('tipos aceitos sem acento e com sinônimos', () => {
  assert.equal(interpretarTipo('Representante'), 'representante');
  assert.equal(interpretarTipo(' rca '), 'representante');
  assert.equal(interpretarTipo('Vendedor Interno'), 'vendedor');
  assert.equal(interpretarTipo('gerente'), null);
});

test('lista de tipos: atualiza pelo código, rejeita o que não reconhece, nenhuma linha some', async () => {
  const db = await bancoTeste();
  await criarEquipe(db); // vendedores com código 10 e 11
  const linhas = [['COD', 'NOME', 'TIPO'], ['10', 'Vend Dez', 'Representante'], ['11', 'Vend Onze', 'VENDEDOR'], ['77', 'Fulano', 'Vendedor'], ['10', 'Vend Dez', 'Vendedor'], ['11', '', 'gerente'], [null, null, null]];
  const r = await importarTipos(db, { ...base, linhas });
  assert.deepEqual([r.resumo.linhasLidas, r.resumo.aceitas, r.resumo.rejeitadas, r.resumo.ignoradas, r.resumo.linhasVazias], [5, 2, 3, 0, 1]);
  const u = Object.fromEntries((await db.execute("SELECT codigo_erp, tipo_atuacao FROM usuarios WHERE perfil = 'vendedor'")).rows.map((x) => [x.codigo_erp, x.tipo_atuacao]));
  assert.deepEqual(u, { 10: 'representante', 11: 'vendedor' });
  const imp = (await db.execute('SELECT * FROM importacoes')).rows[0];
  assert.equal(imp.situacao, 'concluida');
  assert.equal(Number((await db.execute('SELECT count(*) n FROM importacao_linhas')).rows[0].n), 5);
  assert.equal(Number((await db.execute("SELECT count(*) n FROM auditoria WHERE acao = 'tipo_atuacao'")).rows[0].n), 2);
  // reimportar a mesma lista não muda nada
  const r2 = await importarTipos(db, { ...base, linhas: linhas.slice(0, 3) });
  assert.deepEqual([r2.resumo.aceitas, r2.resumo.ignoradas], [0, 2]);
});

test('colunas com outros nomes e simulação sem gravar', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const r = await importarTipos(db, { ...base, linhas: [['Código Rep.', 'Função'], ['10', 'Vendedor']], colunas: { codigo: 'Código Rep.', tipo: 'Função' }, simular: true });
  assert.equal(r.resumo.aceitas, 1);
  assert.equal(r.resumo.semTipoDefinido, 1);
  assert.equal((await db.execute("SELECT tipo_atuacao FROM usuarios WHERE codigo_erp = '10'")).rows[0].tipo_atuacao, null);
  await assert.rejects(importarTipos(db, { ...base, linhas: [['X']] }), /coluna "COD" não encontrada/);
});
