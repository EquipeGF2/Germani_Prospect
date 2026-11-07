// Rejeitados: baixados, expurgados e sem interesse (do cliente e do representante), com hierarquia de níveis, motivos e
// o botão Excel do que está na tela. Gerente e administrador veem tudo; o supervisor, só a equipe dele. docs/03 §16
// A tela lê só as contagens (por chave dos níveis, tipo, motivo e mês) e o resumo da carteira, em cache; os dados de cada
// cliente são lidos só ao exportar.
import { bancoApp, lerComCache } from '../db.js';
import { consultaResumo } from '../../shared/explorar.mjs';
import { consultaResumoRejeitados, contarMotivos, montarArvoreRejeitados, naLinha, NIVEIS_REJEITADOS, NOME_TIPO_REJEICAO, prepararRejeitado, TIPOS_REJEICAO } from '../../shared/rejeitados.mjs';
import { h, montar, formatar, comEspera, aviso, semRolagem } from '../ui.js';
import { blocoNiveis } from './_pedidos.js';
import { exportarRejeitados } from './_rejeitados-excel.js';
import { memoriaDaTela } from '../memoria.js';
import { veTodasEquipes } from '../../shared/perfis.mjs';

const CHAVE_NIVEIS = 'germani.rejeitadosNiveis';
const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '—');
const DETALHE = { baixado: 'CNPJ baixado na Receita', expurgado: 'já eram clientes (grupo)', cliente: 'o cliente recusou', representante: 'o representante não vai trabalhar' };

