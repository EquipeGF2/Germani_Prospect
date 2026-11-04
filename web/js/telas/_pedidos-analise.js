// Corpo de Explorar pedidos: hierarquia de níveis, cards, gráficos, árvore e os pedidos da linha escolhida, como no Explorar carteira.
// Tudo sobre os pedidos já lidos: arrastar níveis, abrir linhas, filtrar e buscar só redesenham no navegador.
import { agruparPorRaiz, buscarPedidos, filtrarPedidos, montarArvorePedidos, NIVEIS_PEDIDOS, niveisPedidosPossiveis, resumirPedidos, rotuloGrupo, rotuloRepresentante } from '../../shared/pedidos.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { h, montar, formatar, baixarCsv, semRolagem } from '../ui.js';
import { significadoDe } from '../../shared/ajuda.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { blocoNiveis, textoChave, cartoes, moeda, valor, razaoSocial, seloSituacao, seloDoPedido, tabelaPedidos } from './_pedidos.js';

const CHAVE_NIVEIS = 'germani.pedidosNiveis';
const LIMITE_RAMO = 100;
const NOME_TIPO = { venda: 'Venda', investimento: 'Bonificação', ignorar: 'Não considerado' };
const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const pct = (v) => (v == null ? '—' : `${v.toFixed(1).replace('.', ',')}%`);

function lerNiveis(possiveis, padrao) {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_NIVEIS) ?? 'null');
    if (Array.isArray(salvo)) { const ok = salvo.filter((n) => possiveis.includes(n)); if (ok.length) return ok; }
  } catch { /* padrão */ }
  return padrao.filter((n) => possiveis.includes(n));
}
function guardarNiveis(n) { try { localStorage.setItem(CHAVE_NIVEIS, JSON.stringify(n)); } catch { /* só nesta visita */ } }

// os filtros continuam ao trocar a chave Empresa ou Grupo: só a tela é redesenhada
const memoria = new WeakMap();

