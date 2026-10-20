// Lista de prospects: representante × vendedor, visões lista/cidade/bairro/rota, escopo e busca sem acento.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { consultaCarteira, consultaOndas, formaDeTrabalho, ORDENACOES, visoesPermitidas } from '../shared/carteira.mjs';
import { consultaPosicao } from '../shared/indicadores.mjs';
import { formatarCnpj } from '../shared/cnpj.mjs';
import { normalizarBusca } from '../shared/texto.mjs';

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
  await criarProspect(db, { n: 1, vendedorId: 2, cidade: 'Santa Cruz do Sul', bairro: 'Centro', rota: 'R1', onda: '1', razao: 'Padaria São João' });
  await criarProspect(db, { n: 2, vendedorId: 2, cidade: 'Santa Cruz do Sul', bairro: 'Goiás', rota: 'R1', onda: '2' });
  await criarProspect(db, { n: 3, vendedorId: 2, cidade: 'Venâncio Aires', bairro: 'Centro', onda: '1' });
  const p4 = await criarProspect(db, { n: 4, vendedorId: 2, cidade: 'Venâncio Aires', bairro: 'Centro' });
  await evento(db, { prospectId: p4, tipo: 'pedido', data: '2026-10-05', documento: 'P4' }); // sai da lista
  // vendedor
  await criarProspect(db, { n: 5, vendedorId: 3, cidade: 'Lajeado', bairro: 'Centro', rota: 'R7', subrota: 'S1' });
  await criarProspect(db, { n: 6, vendedorId: 3, cidade: 'Lajeado', bairro: 'Centro', rota: 'R7', subrota: 'S2' });
  const p7 = await criarProspect(db, { n: 7, vendedorId: 3, cidade: 'Lajeado', bairro: 'Florestal', rota: 'R8' });
  await registrarContato(db, { prospectId: p7, usuarioId: 3, resultado: 'atendido', data: '2026-10-05' }); // em negociação: sai da lista
});

const linhas = async (q) => (await db.execute(q)).rows;