function lerNiveis(possiveis, padrao) {
  try { const s = JSON.parse(localStorage.getItem(CHAVE_NIVEIS) ?? 'null'); if (Array.isArray(s)) { const ok = s.filter((n) => possiveis.includes(n)); if (ok.length) return ok; } } catch { /* padrão */ }
  return padrao;
}

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const [linhas, base] = (await Promise.all([lerComCache(db, consultaResumoRejeitados({ usuario }), 300), lerComCache(db, consultaResumo({ usuario }), 300)])).map((r) => r.rows);
  const clientes = linhas.map(prepararRejeitado);
  const possiveis = Object.keys(NIVEIS_REJEITADOS);
  const nome = (n) => NIVEIS_REJEITADOS[n].nome;
  const tudo = veTodasEquipes(usuario);   // supervisor sem "vê todas as equipes": só a equipe dele, aberta por representante
  const estado = { niveis: lerNiveis(possiveis, tudo ? ['supervisor', 'representante'] : ['representante']), abertos: new Set(['']), sel: '', editarNiveis: false, tipo: 'todos' };
  const memoria = memoriaDaTela('rejeitados', usuario);   // ao voltar, a linha, as abertas e o tipo continuam como estavam
  const salvo = memoria.ler();
  if (salvo && JSON.stringify(salvo.niveis) === JSON.stringify(estado.niveis)) Object.assign(estado, { sel: salvo.sel ?? '', abertos: new Set(salvo.abertos ?? ['']), tipo: salvo.tipo ?? 'todos' });
  const area = h('div', { id: 'rejeitados', class: 'ped-exp acf-exp rej-exp' });
  const mudarNiveis = (n) => { estado.niveis = n; estado.abertos = new Set(['']); estado.sel = ''; try { localStorage.setItem(CHAVE_NIVEIS, JSON.stringify(n)); } catch { /* só nesta visita */ } desenhar(); };
  // Excel do que está na tela: a linha escolhida na hierarquia e o tipo do card (Rejeitados = os quatro tipos, uma aba cada)
  const botaoExcel = h('button', { type: 'button', id: 'excel-rejeitados', onclick: () => comEspera(botaoExcel, async () => {
    const tipos = estado.tipo === 'todos' ? [...TIPOS_REJEICAO] : [estado.tipo];
    const n = await exportarRejeitados(db, { usuario, tipos, filtro: (l) => naLinha(escolhido.caminho, l) });
    aviso(`Excel gerado: ${n0(n)} clientes.`);
  }) });

  function cards(e) {
    const c = e.cont;
    const cartao = (id, titulo, numero, linha1, linha2) => h('button', { type: 'button', class: `acf-etapa${estado.tipo === id ? ' ativa' : ''}`, id: `rej-${id}`, 'aria-pressed': estado.tipo === id ? 'true' : 'false',
      onclick: () => { estado.tipo = id; desenhar(); } }, h('span', { class: 'tit' }, titulo), h('b', {}, n0(numero)), h('span', {}, linha1), h('span', {}, linha2 || ' '));
    return semRolagem(h('div', { class: 'acf-fluxo rej-cards', id: 'rej-cards' },
      cartao('todos', 'Rejeitados', c.total, e.naBase == null ? 'clique num tipo para filtrar' : `${pct(c.total, e.naBase)} da base de ${n0(e.naBase)}`, e.naBase == null ? '' : 'clique num tipo para filtrar'),
      TIPOS_REJEICAO.map((t) => cartao(t, NOME_TIPO_REJEICAO[t], c[t], DETALHE[t], e.naBase == null ? '' : `${pct(c[t], e.naBase)} da base`))), { classe: 'quebra', cortados: '.acf-etapa' });
  }

  // motivos: só para o sem interesse escolhido no card (baixado e expurgado não têm motivo de sem interesse)
  function motivos(e) {
    if (estado.tipo !== 'cliente' && estado.tipo !== 'representante') return null;
    const lista = contarMotivos(e.clientes, estado.tipo);
    const total = e.cont[estado.tipo];
    const maior = Math.max(1, ...lista.map((m) => m.qtd));
    return h('section', { class: 'cartao', id: 'rej-motivos' }, h('h2', {}, `Motivos do ${NOME_TIPO_REJEICAO[estado.tipo].toLowerCase()} · ${n0(total)} clientes`),
      h('p', { class: 'ajuda', style: 'margin:0 0 8px' }, 'Motivo escolhido no registro do atendimento.'),
      lista.length ? [h('div', { class: 'rej-motivo cab' }, h('span', {}, 'Motivo'), h('span'), h('span', { class: 'n' }, 'Qtd.'), h('span', { class: 'n' }, '%')),
        lista.map((m) => h('div', { class: 'rej-motivo' }, h('span', { class: 'nome', title: m.motivo }, m.motivo),
          h('span', { class: 'trilho', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((m.qtd / maior) * 100)}%;background:${estado.tipo === 'cliente' ? 'var(--destaque)' : '#B45309'}` })),
          h('b', { class: 'n' }, n0(m.qtd)), h('span', { class: 'n' }, pct(m.qtd, total))))]
        : h('p', { class: 'ajuda' }, 'Nenhum cliente deste tipo aqui.'));
  }

  function arvoreNaTela(arvore, escolhido) {
    const titulos = ['Na base', 'Baixados', 'Expurgados', 'Sem int. cliente', 'Sem int. repr.', 'Rejeitados', '% da base'];
    const clicar = (n) => { if (n.temFilhos && n.aberto && estado.sel === n.caminho) estado.abertos.delete(n.caminho); else { estado.sel = n.caminho; if (n.temFilhos) estado.abertos.add(n.caminho); } desenhar(); };
    return semRolagem(h('section', { class: 'cartao exp-arvore', 'aria-label': 'Hierarquia' }, h('div', { class: 'rolagem' },
      h('div', { class: 'exp-linha cab' }, ['Hierarquia', ...titulos].map((t, i) => h('span', { class: i ? 'num' : '' }, t))),
      arvore.map((n) => h('div', { class: `exp-linha${n.caminho === escolhido.caminho ? ' escolhida' : ''}${n.profundidade ? '' : ' raiz'}`, dados: { caminho: n.caminho }, style: `--prof:${n.profundidade}`, onclick: () => clicar(n) },
        h('span', { class: 'ramo', style: `padding-left:${n.profundidade * 24}px` },
          n.temFilhos ? h('button', { type: 'button', class: 'abre', 'aria-expanded': n.aberto ? 'true' : 'false', 'aria-label': `${n.aberto ? 'Recolher' : 'Reexibir'} ${n.rotulo}`,
            onclick: (ev) => { ev.stopPropagation(); if (n.aberto) estado.abertos.delete(n.caminho); else estado.abertos.add(n.caminho); desenhar(); } }, n.aberto ? '▼' : '▶') : h('span', { class: 'abre vazio' }),
          h('button', { type: 'button', class: 'nome', title: n.rotulo }, n.rotulo)),
        [n.naBase == null ? '—' : n0(n.naBase), n0(n.cont.baixado), n0(n.cont.expurgado), n0(n.cont.cliente), n0(n.cont.representante), n0(n.cont.total), n.naBase == null ? '—' : pct(n.cont.total, n.naBase)]
          .map((v, i) => h(i === 5 ? 'b' : 'span', { class: 'num', dados: { r: titulos[i] } }, v))))), h('p', { class: 'ajuda exp-nota' }, 'Na base: todos os prospects da linha. Pelo mês da rejeição não há Na base: a base não tem mês.')),
    { cortados: '.exp-linha > .num' });
  }

  let escolhido = null;

  function desenhar() {
    memoria.guardar({ niveis: estado.niveis, sel: estado.sel, abertos: [...estado.abertos], tipo: estado.tipo });
    const arvore = montarArvoreRejeitados({ clientes, base, niveis: estado.niveis, abertos: estado.abertos, rotuloRaiz: tudo ? 'Todos os clientes' : 'Minha equipe' });
    escolhido = arvore.find((n) => n.caminho === estado.sel) ?? arvore[0];
    const etapas = arvore.filter((n) => estado.sel === n.caminho || estado.sel.startsWith(`${n.caminho}/`) || n.caminho === '').sort((a, b) => a.profundidade - b.profundidade);
    const migalhas = h('nav', { class: 'exp-caminho', 'aria-label': 'Linha escolhida' }, etapas.flatMap((n, i) => [
      h('button', { type: 'button', class: n.caminho === escolhido.caminho ? 'atual' : '', title: n.rotulo, onclick: () => { estado.sel = n.caminho; desenhar(); } }, n.profundidade ? `${nome(n.nivel)}: ${n.rotulo}` : n.rotulo),
      i < etapas.length - 1 ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null]));
    const qtd = estado.tipo === 'todos' ? escolhido.cont.total : escolhido.cont[estado.tipo];
    botaoExcel.disabled = !qtd;
    botaoExcel.textContent = `Excel · ${n0(qtd)} ${qtd === 1 ? 'cliente' : 'clientes'}`;
    botaoExcel.title = `${estado.tipo === 'todos' ? 'Os quatro tipos, uma aba cada' : NOME_TIPO_REJEICAO[estado.tipo]} · ${escolhido.rotulo}`;
    montar(area, ...blocoNiveis({ estado, possiveis, nome, mudarNiveis, desenhar }), h('div', { class: 'rej-barra' }, migalhas, botaoExcel), cards(escolhido), motivos(escolhido), arvoreNaTela(arvore, escolhido));
  }

  desenhar();
  montar(conteudo, h('div', { class: 'exp-topo' }, h('h1', {}, 'Rejeitados')),
    h('p', { class: 'ajuda acf-frase' }, 'Clientes da base que saíram da prospecção. Escolha a linha na hierarquia e o tipo nos cards: tudo abaixo segue a escolha.'), area);
}
