// Listas por equipe (Importações › Exportar, docs/03 §17): um PDF por representante, pasta por supervisor, ordem cidade › bairro › segmento.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { blocosParaPdf, consultaContagemListas, consultaListasEquipe, montarListasEquipe, nomeSeguro } from '../shared/listas-equipe.mjs';
import { crc32, montarZip } from '../shared/zip.mjs';

let db; let p;

before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  p = {
    centroB: await criarProspect(db, { n: 1, cidade: 'VENÂNCIO AIRES', bairro: 'Centro', onda: '1', razao: 'Bazar B' }),
    arroio: await criarProspect(db, { n: 2, cidade: 'SANTA CRUZ DO SUL', bairro: 'Arroio', onda: '1', razao: 'Mercado Z' }),
    centroA: await criarProspect(db, { n: 3, cidade: 'VENÂNCIO AIRES', bairro: 'Centro', onda: '1', razao: 'Armazém A' }),
    onda2: await criarProspect(db, { n: 4, cidade: 'SANTA CRUZ DO SUL', bairro: 'Arroio', onda: '2' }),
    baixado: await criarProspect(db, { n: 5, cidade: 'SANTA CRUZ DO SUL', bairro: 'Arroio', onda: '1' }),
    atendido: await criarProspect(db, { n: 6, cidade: 'SANTA CRUZ DO SUL', bairro: 'Úrsula', onda: '1' }),
    outroRep: await criarProspect(db, { n: 7, vendedorId: 3, onda: '1' }),
  };
  await db.execute({ sql: 'UPDATE prospects SET tipologia_gtm = ? WHERE id = ?', args: ['Supermercado', p.centroB] });
  await db.execute({ sql: 'UPDATE prospects SET tipologia_gtm = ? WHERE id = ?', args: ['Mercearia', p.centroA] });
  await evento(db, { prospectId: p.baixado, tipo: 'baixa', data: '2026-10-01' });
  await registrarContato(db, { prospectId: p.atendido, resultado: 'atendido', data: '2026-10-05', retorno: '2026-12-01' });
});

const ler = async (opcoes) => montarListasEquipe((await db.execute(consultaListasEquipe(opcoes))).rows);

test('válidos da onda 1: um PDF por representante, pasta do supervisor, sem baixados e sem outras ondas', async () => {
  const listas = await ler({ abrangencia: 'validos', onda: '1' });
  assert.deepEqual(listas.map((l) => `${l.pasta}/${l.arquivo}`), ['Sup Um/10 - Vend Dez.pdf', 'Sup Um/11 - Vend Onze.pdf']);
  const dez = listas[0];
  assert.equal(dez.total, 4, 'baixado e onda 2 ficam de fora');
  // cidade em ordem; dentro da cidade bairro (sem acento) › segmento › razão social
  assert.deepEqual(dez.blocos.map((b) => b.grupo), ['SANTA CRUZ DO SUL/RS', 'VENÂNCIO AIRES/RS']);
  assert.deepEqual(dez.blocos[0].linhas.map((l) => l.bairro), ['Arroio', 'Úrsula']);
  assert.deepEqual(dez.blocos[1].linhas.map((l) => l.razao_social), ['Armazém A', 'Bazar B'], 'Mercearia antes de Supermercado');
  assert.equal(dez.porStatus.get('nao_contactado'), 3);
});

test('só a Lista principal deixa de fora quem já foi atendido', async () => {
  const [dez] = await ler({ abrangencia: 'lista', onda: '1' });
  assert.equal(dez.total, 3);
  assert.ok(!dez.blocos.flatMap((b) => b.linhas).some((l) => l.bairro === 'Úrsula'));
});

test('filtro de supervisor e contagem para o botão', async () => {
  assert.equal((await ler({ onda: '1', supervisorId: 5 })).length, 0, 'supervisor sem equipe');
  const contagem = (await db.execute(consultaContagemListas({ abrangencia: 'validos' }))).rows;
  const onda1 = contagem.filter((l) => l.onda === '1').reduce((t, l) => t + Number(l.qtd), 0);
  assert.equal(onda1, 5);
});

test('nome de pasta e arquivo sem acento nem caractere proibido', () => {
  assert.equal(nomeSeguro('João / Equipe: Sul'), 'Joao Equipe Sul');
  assert.equal(nomeSeguro(''), 'sem nome');
});

test('ZIP com pastas abre e devolve os mesmos bytes', async () => {
  const a = new TextEncoder().encode('%PDF-1 teste');
  const b = new Uint8Array([0, 1, 2, 255]);
  const zip = await JSZip.loadAsync(montarZip([{ caminho: 'Sup Um/10 - Vend Dez.pdf', dados: a }, { caminho: 'Sup Dois/Ação.pdf', dados: b }]));
  assert.deepEqual(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(), ['Sup Dois/Ação.pdf', 'Sup Um/10 - Vend Dez.pdf']);
  assert.deepEqual(await zip.file('Sup Um/10 - Vend Dez.pdf').async('uint8array'), a);
  assert.deepEqual(await zip.file('Sup Dois/Ação.pdf').async('uint8array'), b);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('PDF de clientes (Lista e Acompanhamento): sempre cidade › bairro › segmento; com grupos da tela, cada grupo nessa ordem', () => {
  const l = (razao, cidade, bairro, seg) => ({ razao_social: razao, cidade, uf: 'RS', bairro, tipologia_gtm: seg });
  const linhas = [l('Zeta', 'Venâncio Aires', 'Centro', 'Mercado'), l('Alfa', 'Lajeado', 'São Cristóvão', 'Padaria'), l('Beta', 'Lajeado', 'Centro', 'Padaria'),
    l('Gama', 'Lajeado', 'Centro', 'Mercado'), l('Delta', 'ÁGUA SANTA', 'Centro', 'Mercado')];
  const blocos = blocosParaPdf(linhas);
  assert.deepEqual(blocos.map((b) => [b.grupo, b.linhas.map((x) => x.razao_social)]), [
    ['ÁGUA SANTA/RS', ['Delta']], ['Lajeado/RS', ['Gama', 'Beta', 'Alfa']], ['Venâncio Aires/RS', ['Zeta']]]);
  const porRota = blocosParaPdf([], [{ grupo: 'Rota R1', linhas: [linhas[0], linhas[1], linhas[2]] }]);
  assert.deepEqual(porRota[0].linhas.map((x) => x.razao_social), ['Beta', 'Alfa', 'Zeta'], 'o grupo fica; dentro, cidade › bairro › segmento');
});
