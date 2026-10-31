// Acompanhamento: fluxo do cadastro ao faturado, primeiro pedido e crédito × pedido. Dados fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cascata, compararCredito, consultaAcompanhamento, contarCredito, contarFluxo, etapaDoCliente, etapaDoStatus, formaLiberada, linhasDaEtapa, montarArvoreAcomp, montarClientes, ordenarPedidosValidos, prazoLiberado } from '../shared/acompanhamento.mjs';
import { bancoTeste, criarEquipe, criarProspect } from './auxiliar.mjs';

const adm = { id: 4, perfil: 'administrador' };
const pedido = (prospectId, numero, o = {}) => ({ prospect_id: prospectId, numero: String(numero), tipo: 'venda', valida: 1, fase: 'carteira', valor_pedido: 100, saldo: 100, valor_faturado: 0, data_primeira: '2026-10-10', data_situacao: '2026-10-10', ...o });
const cliente = (id, status, o = {}) => ({ id, status_atual: status, cnpj: `1111111${id}000100`, cnpj_raiz: `1111111${id}`, razao_social: `Cliente ${id}`, vendedor_id: 2, vendedor_nome: 'Vend', vendedor_codigo: '10', dt_cadastro_erp: '2026-10-01', ...o });

test('o primeiro pedido é o que apareceu antes, depois o de menor número; só venda válida conta', () => {
  const ordem = ordenarPedidosValidos([pedido(1, 30, { data_primeira: '2026-10-09' }), pedido(1, 10, { data_primeira: '2026-10-20' }), pedido(1, 20, { data_primeira: '2026-10-09' }),
    pedido(1, 5, { data_primeira: '2026-01-01', valida: 0, fase: 'cancelado' }), pedido(1, 6, { data_primeira: '2026-01-01', tipo: 'investimento' })]);
  assert.deepEqual(ordem.map((p) => [p.numero, p.ordem]), [['20', 1], ['30', 2], ['10', 3]]);
});

test('a etapa segue o status e, na venda, o primeiro pedido', () => {
  assert.equal(etapaDoCliente(cliente(1, 'aguardando_cadastro')), 'antes');
  assert.equal(etapaDoCliente(cliente(1, 'analise_financeira')), 'analise');
  assert.equal(etapaDoCliente(cliente(1, 'aguardando_pedido')), 'pedido');
  assert.equal(etapaDoCliente(cliente(1, 'aguardando_pedido_valido')), 'pedido', 'pedido cancelado continua no fluxo: não volta para pendentes');
  assert.equal(etapaDoCliente(cliente(1, 'venda_realizada'), pedido(1, 1)), 'carteira');
  assert.equal(etapaDoCliente(cliente(1, 'venda_realizada'), pedido(1, 1, { fase: 'parcial' })), 'faturado');
  assert.equal(etapaDoCliente(cliente(1, 'venda_realizada'), pedido(1, 1, { fase: 'faturado' })), 'faturado');
  assert.equal(etapaDoCliente(cliente(1, 'sem_interesse')), 'encerrados');
  assert.equal(etapaDoStatus('sem_interesse'), 'encerrados');
  assert.equal(etapaDoStatus('aguardando_pedido_valido'), 'pedido');
  assert.equal(etapaDoStatus('venda_realizada'), 'faturado');
});

test('pedido fora da base não entra; segundo pedido não muda a etapa, só a estatística', () => {
  const lista = montarClientes({ clientes: [cliente(1, 'venda_realizada'), cliente(2, 'venda_realizada')], pedidos: [
    pedido(1, 1, { fase: 'carteira', data_primeira: '2026-10-01' }), pedido(1, 2, { fase: 'faturado', valor_pedido: 900, data_primeira: '2026-10-05' }),
    pedido(2, 3, { fase: 'faturado', data_primeira: '2026-10-02' }), pedido(2, 4, { fase: 'faturado', valor_pedido: 50, data_primeira: '2026-10-03' }), pedido(null, 9, { cpf_cnpj: '99999999000100' }), pedido(77, 8)] });
  assert.deepEqual(lista.map((c) => c.etapa), ['carteira', 'faturado'], 'o 2º pedido faturado do cliente 1 não o leva a Faturado');
  const primeiro = contarFluxo(lista, { soPrimeiro: true });
  const todos = contarFluxo(lista, { soPrimeiro: false });
  assert.deepEqual([primeiro.carteira, primeiro.faturado, primeiro.cadastro], [1, 1, 2]);
  assert.deepEqual([todos.carteira, todos.faturado, todos.cadastro], [1, 1, 2], 'o número de clientes não muda');
  assert.deepEqual(primeiro.valor, { carteira: 100, faturado: 100 });
  assert.deepEqual(todos.valor, { carteira: 1000, faturado: 150 });
  assert.deepEqual(todos.qtdPedidos, { carteira: 2, faturado: 2 });
});

