// Corpo de Explorar pedidos: hierarquia de níveis, cards, gráficos e árvore, como no Explorar carteira. Os pedidos da linha escolhida
// saem no botão Excel, sem lista na tela. Tudo sobre os pedidos já lidos: arrastar níveis, abrir linhas e filtrar só redesenham no navegador.
import { filtrarPedidos, montarArvorePedidos, NIVEIS_PEDIDOS, niveisPedidosPossiveis } from '../../shared/pedidos.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { h, montar, formatar, comEspera, aviso, semRolagem } from '../ui.js';
import { significadoDe } from '../../shared/ajuda.mjs';
import { blocoNiveis, textoChave, cartoes, moeda, valor } from './_pedidos.js';
import { baixarPedidos } from './_pedidos-excel.js';
import { memoriaDaTela } from '../memoria.js';

const CHAVE_NIVEIS = 'germani.pedidosNiveis';
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
  // ao voltar à tela, a linha escolhida, as abertas e o tipo continuam como estavam (nesta aba do navegador)
  const lembranca = memoriaDaTela(`pedidos${porGrupo ? '-grupo' : ''}`, usuario);
  if (!memoria.has(destino)) {
    const inicial = { niveis: lerNiveis(possiveis, ['supervisor', 'representante', 'cliente']), abertos: new Set(['']), sel: '', editarNiveis: false, tipo: 'ambos' };
    const salvo = lembranca.ler();
    if (salvo && JSON.stringify(salvo.niveis) === JSON.stringify(inicial.niveis)) Object.assign(inicial, { sel: salvo.sel ?? '', abertos: new Set(salvo.abertos ?? ['']), tipo: salvo.tipo ?? 'ambos' });
    memoria.set(destino, inicial);
  }
  const estado = memoria.get(destino);
  const area = h('div', { id: 'analise-pedidos', class: 'ped-exp' });
  montar(destino, area);
  const desenhar = () => { montar(area, ...tela()); lembranca.guardar({ niveis: estado.niveis, sel: estado.sel, abertos: [...estado.abertos], tipo: estado.tipo }); };
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

  // Excel dos pedidos da linha escolhida (e do tipo marcado no topo): os pedidos já estão lidos, nada volta ao banco
  let pedidosDaLinha = [];
  const botaoExcel = h('button', { type: 'button', id: 'excel-pedidos', onclick: () => comEspera(botaoExcel, async () => {
    await baixarPedidos(pedidosDaLinha);
    aviso(`Excel gerado: ${n0(pedidosDaLinha.length)} pedidos.`);
  }) });

  // filtro na mesma linha da chave Empresa ou Grupo
  function desenharFiltros() {
    const opcao = (id, ativo, texto, aoClicar) => h('button', { type: 'button', id, class: ativo ? 'ativa' : '', 'aria-pressed': ativo ? 'true' : 'false', onclick: () => { aoClicar(); aoFiltrar(); } }, texto);
    montar(slotFiltros,
      h('div', { class: 'ped-chave ped-seg', role: 'group', 'aria-label': 'Tipo de pedido' },
        [['venda', 'Pedidos de venda', 'Venda'], ['investimento', 'Pedidos de bonificação', 'Bonificação'], ['ambos', 'Ambos']].map(([v, t, curto]) => opcao(`tipo-${v}`, estado.tipo === v, textoChave(t, curto), () => { estado.tipo = v; }))));
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

    pedidosDaLinha = escolhido.pedidos;
    botaoExcel.disabled = !pedidosDaLinha.length;
    botaoExcel.textContent = `Excel · ${n0(pedidosDaLinha.length)} ${pedidosDaLinha.length === 1 ? 'pedido' : 'pedidos'}`;
    botaoExcel.title = `Pedidos de ${escolhido.rotulo}`;
    return [...blocoNiveis({ estado, possiveis, nome, mudarNiveis, desenhar }), h('div', { class: 'rej-barra' }, migalhas, botaoExcel), numeros, h('div', { class: 'exp-quadros' }, venda, processo),
      semRolagem(h('section', { class: 'cartao exp-arvore', 'aria-label': 'Árvore' }, h('div', { class: 'rolagem' }, cab, linhas), h('p', { class: 'ajuda exp-nota' }, 'Valores em R$.')), { cortados: '.exp-linha > .num' })];
  }
  desenharFiltros();
  if (!pedidos.length) {
    return montar(area, h('p', { class: 'mensagem info', id: 'sem-pedidos' }, todosPedidos.length
      ? `Nenhum pedido de CNPJ da base. Há ${n0(todosPedidos.length)} pedido(s) de filial de um grupo da base: clique em Ver por Grupo.` : 'Nenhum pedido importado ainda.'));
  }
  desenhar();
}
