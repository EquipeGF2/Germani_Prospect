// Rejeitados: baixados, expurgados e sem interesse (do cliente e do representante), com hierarquia de níveis, motivos e
// exportação em Excel por tipo. Só gerente e administrador. docs/03 §16
// Lê os rejeitados e o resumo da carteira uma vez (em cache); níveis, cards, busca e exportação só redesenham no navegador.
import { bancoApp, lerComCache } from '../db.js';
import { consultaResumo } from '../../shared/explorar.mjs';
import { buscarRejeitados, consultaRejeitados, contarMotivos, montarArvoreRejeitados, NIVEIS_REJEITADOS, NOME_TIPO_REJEICAO, paraExportar, prepararRejeitado, SELO_TIPO_REJEICAO, TIPOS_REJEICAO } from '../../shared/rejeitados.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, formatar, selo, comEspera, semRolagem } from '../ui.js';
import { baixarXlsx } from '../planilhas.js';
import { blocoNiveis, documento, razaoSocial, tabelaPedidos } from './_pedidos.js';

const CHAVE_NIVEIS = 'germani.rejeitadosNiveis';
const LIMITE_LISTA = 300;
const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '—');
const CLASSE_SELO = { baixado: '', expurgado: 'investimento', cliente: 'erro', representante: 'alerta' };
const DETALHE = { baixado: 'CNPJ baixado na Receita', expurgado: 'já eram clientes (grupo)', cliente: 'o cliente recusou', representante: 'o representante não vai trabalhar' };