test('forma de trabalho e visões: representante sem rota; vendedor e gestão com rota', () => {
  assert.equal(formaDeTrabalho(REP), 'representante');
  assert.equal(formaDeTrabalho({ id: 9, perfil: 'vendedor', tipo_atuacao: null }), 'representante'); // não definido = mais restrito
  assert.equal(formaDeTrabalho(VEND), 'vendedor');
  assert.equal(formaDeTrabalho(SUP), 'gestao');
  assert.deepEqual(visoesPermitidas(REP), ['lista', 'cidade', 'bairro', 'onda', 'status']);
  assert.deepEqual(visoesPermitidas(VEND), ['lista', 'cidade', 'bairro', 'onda', 'status', 'rota']);
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

test('lista do vendedor: com rota/subrota; prospect em negociação fora da lista', async () => {
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
  assert.equal(Number(g.aguardando_cadastro), 1);
  const b = await linhas(consultaPosicao({ agrupar: 'bairro' }));
  assert.equal(Number(b.find((x) => x.rotulo === 'Centro — Lajeado/RS').total), 2);
  const r = await linhas(consultaPosicao({ agrupar: 'rota' }));
  assert.deepEqual(r.map((x) => x.rotulo).sort(), ['R7 / S1', 'R7 / S2', 'R8']); // só prospects de vendedor
});

test('acompanhamento por status: carteira inteira, inclusive o que saiu da lista', async () => {
  const r = await linhas(consultaCarteira({ usuario: VEND, visao: 'status' }));
  const por = Object.fromEntries(r.map((x) => [x.status_atual, Number(x.prospects)]));
  assert.deepEqual(por, { nao_contactado: 2, em_prospeccao: 0, aguardando_cadastro: 1, sem_interesse: 0, analise_financeira: 0, aguardando_pedido: 0, venda_realizada: 0, invalido: 0 });
  // cards na ordem do processo; sem interesse e inválido (encerrados) por último
  assert.deepEqual(r.map((x) => x.status_atual), ['nao_contactado', 'em_prospeccao', 'aguardando_cadastro', 'analise_financeira', 'aguardando_pedido', 'venda_realizada', 'sem_interesse', 'invalido']);
  const neg = await linhas(consultaCarteira({ usuario: VEND, filtros: { status: 'aguardando_cadastro' } }));
  assert.equal(neg.length, 1);
  assert.equal(neg[0].status_descricao, 'Aguardando cadastro · atendido em 05/10/2026');
  assert.equal(neg[0].dt_primeiro_contato, '2026-10-05');
  const rep = Object.fromEntries((await linhas(consultaCarteira({ usuario: REP, visao: 'status' }))).map((x) => [x.status_atual, Number(x.prospects)]));
  assert.equal(rep.venda_realizada, 1); // representante também acompanha por status
});

test('Aguardando cadastro fica só no acompanhamento: o filtro de retornos da lista não o traz', async () => {
  await db.execute("UPDATE prospects SET data_proxima_acao = '2026-01-01' WHERE status_atual = 'aguardando_cadastro'");
  const lista = await linhas(consultaCarteira({ usuario: VEND, filtros: { somenteRetornos: true } }));
  assert.ok(lista.every((x) => x.status_atual !== 'aguardando_cadastro'));
  const acomp = await linhas(consultaCarteira({ usuario: VEND, filtros: { status: 'aguardando_cadastro', somenteRetornos: true } }));
  assert.equal(acomp.length, 1);
});

test('onda: visão agrupada e filtro, na lista, nos indicadores e no histórico (representante também usa)', async () => {
  const v = await linhas(consultaCarteira({ usuario: REP, visao: 'onda' }));
  assert.deepEqual(v.map((x) => [x.rotulo, Number(x.prospects)]), [['Onda 1', 2], ['Onda 2', 1]]);
  const f = await linhas(consultaCarteira({ usuario: REP, filtros: { onda: 1 } }));
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.onda === '1'));
  const ind = await linhas(consultaPosicao({ agrupar: 'onda', filtros: { vendedorId: 2 } }));
  assert.deepEqual(ind.map((x) => [x.rotulo, Number(x.total)]), [['(sem onda)', 1], ['Onda 1', 2], ['Onda 2', 1]]);
  const { consultaMovimentacoes } = await import('../shared/indicadores.mjs');
  const mv = await linhas(consultaMovimentacoes({ filtros: { onda: '2' } }));
  assert.ok(mv.length >= 1 && mv.every((x) => x.onda === '2'));
});

test('gestão filtra a lista por supervisor e por vendedor/representante; vendedor ignora esses filtros', async () => {
  const ADM = { id: 4, perfil: 'administrador' };
  const GER = { id: 4, perfil: 'gerente' };
  assert.equal((await linhas(consultaCarteira({ usuario: ADM }))).length, 5);
  assert.equal((await linhas(consultaCarteira({ usuario: ADM, filtros: { supervisorId: 1 } }))).length, 5);
  assert.equal((await linhas(consultaCarteira({ usuario: ADM, filtros: { supervisorId: 5 } }))).length, 0);
  const doRep = await linhas(consultaCarteira({ usuario: GER, filtros: { supervisorId: 1, vendedorId: 2 } }));
  assert.equal(doRep.length, 3);
  assert.ok(doRep.every((p) => Number(p.vendedor_id) === 2));
  assert.equal((await linhas(consultaCarteira({ usuario: ADM, visao: 'cidade', filtros: { vendedorId: 3 } }))).length, 1);   // vale nas visões agrupadas
  assert.equal((await linhas(consultaCarteira({ usuario: REP, filtros: { supervisorId: 5, vendedorId: 3 } }))).length, 3);  // vendedor: sempre a própria carteira
});

