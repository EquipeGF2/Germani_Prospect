// Ajuda: fluxograma da operação, manual por capítulos e PDF, conforme o perfil. O conteúdo fica em shared/ajuda.mjs. docs/03 §15
import { capitulosDoUsuario, DESVIOS, FLUXO } from '../../shared/ajuda.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, formatar, comEspera } from '../ui.js';
import { gerarManualPdf } from '../relatorio.js';

const NOMES_PERFIL = { administrador: 'Administrador', gerente: 'Gerente comercial', supervisor: 'Supervisor', vendedor: 'Representante/vendedor', financeiro: 'Analista financeiro' };
const item = (x) => (Array.isArray(x) ? [h('b', {}, `${x[0]}: `), x[1]] : x);

/** Desenha os blocos de um capítulo. */
function blocos(lista) {
  return lista.map((b) => {
    if (b[0] === 'p') return h('p', {}, b[1]);
    if (b[0] === 'h') return h('h2', {}, b[1]);
    if (b[0] === 'img') return h('figure', { class: `ajf-figura${b[1].includes('celular') ? ' celular' : ''}` }, h('img', { src: `img/ajuda/${b[1]}`, alt: b[2], loading: 'lazy' }), h('figcaption', {}, b[2]));
    if (b[0] === 'lista') return h('ul', {}, b[1].map((x) => h('li', {}, item(x))));
    if (b[0] === 'passos') return h('ol', {}, b[1].map((x) => h('li', {}, item(x))));
    return h('div', { class: 'tabela-wrap' }, h('table', { class: 'ped-tabela' },
      h('thead', {}, h('tr', {}, b[1].map((t) => h('th', {}, t)))),
      h('tbody', {}, b[2].map((l) => h('tr', {}, l.map((c, i) => h('td', {}, i ? c : h('b', {}, c))))))));
  });
}

