// Acompanhamento de pedidos: cada linha é um pedido (o Acompanhamento de clientes continua uma linha por cliente). docs/03 §14
import { bancoApp } from '../db.js';
import { alertasPedidos, bonificacaoPorCliente, clientesDistintos, clientesVariosRepresentantes, consultaMotivosPedidoValido, consultaPedidos, consultaSaldoFiliais, porRepresentante, resumirPedidos, rotuloRepresentante } from '../../shared/pedidos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { normalizarBusca } from '../../shared/texto.mjs';
import { h, montar, mensagem, formatar, selo, baixarCsv } from '../ui.js';
import { renderAnalise } from './_pedidos-analise.js';
import { cartoes, moeda, valor, razaoSocial, documento, seloSituacao, seloRelacao, tabelaPedidos } from './_pedidos.js';

const ABAS = { analise: 'Análise', pedidos: 'Pedidos', representantes: 'Por representante', bonificacao: 'Bonificação', alertas: 'Alertas' };
const NOME_TIPO = { venda: 'Venda', investimento: 'Bonificação', ignorar: 'Não considerado' };
const LIMITE_LINHAS = 300;
const n0 = (v) => formatar.numero(v);

export async function render(conteudo, { usuario, parametros }) {
  const db = await bancoApp();
  const [pedidos, motivos, filiais, valores] = (await Promise.all([db.execute(consultaPedidos({ usuario })), db.execute(consultaMotivosPedidoValido()), db.execute(consultaSaldoFiliais()),
    db.execute("SELECT chave, valor FROM parametros WHERE chave IN ('prazo_pedido_valido_dias','alerta_desistencias_cliente','dias_alerta_pedido_aberto')")])).map((r) => r.rows);
  const p = Object.fromEntries(valores.map((v) => [v.chave, Number(v.valor)]));
  const entradas = new Map(motivos.map((m) => [Number(m.prospect_id), m.data_evento]));
  const hoje = hojeSaoPaulo();
  const alertas = alertasPedidos(pedidos, { hoje, prazoPedidoValido: p.prazo_pedido_valido_dias, desistencias: p.alerta_desistencias_cliente, diasAberto: p.dias_alerta_pedido_aberto, entradas, saldoFiliais: new Map(filiais.map((f) => [f.raiz, Number(f.saldo)])) });

  const r = resumirPedidos(pedidos);
  const pct = (v) => (r.venda.valor ? `${Math.round((v / r.venda.valor) * 100)}% da venda` : '');
  const numeros = cartoes([['Venda válida', moeda(r.venda.valor), `${n0(r.venda.qtd)} pedidos`, 'destaque'], ['Faturado', moeda(r.faturado), pct(r.faturado)], ['Em carteira', moeda(r.saldo), pct(r.saldo)],
    ['Digitado', moeda(r.digitado.valor), `${n0(r.digitado.qtd)} pedidos`], ['Desistência', moeda(r.cancelado.valor), `${n0(r.cancelado.qtd)} pedidos`], ['Investimento', moeda(r.investimento.valor), `${n0(r.investimento.qtd)} bonificações`, 'investimento']]);

  let aba = ABAS[parametros.get('aba')] ? parametros.get('aba') : 'analise';
  const slotNumeros = h('div');
  const area = h('div');
  const barra = h('div', { class: 'ped-abas', role: 'tablist' });
  function desenharBarra() {
    montar(barra, Object.entries(ABAS).map(([k, t]) => h('button', { type: 'button', role: 'tab', class: k === aba ? 'ativa' : '', dados: { aba: k }, 'aria-selected': k === aba ? 'true' : 'false',
      onclick: () => { aba = k; desenharBarra(); desenhar(); } }, k === 'alertas' && alertas.length ? `${t} (${alertas.length})` : t)));
  }
  const desenhar = () => { montar(slotNumeros, aba === 'analise' ? null : numeros); return ({ analise: (d) => renderAnalise(d, { pedidos, usuario }), pedidos: abaPedidos, representantes: abaRepresentantes, bonificacao: abaBonificacao, alertas: abaAlertas })[aba](area); };

  function abaPedidos(destino) {
    const busca = h('input', { type: 'search', id: 'busca-pedidos', placeholder: 'Pedido, razão social, CNPJ ou representante', oninput: filtrar });
    const nomesSit = [...new Set(pedidos.map((x) => x.situacao_descricao))].sort();
    const situacao = h('select', { 'aria-label': 'Situação', onchange: filtrar }, h('option', { value: '' }, 'Todas as situações'), nomesSit.map((s) => h('option', { value: s }, s)));
    const tipo = h('select', { 'aria-label': 'Tipo', onchange: filtrar }, h('option', { value: '' }, 'Venda e bonificação'), [['venda', 'Venda'], ['investimento', 'Bonificação']].map(([v, t]) => h('option', { value: v }, t)));
    const repsLista = [...new Map(pedidos.map((x) => [String(x.rep_codigo ?? ''), rotuloRepresentante(x)]))].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    const rep = h('select', { 'aria-label': 'Representante', onchange: filtrar }, h('option', { value: '' }, 'Todos os representantes'), repsLista.map(([v, t]) => h('option', { value: v }, t)));
    const lista = h('div');
    let vistos = pedidos;
    const colunas = [
      { titulo: 'Pedido', campo: 'numero', classe: 'num' }, { titulo: 'Data', valor: (x) => formatar.data(x.data_situacao), classe: 'num' },
      { titulo: 'Razão social', valor: (x) => razaoSocial({ codigo: x.codigo_cliente, razao: x.razao_social, doc: x.cpf_cnpj, prospectId: x.prospect_id }), classe: 'rz' },
      { titulo: 'Representante', valor: rotuloRepresentante }, { titulo: 'Tipo', valor: (x) => NOME_TIPO[x.tipo] ?? x.tipo, classe: 'cen' },
      { titulo: 'Situação', valor: seloSituacao, classe: 'cen' }, { titulo: 'Pedido (R$)', valor: (x) => valor(x.valor_pedido), classe: 'num' },
      { titulo: 'Faturado (R$)', valor: (x) => valor(x.valor_faturado), classe: 'num' }, { titulo: 'Na lista?', valor: (x) => seloRelacao(x.relacao), classe: 'cen' }];
    function filtrar() {
      const t = normalizarBusca(busca.value);
      vistos = pedidos.filter((x) => (!situacao.value || x.situacao_descricao === situacao.value) && (!tipo.value || x.tipo === tipo.value) && (!rep.value || String(x.rep_codigo ?? '') === rep.value)
        && (!t || normalizarBusca(`${x.numero} ${x.razao_social} ${x.cpf_cnpj} ${x.codigo_cliente} ${x.rep_codigo} ${x.rep_nome}`).includes(t)));
      montar(lista, tabelaPedidos(colunas, vistos.slice(0, LIMITE_LINHAS), { vazio: pedidos.length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido importado ainda.', id: 'lista-pedidos' }),
        vistos.length > LIMITE_LINHAS ? h('p', { class: 'ajuda' }, `Mostrando ${LIMITE_LINHAS} de ${n0(vistos.length)}. Baixe o CSV para ver todos.`) : null);
    }
    const csv = [{ titulo: 'Pedido', campo: 'numero' }, { titulo: 'Data', texto: (x) => formatar.data(x.data_situacao) }, { titulo: 'Código', campo: 'codigo_cliente' }, { titulo: 'Razão social', campo: 'razao_social' }, { titulo: 'CPF/CNPJ', campo: 'cpf_cnpj' },
      { titulo: 'Representante', texto: rotuloRepresentante }, { titulo: 'Tipo', texto: (x) => NOME_TIPO[x.tipo] ?? x.tipo }, { titulo: 'Situação', campo: 'situacao_descricao' }, { titulo: 'Pedido', texto: (x) => valor(x.valor_pedido) }, { titulo: 'Faturado', texto: (x) => valor(x.valor_faturado) }];
    filtrar();
    montar(destino, h('div', { class: 'cartao' },
      h('div', { class: 'ped-filtros' }, busca, situacao, tipo, rep, h('button', { class: 'secundario', onclick: () => baixarCsv(`pedidos-${hoje}.csv`, csv, vistos) }, 'Baixar CSV'))), lista);
  }

  function abaRepresentantes(destino) {
    const reps = porRepresentante(pedidos);
    const total = (campo) => reps.reduce((s, x) => s + x[campo], 0);
    const escolhido = h('select', { id: 'rep-lista', 'aria-label': 'Representante', onchange: mostrarLista }, reps.filter((x) => x.clientes.length).map((x) => h('option', { value: String(x.codigo ?? '') }, x.rotulo)));
    const lista = h('div');
    function mostrarLista() {
      const x = reps.find((y) => String(y.codigo ?? '') === escolhido.value);
      montar(lista, x ? tabelaPedidos([
        { titulo: 'Razão social', valor: (c) => razaoSocial({ codigo: c.codigo, razao: c.razao, doc: c.documento }), classe: 'rz' }, { titulo: 'Na lista?', valor: (c) => seloRelacao(c.relacao), classe: 'cen' },
        { titulo: 'Pedidos', valor: (c) => n0(c.pedidos), classe: 'num' }, { titulo: 'Vendeu (R$)', valor: (c) => valor(c.venda), classe: 'num' }, { titulo: 'Dono da carteira', valor: (c) => c.dono ?? '—' }], x.clientes, { id: 'lista-representante' }) : null);
    }
    mostrarLista();
    const varios = clientesVariosRepresentantes(pedidos).flatMap((c) => c.reps.map((rp, i) => ({ ...rp, cliente: i === 0 ? c : null })));
    montar(destino,
      mensagem('O cliente fica com o dono da carteira, e a venda vai para quem a realizou. É só informação, sem alerta.', 'info'),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por representante'),
        tabelaPedidos([{ titulo: 'Representante', campo: 'rotulo' }, { titulo: 'Clientes', valor: (x) => n0(x.clientes.length), classe: 'num' }, { titulo: 'Válidos', valor: (x) => n0(x.validos), classe: 'num' }, { titulo: 'Venda (R$)', valor: (x) => valor(x.venda), classe: 'num' },
          { titulo: 'Faturado (R$)', valor: (x) => valor(x.faturado), classe: 'num' }, { titulo: 'Em carteira (R$)', valor: (x) => valor(x.saldo), classe: 'num' }, { titulo: 'Digitado (R$)', valor: (x) => valor(x.digitado), classe: 'num' }, { titulo: 'Desistência (R$)', valor: (x) => valor(x.desistencia), classe: 'num' },
          { titulo: 'Investimento (R$)', valor: (x) => valor(x.investimento), classe: 'num' }, { titulo: 'Na própria lista (R$)', valor: (x) => valor(x.propria), classe: 'num' }, { titulo: 'Na lista de outro (R$)', valor: (x) => valor(x.outra), classe: 'num' }],
        reps, { id: 'tabela-representantes', rodape: [{ texto: 'Total' }, `${n0(clientesDistintos(pedidos))} distintos`, n0(total('validos')), valor(total('venda')), valor(total('faturado')), valor(total('saldo')), valor(total('digitado')), valor(total('desistencia')), valor(total('investimento')), valor(total('propria')), valor(total('outra'))] }),
        h('p', { class: 'ajuda', style: 'margin:12px 0 0' }, 'O valor nunca duplica, porque cada pedido tem um só representante. Já um cliente pode aparecer em mais de uma lista, então o total usa os clientes distintos.')),
      h('div', { class: 'cartao' }, h('h2', {}, 'Lista de cada representante'), h('div', { style: 'max-width:360px;margin-bottom:12px' }, escolhido), lista),
      h('div', { class: 'cartao' }, h('h2', {}, 'Clientes vendidos por mais de um representante'),
        tabelaPedidos([{ titulo: 'Razão social', valor: (x) => (x.cliente ? razaoSocial({ codigo: x.cliente.codigo, razao: x.cliente.razao, doc: x.cliente.documento }) : ''), classe: 'rz' }, { titulo: 'Representante', campo: 'rotulo' },
          { titulo: 'Pedidos válidos', valor: (x) => n0(x.pedidos), classe: 'num' }, { titulo: 'Venda válida (R$)', valor: (x) => valor(x.venda), classe: 'num' }, { titulo: 'Parte do cliente', valor: (x) => `${Math.round(x.parte)}%`, classe: 'num' }], varios, { vazio: 'Nenhum cliente com mais de um representante.' })));
  }

  function abaBonificacao(destino) {
    const clientes = bonificacaoPorCliente(pedidos);
    const comVenda = clientes.filter((c) => c.venda > 0); const semVenda = clientes.filter((c) => !c.venda);
    const soma = (l, campo) => l.reduce((s, c) => s + c[campo], 0);
    const pctVenda = soma(comVenda, 'venda') ? `${comVenda.length} cliente(s), ${(soma(comVenda, 'investimento') / soma(comVenda, 'venda') * 100).toFixed(2).replace('.', ',')}% da venda deles` : `${comVenda.length} cliente(s)`;
    const porRep = porRepresentante(pedidos).filter((x) => x.investimento > 0).sort((a, b) => b.investimento - a.investimento);
    montar(destino,
      cartoes([['Investimento total', moeda(r.investimento.valor), `${n0(r.investimento.qtd)} pedidos em ${n0(clientes.length)} cliente(s)`, 'investimento'], ['Em clientes com venda', moeda(soma(comVenda, 'investimento')), pctVenda], ['Em clientes sem venda', moeda(soma(semVenda, 'investimento')), `${semVenda.length} cliente(s), exceção com alerta`]]),
      h('p', { class: 'ajuda' }, `A bonificação é uma conta à parte. A venda válida continua em ${moeda(r.venda.valor)}, com ou sem ela.`),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por cliente'),
        tabelaPedidos([{ titulo: 'Razão social', valor: (c) => razaoSocial({ codigo: c.codigo, razao: c.razao, doc: c.documento, prospectId: c.prospectId }), classe: 'rz' }, { titulo: 'Representante', campo: 'rep' }, { titulo: 'Pedidos', valor: (c) => c.pedidos.join(', '), classe: 'num' },
          { titulo: 'Investimento (R$)', valor: (c) => valor(c.investimento), classe: 'num' }, { titulo: 'Venda válida (R$)', valor: (c) => valor(c.venda), classe: 'num' }, { titulo: 'Invest. ÷ venda', valor: (c) => (c.pct == null ? '—' : `${c.pct.toFixed(2).replace('.', ',')}%`), classe: 'num' },
          { titulo: 'Leitura', valor: (c) => (c.venda ? selo('Com venda', 'ok') : selo('Exceção, com alerta', 'alerta')), classe: 'cen' }], clientes, { vazio: 'Nenhuma bonificação importada.', id: 'tabela-bonificacao' })),
      h('div', { class: 'cartao' }, h('h2', {}, 'Por representante'),
        tabelaPedidos([{ titulo: 'Representante', campo: 'rotulo' }, { titulo: 'Investimento (R$)', valor: (x) => valor(x.investimento), classe: 'num' }, { titulo: 'Venda válida (R$)', valor: (x) => valor(x.venda), classe: 'num' }], porRep, { vazio: 'Nenhuma bonificação importada.' })));
  }

  function abaAlertas(destino) {
    montar(destino, h('div', { class: 'cartao' }, h('h2', {}, 'Alertas'),
      tabelaPedidos([{ titulo: 'Alerta', valor: (a) => selo(a.rotulo, a.tipo === 'bonificacao' ? 'investimento' : 'alerta'), classe: 'cen' },
        { titulo: 'Razão social', valor: (a) => (a.prospectId ? h('a', { href: `#/ficha?id=${a.prospectId}` }, a.cliente) : a.cliente) }, { titulo: 'O que aconteceu', campo: 'detalhe' }, { titulo: 'Quem age', campo: 'quem', classe: 'cen' }], alertas, { vazio: 'Nenhum alerta.', id: 'tabela-alertas' }),
      h('p', { class: 'ajuda', style: 'margin:12px 0 0' }, 'Prazos e limites ficam em Administração → Parâmetros. Venda para cliente de outro representante não é alerta: aparece em Por representante.')));
  }

  desenharBarra();
  desenhar();
  montar(conteudo, h('h1', {}, 'Acompanhamento de pedidos'), h('p', { class: 'ajuda' }, 'Só os pedidos dos clientes da base. As filiais de um grupo da base aparecem na ficha, na visão do grupo.'), barra, slotNumeros, area);
}
