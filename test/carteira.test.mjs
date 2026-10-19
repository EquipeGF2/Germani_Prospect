// Lista de prospects: representante × vendedor, visões lista/cidade/bairro/rota, escopo e busca sem acento.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { consultaCarteira, formaDeTrabalho, visoesPermitidas } from '../shared/carteira.mjs';
import { consultaPosicao } from '../shared/indicadores.mjs';
import { formatarCnpj } from '../shared/cnpj.mjs';

let db;
// usuário 2 = representante · usuário 3 = vendedor (ambos do supervisor 1)
const REP = { id: 2, perfil: 'vendedor', tipo_atuacao: 'representante' };
const VEND = { id: 3, perfil: 'vendedor', tipo_atuacao: 'vendedor' };
const SUP = { id: 1, perfil: 'supervisor' };
const SUP2 = { id: 5, perfil: 'supervisor' };

before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'representante' WHERE id = 2");
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'vendedor' WHERE id = 3");
  // representante: rota preenchida na planilha, mas não pode aparecer
  await criarProspect(db, { n: 1, vendedorId: 2, cidade: 'Santa Cruz do Sul', bairro: 'Centro', rota: 'R1', razao: 'Padaria São João' });
  await criarProspect(db, { n: 2, vendedorId: 2, cidade: 'Santa Cruz do Sul', bairro: 'Goiás', rota: 'R1' });
  await criarProspect(db, { n: 3, vendedorId: 2, cidade: 'Venâncio Aires', bairro: 'Centro' });
  const p4 = await criarProspect(db, { n: 4, vendedorId: 2, cidade: 'Venâncio Aires', bairro: 'Centro' });
  await evento(db, { prospectId: p4, tipo: 'pedido', data: '2026-10-05', documento: 'P4' }); // sai da lista
  // vendedor
  await criarProspect(db, { n: 5, vendedorId: 3, cidade: 'Lajeado', bairro: 'Centro', rota: 'R7', subrota: 'S1' });
  await criarProspect(db, { n: 6, vendedorId: 3, cidade: 'Lajeado', bairro: 'Centro', rota: 'R7', subrota: 'S2' });
  const p7 = await criarProspect(db, { n: 7, vendedorId: 3, cidade: 'Lajeado', bairro: 'Florestal', rota: 'R8' });
  await registrarContato(db, { prospectId: p7, usuarioId: 3, resultado: 'sem_conclusao', data: '2026-10-01' });
  await registrarContato(db, { prospectId: p7, usuarioId: 3, resultado: 'com_interesse', data: '2026-10-05' }); // 2º atendimento: sai da lista
});

const linhas = async (q) => (await db.execute(q)).rows;

test('forma de trabalho e visões: representante sem rota; vendedor e gestão com rota', () => {
  assert.equal(formaDeTrabalho(REP), 'representante');
  assert.equal(formaDeTrabalho({ id: 9, perfil: 'vendedor', tipo_atuacao: null }), 'representante'); // não definido = mais restrito
  assert.equal(formaDeTrabalho(VEND), 'vendedor');
  assert.equal(formaDeTrabalho(SUP), 'gestao');
  assert.deepEqual(visoesPermitidas(REP), ['lista', 'cidade', 'bairro']);
  assert.deepEqual(visoesPermitidas(VEND), ['lista', 'cidade', 'bairro', 'rota']);
  assert.throws(() => consultaCarteira({ usuario: REP, visao: 'rota' }), /não disponível para representante/);
  assert.throws(() => consultaCarteira({ usuario: REP, filtros: { rota: 'R1' } }), /não trabalha com rota/);
});

test('lista do representante: só a própria carteira, só o que está na lista, sem colunas de rota', async () => {
  const q = consultaCarteira({ usuario: REP });
  assert.ok(!q.colunas.includes('rota'));
  const r = await linhas(q);
  assert.equal(r.length, 3); // P4 saiu (pedido)
  assert.ok(r.every((x) => !('rota' in x)));
  const todos = await linhas(consultaCarteira({ usuario: REP, incluirForaDaLista: true }));
  assert.equal(todos.length, 4);
});