test('computador: onda em ordem natural, rota em 2 níveis e filtro pela data do último registro', async () => {
  const ADM = { id: 4, perfil: 'administrador' };
  const ondas = await linhas(consultaCarteira({ usuario: ADM, visao: 'onda', ordemNatural: true }));
  assert.deepEqual(ondas.map((o) => o.rotulo), ['Onda 1', 'Onda 2', '(sem onda)']);
  const n1 = await linhas(consultaCarteira({ usuario: VEND, visao: 'rota', ordemNatural: true, rotaEmNiveis: true }));
  assert.deepEqual(n1.map((x) => [x.rotulo, Number(x.prospects)]), [['Rota R7', 2]]);
  const n2 = await linhas(consultaCarteira({ usuario: VEND, visao: 'rota', ordemNatural: true, rotaEmNiveis: true, filtros: { rota: 'R7' } }));
  assert.deepEqual(n2.map((x) => x.rotulo), ['Subrota S1', 'Subrota S2']);
  const porData = await linhas(consultaCarteira({ usuario: VEND, incluirForaDaLista: true, filtros: { dataDe: '2026-10-05', dataAte: '2026-10-05' } }));
  assert.equal(porData.length, 1);                                     // só o atendido em 05/10
});

test('lista ordenada pelos rótulos das colunas (crescente/decrescente) e ondas para o filtro', async () => {
  const ADM = { id: 4, perfil: 'administrador' };
  const nomes = async (ordenar) => (await linhas(consultaCarteira({ usuario: ADM, ordenar }))).map((p) => p.razao_social);
  const asc = await nomes({ campo: 'prospect' });
  assert.deepEqual(asc, [...asc].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.deepEqual(await nomes({ campo: 'prospect', desc: true }), [...asc].reverse());
  const porOnda = (await linhas(consultaCarteira({ usuario: ADM, ordenar: { campo: 'onda' } }))).map((p) => p.onda ?? null);
  assert.deepEqual(porOnda, [...porOnda].sort((a, b) => (a == null) - (b == null) || String(a).length - String(b).length || String(a).localeCompare(String(b))));
  for (const campo of Object.keys(ORDENACOES)) {                       // toda coluna ordena nos dois sentidos sem erro
    if (campo === 'rota') continue;
    await linhas(consultaCarteira({ usuario: ADM, ordenar: { campo } }));
    await linhas(consultaCarteira({ usuario: ADM, ordenar: { campo, desc: true }, filtros: { foraDaLista: true } }));
  }
  await linhas(consultaCarteira({ usuario: VEND, ordenar: { campo: 'rota', desc: true } }));
  // campo desconhecido é ignorado (nunca vira SQL)
  assert.deepEqual(await nomes({ campo: 'razao_social; DROP TABLE prospects' }), await nomes(null));
  assert.deepEqual((await linhas(consultaOndas())).map((o) => o.onda), ['1', '2']);
  assert.ok((await linhas(consultaCarteira({ usuario: ADM, filtros: { onda: '1' } }))).every((p) => p.onda === '1'));
});

test('busca com índice de texto (0006) devolve exatamente o mesmo que a busca antiga (LIKE na tabela)', async () => {
  const ADM = { id: 4, perfil: 'administrador' };
  const antiga = async (termo) => {
    const t = normalizarBusca(termo);
    const c = t.replace(/[.\-\/\s]/g, '');
    return (await db.execute({ sql: `SELECT id FROM prospects p JOIN status s ON s.codigo = p.status_atual
      WHERE s.lista_trabalho = 1 AND (busca LIKE '%' || ? || '%' OR COALESCE(bairro_busca, '') LIKE '%' || ? || '%' OR cnpj LIKE ? || '%') ORDER BY id`,
    args: [t, t, c] })).rows.map((r) => Number(r.id));
  };
  const nova = async (termo) => (await linhas(consultaCarteira({ usuario: ADM, busca: termo }))).map((p) => Number(p.id)).sort((a, b) => a - b);
  const exemplo = (await db.execute('SELECT cnpj, bairro, cidade, razao_social FROM prospects LIMIT 1')).rows[0];
  const cnpjFormatado = formatarCnpj(exemplo.cnpj);
  for (const termo of ['emp', 'Empresa 1', 'santa', 'cruz do', exemplo.cnpj.slice(0, 6), cnpjFormatado.slice(0, 7), cnpjFormatado, 'zz', 'a', exemplo.bairro ?? 'centro', 'inexistente xyz']) {
    assert.deepEqual(await nova(termo), await antiga(termo), `termo "${termo}"`);
  }
});
