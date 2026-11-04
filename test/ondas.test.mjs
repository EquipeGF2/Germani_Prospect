// Ondas liberadas (0024): o representante/vendedor vê na lista só as ondas liberadas; o que já foi atendido não some.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, registrarContato } from './auxiliar.mjs';
import { consultaCarteira } from '../shared/carteira.mjs';
import { consultaResumo } from '../shared/explorar.mjs';
import { alterarParametro } from '../shared/administracao.mjs';
import { condicaoOndas, consultaOndasDaBase, lerOndas, ondasDoFiltro, valorOndas } from '../shared/ondas.mjs';

let db;
const REP = { id: 2, perfil: 'vendedor', tipo_atuacao: 'representante' };
const SUP = { id: 1, perfil: 'supervisor' };

before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  await criarProspect(db, { n: 1, vendedorId: 2, onda: '1' });
  await criarProspect(db, { n: 2, vendedorId: 2, onda: '2' });
  await criarProspect(db, { n: 3, vendedorId: 2, onda: null });
  const p4 = await criarProspect(db, { n: 4, vendedorId: 2, onda: '2' });
  await registrarContato(db, { prospectId: p4, usuarioId: 2, resultado: 'atendido', data: '2026-10-05' });   // já atendido
});

const nomes = async (usuario, extra = {}) => (await db.execute(consultaCarteira({ usuario, incluirForaDaLista: true, limite: 50, ...extra }))).rows.map((r) => r.razao_social).sort();
const resumo = async (usuario) => (await db.execute(consultaResumo({ usuario }))).rows.reduce((t, r) => t + Number(r.qtd), 0);
const liberar = (valor) => alterarParametro(db, { chave: 'ondas_liberadas', valor, executadoPor: 'teste' });

test('padrão: todas as ondas liberadas, como antes', async () => {
  assert.deepEqual(await nomes(REP), ['Empresa 1', 'Empresa 2', 'Empresa 3', 'Empresa 4']);
  assert.equal(await resumo(REP), 4);
});

test('só a onda 1: o representante não vê a onda 2 nem os sem onda; o atendido continua; o supervisor vê tudo', async () => {
  await liberar('["1"]');
  assert.deepEqual(await nomes(REP), ['Empresa 1', 'Empresa 4']);
  assert.equal(await resumo(REP), 2, 'o Explorar carteira segue a mesma regra');
  assert.deepEqual(await nomes(SUP), ['Empresa 1', 'Empresa 2', 'Empresa 3', 'Empresa 4']);
  await liberar('["1",""]');
  assert.deepEqual(await nomes(REP), ['Empresa 1', 'Empresa 3', 'Empresa 4'], '"" libera os sem onda');
  await liberar('[]');
  assert.deepEqual(await nomes(REP), ['Empresa 4'], 'nenhuma onda: só quem já saiu da lista');
  await liberar('todas');
  assert.deepEqual(await nomes(REP), ['Empresa 1', 'Empresa 2', 'Empresa 3', 'Empresa 4']);
});

test('o banco recusa valor que não seja todas ou uma lista', async () => {
  await assert.rejects(liberar('1,2'), /ondas liberadas/);
  await assert.rejects(liberar('{"a":1}'), /ondas liberadas/);
});

test('valor do parâmetro e ondas da base', async () => {
  assert.equal(valorOndas(['1', '2', ''], ['', '1', '2']), 'todas');
  assert.equal(valorOndas(['2', '10'], ['1', '2', '10']), '["2","10"]');
  assert.equal(valorOndas([], ['1']), '[]');
  assert.deepEqual(lerOndas('["1"]'), ['1']);
  assert.equal(lerOndas('todas'), null);
  assert.equal(condicaoOndas(SUP), null);
  const ondas = (await db.execute(consultaOndasDaBase())).rows.map((r) => [r.onda, Number(r.qtd), Number(r.na_lista)]);
  assert.deepEqual(ondas, [['', 1, 1], ['1', 1, 1], ['2', 2, 1]]);
});

test('filtro de onda: representante/vendedor e supervisor só veem as ondas liberadas; a gestão vê todas', () => {
  const ondas = ['1', '2', '3'];
  assert.deepEqual(ondasDoFiltro(ondas, REP, '["1","3"]'), ['1', '3']);
  assert.deepEqual(ondasDoFiltro(ondas, SUP, '["2"]'), ['2']);
  assert.deepEqual(ondasDoFiltro(ondas, { id: 9, perfil: 'gerente' }, '["2"]'), ondas);
  assert.deepEqual(ondasDoFiltro(ondas, { id: 4, perfil: 'administrador' }, '["2"]'), ondas);
  assert.deepEqual(ondasDoFiltro(ondas, REP, 'todas'), ondas);
});