test('lista do vendedor: com rota/subrota; prospect com 2 atendimentos fora da lista', async () => {
  const r = await linhas(consultaCarteira({ usuario: VEND }));
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.rota), ['R7', 'R7']);
  const s1 = await linhas(consultaCarteira({ usuario: VEND, filtros: { rota: 'R7', subrota: 'S1' } }));
  assert.equal(s1.length, 1);
});

test('visão por cidade e por bairro (com contagens)', async () => {
  const c = await linhas(consultaCarteira({ usuario: REP, visao: 'cidade' }));
  assert.deepEqual(c.map((x) => [x.rotulo, Number(x.prospects)]), [['Santa Cruz do Sul/RS', 2], ['Venâncio Aires/RS', 1]]);
  const b = await linhas(consultaCarteira({ usuario: REP, visao: 'bairro', filtros: { cidadeBusca: 'SANTA CRUZ DO SUL' } }));
  assert.deepEqual(b.map((x) => x.rotulo).sort(), ['Centro — Santa Cruz do Sul', 'Goiás — Santa Cruz do Sul']);
});

test('visão por rota do vendedor; gestão vê rota só de vendedores', async () => {
  const r = await linhas(consultaCarteira({ usuario: VEND, visao: 'rota' }));
  assert.deepEqual(r.map((x) => [x.rotulo, Number(x.prospects)]), [['R7 / S1', 1], ['R7 / S2', 1]]);
  const g = await linhas(consultaCarteira({ usuario: SUP, visao: 'rota' }));
  assert.ok(g.every((x) => x.rota !== 'R1')); // R1 é de representante: não aparece
  const lista = await linhas(consultaCarteira({ usuario: SUP }));
  assert.equal(lista.find((x) => x.razao_social === 'Padaria São João').rota, null);
});

test('busca ignora acento e aceita CNPJ formatado', async () => {
  assert.equal((await linhas(consultaCarteira({ usuario: REP, busca: 'padaria sao joao' }))).length, 1);
  assert.equal((await linhas(consultaCarteira({ usuario: REP, busca: 'VENÂNCIO' }))).length, 1);
  assert.equal((await linhas(consultaCarteira({ usuario: REP, busca: 'goias' }))).length, 1);
  const cnpj = (await linhas(consultaCarteira({ usuario: REP, busca: 'padaria' })))[0].cnpj;
  assert.equal((await linhas(consultaCarteira({ usuario: REP, busca: formatarCnpj(cnpj) }))).length, 1);
});

test('escopo: supervisor vê a equipe; outro supervisor não vê nada; vendedor não vê o representante', async () => {
  assert.equal((await linhas(consultaCarteira({ usuario: SUP }))).length, 5);
  assert.equal((await linhas(consultaCarteira({ usuario: SUP2 }))).length, 0);
  assert.equal((await linhas(consultaCarteira({ usuario: VEND, busca: 'padaria' }))).length, 0);
});

test('indicadores continuam contando quem saiu da lista; agrupamento por bairro e rota', async () => {
  const [g] = await linhas(consultaPosicao({ agrupar: 'geral' }));
  assert.equal(Number(g.total), 7);
  assert.equal(Number(g.vendas), 1);
  assert.equal(Number(g.com_interesse_aguardando_cadastro), 1);
  const b = await linhas(consultaPosicao({ agrupar: 'bairro' }));
  assert.equal(Number(b.find((x) => x.rotulo === 'Centro — Lajeado/RS').total), 2);
  const r = await linhas(consultaPosicao({ agrupar: 'rota' }));
  assert.deepEqual(r.map((x) => x.rotulo).sort(), ['R7 / S1', 'R7 / S2', 'R8']); // só prospects de vendedor
});
