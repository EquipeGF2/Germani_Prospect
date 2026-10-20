// Explorar carteira — árvore de níveis livres sobre o resumo pronto do banco (shared/explorar.mjs, migração 0012).
// Lê o resumo e os pedidos uma vez (com cache curto) e redesenha só no navegador: arrastar níveis, abrir ramos, escolher
// representante × vendedor não voltam ao banco. A Lista principal abre só com um ramo escolhido (nunca a base inteira).
import { bancoApp, lerComCache, leitorComCache } from '../db.js';
import { consultaPedidosResumo, consultaResumo, montarArvore, NIVEIS, niveisPossiveis, STATUS_ORDEM } from '../../shared/explorar.mjs';
import { lerParametrosPainel } from '../../shared/painel.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { h, montar, mensagem, formatar } from '../ui.js';

const CHAVE_NIVEIS = 'germani.explorarNiveis';
const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const pct = (v) => (v == null ? '—' : `${v.toFixed(1).replace('.', ',')}%`);
const reais = (x) => {
  const v = Number(x) || 0;
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (v >= 1e4) return `R$ ${Math.round(v / 1e3)} mil`;
  return formatar.moeda(v);
};

function lerNiveis(possiveis, padrao) {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_NIVEIS) ?? 'null');
    if (Array.isArray(salvo)) { const ok = salvo.filter((n) => possiveis.includes(n)); if (ok.length) return ok; }
  } catch { /* padrão */ }
  return padrao.filter((n) => possiveis.includes(n));
}
function guardarNiveis(n) { try { localStorage.setItem(CHAVE_NIVEIS, JSON.stringify(n)); } catch { /* só nesta visita */ } }