function lerNiveis(possiveis) {
  try { const s = JSON.parse(localStorage.getItem(CHAVE_NIVEIS) ?? 'null'); if (Array.isArray(s)) { const ok = s.filter((n) => possiveis.includes(n)); if (ok.length) return ok; } } catch { /* padrão */ }
  return ['supervisor', 'representante'];
}

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const [linhas, base] = (await Promise.all([lerComCache(db, consultaRejeitados(), 300), lerComCache(db, consultaResumo({ usuario }), 300)])).map((r) => r.rows);
  const clientes = linhas.map(prepararRejeitado);
  const possiveis = Object.keys(NIVEIS_REJEITADOS);
  const nome = (n) => NIVEIS_REJEITADOS[n].nome;
  const estado = { niveis: lerNiveis(possiveis), abertos: new Set(['']), sel: '', editarNiveis: false, tipo: 'todos', busca: '', exportar: new Set(TIPOS_REJEICAO) };
  const area = h('div', { id: 'rejeitados', class: 'ped-exp acf-exp rej-exp' });
  const mudarNiveis = (n) => { estado.niveis = n; estado.abertos = new Set(['']); estado.sel = ''; try { localStorage.setItem(CHAVE_NIVEIS, JSON.stringify(n)); } catch { /* só nesta visita */ } desenhar(); };
  const campoBusca = h('input', { type: 'search', id: 'busca-rejeitados', 'aria-label': 'Buscar', placeholder: 'Cliente, CNPJ, cidade ou representante',
    oninput: () => { estado.busca = campoBusca.value; desenhar(); campoBusca.focus(); } });

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

  function exportar(e) {
    const marcados = () => TIPOS_REJEICAO.filter((t) => estado.exportar.has(t));
    const total = paraExportar(e.clientes, marcados()).length;
    const botao = h('button', { type: 'button', id: 'exportar-rejeitados', disabled: !total, onclick: async () => {
      const lista = paraExportar(e.clientes, marcados());
      await comEspera(botao, () => baixarXlsx(`rejeitados-${hojeSaoPaulo()}.xlsx`, [
        { titulo: 'Tipo', valor: (l) => NOME_TIPO_REJEICAO[l.tipo], largura: 30 }, { titulo: 'Motivo', valor: (l) => l.motivo, largura: 40 }, { titulo: 'Data', valor: (l) => formatar.data(l.data), largura: 12 },
        { titulo: 'Código', valor: (l) => l.codigo_cliente_erp ?? '', largura: 10 }, { titulo: 'Razão social', valor: (l) => l.razao_social, largura: 40 }, { titulo: 'CNPJ', valor: (l) => documento(l.cnpj), largura: 20 },
        { titulo: 'Telefone', valor: (l) => l.telefone ?? '', largura: 16 }, { titulo: 'Cidade', valor: (l) => l.cidade, largura: 22 }, { titulo: 'UF', valor: (l) => l.uf, largura: 6 },
        { titulo: 'Onda', valor: (l) => l.onda, largura: 8 }, { titulo: 'Segmento', valor: (l) => l.tipologia_gtm, largura: 22 },
        { titulo: 'Representante', valor: (l) => [l.vendedor_codigo, l.vendedor_nome].filter(Boolean).join(' - '), largura: 30 }, { titulo: 'Supervisor', valor: (l) => l.supervisor_nome ?? '', largura: 24 },
      ], lista, { aba: 'Rejeitados' }));
    } }, `Exportar Excel · ${n0(total)} clientes`);
    return h('section', { class: 'cartao', id: 'rej-exportar' }, h('h2', {}, 'Exportar a base de rejeitados'),
      h('p', { class: 'ajuda', style: 'margin:0 0 10px' }, `Vai no arquivo o que está escolhido na hierarquia (${escolhido.rotulo}), nos tipos marcados. Marque um ou mais.`),
      h('div', { class: 'rej-tipos' }, TIPOS_REJEICAO.map((t) => h('label', { class: 'ped-opcao' },
        h('input', { type: 'checkbox', dados: { tipo: t }, checked: estado.exportar.has(t), onchange: (ev) => { if (ev.target.checked) estado.exportar.add(t); else estado.exportar.delete(t); desenhar(); } }),
        h('span', {}, `${NOME_TIPO_REJEICAO[t]} (${n0(e.cont[t])})`))), botao));
  }
  let escolhido = null;

  function lista(e) {
    const vistos = buscarRejeitados(e.clientes.filter((l) => estado.tipo === 'todos' || l.tipo === estado.tipo), estado.busca)
      .sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? '')) || String(a.razao_social).localeCompare(String(b.razao_social), 'pt-BR'));
    const colunas = [{ titulo: 'Razão social', valor: (l) => razaoSocial({ codigo: l.codigo_cliente_erp, razao: l.razao_social, doc: l.cnpj, prospectId: l.id }), classe: 'rz' },
      { titulo: 'Tipo', valor: (l) => selo(SELO_TIPO_REJEICAO[l.tipo], CLASSE_SELO[l.tipo]), classe: 'cen' }, { titulo: 'Motivo', valor: (l) => l.motivo },
      { titulo: 'Data', valor: (l) => formatar.data(l.data) || '—', classe: 'cen' }, { titulo: 'Representante', valor: (l) => [l.vendedor_codigo, l.vendedor_nome].filter(Boolean).join(' - ') },
      { titulo: 'Cidade', valor: (l) => (l.cidade ? `${l.cidade}${l.uf ? '/' + l.uf : ''}` : '—'), classe: 'cen' }, { titulo: 'Onda', valor: (l) => l.onda || '—', classe: 'cen' }];
    return h('div', { class: 'cartao' },
      h('div', { class: 'ped-lista-topo' }, h('h2', { id: 'titulo-rejeitados' }, `${estado.tipo === 'todos' ? 'Todos os rejeitados' : NOME_TIPO_REJEICAO[estado.tipo]} · ${e.rotulo} (${n0(vistos.length)})`), campoBusca),
      tabelaPedidos(colunas, vistos.slice(0, LIMITE_LISTA), { id: 'lista-rejeitados', vazio: estado.busca ? `Nada encontrado para "${estado.busca}".` : 'Nenhum cliente aqui.' }),
      vistos.length > LIMITE_LISTA ? h('p', { class: 'ajuda', style: 'margin:12px 0 0' }, `Mostrando ${n0(LIMITE_LISTA)} de ${n0(vistos.length)}. Escolha uma linha na hierarquia para ver menos, ou exporte.`) : null);
  }

  function desenhar() {
    const arvore = montarArvoreRejeitados({ clientes, base, niveis: estado.niveis, abertos: estado.abertos });
    escolhido = arvore.find((n) => n.caminho === estado.sel) ?? arvore[0];
    const etapas = arvore.filter((n) => estado.sel === n.caminho || estado.sel.startsWith(`${n.caminho}/`) || n.caminho === '').sort((a, b) => a.profundidade - b.profundidade);
    const migalhas = h('nav', { class: 'exp-caminho', 'aria-label': 'Linha escolhida' }, etapas.flatMap((n, i) => [
      h('button', { type: 'button', class: n.caminho === escolhido.caminho ? 'atual' : '', title: n.rotulo, onclick: () => { estado.sel = n.caminho; desenhar(); } }, n.profundidade ? `${nome(n.nivel)}: ${n.rotulo}` : n.rotulo),
      i < etapas.length - 1 ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null]));
    montar(area, ...blocoNiveis({ estado, possiveis, nome, mudarNiveis, desenhar }), migalhas, cards(escolhido), motivos(escolhido), arvoreNaTela(arvore, escolhido), exportar(escolhido), lista(escolhido));
  }

  desenhar();
  montar(conteudo, h('div', { class: 'exp-topo' }, h('h1', {}, 'Rejeitados')),
    h('p', { class: 'ajuda acf-frase' }, 'Clientes da base que saíram da prospecção. Escolha a linha na hierarquia e o tipo nos cards: tudo abaixo segue a escolha.'), area);
}