export function renderAnalise(destino, { pedidos: todosPedidos, usuario, porGrupo = false, slotFiltros }) {
  // Ver por Empresa: só os CNPJs da base. Ver por Grupo: também as filiais fora da base com a raiz de um cliente da base
  const pedidos = porGrupo ? todosPedidos : todosPedidos.filter((p) => p.prospect_id !== null);
  const possiveis = niveisPedidosPossiveis(usuario);
  const raiz = veTodasEquipes(usuario) ? 'Todos os pedidos' : usuario.perfil === 'supervisor' ? 'Pedidos da minha equipe' : 'Meus pedidos';
  if (!memoria.has(destino)) memoria.set(destino, { niveis: lerNiveis(possiveis, ['supervisor', 'representante', 'cliente']), abertos: new Set(['']), sel: '', editarNiveis: false, busca: '', tipo: 'ambos', gruposAbertos: new Set() });
  const estado = memoria.get(destino);
  const area = h('div', { id: 'analise-pedidos', class: 'ped-exp' });
  montar(destino, area);
  const desenhar = () => montar(area, ...tela());
  const nome = (n) => NIVEIS_PEDIDOS[n].nome;
  const mudarNiveis = (n) => { estado.niveis = n; estado.abertos = new Set(['']); estado.sel = ''; guardarNiveis(n); desenhar(); };
  const aoFiltrar = () => { estado.abertos = new Set(['']); estado.sel = ''; desenharFiltros(); desenhar(); };

  // partes: [nome, valor, cor, quantidade de pedidos, explicação curta]; com quantidade, ela vira uma coluna própria
  function barra(titulo, subtitulo, partes, total, id) {
    const comQtd = partes.some((x) => x[3] != null);
    return h('section', { class: `cartao exp-grafico${comQtd ? ' com-qtd' : ''}`, id },
      h('div', { class: 'exp-grafico-topo' }, h('div', {}, h('span', { class: 'tit' }, titulo), h('h2', {}, subtitulo))),
      h('div', { class: 'exp-barra100', role: 'img', 'aria-label': partes.map(([n, v]) => `${n}: ${moeda(v)}`).join(', ') },
        partes.filter(([, v]) => v > 0).map(([n, v, cor]) => h('span', { title: `${n}: ${moeda(v)}`, style: `flex:${v} 1 0;background:${cor}` }))),
      comQtd ? h('div', { class: 'exp-legenda cab' }, h('span'), h('span', {}, 'Situação'), h('span', { class: 'qtd' }, 'Pedidos'), h('span', { class: 'val' }, 'Valor (R$)'), h('span', { class: 'pct' }, '%')) : null,
      partes.map(([n, v, cor, qtd, explica]) => h('div', { class: 'exp-legenda' }, h('span', { class: 'ponto', style: `background:${cor}` }),
        h('span', {}, n, explica ? h('small', { class: 'explica' }, explica) : null),
        comQtd ? h('span', { class: 'qtd' }, n0(qtd)) : null, h('b', {}, valor(v)), h('span', { class: 'pct' }, pct(total ? (v / total) * 100 : null)))));
  }

  // a busca é o mesmo campo entre os redesenhos: quem digita não perde o foco. Ela procura só na lista de pedidos
  const campoBusca = h('input', { type: 'search', id: 'busca-pedidos', value: estado.busca, 'aria-label': 'Buscar pedido', placeholder: 'Pedido, cliente, CNPJ ou representante',
    oninput: () => { estado.busca = campoBusca.value; desenhar(); campoBusca.focus(); } });

  // filtro na mesma linha da chave Empresa ou Grupo
  function desenharFiltros() {
    const opcao = (id, ativo, texto, aoClicar) => h('button', { type: 'button', id, class: ativo ? 'ativa' : '', 'aria-pressed': ativo ? 'true' : 'false', onclick: () => { aoClicar(); aoFiltrar(); } }, texto);
    montar(slotFiltros,
      h('div', { class: 'ped-chave ped-seg', role: 'group', 'aria-label': 'Tipo de pedido' },
        [['venda', 'Pedidos de venda', 'Venda'], ['investimento', 'Pedidos de bonificação', 'Bonificação'], ['ambos', 'Ambos']].map(([v, t, curto]) => opcao(`tipo-${v}`, estado.tipo === v, textoChave(t, curto), () => { estado.tipo = v; }))));
  }

  function listaDoRamo(doRamo, escolhido) {
    const colunas = [{ titulo: 'Pedido', campo: 'numero', classe: 'num' }, { titulo: 'Data', valor: (x) => formatar.data(x.data_situacao), classe: 'num' },
      { titulo: 'Razão social', valor: (x) => razaoSocial({ codigo: x.codigo_cliente, razao: x.razao_social, doc: x.cpf_cnpj, prospectId: x.prospect_id }), classe: 'rz' }, { titulo: 'Representante', valor: rotuloRepresentante },
      { titulo: 'Tipo', valor: (x) => NOME_TIPO[x.tipo] ?? x.tipo, classe: 'cen' }, { titulo: 'Situação', valor: seloSituacao, classe: 'cen' }, { titulo: 'Pedido (R$)', valor: (x) => valor(x.valor_pedido), classe: 'num' },
      { titulo: 'Faturado (R$)', valor: (x) => valor(x.valor_faturado), classe: 'num' }, { titulo: 'Na lista?', valor: seloDoPedido, classe: 'cen' }];
    const csv = [{ titulo: 'Pedido', campo: 'numero' }, { titulo: 'Data', texto: (x) => formatar.data(x.data_situacao) }, { titulo: 'Código', campo: 'codigo_cliente' }, { titulo: 'Razão social', campo: 'razao_social' }, { titulo: 'CPF/CNPJ', campo: 'cpf_cnpj' },
      { titulo: 'Representante', texto: rotuloRepresentante }, { titulo: 'Tipo', texto: (x) => NOME_TIPO[x.tipo] ?? x.tipo }, { titulo: 'Situação', campo: 'situacao_descricao' }, { titulo: 'Pedido', texto: (x) => valor(x.valor_pedido) }, { titulo: 'Faturado', texto: (x) => valor(x.valor_faturado) }];
    // Ver por Grupo: uma linha por grupo, que abre os pedidos das empresas; empresa sem grupo fica solta, depois dos grupos
    let exibidos = doRamo;
    if (porGrupo) {
      const { grupos, soltas } = agruparPorRaiz(doRamo, (x) => x.cpf_cnpj);
      exibidos = [];
      for (const g of grupos.sort((a, b) => String(a.linhas[0].razao_social).localeCompare(String(b.linhas[0].razao_social), 'pt-BR'))) {
        const aberto = estado.gruposAbertos.has(g.raiz);
        exibidos.push({ linhaGrupo: h('button', { type: 'button', class: 'abre-grupo', dados: { raiz: g.raiz }, 'aria-expanded': aberto ? 'true' : 'false', onclick: () => { if (aberto) estado.gruposAbertos.delete(g.raiz); else estado.gruposAbertos.add(g.raiz); desenhar(); } },
          `${aberto ? '▼' : '▶'} ${rotuloGrupo(g)} · ${n0(g.linhas.length)} pedidos · venda ${moeda(resumirPedidos(g.linhas).venda.valor)}`) });
        if (aberto) exibidos.push(...g.linhas);
      }
      exibidos.push(...soltas);
    }
    return h('div', { class: 'cartao' },
      h('div', { class: 'ped-lista-topo' }, h('h2', { id: 'titulo-pedidos' }, `${escolhido.caminho ? `Pedidos de ${escolhido.rotulo}` : 'Todos os pedidos'} (${n0(doRamo.length)})`), campoBusca,
        h('button', { class: 'secundario pequeno', id: 'csv-pedidos', onclick: () => baixarCsv(`pedidos-${hojeSaoPaulo()}.csv`, csv, doRamo) }, 'Baixar CSV')),
      tabelaPedidos(colunas, exibidos.slice(0, LIMITE_RAMO), { id: 'pedidos-do-ramo', vazio: estado.busca ? `Nenhum pedido para "${estado.busca}".` : 'Nenhum pedido com esses filtros.' }),
      exibidos.length > LIMITE_RAMO ? h('p', { class: 'ajuda', style: 'margin:12px 0 0' }, `Mostrando ${LIMITE_RAMO} de ${n0(exibidos.length)}. Clique numa linha da hierarquia para ver menos, ou baixe o CSV.`) : null);
  }

  function tela() {
    const vistos = filtrarPedidos(pedidos, { tipo: estado.tipo });
    const arvore = montarArvorePedidos({ pedidos: vistos, niveis: estado.niveis, abertos: estado.abertos, rotuloRaiz: raiz, porGrupo });
    const escolhido = arvore.find((n) => n.caminho === estado.sel) ?? arvore[0];
    const ind = escolhido.ind;
    const etapas = arvore.filter((n) => estado.sel === n.caminho || estado.sel.startsWith(`${n.caminho}/`) || n.caminho === '').sort((a, b) => a.profundidade - b.profundidade);
    const migalhas = h('nav', { class: 'exp-caminho', 'aria-label': 'Linha escolhida' }, etapas.flatMap((n, i) => [
      h('button', { type: 'button', class: n.caminho === escolhido.caminho ? 'atual' : '', title: n.rotulo, onclick: () => { estado.sel = n.caminho; desenhar(); } }, n.profundidade ? `${nome(n.nivel)}: ${n.rotulo}` : n.rotulo),
      i < etapas.length - 1 ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null]));

    const numeros = h('div', { id: 'analise-numeros' }, cartoes([['Venda válida', moeda(ind.venda.valor), `${n0(ind.venda.qtd)} pedidos · ${n0(ind.clientes)} clientes`, 'destaque'], ['Faturado', moeda(ind.faturado), `${pct(ind.pctFaturado)} da venda`],
      ['Em carteira', moeda(ind.saldo), `ticket médio ${moeda(ind.ticket)}`], ['Digitado', moeda(ind.digitado.valor), `${n0(ind.digitado.qtd)} pedidos`], ['Desistência', moeda(ind.cancelado.valor), `${n0(ind.cancelado.qtd)} pedidos`], ['Investimento', moeda(ind.investimento.valor), `${n0(ind.investimento.qtd)} bonificações`, 'investimento'],
      ['Próprio', moeda(ind.propria), `${pct(ind.venda.valor ? (ind.propria / ind.venda.valor) * 100 : null)} da venda`], ['Outro', moeda(ind.outra), `${pct(ind.venda.valor ? (ind.outra / ind.venda.valor) * 100 : null)} da venda`]]));

    // Faturamento da venda: só a venda válida, faturado × a faturar. O que aconteceu: todos os pedidos de venda, inclusive os que não viraram venda
    const venda = barra('Faturamento da venda', `Dos ${moeda(ind.venda.valor)} vendidos, ${moeda(ind.faturado)} já faturaram`,
      [['Faturado', ind.faturado, '#0F766E', null, 'já saiu nota fiscal'], ['Em carteira, a faturar', ind.saldo, '#1D4ED8', null, 'pedido aceito, falta faturar']], ind.venda.valor, 'grafico-faturamento');
    const todos = ind.venda.valor + ind.digitado.valor + ind.cancelado.valor;
    const qtdTodos = ind.venda.qtd + ind.digitado.qtd + ind.cancelado.qtd;
    const plural = (q, um, varios) => `${n0(q)} ${q === 1 ? um : varios}`;
    const processo = barra('O que aconteceu com os pedidos de venda',
      `${plural(qtdTodos, 'pedido digitado', 'pedidos digitados')}: ${plural(ind.venda.qtd, 'virou venda', 'viraram venda')}, ${plural(ind.digitado.qtd, 'está parado', 'estão parados')} e ${plural(ind.cancelado.qtd, 'foi cancelado', 'foram cancelados')}`,
      [['Venda válida', ind.venda.valor, '#1D4ED8', ind.venda.qtd, 'em carteira ou faturado'], ['Digitado, fora da carteira', ind.digitado.valor, '#B45309', ind.digitado.qtd, 'Não Fechado no ERP: ainda não conta como venda'],
        ['Desistência', ind.cancelado.valor, '#B42318', ind.cancelado.qtd, 'pedido cancelado']], todos, 'grafico-pedidos-venda');

    const clicarLinha = (n) => {
      if (n.temFilhos && n.aberto && estado.sel === n.caminho) estado.abertos.delete(n.caminho);
      else { estado.sel = n.caminho; if (n.temFilhos) estado.abertos.add(n.caminho); }
      desenhar();
    };
    // rótulos numa linha só (os valores são em R$, dito abaixo da árvore); a dica do rótulo traz o significado
    const cab = h('div', { class: 'exp-linha cab' }, ['Hierarquia', 'Clientes', 'Válidos', 'Venda', 'Faturado', 'Em carteira', 'Digitado', 'Desistência', 'Invest.', 'Invest. ÷ venda', 'Próprio', 'Outro']
      .map((t, i) => h('span', { class: i ? 'num' : '', title: significadoDe(t === 'Venda' ? 'Venda válida' : t) }, t)));
    const linhas = arvore.map((n) => h('div', { class: `exp-linha${n.caminho === escolhido.caminho ? ' escolhida' : ''}${n.profundidade ? '' : ' raiz'}`, dados: { caminho: n.caminho }, style: `--prof:${n.profundidade}`, onclick: () => clicarLinha(n) },
      h('span', { class: 'ramo', style: `padding-left:${n.profundidade * 24}px` },
        n.temFilhos ? h('button', { type: 'button', class: 'abre', 'aria-expanded': n.aberto ? 'true' : 'false', 'aria-label': `${n.aberto ? 'Fechar' : 'Abrir'} ${n.rotulo}`,
          onclick: (ev) => { ev.stopPropagation(); if (n.aberto) estado.abertos.delete(n.caminho); else estado.abertos.add(n.caminho); desenhar(); } }, n.aberto ? '▼' : '▶') : h('span', { class: 'abre vazio' }),
        h('button', { type: 'button', class: 'nome', title: n.rotulo }, n.rotulo)),
      // no cartão (sem espaço para as colunas): o valor da venda ao lado do nome e um resumo embaixo
      h('span', { class: 'resumo' }, `${n0(n.ind.clientes)} ${n.ind.clientes === 1 ? 'cliente' : 'clientes'} · ${n0(n.ind.venda.qtd)} ${n.ind.venda.qtd === 1 ? 'válido' : 'válidos'} · ${pct(n.ind.pctFaturado)} faturado`),
      // `dados.r` = rótulo do número quando a linha vira cartão
      ...[['Clientes', n0(n.ind.clientes)], ['Válidos', n0(n.ind.venda.qtd)], ['Venda', valor(n.ind.venda.valor), 'venda'], ['Faturado', valor(n.ind.faturado)], ['Em carteira', valor(n.ind.saldo)],
        ['Digitado', valor(n.ind.digitado.valor)], ['Desistência', valor(n.ind.cancelado.valor)], ['Invest.', valor(n.ind.investimento.valor)], ['Invest. ÷ venda', pct(n.ind.pctInvestimento)],
        ['Próprio', valor(n.ind.propria)], ['Outro', valor(n.ind.outra)]].map(([r, v, classe]) => h(classe ? 'b' : 'span', { class: `num${classe ? ` ${classe}` : ''}`, dados: { r } }, v))));

    return [...blocoNiveis({ estado, possiveis, nome, mudarNiveis, desenhar }), migalhas, numeros, h('div', { class: 'exp-quadros' }, venda, processo),
      semRolagem(h('section', { class: 'cartao exp-arvore', 'aria-label': 'Árvore' }, h('div', { class: 'rolagem' }, cab, linhas), h('p', { class: 'ajuda exp-nota' }, 'Valores em R$.')), { cortados: '.exp-linha > .num' }), listaDoRamo(buscarPedidos(escolhido.pedidos, estado.busca), escolhido)];
  }
  desenharFiltros();
  if (!pedidos.length) {
    return montar(area, h('p', { class: 'mensagem info', id: 'sem-pedidos' }, todosPedidos.length
      ? `Nenhum pedido de CNPJ da base. Há ${n0(todosPedidos.length)} pedido(s) de filial de um grupo da base: clique em Ver por Grupo.` : 'Nenhum pedido importado ainda.'));
  }
  desenhar();
}