test('a meta: dez pedidos para o mesmo cliente valem o valor, não o número de clientes', () => {
  const pedidos = Array.from({ length: 10 }, (_, i) => pedido(1, i + 1, { fase: 'faturado', valor_pedido: 10000, saldo: 0 }));
  const lista = montarClientes({ clientes: [cliente(1, 'venda_realizada')], pedidos });
  const todos = contarFluxo(lista, { soPrimeiro: false }); const primeiro = contarFluxo(lista, { soPrimeiro: true });
  assert.deepEqual([todos.faturado, todos.valor.faturado, todos.qtdPedidos.faturado], [1, 100000, 10]);
  assert.deepEqual([primeiro.faturado, primeiro.valor.faturado, primeiro.qtdPedidos.faturado], [1, 10000, 1]);
});

test('os cadastros realizados são a soma das quatro etapas; aguardando cadastro e encerrados ficam fora', () => {
  const lista = montarClientes({ clientes: [cliente(1, 'aguardando_cadastro'), cliente(2, 'analise_financeira', { analise_financeira_vencida: 1 }), cliente(3, 'aguardando_pedido'), cliente(4, 'aguardando_pedido_valido'), cliente(5, 'venda_realizada')],
    encerrados: [cliente(6, 'sem_interesse')], pedidos: [pedido(5, 1)] });
  const n = contarFluxo(lista);
  assert.deepEqual([n.antes, n.analise, n.pedido, n.carteira, n.faturado, n.encerrados], [1, 1, 2, 1, 0, 1]);
  assert.equal(n.cadastro, 4);
  assert.deepEqual([n.vencidas, n.naoValidos], [1, 1]);
});

test('Ver por Grupo: o grupo conta uma vez, na etapa mais avançada; cada empresa mantém a sua', () => {
  const raiz = { cnpj_raiz: '22222222' };
  const lista = montarClientes({ clientes: [cliente(1, 'analise_financeira', { ...raiz, cnpj: '22222222000100' }), cliente(2, 'venda_realizada', { ...raiz, cnpj: '22222222000200' }), cliente(3, 'aguardando_pedido')],
    pedidos: [pedido(2, 1, { fase: 'faturado' })] });
  assert.deepEqual(lista.map((c) => [c.etapa, c.etapaGrupo]), [['analise', 'faturado'], ['faturado', 'faturado'], ['pedido', 'pedido']]);
  const g = contarFluxo(lista, { porGrupo: true });
  assert.deepEqual([g.analise, g.pedido, g.faturado, g.cadastro], [0, 1, 1, 2]);
  assert.equal(contarFluxo(lista).cadastro, 3);
  const linhas = linhasDaEtapa(lista, { etapa: 'faturado', porGrupo: true, hoje: '2026-10-31' });
  assert.equal(new Set(linhas.map((l) => l.cliente.id)).size, 2, 'o grupo traz as duas empresas');
  const c = cascata(linhas, { porGrupo: true, fechados: new Set() });
  assert.match(c[0].rotulo, /^Grupo Cliente \d · 2 empresas$/);
  assert.equal(c.filter((x) => x.linha).length, 2);
  assert.equal(cascata(linhas, { porGrupo: true, fechados: new Set(['/raiz=22222222']) }).filter((x) => x.linha).length, 0, 'recolhe');
});