export async function render(conteudo, { usuario, parametros }) {
  const capitulos = capitulosDoUsuario(usuario);
  const pedido = Number(parametros?.get('cap'));
  const capitulo = capitulos.find((c) => c.n === pedido);
  const hoje = hojeSaoPaulo();
  const perfil = NOMES_PERFIL[usuario.perfil] ?? usuario.perfil;
  const baixar = (lista, nome) => (ev) => comEspera(ev.currentTarget, () => gerarManualPdf({ capitulos: lista, perfil, emissao: formatar.data(hoje), nomeArquivo: nome }));

  if (capitulo) {
    const i = capitulos.indexOf(capitulo);
    const anterior = capitulos[i - 1]; const seguinte = capitulos[i + 1];
    const nomeCap = (c) => `${c.n}. ${c.nome}`;
    return montar(conteudo, h('div', { class: 'ajf-capitulo' },
      h('nav', { class: 'cartao ajf-indice', 'aria-label': 'Capítulos' }, h('a', { href: '#/ajuda', class: 'ajf-voltar' }, '‹ Fluxograma'),
        capitulos.map((c) => h('a', { href: `#/ajuda?cap=${c.n}`, class: c === capitulo ? 'ativo' : '', 'aria-current': c === capitulo ? 'page' : null }, nomeCap(c)))),
      h('article', { class: 'cartao ajf-texto', id: 'capitulo-ajuda' },
        h('div', { class: 'ajf-topo' }, h('h1', {}, nomeCap(capitulo)),
          h('button', { type: 'button', class: 'secundario pequeno', id: 'pdf-capitulo', onclick: baixar([capitulo], `manual-capitulo-${capitulo.n}-${hoje}.pdf`) }, 'Baixar este capítulo em PDF')),
        blocos(capitulo.blocos),
        h('div', { class: 'ajf-navega' }, anterior ? h('a', { class: 'botao secundario', href: `#/ajuda?cap=${anterior.n}` }, `‹ ${nomeCap(anterior)}`) : h('span'),
          seguinte ? h('a', { class: 'botao secundario', href: `#/ajuda?cap=${seguinte.n}` }, `${nomeCap(seguinte)} ›`) : h('span')))));
  }

  let selecionada = 'lista';
  const fluxograma = h('section', { class: 'cartao', id: 'fluxograma', 'aria-label': 'Fluxograma da operação' });
  const detalhe = h('section', { class: 'cartao ajf-detalhe', id: 'detalhe-etapa', 'aria-live': 'polite' });
  function desenharFluxo() {
    const passo = (e) => h('button', { type: 'button', class: `ajf-passo${selecionada === e.id ? ' ativo' : ''}`, dados: { etapa: e.id }, 'aria-pressed': selecionada === e.id ? 'true' : 'false', onclick: () => { selecionada = e.id; desenharFluxo(); } },
      h('b', {}, `${FLUXO.indexOf(e) + 1}. ${e.nome}`), h('span', {}, e.quem));
    const linha = (etapas) => h('div', { class: 'ajf-linha' }, etapas.flatMap((e, i) => [passo(e), i < etapas.length - 1 ? h('span', { class: 'ajf-seta', 'aria-hidden': 'true' }, '›') : null]));
    montar(fluxograma, h('h2', {}, 'O fluxo da operação'), h('p', { class: 'ajuda' }, 'Clique numa etapa para ver quem age, em qual tela e o que faz o cliente avançar.'),
      linha(FLUXO.slice(0, 4)), h('div', { class: 'ajf-volta', 'aria-hidden': 'true' }), linha(FLUXO.slice(4)),
      h('div', { class: 'ajf-desvios' }, h('span', { class: 'ajuda' }, 'Desvios do caminho:'), DESVIOS.map((d) => h('button', { type: 'button', class: `ajf-desvio${selecionada === d.id ? ' ativo' : ''}`, dados: { etapa: d.id }, onclick: () => { selecionada = d.id; desenharFluxo(); } }, d.nome))));
    const e = [...FLUXO, ...DESVIOS].find((x) => x.id === selecionada);
    const temCapitulo = capitulos.some((c) => c.n === e.cap);
    montar(detalhe, h('h2', {}, e.nome), h('dl', { class: 'ajf-dados' }, h('dt', {}, 'Quem age'), h('dd', {}, e.quem), h('dt', {}, 'Em qual tela'), h('dd', {}, e.tela), h('dt', {}, 'O que acontece'), h('dd', {}, e.faz), h('dt', {}, 'Para avançar'), h('dd', {}, e.avanca)),
      temCapitulo ? h('a', { href: `#/ajuda?cap=${e.cap}`, id: 'ler-capitulo' }, `Ler o capítulo ${e.cap}`) : null);
  }
  desenharFluxo();
  montar(conteudo,
    h('div', { class: 'exp-topo' }, h('div', {}, h('h1', {}, 'Ajuda'), h('p', { class: 'ajuda', style: 'margin:0' }, 'Como funciona a operação, do prospect ao pedido faturado.')),
      h('button', { type: 'button', id: 'pdf-manual', onclick: baixar(capitulos, `manual-germani-${hoje}.pdf`) }, 'Baixar manual em PDF')),
    fluxograma,
    h('div', { class: 'ajf-baixo' }, detalhe,
      h('section', { class: 'cartao ajf-capitulos', 'aria-label': 'Manual por capítulos' }, h('h2', {}, 'Manual por capítulos'),
        h('p', { class: 'ajuda' }, `O perfil ${perfil} vê ${capitulos.length} capítulos: só o que ele usa.`),
        h('div', { class: 'ajf-grade' }, capitulos.map((c) => h('a', { class: 'ajf-cap', href: `#/ajuda?cap=${c.n}`, dados: { cap: c.n } }, h('span', { class: 'num' }, String(c.n)), h('span', {}, h('b', {}, c.nome), h('small', {}, c.desc))))))));
}
