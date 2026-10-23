// Montagem de rotas: só vendedor, só a própria carteira, plano editável, execução medida pelos contatos.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { comandoCriarRota, comandoEncerrarRota, comandosSalvarParadas, consultaParadas, linkMapa, sugerirOrdem, telefoneParaLink } from '../shared/rotas.mjs';
import { consultaExecucaoRotas } from '../shared/indicadores.mjs';
import { consultaCarteira } from '../shared/carteira.mjs';

const REP = { id: 2, perfil: 'vendedor', tipo_atuacao: 'representante' };
const VEND = { id: 3, perfil: 'vendedor', tipo_atuacao: 'vendedor' };
let db, p;

beforeEach(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'representante' WHERE id = 2");
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'vendedor' WHERE id = 3");
  p = {
    a: await criarProspect(db, { n: 1, vendedorId: 3, cidade: 'Lajeado', bairro: 'Centro' }),
    b: await criarProspect(db, { n: 2, vendedorId: 3, cidade: 'Lajeado', bairro: 'Americano' }),
    c: await criarProspect(db, { n: 3, vendedorId: 3, cidade: 'Estrela', bairro: 'Centro' }),
    rep: await criarProspect(db, { n: 4, vendedorId: 2 }),
  };
});

async function criarRota(usuario = VEND, data = '2026-10-20') {
  return Number((await db.execute(comandoCriarRota({ usuario, dataRota: data }))).rows[0].id);
}

test('representante não monta rota (app e banco)', async () => {
  assert.throws(() => comandoCriarRota({ usuario: REP, dataRota: '2026-10-20' }), /exclusiva do vendedor/);
  await assert.rejects(db.execute("INSERT INTO rotas (vendedor_id, data_rota) VALUES (2, '2026-10-20')"), /exclusiva do vendedor/);
  await assert.rejects(db.execute("INSERT INTO rotas (vendedor_id, data_rota) VALUES (1, '2026-10-20')"), /exclusiva do vendedor/); // supervisor
});

test('ordem sugerida por cidade → bairro, sem distância (a partir da lista da carteira)', async () => {
  const linhas = (await db.execute(consultaCarteira({ usuario: VEND }))).rows;
  assert.deepEqual(sugerirOrdem(linhas), [p.c, p.b, p.a]); // Estrela/Centro, Lajeado/Americano, Lajeado/Centro
  // sem as colunas normalizadas, normaliza na hora (acento não separa grupos)
  const crus = [{ id: 1, cidade: 'Lajeado', bairro: 'São Cristóvão' }, { id: 2, cidade: 'Lajeado', bairro: 'Americano' }, { id: 3, cidade: 'Lajeado', bairro: 'SAO CRISTOVAO' }];
  assert.deepEqual(sugerirOrdem(crus), [2, 1, 3]);
});

test('monta, reordena e mede a execução da rota; tudo entra nos indicadores', async () => {
  const rota = await criarRota();
  await db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.a, p.b, p.c] }), 'write');
  await db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.c, p.a] }), 'write'); // reordena e tira p.b
  let paradas = (await db.execute(consultaParadas({ usuario: VEND, rotaId: rota }))).rows;
  assert.deepEqual(paradas.map((x) => [x.prospect_id, x.ordem]), [[p.c, 1], [p.a, 2]]);
  await registrarContato(db, { prospectId: p.c, usuarioId: 3, resultado: 'atendido', data: '2026-10-20' });
  paradas = (await db.execute(consultaParadas({ usuario: VEND, rotaId: rota }))).rows;
  assert.deepEqual(paradas.map((x) => x.atendida), [1, 0]);
  const [g] = (await db.execute(consultaExecucaoRotas({ inicio: '2026-10-01', fim: '2026-10-31' }))).rows;
  assert.deepEqual([Number(g.rotas), Number(g.paradas_planejadas), Number(g.paradas_atendidas)], [1, 2, 1]);
  const [s] = (await db.execute(consultaExecucaoRotas({ agrupar: 'supervisor', inicio: '2026-10-01', fim: '2026-10-31' }))).rows;
  assert.equal(s.rotulo, 'Sup Um');
  // supervisor consulta a rota da equipe
  assert.equal((await db.execute(consultaParadas({ usuario: { id: 1, perfil: 'supervisor' }, rotaId: rota }))).rows.length, 2);
  assert.equal((await db.execute(consultaParadas({ usuario: { id: 5, perfil: 'supervisor' }, rotaId: rota }))).rows.length, 0);
});

test('na rota só entram prospects da própria carteira, da lista principal ou em negociação', async () => {
  const rota = await criarRota();
  await assert.rejects(db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.rep] }), 'write'), /não pertence à carteira/);
  await evento(db, { prospectId: p.b, tipo: 'pedido', data: '2026-10-10', documento: 'X' });
  await assert.rejects(db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.b] }), 'write'), /lista principal, aguardando cadastro ou aguardando pedido/);
  await registrarContato(db, { prospectId: p.a, usuarioId: 3, resultado: 'atendido', data: '2026-10-10' }); // em negociação: pode
  await db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.a] }), 'write');
  assert.throws(() => comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.a, p.a] }), /repetido/);
});

test('rota concluída fica travada; rota não é apagada', async () => {
  const rota = await criarRota();
  await db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.a] }), 'write');
  await db.execute(comandoEncerrarRota({ usuario: VEND, rotaId: rota, situacao: 'concluida' }));
  await assert.rejects(db.batch(comandosSalvarParadas({ usuario: VEND, rotaId: rota, prospectIds: [p.b] }), 'write'), /não pode ser alterada/);
  await assert.rejects(db.execute({ sql: "UPDATE rotas SET nome = 'x' WHERE id = ?", args: [rota] }), /não pode ser alterada/);
  await assert.rejects(db.execute({ sql: 'DELETE FROM rotas WHERE id = ?', args: [rota] }), /não são apagadas/);
});

test('link do mapa usa a coordenada, nunca dado pessoal', () => {
  assert.equal(linkMapa({ latitude: -29.4669, longitude: -51.9614 }), 'https://www.google.com/maps/search/?api=1&query=-29.466900,-51.961400');
  assert.equal(linkMapa({ latitude: null, longitude: -51 }), null);
});

test('telefone para Ligar/WhatsApp: sem telefone não quebra a ficha', () => {
  // cliente sem telefone na base (o banco guarda null) derrubava a ficha: somenteDigitos('') é null
  assert.deepEqual([null, undefined, '', '-', '3000-0000', '(51) 3000-0000', '5551999990000', 5130000000].map(telefoneParaLink),
    [null, null, null, null, null, '555130000000', '5551999990000', '555130000000']);
});