test('crédito: limite do CNPJ, do grupo, sem limite, zero e o primeiro pedido', () => {
  const lista = montarClientes({ clientes: [
    cliente(1, 'venda_realizada', { limite_credito: 1000, limite_credito_origem: 'cnpj' }), cliente(2, 'venda_realizada', { limite_credito: 9999999, limite_credito_origem: 'cnpj' }),
    cliente(3, 'venda_realizada', { limite_credito: 0, limite_credito_origem: 'cnpj' }), cliente(4, 'venda_realizada', { limite_credito: null }),
    cliente(5, 'venda_realizada', { cnpj_raiz: '33333333', limite_credito: 1000, limite_credito_origem: 'grupo' }), cliente(6, 'venda_realizada', { cnpj_raiz: '33333333', limite_credito: 1000, limite_credito_origem: 'grupo' }),
    cliente(7, 'venda_realizada', { limite_credito: 500, limite_credito_origem: 'cnpj' })],
  pedidos: [pedido(1, 1, { saldo: 700 }), pedido(1, 2, { saldo: 700 }), pedido(2, 3, { saldo: 5000 }), pedido(3, 4, { saldo: 10 }), pedido(4, 5, { saldo: 10 }), pedido(5, 6, { saldo: 400 }), pedido(6, 7, { saldo: 400 }), pedido(7, 8, { saldo: 0, fase: 'faturado' })] });
  const sit = (l) => Object.fromEntries(l.map((x) => [x.cliente.id, x.situacao]));
  const primeiro = compararCredito(lista, { soPrimeiro: true });
  assert.deepEqual(sit(primeiro), { 1: 'dentro', 2: 'sem_limite', 3: 'acima', 4: 'sem_limite', 5: 'dentro', 6: 'dentro' }, 'sem saldo não entra');
  const todos = compararCredito(lista, { soPrimeiro: false, saldoFiliais: new Map([['33333333', 300]]) });
  assert.equal(sit(todos)[1], 'acima', 'os dois pedidos passam do limite');
  assert.equal(todos.find((x) => x.cliente.id === 1).uso, 140);
  assert.equal(sit(todos)[5], 'acima', 'limite do grupo soma a raiz e a filial');
  assert.equal(todos.find((x) => x.cliente.id === 5).base, 1100);
  assert.equal(todos.find((x) => x.cliente.id === 3).uso, null, 'limite zero não tem percentual');
  assert.deepEqual(contarCredito(primeiro), { todos: 6, dentro: 3, acima: 1, sem_limite: 2, saldo: 700 + 5000 + 10 + 10 + 800 });
  assert.equal(contarCredito(todos, { porGrupo: true }).todos, 5, 'o grupo conta uma vez');
});

test('hierarquia e cascata: abrir, recolher e os níveis da grid', () => {
  const lista = montarClientes({ clientes: [cliente(1, 'aguardando_pedido', { supervisor_id: 1, supervisor_nome: 'Sup A', vendedor_id: 2, vendedor_codigo: '10', vendedor_nome: 'Um' }), cliente(2, 'aguardando_pedido', { supervisor_id: 1, supervisor_nome: 'Sup A', vendedor_id: 3, vendedor_codigo: '11', vendedor_nome: 'Dois' })], pedidos: [] });
  const arv = montarArvoreAcomp({ clientes: lista, niveis: ['supervisor', 'representante'], abertos: new Set(['', '/supervisor=1']) });
  assert.deepEqual(arv.map((n) => [n.profundidade, n.rotulo, n.clientes.length]), [[0, 'Todos os clientes', 2], [1, 'Sup A', 2], [2, '10 · Um', 1], [2, '11 · Dois', 1]]);
  assert.equal(montarArvoreAcomp({ clientes: lista, niveis: ['supervisor', 'representante'], abertos: new Set(['']) }).length, 2, 'fechado não mostra os filhos');
  const linhas = linhasDaEtapa(lista, { etapa: 'pedido', hoje: '2026-10-31' });
  const aberta = cascata(linhas, { niveis: ['supervisor', 'representante'] });
  assert.deepEqual(aberta.map((x) => (x.cabecalho ? x.rotulo : x.linha.cliente.id)), ['Sup A', '10 · Um', 1, '11 · Dois', 2]);
  assert.deepEqual(cascata(linhas, { niveis: ['supervisor', 'representante'], fechados: new Set(['/supervisor=1']) }).map((x) => x.rotulo), ['Sup A']);
});

