import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisarCnpj, calcularDv, cnpjValido, formatarCnpj, normalizarCnpj } from '../shared/cnpj.mjs';

test('normaliza pontuação, espaços e zeros à esquerda perdidos no Excel', () => {
  assert.equal(normalizarCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizarCnpj(' 11 222 333 0001 81 '), '11222333000181');
  assert.equal(normalizarCnpj(1222333000181), '01222333000181');
  assert.equal(normalizarCnpj('1222333000181.0'), '01222333000181');
  assert.equal(normalizarCnpj('1.1222333000181E+13'), '11222333000181');
  assert.equal(normalizarCnpj(''), null);
  assert.equal(normalizarCnpj('12345'), '00000000012345'); // completado; o DV decide se é válido
  assert.equal(normalizarCnpj('12.ABC.345/01DE-3'), null); // alfanumérico curto não é completado
});

test('valida DV de CNPJ numérico', () => {
  assert.equal(cnpjValido('11222333000181'), true);
  assert.equal(cnpjValido('11222333000182'), false);
  assert.equal(cnpjValido('11111111111111'), false);
  assert.equal(cnpjValido('00000000000000'), false);
});

test('CNPJ alfanumérico (IN RFB 2.229/2024): exemplo oficial 12.ABC.345/01DE-35', () => {
  assert.equal(calcularDv('12ABC34501DE'), '35');
  assert.equal(normalizarCnpj('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.equal(cnpjValido('12ABC34501DE35'), true);
  assert.equal(cnpjValido('12ABC34501DE36'), false);
  assert.equal(cnpjValido('12ABC34501DEA5'), false); // DV sempre numérico
});

test('analisarCnpj devolve o motivo da rejeição', () => {
  assert.deepEqual(analisarCnpj('11.222.333/0001-81'), { cnpj: '11222333000181', erro: null });
  assert.match(analisarCnpj('11.222.333/0001-80').erro, /dígito verificador/);
  assert.match(analisarCnpj('abc!').erro, /formato/);
  assert.match(analisarCnpj(null).erro, /vazio/);
});

test('formata para exibição', () => {
  assert.equal(formatarCnpj('12ABC34501DE35'), '12.ABC.345/01DE-35');
});
