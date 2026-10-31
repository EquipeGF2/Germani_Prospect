// Explorar carteira — árvore de níveis livres sobre o resumo pronto do banco (shared/explorar.mjs, migração 0012).
// Lê o resumo e os pedidos uma vez (com cache curto) e redesenha só no navegador: arrastar níveis, abrir ramos, escolher
// representante × vendedor não voltam ao banco. A Lista principal abre só com um ramo escolhido (nunca a base inteira).
import { bancoApp, lerComCache, leitorComCache } from '../db.js';
import { consultaPedidosResumo, consultaResumo, montarArvore, NIVEIS, niveisPossiveis } from '../../shared/explorar.mjs';
import { lerParametrosPainel } from '../../shared/painel.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { h, montar, mensagem, formatar } from '../ui.js';
import { lerPedidos } from './_pedidos.js';

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
  q.set('ver', '1');   // já aplicado: a lista lê direto, com o filtro do ramo
  q.set('de', 'explorar');   // o ramo basta: não exige supervisor e representante
  return `#/carteira?${q.toString()}`;
}

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const [resumo, pedidos, parametros, status] = await Promise.all([
    lerComCache(db, consultaResumo({ usuario }), 120).then((r) => r.rows),
    lerPedidos(db, consultaPedidosResumo({ usuario })).then((r) => r.rows),
    lerParametrosPainel(leitorComCache(db, 600)),
    lerComCache(db, 'SELECT codigo, nome, cor FROM status', 3600).then((r) => Object.fromEntries(r.rows.map((s) => [s.codigo, s]))),
  ]).catch((e) => {
    if (/no such table/i.test(String(e?.message))) throw new Error('O resumo da carteira ainda não existe no banco: rode no GitHub Actions → Criar administrador (aplica a migração 0012).');
    throw e;
  });

  const possiveis = niveisPossiveis(usuario);
  const tudo = veTodasEquipes(usuario);
  const raiz = tudo ? 'Toda a base' : usuario.perfil === 'supervisor' ? 'Minha equipe' : 'Minha carteira';
  const estado = { niveis: lerNiveis(possiveis, ['supervisor', 'representante', 'cidade', 'segmento']), abertos: new Set(['']), sel: '', tipo: '', editarNiveis: false };
  // Explorar é a página inicial e já abre no escopo de quem entrou (a raiz é a carteira do representante, a equipe do
  // supervisor ou a base toda). Supervisor que vê todas as equipes (ex.: Julio) abre como o gerente: a base toda,
  // e escolhe a equipe dele no 1º nível (Supervisor) quando quiser.

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
    // representante × vendedor só faz sentido para quem vê mais de uma carteira (supervisor, gerente, administrador)
    const tipos = usuario.perfil === 'vendedor' ? null : h('div', { class: 'visoes exp-tipo', role: 'group', 'aria-label': 'Representante ou vendedor' },
      [['', 'Todos'], ['representante', 'Representantes'], ['vendedor', 'Vendedores']].map(([v, t]) => h('a', { href: '#', class: estado.tipo === v ? 'ativa' : '', dados: { tipo: v || 'todos' },
        onclick: (ev) => { ev.preventDefault(); estado.tipo = v; estado.sel = ''; estado.abertos = new Set(['']); desenhar(); } }, t)));

    const niveis = h('section', { class: 'cartao exp-niveis', 'aria-label': 'Níveis da árvore' },
      h('div', { class: 'zona', title: 'Arraste para ordenar · solte aqui para incluir no fim', ondragover: (ev) => ev.preventDefault(), ondrop: soltarNoFim },
        h('span', { class: 'tit' }, 'Níveis'), estado.niveis.map(cartaoNivel)),
      h('div', { class: 'zona livres', ondragover: (ev) => ev.preventDefault(), ondrop: soltarFora },
        h('span', { class: 'tit' }, 'Disponíveis'), possiveis.filter((n) => !estado.niveis.includes(n)).map(cartaoDisponivel)));

    // celular: arrastar não funciona no toque — os níveis numa linha (com "Mudar") e, ao abrir, uma lista para ligar,
    // desligar e subir/descer cada nível. Tudo no navegador, sem ler o banco.
    const mover = (nivel, d) => { const n = [...estado.niveis]; const i = n.indexOf(nivel); const j = i + d;
      if (i < 0 || j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; mudarNiveis(n); };
    const ordemEdicao = [...estado.niveis, ...possiveis.filter((n) => !estado.niveis.includes(n))];
    const niveisCelular = h('section', { class: 'cartao exp-niveis-cel', 'aria-label': 'Níveis da árvore' },
      h('div', { class: 'exp-niveis-cel-topo' }, h('span', { class: 'tit' }, 'Níveis'),
        h('span', { class: 'ordem' }, estado.niveis.length ? estado.niveis.map((n) => NIVEIS[n].nome).join(' › ') : 'nenhum'),
        h('button', { type: 'button', class: 'secundario pequeno', id: 'mudar-niveis', 'aria-expanded': estado.editarNiveis ? 'true' : 'false',
          onclick: () => { estado.editarNiveis = !estado.editarNiveis; desenhar(); } }, estado.editarNiveis ? 'Pronto' : 'Mudar')),
      estado.editarNiveis ? h('ol', { class: 'exp-niveis-cel-lista' }, ordemEdicao.map((nivel) => {
        const i = estado.niveis.indexOf(nivel);
        const ligado = i >= 0;
        return h('li', { class: ligado ? 'ligado' : '', dados: { nivel } },
          h('label', {}, h('input', { type: 'checkbox', checked: ligado,
            onchange: () => mudarNiveis(ligado ? estado.niveis.filter((x) => x !== nivel) : [...estado.niveis, nivel]) }),
          ligado ? `${i + 1}. ${NIVEIS[nivel].nome}` : NIVEIS[nivel].nome),
          ligado ? h('span', { class: 'setas' },
            h('button', { type: 'button', class: 'secundario pequeno', 'aria-label': `Subir ${NIVEIS[nivel].nome}`, disabled: i === 0, onclick: () => mover(nivel, -1) }, '↑'),
            h('button', { type: 'button', class: 'secundario pequeno', 'aria-label': `Descer ${NIVEIS[nivel].nome}`, disabled: i === estado.niveis.length - 1, onclick: () => mover(nivel, 1) }, '↓')) : null);
      })) : null);

    // Da totalidade: uma barra de 100% em 4 partes que somam todos os prospects do ramo
    const contSemSI = ind.contactados - ind.semInteresse;   // contactados que seguem no processo (sem os sem interesse)
    const partes = [
      ['contactados', 'Contactados', contSemSI, '#1D4ED8'],
      ['si_cliente', 'Sem interesse do cliente', ind.siCliente, '#3F3F46'],
      ['si_representante', 'Sem interesse do representante', ind.siRepresentante, '#B45309'],
      ['nao_contactados', 'Não contactados', ind.status.nao_contactado, '#9CA3AF'],
      ['inativos', 'Inativos (baixados / expurgados)', ind.inativos, '#E5E7EB'],
    ];
    const totalidade = h('section', { class: 'cartao exp-grafico', id: 'grafico-totalidade' },
      h('div', { class: 'exp-grafico-topo' }, h('div', {}, h('span', { class: 'tit' }, 'Da totalidade'), h('h2', {}, escolhido.rotulo)),
        h('div', { class: 'exp-total' }, h('b', {}, n0(ind.qtd)), h('span', {}, 'prospects'))),
      h('div', { class: 'exp-barra100', role: 'img', 'aria-label': partes.map(([, nome, q]) => `${nome}: ${n0(q)}`).join(', ') },
        partes.filter(([, , q]) => q > 0).map(([chave, nome, q, cor]) => h('span', { dados: { parte: chave }, title: `${nome}: ${n0(q)}`, style: `flex:${q} 1 0;background:${cor}` }))),
      partes.map(([chave, nome, q, cor]) => h('div', { class: 'exp-legenda', dados: { parte: chave } },
        h('span', { class: `ponto${chave === 'inativos' ? ' claro' : ''}`, style: `background:${cor}` }), h('span', {}, nome),
        h('b', {}, n0(q)), h('span', { class: 'pct' }, pct(ind.qtd ? (q / ind.qtd) * 100 : null)))),
      h('p', { class: 'exp-rodape' }, h('b', {}, `Cobertura ${pct(ind.cobertura)}`),
        ` = contactados com sem interesse (${n0(ind.contactados)}) ÷ base válida (${n0(ind.base)}, sem inativos)`));

    // Dos contactados: onde estão os que seguem no processo (% sobre os contactados sem os sem interesse)
    const etapasProcesso = [['Aguardando cadastro', ind.status.aguardando_cadastro, status.aguardando_cadastro?.cor ?? '#6D28D9'],
      ['Aguardando financeiro', ind.status.analise_financeira, status.analise_financeira?.cor ?? '#C2410C'],
      ['Aguardando pedido', ind.status.aguardando_pedido, status.aguardando_pedido?.cor ?? '#0F766E'],
      ['Aguardando pedido válido', ind.status.aguardando_pedido_valido, status.aguardando_pedido_valido?.cor ?? '#B45309'],
      ['Pedido realizado', ind.vendas, status.venda_realizada?.cor ?? '#1D4ED8']];
    const doProcesso = h('section', { class: 'cartao exp-grafico', id: 'grafico-contactados' },
      h('div', { class: 'exp-grafico-topo' }, h('div', {}, h('span', { class: 'tit' }, 'Dos contactados'),
        h('h2', {}, `Onde estão os ${n0(contSemSI)} que seguem no processo`))),
      etapasProcesso.map(([nome, q, cor]) => h('div', { class: 'exp-etapa' }, h('span', { class: 'nome' }, nome),
        h('span', { class: 'trilho', 'aria-hidden': 'true' }, h('span', { style: `width:${q && contSemSI ? Math.max(1.5, (q / contSemSI) * 100) : 0}%;background:${cor}` })),
        h('b', {}, n0(q)), h('span', { class: 'pct' }, pct(contSemSI ? (q / contSemSI) * 100 : null)))),
      h('div', { class: 'exp-mini' },
        h('div', {}, h('span', { class: 'tit' }, 'Valor dos pedidos'), h('b', {}, reais(ind.valorPedidos)), h('small', {}, `de ${n0(ind.vendas)} cliente(s)`)),
        h('div', {}, h('span', { class: 'tit' }, 'Potencial'), h('b', {}, reais(ind.potencial)), h('small', {}, `em aberto × ${parametros.percentual_pipeline ?? 0}%`)),
        h('div', {}, h('span', { class: 'tit' }, 'Conversão'), h('b', {}, pct(ind.conversao)), h('small', {}, 'vendas ÷ contactados'))),
      escolhido.profundidade
        ? h('a', { class: 'botao pequeno', id: 'abrir-lista', href: enderecoLista(escolhido.filtros) }, `Abrir na Lista principal · ${n0(ind.qtd)} prospects`)
        : h('p', { class: 'ajuda', style: 'margin:0' }, 'Escolha um ramo na árvore para abrir a lista dele.'));

    const cab = h('div', { class: 'exp-linha cab' }, ['Ramo', 'Prospects', 'Contactados', 'Cobertura', 'S. int. cliente', 'S. int. repr.', 'Ag. cadastro', 'Ag. financeiro', 'Ag. pedido', 'Pedido realizado', 'Pedidos (R$)', 'Potencial (R$)']
      .map((t, i) => h('span', { class: i ? 'num' : '' }, t)));
    // clicar em qualquer parte da linha escolhe o ramo e abre (de novo na linha já escolhida e aberta: fecha); a seta só abre/fecha
    const clicarLinha = (n) => {
      if (n.temFilhos && n.aberto && estado.sel === n.caminho) estado.abertos.delete(n.caminho);
      else { estado.sel = n.caminho; if (n.temFilhos) estado.abertos.add(n.caminho); }
      desenhar();
    };
    const linhas = arvore.map((n) => h('div', { class: `exp-linha${n.caminho === escolhido.caminho ? ' escolhida' : ''}${n.profundidade ? '' : ' raiz'}`, dados: { caminho: n.caminho },
      style: `--prof:${n.profundidade}`, onclick: () => clicarLinha(n) },
      h('span', { class: 'ramo', style: `padding-left:${n.profundidade * 24}px` },
        n.temFilhos ? h('button', { type: 'button', class: 'abre', 'aria-expanded': n.aberto ? 'true' : 'false', 'aria-label': `${n.aberto ? 'Fechar' : 'Abrir'} ${n.rotulo}`,
          onclick: (ev) => { ev.stopPropagation(); if (n.aberto) estado.abertos.delete(n.caminho); else estado.abertos.add(n.caminho); desenhar(); } }, n.aberto ? '▼' : '▶') : h('span', { class: 'abre vazio' }),
        h('button', { type: 'button', class: 'nome', title: n.rotulo }, n.rotulo)),
      // `dados.r` = rótulo do número no cartão do celular; `cel` = ordem nele (grade 4 × 2); inativos só aparecem no celular
      h('b', { class: 'num qtd' }, n0(n.ind.qtd)), h('span', { class: 'quebra', 'aria-hidden': 'true' }),
      h('span', { class: 'num contact' }, n0(n.ind.contactados)),
      h('span', { class: 'num cobertura', dados: { r: 'Cobert.', cel: 9 } }, pct(n.ind.cobertura)),
      h('span', { class: 'num', dados: { r: 'S.I. cli.', cel: 5 } }, n0(n.ind.siCliente)),
      h('span', { class: 'num', dados: { r: 'S.I. rep.', cel: 6 } }, n0(n.ind.siRepresentante)),
      h('span', { class: 'num', dados: { r: 'Ag. cad.', cel: 1 } }, n0(n.ind.status.aguardando_cadastro)),
      h('span', { class: 'num', dados: { r: 'Ag. fin.', cel: 2 } }, n0(n.ind.status.analise_financeira)),
      h('span', { class: 'num', dados: { r: 'Ag. ped.', cel: 3 } }, n0(n.ind.aguardandoPedido)),
      h('b', { class: 'num', dados: { r: 'Pedidos', cel: 4 } }, n0(n.ind.vendas)),
      h('span', { class: 'num', dados: { r: 'Valor', cel: 8 } }, reais(n.ind.valorPedidos)), h('span', { class: 'num potencial' }, reais(n.ind.potencial)),
      h('span', { class: 'num so-celular', dados: { r: 'Inativos', cel: 7 } }, n0(n.ind.inativos))));

    return [
      h('div', { class: 'exp-topo' }, h('h1', {}, 'Explorar carteira'), tipos),
      h('p', { class: 'ajuda exp-sub' }, 'Do total até o cliente: escolha e ordene os níveis, abra os ramos; os números de cima seguem o ramo escolhido.'),
      niveis, niveisCelular, migalhas,
      h('div', { class: 'exp-quadros' }, totalidade, doProcesso),
      h('section', { class: 'cartao exp-arvore', 'aria-label': 'Árvore' }, h('div', { class: 'rolagem' }, cab, linhas)),
      h('p', { class: 'ajuda' }, 'Números do resumo pronto no banco (atualizado a cada registro e importação) — a tela não lê a carteira inteira.'),
    ];
  }

  if (!resumo.length) return montar(conteudo, h('h1', {}, 'Explorar carteira'), mensagem('Ainda não há prospects na sua carteira.', 'info'));
  desenhar();
}
