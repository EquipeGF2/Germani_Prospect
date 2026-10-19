import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveCabecalho, limparTexto, normalizarBusca, palavrasChave, somenteDigitos } from '../shared/texto.mjs';
import { analisarData, diasEntre, hojeSaoPaulo, somarDias } from '../shared/datas.mjs';

test('busca ignora acentuação: A, Á, Â, Ã, à são iguais', () => {
  assert.equal(normalizarBusca('Á â ã à a'), 'A A A A A');
  assert.equal(normalizarBusca('  Venâncio   Aires '), 'VENANCIO AIRES');
  assert.equal(normalizarBusca('Conceição'), 'CONCEICAO');
  assert.equal(normalizarBusca('São João'), normalizarBusca('SAO JOAO'));
});

test('cabeçalhos da planilha base são reconhecidos com variações', () => {
  assert.equal(chaveCabecalho('DT 1o.contato'), chaveCabecalho('DT 1º.CONTATO'));
  assert.equal(chaveCabecalho('Código Postal'), 'CODIGOPOSTAL');
  assert.equal(chaveCabecalho('# Dias Corridos'), 'DIASCORRIDOS');
});

test('limpeza básica', () => {
  assert.equal(limparTexto('  a   b  '), 'a b');
  assert.equal(limparTexto('   '), null);
  assert.equal(somenteDigitos('(51) 3711-0000'), '5137110000');
  assert.equal(somenteDigitos('—'), null);
});

test('palavras-chave de observação (para ranking de motivos)', () => {
  assert.deepEqual(palavrasChave('Preço muito alto, já compra da concorrência'), ['PRECO', 'ALTO', 'COMPRA', 'CONCORRENCIA']);
});

test('datas da planilha: serial Excel, dd/mm/aaaa, ISO e inválidas', () => {
  assert.deepEqual(analisarData(46296), { data: '2026-10-01', erro: null });
  assert.deepEqual(analisarData('05/09/2026'), { data: '2026-09-05', erro: null });
  assert.deepEqual(analisarData('05/09/26'), { data: '2026-09-05', erro: null });
  assert.deepEqual(analisarData('2026-09-05T00:00:00'), { data: '2026-09-05', erro: null });
  assert.deepEqual(analisarData(new Date(Date.UTC(2026, 8, 5))), { data: '2026-09-05', erro: null });
  assert.deepEqual(analisarData(''), { data: null, erro: null });
  assert.match(analisarData('31/02/2026').erro, /inválida/);
  assert.match(analisarData('ontem').erro, /não reconhecido/);
});

test('"hoje" é o dia em São Paulo (UTC−3)', () => {
  assert.equal(hojeSaoPaulo(new Date('2026-10-20T02:30:00Z')), '2026-10-19');
  assert.equal(hojeSaoPaulo(new Date('2026-10-20T03:30:00Z')), '2026-10-20');
  assert.equal(somarDias('2026-12-25', 10), '2027-01-04');
  assert.equal(diasEntre('2026-10-01', '2026-10-19'), 18);
});
