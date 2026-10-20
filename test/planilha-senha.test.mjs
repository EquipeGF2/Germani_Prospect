import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { lerCsvTexto, lerPlanilha } from '../lib/planilha.mjs';
import { conferirSenha, gerarHashSenha } from '../shared/senha.mjs';
import { validarContato } from '../shared/status.mjs';

test('CSV com ";", aspas e decimal com vírgula', () => {
  const { linhas, separador } = lerCsvTexto('CNPJ;Nome;Lat\r\n"11.222.333/0001-81";"Mercado ""Bom"";Ltda";-29,71\r\n');
  assert.equal(separador, ';');
  assert.deepEqual(linhas[1], ['11.222.333/0001-81', 'Mercado "Bom";Ltda', '-29,71']);
});

test('CSV em Windows-1252 (padrão Senior) é decodificado', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gp-'));
  const arq = path.join(dir, 'a.csv');
  await writeFile(arq, Buffer.from([0x43, 0x69, 0x64, 0x61, 0x64, 0x65, 0x0a, 0x56, 0x65, 0x6e, 0xe2, 0x6e, 0x63, 0x69, 0x6f, 0x0a])); // "Venâncio" em latin1
  const r = await lerPlanilha(arq);
  assert.equal(r.linhas[1][0], 'Venâncio');
});

test('.xlsx malformado do Senior (caminhos com "\\" e styles.xml quebrado) é lido após reempacotar', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(['CNPJ', 'Razão social']);
  ws.addRow(['11222333000181', 'Mercado Teste']);
  const bom = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(bom);
  const ruim = new JSZip();
  for (const [nome, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    const conteudo = nome.endsWith('styles.xml') ? '<styleSheet><quebrado' : await f.async('uint8array');
    ruim.file(nome.startsWith('xl/') ? nome.replace(/\//g, '\\') : nome, conteudo);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gp-'));
  const arq = path.join(dir, 'senior.xlsx');
  await writeFile(arq, await ruim.generateAsync({ type: 'nodebuffer' }));
  const r = await lerPlanilha(arq);
  assert.match(r.observacao, /reempacotar/);
  assert.deepEqual(r.linhas[1], ['11222333000181', 'Mercado Teste']);
});

test('senha: PBKDF2 confere e rejeita', async () => {
  const h = await gerarHashSenha('segredo-123');
  assert.match(h, /^pbkdf2\$210000\$/);
  assert.equal(await conferirSenha('segredo-123', h), true);
  assert.equal(await conferirSenha('segredo-124', h), false);
  assert.equal(await conferirSenha('x', null), false);
  await assert.rejects(gerarHashSenha('curta'));
});

test('validação do formulário de contato espelha o banco', () => {
  assert.deepEqual(validarContato({ canal: 'visita', resultado: 'atendido', dataContato: '2026-10-01' }), []);
  assert.match(validarContato({ canal: 'visita', resultado: 'nao_atendido', dataContato: '2026-10-01' }).join(), /resultado inválido/);
  assert.match(validarContato({ canal: 'visita', resultado: 'sem_interesse', dataContato: '2026-10-01' }).join(), /motivo obrigatório/);
  assert.deepEqual(validarContato({ canal: 'visita', resultado: 'atendido', dataContato: '2026-10-01' }), []);
  assert.match(validarContato({ canal: 'visita', resultado: 'atendido', dataContato: '2026-10-01', dataRetorno: '2026-09-01' }).join(), /anterior/);
  assert.match(validarContato({ canal: 'fax', resultado: 'x', dataContato: '' }).join(), /canal.*resultado.*data/);
});

test('reabertura com pedido exige data de entrada do pedido não posterior ao registro', () => {
  const base = { canal: 'telefone', resultado: 'pedido_informado', dataContato: '2026-10-12' };
  assert.match(validarContato(base).join(), /data de entrada do pedido obrigatória/);
  assert.match(validarContato({ ...base, dataPedido: '2026-10-13' }).join(), /posterior/);
  assert.deepEqual(validarContato({ ...base, dataPedido: '2026-10-10' }), []);
  assert.match(validarContato({ canal: 'visita', resultado: 'atendido', dataContato: '2026-10-12', dataPedido: '2026-10-10' }).join(), /só vale/);
});

test('.xlsx com filtro gigante (_FilterDatabase até a coluna XEY) e validações é lido sem estourar a memória', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tabela Principal');
  ws.addRow([]);                                   // cabeçalho na linha 2, como na planilha real da GERMANI
  ws.addRow(['CNPJ', 'Razão social']);
  ws.addRow(['11222333000181', 'Mercado Teste']);
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  const livro = (await zip.file('xl/workbook.xml').async('string')).replace('</sheets>',
    `</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Tabela Principal'!$A$2:$XEY$15675</definedName></definedNames>`);
  zip.file('xl/workbook.xml', livro);
  const folha = (await zip.file('xl/worksheets/sheet1.xml').async('string')).replace('</sheetData>',
    '</sheetData><autoFilter ref="A2:XEY15675"/><dataValidations count="1"><dataValidation type="list" sqref="B3:B23040"><formula1>"a,b"</formula1></dataValidation></dataValidations>');
  zip.file('xl/worksheets/sheet1.xml', folha);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gp-'));
  const arq = path.join(dir, 'base.xlsx');
  await writeFile(arq, await zip.generateAsync({ type: 'nodebuffer' }));
  const antes = process.memoryUsage().heapUsed;
  const r = await lerPlanilha(arq);
  assert.ok(process.memoryUsage().heapUsed - antes < 300e6, 'sem expandir o filtro célula por célula');
  assert.deepEqual(r.linhas[1], ['CNPJ', 'Razão social']);
  assert.deepEqual(r.linhas[2], ['11222333000181', 'Mercado Teste']);
});