function enderecoLista(filtros) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v != null && v !== '') q.set(k, v);
  return `#/carteira?${q.toString()}`;
}

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const [resumo, pedidos, parametros, status] = await Promise.all([
    lerComCache(db, consultaResumo({ usuario }), 120).then((r) => r.rows),
    lerComCache(db, consultaPedidosResumo({ usuario }), 120).then((r) => r.rows),
    lerParametrosPainel(leitorComCache(db, 600)),
    lerComCache(db, 'SELECT codigo, nome, cor FROM status', 3600).then((r) => Object.fromEntries(r.rows.map((s) => [s.codigo, s]))),
  ]).catch((e) => {
    if (/no such table/i.test(String(e?.message))) throw new Error('O resumo da carteira ainda não existe no banco: rode no GitHub Actions → Criar administrador (aplica a migração 0012).');
    throw e;
  });

  const possiveis = niveisPossiveis(usuario);
  const tudo = veTodasEquipes(usuario);
  const raiz = tudo ? 'Toda a base' : usuario.perfil === 'supervisor' ? 'Minha equipe' : 'Minha carteira';
  const estado = { niveis: lerNiveis(possiveis, ['supervisor', 'representante', 'cidade', 'segmento']), abertos: new Set(['']), sel: '', tipo: '' };

  const area = h('div', { class: 'explorar' });
  montar(conteudo, area);
  const desenhar = () => montar(area, ...tela());

  function mudarNiveis(n) { estado.niveis = n; estado.abertos = new Set(['']); estado.sel = ''; guardarNiveis(n); desenhar(); }

  // arrastar e soltar dos níveis (e × para tirar)
  function cartaoNivel(nivel, i) {
    const c = h('span', { class: 'exp-nivel', draggable: 'true', title: 'Arraste para mudar a ordem', dados: { nivel },
      ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', nivel); ev.dataTransfer.effectAllowed = 'move'; },
      ondragover: (ev) => ev.preventDefault(),
      ondrop: (ev) => { ev.preventDefault(); ev.stopPropagation(); const d = ev.dataTransfer.getData('text/plain'); if (!possiveis.includes(d)) return;
        const n = estado.niveis.filter((x) => x !== d); n.splice(Math.min(i, n.length), 0, d); mudarNiveis(n); } },
    h('span', { class: 'pega', 'aria-hidden': 'true' }, '⋮⋮'), `${i + 1}. ${NIVEIS[nivel].nome}`,
    h('button', { type: 'button', class: 'tirar', 'aria-label': `Tirar ${NIVEIS[nivel].nome}`, onclick: () => mudarNiveis(estado.niveis.filter((x) => x !== nivel)) }, '×'));
    return c;
  }
  function cartaoDisponivel(nivel) {
    return h('span', { class: 'exp-nivel livre', draggable: 'true', title: 'Arraste para os níveis (ou clique)', dados: { livre: nivel },
      ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', nivel); ev.dataTransfer.effectAllowed = 'move'; },
      onclick: () => mudarNiveis([...estado.niveis, nivel]) }, h('span', { class: 'pega', 'aria-hidden': 'true' }, '⋮⋮'), NIVEIS[nivel].nome);
  }
  const soltarNoFim = (ev) => { ev.preventDefault(); const d = ev.dataTransfer.getData('text/plain'); if (possiveis.includes(d)) mudarNiveis([...estado.niveis.filter((x) => x !== d), d]); };
  const soltarFora = (ev) => { ev.preventDefault(); const d = ev.dataTransfer.getData('text/plain'); if (estado.niveis.includes(d)) mudarNiveis(estado.niveis.filter((x) => x !== d)); };

  function tela() {
    const arvore = montarArvore({ linhas: resumo, pedidos, niveis: estado.niveis, abertos: estado.abertos, tipo: estado.tipo, parametros,
      rotuloRaiz: raiz + (estado.tipo === 'representante' ? ' · representantes' : estado.tipo === 'vendedor' ? ' · vendedores' : '') });
    const escolhido = arvore.find((n) => n.caminho === estado.sel) ?? arvore[0];
    const ind = escolhido.ind;
    // caminho até o ramo escolhido (cada etapa clicável)
    const etapas = arvore.filter((n) => estado.sel === n.caminho || estado.sel.startsWith(`${n.caminho}/`) || n.caminho === '')
      .filter((n, i, l) => l.findIndex((x) => x.caminho === n.caminho) === i).sort((a, b) => a.profundidade - b.profundidade);
    const migalhas = h('nav', { class: 'exp-caminho', 'aria-label': 'Ramo escolhido' }, etapas.flatMap((n, i) => [
      h('button', { type: 'button', class: n.caminho === escolhido.caminho ? 'atual' : '', title: n.profundidade ? `${NIVEIS[n.nivel].nome}: ${n.rotulo}` : n.rotulo, onclick: () => { estado.sel = n.caminho; desenhar(); } },
        n.profundidade ? `${NIVEIS[n.nivel].nome}: ${n.rotulo}` : n.rotulo),
      i < etapas.length - 1 ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null]));
    const tipos = h('div', { class: 'visoes exp-tipo', role: 'group', 'aria-label': 'Representante ou vendedor' },
      [['', 'Todos'], ['representante', 'Representantes'], ['vendedor', 'Vendedores']].map(([v, t]) => h('a', { href: '#', class: estado.tipo === v ? 'ativa' : '', dados: { tipo: v || 'todos' },
        onclick: (ev) => { ev.preventDefault(); estado.tipo = v; estado.sel = ''; estado.abertos = new Set(['']); desenhar(); } }, t)));

    const niveis = h('section', { class: 'cartao exp-niveis', 'aria-label': 'Níveis da árvore' },
      h('div', { class: 'zona', title: 'Arraste para ordenar · solte aqui para incluir no fim', ondragover: (ev) => ev.preventDefault(), ondrop: soltarNoFim },
        h('span', { class: 'tit' }, 'Níveis'), estado.niveis.map(cartaoNivel)),
      h('div', { class: 'zona livres', ondragover: (ev) => ev.preventDefault(), ondrop: soltarFora },
        h('span', { class: 'tit' }, 'Disponíveis'), possiveis.filter((n) => !estado.niveis.includes(n)).map(cartaoDisponivel)));

    const kpi = (rotulo, valor, detalhe) => h('div', { class: 'exp-kpi' }, h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, valor), h('div', { class: 'detalhe', title: detalhe }, detalhe));
    const kpis = h('section', { class: 'exp-kpis', 'aria-label': 'Números do ramo' },
      kpi('Prospects', n0(ind.qtd), `${n0(ind.status.invalido)} inválidos`),
      kpi('Cobertura', pct(ind.cobertura), `${n0(ind.contactados)} contactados`),
      kpi('Em andamento', n0(ind.emAndamento), 'cadastro + análise'),
      kpi('Aguardando pedido', n0(ind.aguardandoPedido), 'crédito liberado'),
      kpi('Sem interesse', n0(ind.semInteresse), `${pct(ind.contactados ? (ind.semInteresse / ind.contactados) * 100 : null)} dos contactados`),
      kpi('Vendas', n0(ind.vendas), `${n0(ind.qtdPedidos)} pedido(s)`),
      kpi('Valor dos pedidos', reais(ind.valorPedidos), 'pedidos importados do ERP'),
      kpi('Potencial', reais(ind.potencial), `em aberto × ${parametros.percentual_pipeline ?? 0}%`));

    const maior = Math.max(1, ...STATUS_ORDEM.map((s) => ind.status[s] ?? 0));
    const quadroStatus = h('section', { class: 'cartao exp-quadro' }, h('h2', {}, 'Clientes por status'), h('p', { class: 'ajuda' }, escolhido.rotulo),
      STATUS_ORDEM.map((s) => { const q = ind.status[s] ?? 0; const cor = status[s]?.cor ?? '#9CA3AF';
        return h('div', { class: 'exp-status' }, h('span', { class: 'nome' }, h('span', { class: 'ponto', style: `background:${cor}` }), status[s]?.nome ?? s),
          h('span', { class: 'trilho', 'aria-hidden': 'true' }, h('span', { style: `width:${q ? Math.max(1.5, (q / maior) * 100) : 0}%;background:${cor}` })),
          h('b', {}, n0(q)), h('span', { class: 'pct' }, pct(ind.qtd ? (q / ind.qtd) * 100 : null))); }));
    const funil = [['Base de prospects', ind.base], ['Contactados', ind.contactados], ['Atendidos', ind.atendidos], ['Cadastrados no ERP', ind.cadastrados],
      ['Crédito liberado', ind.credito], ['Venda realizada', ind.vendas]];
    const quadroFunil = h('section', { class: 'cartao exp-quadro' }, h('h2', {}, 'Funil'), h('p', { class: 'ajuda' }, '% sobre a base do ramo'),
      funil.map(([nome, q], i) => h('div', { class: 'exp-funil' }, h('span', { class: 'nome' }, nome),
        h('span', { class: 'trilho', 'aria-hidden': 'true' }, h('span', { class: `e${i}`, style: `width:${ind.base ? Math.max(1, (q / ind.base) * 100) : 0}%` })),
        h('b', {}, n0(q)), h('span', { class: 'pct' }, pct(ind.base ? (q / ind.base) * 100 : null)))),
      escolhido.profundidade
        ? h('a', { class: 'botao pequeno', id: 'abrir-lista', href: enderecoLista(escolhido.filtros) }, `Abrir na Lista principal · ${n0(ind.qtd)} prospects`)
        : h('p', { class: 'ajuda', style: 'margin-top:12px' }, 'Escolha um ramo na árvore para abrir a lista dele.'));

    const cab = h('div', { class: 'exp-linha cab' }, ['Ramo', 'Prospects', 'Cobertura', 'Em andamento', 'Aguard. pedido', 'Sem interesse', 'Vendas', 'Pedidos (R$)', 'Potencial (R$)']
      .map((t, i) => h('span', { class: i ? 'num' : '' }, t)));
    // clicar em qualquer parte da linha escolhe o ramo e abre (de novo na linha já escolhida e aberta: fecha); a seta só abre/fecha
    const clicarLinha = (n) => {
      if (n.temFilhos && n.aberto && estado.sel === n.caminho) estado.abertos.delete(n.caminho);
      else { estado.sel = n.caminho; if (n.temFilhos) estado.abertos.add(n.caminho); }
      desenhar();
    };
    const linhas = arvore.map((n) => h('div', { class: `exp-linha${n.caminho === escolhido.caminho ? ' escolhida' : ''}${n.profundidade ? '' : ' raiz'}`, dados: { caminho: n.caminho },
      onclick: () => clicarLinha(n) },
      h('span', { class: 'ramo', style: `padding-left:${n.profundidade * 24}px` },
        n.temFilhos ? h('button', { type: 'button', class: 'abre', 'aria-expanded': n.aberto ? 'true' : 'false', 'aria-label': `${n.aberto ? 'Fechar' : 'Abrir'} ${n.rotulo}`,
          onclick: (ev) => { ev.stopPropagation(); if (n.aberto) estado.abertos.delete(n.caminho); else estado.abertos.add(n.caminho); desenhar(); } }, n.aberto ? '▼' : '▶') : h('span', { class: 'abre vazio' }),
        h('button', { type: 'button', class: 'nome' }, n.rotulo)),
      h('b', { class: 'num' }, n0(n.ind.qtd)), h('span', { class: 'num' }, pct(n.ind.cobertura)), h('span', { class: 'num' }, n0(n.ind.emAndamento)),
      h('span', { class: 'num' }, n0(n.ind.aguardandoPedido)), h('span', { class: 'num' }, n0(n.ind.semInteresse)), h('b', { class: 'num' }, n0(n.ind.vendas)),
      h('span', { class: 'num' }, reais(n.ind.valorPedidos)), h('span', { class: 'num' }, reais(n.ind.potencial))));

    return [
      h('div', { class: 'exp-topo' }, h('h1', {}, 'Explorar carteira'), tipos),
      h('p', { class: 'ajuda exp-sub' }, 'Do total até o cliente: arraste os níveis, abra os ramos; os números de cima seguem o ramo escolhido.'),
      niveis, migalhas, kpis,
      h('div', { class: 'exp-quadros' }, quadroStatus, quadroFunil),
      h('section', { class: 'cartao exp-arvore', 'aria-label': 'Árvore' }, h('div', { class: 'rolagem' }, cab, linhas)),
      h('p', { class: 'ajuda' }, 'Números do resumo pronto no banco (atualizado a cada registro e importação) — a tela não lê a carteira inteira.'),
    ];
  }

  if (!resumo.length) return montar(conteudo, h('h1', {}, 'Explorar carteira'), mensagem('Ainda não há prospects na sua carteira.', 'info'));
  desenhar();
}