test('dias da etapa: faturado conta do cadastro até o primeiro faturar, e o segundo pedido não tem', () => {
  const lista = montarClientes({ clientes: [cliente(1, 'venda_realizada', { dt_cadastro_erp: '2026-10-01' })], pedidos: [pedido(1, 1, { fase: 'faturado', data_situacao: '2026-10-11' }), pedido(1, 2, { fase: 'faturado', data_primeira: '2026-10-20' })] });
  assert.deepEqual(linhasDaEtapa(lista, { etapa: 'faturado', soPrimeiro: false, hoje: '2026-10-31' }).map((l) => [l.pedido.numero, l.dias]), [['1', 10], ['2', null]]);
  assert.deepEqual(linhasDaEtapa(lista, { etapa: 'faturado', soPrimeiro: true, hoje: '2026-10-31' }).map((l) => l.pedido.numero), ['1']);
});

test('forma e prazo liberados: como vieram do ERP e, sem eles, os do analista', () => {
  assert.equal(formaLiberada({ forma_pgto_descricao: 'Convênio', forma_pagamento: 'boleto' }), 'Convênio');
  assert.equal(formaLiberada({ forma_pagamento: 'a_vista' }), 'À vista');
  assert.equal(prazoLiberado({ prazo_parcelas: '14/21/28' }), '14/21/28 dias');
  assert.equal(prazoLiberado({ prazo_parcelas: 'A VISTA' }), 'à vista');
  assert.equal(prazoLiberado({ prazo_pagamento_dias: 21 }), '21 dia(s)');
  assert.equal(prazoLiberado({}), null);
});

test('pedido sem cadastro: fica fora do fluxo, sem perder os pedidos, e entra ao registrar o cadastro', () => {
  const ped = [pedido(1, 1, { fase: 'faturado' }), pedido(2, 2, { fase: 'cancelado', valida: 0 })];
  const sem = (o = {}) => montarClientes({ clientes: [cliente(1, 'venda_realizada', { dt_cadastro_erp: null, ...o }), cliente(2, 'aguardando_pedido_valido', { dt_cadastro_erp: null, ...o })], pedidos: ped });
  assert.deepEqual(sem().map((c) => c.etapa), ['sem_cadastro', 'sem_cadastro']);
  const n = contarFluxo(sem());
  assert.deepEqual([n.sem_cadastro, n.cadastro, n.naoValidos], [2, 0, 0]);
  assert.equal(sem()[0].pedidos.length, 1, 'os pedidos continuam com o cliente');
  assert.equal(linhasDaEtapa(sem(), { etapa: 'sem_cadastro', hoje: '2026-10-31' })[0].dias, 21);
  const com = sem({ dt_cadastro_erp: '2026-10-20' });
  assert.deepEqual(com.map((c) => c.etapa), ['faturado', 'pedido'], 'com o cadastro, entra na etapa sem reimportar');
  assert.equal(contarFluxo(com).cadastro, 2);
});

test('a consulta só traz clientes do status pedido, no escopo, com a última liberação', async () => {
  const db = await bancoTeste(); await criarEquipe(db);
  await criarProspect(db, { n: 1, vendedorId: 2 }); await criarProspect(db, { n: 2, vendedorId: 3 });
  const ler = async (o) => (await db.execute(consultaAcompanhamento(o))).rows;
  assert.equal((await ler({ usuario: adm })).length, 0, 'não contactado está na Lista principal, não aqui');
  await db.execute("UPDATE prospects SET status_atual = 'aguardando_pedido' WHERE id IN (1, 2)");
  const todos = await ler({ usuario: adm });
  assert.equal(todos.length, 2);
  assert.ok('forma_pgto_descricao' in todos[0] && 'prazo_parcelas' in todos[0] && 'analise_financeira_vencida' in todos[0]);
  assert.deepEqual((await ler({ usuario: { id: 2, perfil: 'vendedor' } })).map((c) => Number(c.vendedor_id)), [2], 'o representante vê a própria carteira');
  assert.equal((await ler({ usuario: { id: 5, perfil: 'supervisor' } })).length, 0, 'outra equipe não vê');
  assert.equal((await ler({ usuario: adm, encerrados: true })).length, 0);
});
