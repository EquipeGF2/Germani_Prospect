// Corpo de Explorar pedidos: hierarquia de níveis, cards, gráficos, árvore e os pedidos da linha escolhida, como no Explorar carteira.
// Tudo sobre os pedidos já lidos: arrastar níveis, abrir linhas, filtrar e buscar só redesenham no navegador.
import { agruparPorRaiz, buscarPedidos, filtrarPedidos, montarArvorePedidos, NIVEIS_PEDIDOS, niveisPedidosPossiveis, resumirPedidos, rotuloGrupo, rotuloRepresentante } from '../../shared/pedidos.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { h, montar, formatar, baixarCsv } from '../ui.js';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { cartoes, moeda, valor, razaoSocial, seloSituacao, seloDoPedido, tabelaPedidos } from './_pedidos.js';

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
  if (!memoria.has(destino)) memoria.set(destino, { niveis: lerNiveis(possiveis, ['supervisor', 'representante', 'cliente']), abertos: new Set(['']), sel: '', editarNiveis: false, busca: '', tipo: 'ambos', variosReps: false, gruposAbertos: new Set() });
  const estado = memoria.get(destino);
  const area = h('div', { id: 'analise-pedidos', class: 'ped-exp' });
  montar(destino, area);
  const desenhar = () => montar(area, ...tela());
  const nome = (n) => NIVEIS_PEDIDOS[n].nome;
  const mudarNiveis = (n) => { estado.niveis = n; estado.abertos = new Set(['']); estado.sel = ''; guardarNiveis(n); desenhar(); };
  const aoFiltrar = () => { estado.abertos = new Set(['']); estado.sel = ''; desenharFiltros(); desenhar(); };

  function cartaoNivel(nivel, i) {
    return h('span', { class: 'exp-nivel', draggable: 'true', title: 'Arraste para mudar a ordem', dados: { nivel },
      ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', nivel); ev.dataTransfer.effectAllowed = 'move'; },
      ondragover: (ev) => ev.preventDefault(),
      ondrop: (ev) => { ev.preventDefault(); ev.stopPropagation(); const d = ev.dataTransfer.getData('text/plain'); if (!possiveis.includes(d)) return;
        const n = estado.niveis.filter((x) => x !== d); n.splice(Math.min(i, n.length), 0, d); mudarNiveis(n); } },
    h('span', { class: 'pega', 'aria-hidden': 'true' }, '⋮⋮'), `${i + 1}. ${nome(nivel)}`,
    h('button', { type: 'button', class: 'tirar', 'aria-label': `Tirar ${nome(nivel)}`, onclick: () => mudarNiveis(estado.niveis.filter((x) => x !== nivel)) }, '×'));
  }
  const cartaoDisponivel = (nivel) => h('span', { class: 'exp-nivel livre', draggable: 'true', title: 'Arraste para os níveis (ou clique)', dados: { livre: nivel },
    ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', nivel); ev.dataTransfer.effectAllowed = 'move'; },
    onclick: () => mudarNiveis([...estado.niveis, nivel]) }, h('span', { class: 'pega', 'aria-hidden': 'true' }, '⋮⋮'), nome(nivel));
  const soltarNoFim = (ev) => { ev.preventDefault(); const d = ev.dataTransfer.getData('text/plain'); if (possiveis.includes(d)) mudarNiveis([...estado.niveis.filter((x) => x !== d), d]); };
  const soltarFora = (ev) => { ev.preventDefault(); const d = ev.dataTransfer.getData('text/plain'); if (estado.niveis.includes(d)) mudarNiveis(estado.niveis.filter((x) => x !== d)); };

  function barra(titulo, subtitulo, partes, total) {
    return h('section', { class: 'cartao exp-grafico' },
      h('div', { class: 'exp-grafico-topo' }, h('div', {}, h('span', { class: 'tit' }, titulo), h('h2', {}, subtitulo))),
      h('div', { class: 'exp-barra100', role: 'img', 'aria-label': partes.map(([n, v]) => `${n}: ${moeda(v)}`).join(', ') },
        partes.filter(([, v]) => v > 0).map(([n, v, cor]) => h('span', { title: `${n}: ${moeda(v)}`, style: `flex:${v} 1 0;background:${cor}` }))),
      partes.map(([n, v, cor, qtd]) => h('div', { class: 'exp-legenda' }, h('span', { class: 'ponto', style: `background:${cor}` }), h('span', {}, qtd == null ? n : `${n} (${n0(qtd)})`),
        h('b', {}, valor(v)), h('span', { class: 'pct' }, pct(total ? (v / total) * 100 : null)))));
  }

  // a busca é o mesmo campo entre os redesenhos: quem digita não perde o foco. Ela procura só na lista de pedidos
  const campoBusca = h('input', { type: 'search', id: 'busca-pedidos', value: estado.busca, 'aria-label': 'Buscar pedido', placeholder: 'Pedido, cliente, CNPJ ou representante',
    oninput: () => { estado.busca = campoBusca.value; desenhar(); campoBusca.focus(); } });

  // filtros na linha da frase, abaixo da chave Empresa ou Grupo
  function desenharFiltros() {
    const opcao = (id, ativo, texto, aoClicar) => h('button', { type: 'button', id, class: ativo ? 'ativa' : '', 'aria-pressed': ativo ? 'true' : 'false', onclick: () => { aoClicar(); aoFiltrar(); } }, texto);
    montar(slotFiltros,
      h('div', { class: 'ped-chave ped-seg', role: 'group', 'aria-label': 'Tipo de pedido' },
        [['venda', 'Pedidos de venda'], ['investimento', 'Pedidos de bonificação'], ['ambos', 'Ambos']].map(([v, t]) => opcao(`tipo-${v}`, estado.tipo === v, t, () => { estado.tipo = v; }))),
      h('span', { class: 'ped-seg-rotulo' }, 'Mais de um representante'),
      h('div', { class: 'ped-chave ped-seg', role: 'group', 'aria-label': 'Mais de um representante' },
        opcao('varios-nao', !estado.variosReps, 'Não', () => { estado.variosReps = false; }), opcao('varios-sim', estado.variosReps, 'Sim', () => { estado.variosReps = true; })));
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
    const vistos = filtrarPedidos(pedidos, { tipo: estado.tipo, variosReps: estado.variosReps, porGrupo });
    const arvore = montarArvorePedidos({ pedidos: vistos, niveis: estado.niveis, abertos: estado.abertos, rotuloRaiz: raiz, porGrupo });
    const escolhido = arvore.find((n) => n.caminho === estado.sel) ?? arvore[0];
    const ind = escolhido.ind;
    const etapas = arvore.filter((n) => estado.sel === n.caminho || estado.sel.startsWith(`${n.caminho}/`) || n.caminho === '').sort((a, b) => a.profundidade - b.profundidade);
    const migalhas = h('nav', { class: 'exp-caminho', 'aria-label': 'Linha escolhida' }, etapas.flatMap((n, i) => [
      h('button', { type: 'button', class: n.caminho === escolhido.caminho ? 'atual' : '', title: n.rotulo, onclick: () => { estado.sel = n.caminho; desenhar(); } }, n.profundidade ? `${nome(n.nivel)}: ${n.rotulo}` : n.rotulo),
      i < etapas.length - 1 ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null]));

    const niveis = h('section', { class: 'cartao exp-niveis', 'aria-label': 'Níveis da árvore' },
      h('div', { class: 'zona', title: 'Arraste para ordenar · solte aqui para incluir no fim', ondragover: (ev) => ev.preventDefault(), ondrop: soltarNoFim }, h('span', { class: 'tit' }, 'Níveis'), estado.niveis.map(cartaoNivel)),
      h('div', { class: 'zona livres', ondragover: (ev) => ev.preventDefault(), ondrop: soltarFora }, h('span', { class: 'tit' }, 'Disponíveis'), possiveis.filter((n) => !estado.niveis.includes(n)).map(cartaoDisponivel)));

    // celular: arrastar não funciona no toque — mesma solução do Explorar carteira
    const mover = (nivel, d) => { const n = [...estado.niveis]; const i = n.indexOf(nivel); const j = i + d; if (i < 0 || j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; mudarNiveis(n); };
    const ordemEdicao = [...estado.niveis, ...possiveis.filter((n) => !estado.niveis.includes(n))];
    const niveisCelular = h('section', { class: 'cartao exp-niveis-cel', 'aria-label': 'Níveis da árvore' },
      h('div', { class: 'exp-niveis-cel-topo' }, h('span', { class: 'tit' }, 'Níveis'), h('span', { class: 'ordem' }, estado.niveis.length ? estado.niveis.map(nome).join(' › ') : 'nenhum'),
        h('button', { type: 'button', class: 'secundario pequeno', 'aria-expanded': estado.editarNiveis ? 'true' : 'false', onclick: () => { estado.editarNiveis = !estado.editarNiveis; desenhar(); } }, estado.editarNiveis ? 'Pronto' : 'Mudar')),
      estado.editarNiveis ? h('ol', { class: 'exp-niveis-cel-lista' }, ordemEdicao.map((nivel) => {
        const i = estado.niveis.indexOf(nivel); const ligado = i >= 0;
        return h('li', { class: ligado ? 'ligado' : '' },
          h('label', {}, h('input', { type: 'checkbox', checked: ligado, onchange: () => mudarNiveis(ligado ? estado.niveis.filter((x) => x !== nivel) : [...estado.niveis, nivel]) }), ligado ? `${i + 1}. ${nome(nivel)}` : nome(nivel)),
          ligado ? h('span', { class: 'setas' },
            h('button', { type: 'button', class: 'secundario pequeno', 'aria-label': `Subir ${nome(nivel)}`, disabled: i === 0, onclick: () => mover(nivel, -1) }, '↑'),
            h('button', { type: 'button', class: 'secundario pequeno', 'aria-label': `Descer ${nome(nivel)}`, disabled: i === estado.niveis.length - 1, onclick: () => mover(nivel, 1) }, '↓')) : null);
      })) : null);

    const numeros = h('div', { id: 'analise-numeros' }, cartoes([['Venda válida', moeda(ind.venda.valor), `${n0(ind.venda.qtd)} pedidos · ${n0(ind.clientes)} clientes`, 'destaque'], ['Faturado', moeda(ind.faturado), `${pct(ind.pctFaturado)} da venda`],
      ['Em carteira', moeda(ind.saldo), `ticket médio ${moeda(ind.ticket)}`], ['Digitado', moeda(ind.digitado.valor), `${n0(ind.digitado.qtd)} pedidos`], ['Desistência', moeda(ind.cancelado.valor), `${n0(ind.cancelado.qtd)} pedidos`], ['Investimento', moeda(ind.investimento.valor), `${n0(ind.investimento.qtd)} bonificações`, 'investimento']]));

    const venda = barra('Da venda válida', `Como está ${moeda(ind.venda.valor)} em venda`, [['Faturado', ind.faturado, '#0F766E'], ['Em carteira, a faturar', ind.saldo, '#1D4ED8']], ind.venda.valor);
    const todos = ind.venda.valor + ind.digitado.valor + ind.cancelado.valor;
    const processo = barra('Dos pedidos de venda', `${n0(ind.venda.qtd + ind.digitado.qtd + ind.cancelado.qtd)} pedidos de venda`,
      [['Venda válida', ind.venda.valor, '#1D4ED8', ind.venda.qtd], ['Digitado, fora da carteira', ind.digitado.valor, '#B45309', ind.digitado.qtd], ['Desistência', ind.cancelado.valor, '#B42318', ind.cancelado.qtd]], todos);

    const clicarLinha = (n) => {
      if (n.temFilhos && n.aberto && estado.sel === n.caminho) estado.abertos.delete(n.caminho);
      else { estado.sel = n.caminho; if (n.temFilhos) estado.abertos.add(n.caminho); }
      desenhar();
    };
    const cab = h('div', { class: 'exp-linha cab' }, ['Hierarquia', 'Clientes', 'Válidos', 'Venda (R$)', 'Faturado (R$)', 'Em carteira (R$)', 'Digitado (R$)', 'Desistência (R$)', 'Invest. (R$)', 'Invest. ÷ venda', 'Próprio (R$)', 'Outro (R$)'].map((t, i) => h('span', { class: i ? 'num' : '' }, t)));
    const linhas = arvore.map((n) => h('div', { class: `exp-linha${n.caminho === escolhido.caminho ? ' escolhida' : ''}${n.profundidade ? '' : ' raiz'}`, dados: { caminho: n.caminho }, onclick: () => clicarLinha(n) },
      h('span', { class: 'ramo', style: `padding-left:${n.profundidade * 24}px` },
        n.temFilhos ? h('button', { type: 'button', class: 'abre', 'aria-expanded': n.aberto ? 'true' : 'false', 'aria-label': `${n.aberto ? 'Fechar' : 'Abrir'} ${n.rotulo}`,
          onclick: (ev) => { ev.stopPropagation(); if (n.aberto) estado.abertos.delete(n.caminho); else estado.abertos.add(n.caminho); desenhar(); } }, n.aberto ? '▼' : '▶') : h('span', { class: 'abre vazio' }),
        h('button', { type: 'button', class: 'nome', title: n.rotulo }, n.rotulo)),
      h('span', { class: 'num' }, n0(n.ind.clientes)), h('span', { class: 'num' }, n0(n.ind.venda.qtd)), h('b', { class: 'num' }, valor(n.ind.venda.valor)), h('span', { class: 'num' }, valor(n.ind.faturado)),
      h('span', { class: 'num' }, valor(n.ind.saldo)), h('span', { class: 'num' }, valor(n.ind.digitado.valor)), h('span', { class: 'num' }, valor(n.ind.cancelado.valor)), h('span', { class: 'num' }, valor(n.ind.investimento.valor)),
      h('span', { class: 'num' }, pct(n.ind.pctInvestimento)), h('span', { class: 'num' }, valor(n.ind.propria)), h('span', { class: 'num' }, valor(n.ind.outra))));

    return [niveis, niveisCelular, migalhas, numeros, h('div', { class: 'exp-quadros' }, venda, processo),
      h('section', { class: 'cartao exp-arvore', 'aria-label': 'Árvore' }, h('div', { class: 'rolagem' }, cab, linhas)), listaDoRamo(buscarPedidos(escolhido.pedidos, estado.busca), escolhido)];
  }
  desenharFiltros();
  if (!pedidos.length) {
    return montar(area, h('p', { class: 'mensagem info', id: 'sem-pedidos' }, todosPedidos.length
      ? `Nenhum pedido de CNPJ da base. Há ${n0(todosPedidos.length)} pedido(s) de filial de um grupo da base: clique em Ver por Grupo.` : 'Nenhum pedido importado ainda.'));
  }
  desenhar();
}
