// Lista principal (Não contactado / Em prospecção) e Acompanhamento (demais status). docs/03 §6
// Visões: lista, cidade, bairro, onda, status e — só vendedor — rota. Busca sem acento.
import { bancoApp } from '../db.js';
import { consultaCarteira, visoesPermitidas } from '../../shared/carteira.mjs';
import { h, montar, mensagem, formatar, numeros } from '../ui.js';
import { gravarLote, lerLote, seloStatus } from './_carteira.js';

const POR_PAGINA = 50;
const NOMES_VISAO = { lista: 'Lista', cidade: 'Cidade', bairro: 'Bairro', onda: 'Onda', status: 'Status', rota: 'Rota' };
const FILTROS = ['cidadeBusca', 'uf', 'bairroBusca', 'onda', 'rota', 'subrota', 'status', 'vendedorId', 'somenteRetornos'];

function lerEstado(parametros) {
  const e = { aba: parametros.get('aba') === 'acompanhamento' ? 'acompanhamento' : 'principal', visao: parametros.get('visao') ?? '',
    busca: parametros.get('busca') ?? '', pagina: Math.max(0, Number(parametros.get('pagina')) || 0), filtros: {} };
  for (const f of FILTROS) if (parametros.get(f)) e.filtros[f] = parametros.get(f);
  if (e.filtros.vendedorId) e.filtros.vendedorId = Number(e.filtros.vendedorId);
  if (e.filtros.somenteRetornos) e.filtros.somenteRetornos = true;
  e.visao ||= e.aba === 'acompanhamento' && !e.filtros.status ? 'status' : 'lista';
  return e;
}

function endereco(e, muda = {}) {
  const n = { ...e, ...muda, filtros: { ...e.filtros, ...(muda.filtros ?? {}) } };
  const q = new URLSearchParams();
  if (n.aba === 'acompanhamento') q.set('aba', 'acompanhamento');
  if (n.visao && n.visao !== 'lista') q.set('visao', n.visao);
  if (n.busca) q.set('busca', n.busca);
  for (const [k, v] of Object.entries(n.filtros)) if (v != null && v !== '' && v !== false) q.set(k, v === true ? '1' : v);
  if (n.pagina) q.set('pagina', n.pagina);
  const s = q.toString();
  return `#/carteira${s ? '?' + s : ''}`;
}

async function vendedoresDoEscopo(db, usuario) {
  if (usuario.perfil === 'administrador' || usuario.perfil === 'financeiro') {
    return (await db.execute("SELECT id, nome, codigo_erp FROM usuarios WHERE perfil IN ('vendedor','supervisor') AND ativo = 1 ORDER BY nome")).rows;
  }
  if (usuario.perfil === 'supervisor') {
    return (await db.execute({ sql: 'SELECT id, nome, codigo_erp FROM usuarios WHERE (supervisor_id = ? OR id = ?) AND ativo = 1 ORDER BY nome', args: [usuario.id, usuario.id] })).rows;
  }
  return [];
}

function descreverFiltros(e) {
  const f = e.filtros;
  const partes = [];
  if (f.status) partes.push(['status', `Status: ${f.status.replace(/_/g, ' ')}`]);
  if (f.cidadeBusca) partes.push(['cidadeBusca', `Cidade: ${f.cidadeBusca}${f.uf ? '/' + f.uf : ''}`]);
  if (f.bairroBusca) partes.push(['bairroBusca', `Bairro: ${f.bairroBusca}`]);
  if (f.onda) partes.push(['onda', `Onda ${f.onda}`]);
  if (f.rota) partes.push(['rota', `Rota ${f.rota}${f.subrota ? ' / ' + f.subrota : ''}`]);
  if (f.somenteRetornos) partes.push(['somenteRetornos', 'Só retornos vencidos/hoje']);
  return partes;
}

export async function render(conteudo, ctx) {
  const { usuario, parametros } = ctx;
  const db = await bancoApp();
  const e = lerEstado(parametros);
  const permitidas = visoesPermitidas(usuario);
  if (!permitidas.includes(e.visao)) e.visao = 'lista';
  const podeRegistrar = usuario.perfil !== 'financeiro';
  const selecao = new Set(lerLote());

  // Na aba Acompanhamento a lista mostra a carteira fora da lista principal (por status)
  const filtros = { ...e.filtros, foraDaLista: e.aba === 'acompanhamento' && !e.filtros.status };
  let consulta;
  try {
    consulta = consultaCarteira({ usuario, visao: e.visao, filtros, busca: e.busca, limite: POR_PAGINA + 1, deslocamento: e.pagina * POR_PAGINA });
  } catch (erro) {
    return montar(conteudo, mensagem(erro.message, 'erro'));
  }
  const linhas = (await db.execute(consulta)).rows;
  const vendedores = await vendedoresDoEscopo(db, usuario);

  const campoBusca = h('input', { type: 'search', id: 'busca', value: e.busca, placeholder: 'Nome, CNPJ, cidade ou bairro', 'aria-label': 'Buscar prospect' });
  const formBusca = h('form', { class: 'barra-busca', onsubmit: (ev) => { ev.preventDefault(); location.hash = endereco(e, { busca: campoBusca.value.trim(), pagina: 0 }); } },
    campoBusca, h('button', { type: 'submit' }, 'Buscar'));

  const visoes = h('div', { class: 'visoes', role: 'tablist' }, permitidas
    .filter((v) => (e.aba === 'acompanhamento' ? ['status', 'lista', 'cidade', 'bairro', 'onda', 'rota'].includes(v) : v !== 'status'))
    .map((v) => h('a', { href: endereco(e, { visao: v, pagina: 0 }), class: v === e.visao ? 'ativa' : '' }, NOMES_VISAO[v])));

  const extras = [];
  if (vendedores.length) {
    const sel = h('select', { id: 'filtro-vendedor', 'aria-label': 'Vendedor', onchange: () => { location.hash = endereco(e, { filtros: { vendedorId: sel.value ? Number(sel.value) : null }, pagina: 0 }); } },
      h('option', { value: '' }, 'Toda a equipe'),
      vendedores.map((v) => h('option', { value: v.id, selected: Number(v.id) === e.filtros.vendedorId }, `${v.nome}${v.codigo_erp ? ' · ' + v.codigo_erp : ''}`)));
    extras.push(sel);
  }
  extras.push(h('label', { class: 'marcador' },
    h('input', { type: 'checkbox', id: 'so-retornos', checked: Boolean(e.filtros.somenteRetornos), onchange: (ev) => { location.hash = endereco(e, { filtros: { somenteRetornos: ev.target.checked }, pagina: 0 }); } }),
    ' Só retornos vencidos/hoje'));

  const chips = descreverFiltros(e).map(([chave, texto]) => {
    const limpa = { [chave]: null };
    if (chave === 'cidadeBusca') Object.assign(limpa, { uf: null, bairroBusca: null });
    if (chave === 'rota') limpa.subrota = null;
    return h('a', { class: 'chip', href: endereco(e, { filtros: limpa, pagina: 0 }), title: 'Remover filtro' }, texto, ' ✕');
  });

  let corpo;
  if (e.visao === 'status') corpo = blocoStatus(e, linhas);
  else if (e.visao === 'lista') corpo = blocoLista(e, linhas, { usuario, podeRegistrar, selecao, comRota: permitidas.includes('rota') });
  else corpo = blocoGrupos(e, linhas);

  const titulo = e.aba === 'acompanhamento' ? 'Acompanhamento' : 'Lista principal';
  const ajuda = e.aba === 'acompanhamento'
    ? 'Clientes que já saíram da lista principal: aguardando cadastro, análise financeira, aguardando pedido, venda realizada, sem interesse e inválidos. Todos continuam nos indicadores.'
    : 'Não contactados e em prospecção. Registrou atendido ou sem interesse, o cliente passa para o acompanhamento.';
  montar(conteudo,
    h('h1', {}, titulo),
    h('p', { class: 'ajuda' }, ajuda),
    formBusca, visoes,
    h('div', { class: 'filtros-linha' }, extras),
    chips.length ? h('div', { class: 'chips' }, chips) : null,
    corpo);
}

function blocoStatus(e, linhas) {
  const lista = linhas.filter((s) => (e.aba === 'acompanhamento' ? !Number(s.na_lista) : true));
  return h('div', { class: 'grade' }, lista.map((s) => h('a', {
    class: 'atalho status-cartao', href: endereco({ ...e, visao: 'lista' }, { filtros: { status: s.status_atual }, pagina: 0 }),
    style: `border-left: 6px solid ${s.status_cor}`,
  },
  h('b', {}, s.rotulo),
  h('span', { class: 'contagem' }, formatar.numero(s.prospects)),
  h('small', {}, [
    Number(s.retornos_pendentes) ? `${s.retornos_pendentes} retorno(s) pendente(s)` : null,
    Number(s.prazos_cadastro_vencidos) ? `${s.prazos_cadastro_vencidos} com prazo de cadastro vencido` : null,
    s.media_dias_corridos != null ? `média de ${s.media_dias_corridos} dias corridos` : null,
  ].filter(Boolean).join(' · ') || ' '))));
}

function blocoGrupos(e, linhas) {
  if (!linhas.length) return mensagem('Nada encontrado com esses filtros.', 'info');
  const filtroDo = (g) => ({
    cidade: { cidadeBusca: g.cidade_busca, uf: g.uf },
    bairro: { cidadeBusca: g.cidade_busca, uf: g.uf, bairroBusca: g.bairro_busca },
    onda: { onda: g.onda },
    rota: { rota: g.rota, subrota: g.subrota },
  }[e.visao]);
  const total = linhas.reduce((s, g) => s + Number(g.prospects), 0);
  return h('div', {},
    numeros([['grupos', linhas.length], ['prospects', total], ['pendentes hoje', linhas.reduce((s, g) => s + Number(g.pendentes_hoje ?? 0), 0), 'alerta']]),
    h('div', { class: 'lista-grupos' }, linhas.map((g) => {
      const f = filtroDo(g);
      const semChave = Object.values(f).every((v) => v == null);
      const conteudo = [h('b', {}, g.rotulo), h('span', { class: 'ajuda' },
        `${g.prospects} prospect(s) · ${g.pendentes_hoje ?? 0} pendente(s) hoje · ${g.nao_contactados ?? 0} não contactado(s) · ${g.em_prospeccao ?? 0} em prospecção`)];
      return semChave ? h('div', { class: 'grupo' }, conteudo) : h('a', { class: 'grupo', href: endereco({ ...e, visao: 'lista' }, { filtros: f, pagina: 0 }) }, conteudo);
    })));
}

function blocoLista(e, linhas, { podeRegistrar, selecao, comRota }) {
  const temMais = linhas.length > POR_PAGINA;
  const pagina = linhas.slice(0, POR_PAGINA);
  if (!pagina.length) return mensagem(e.busca ? `Nada encontrado para "${e.busca}".` : 'Nenhum prospect nesta lista.', 'info');
  // lote: só para quem ainda está na lista principal (sem interesse em lote)
  const loteVisivel = podeRegistrar && e.aba === 'principal';
  const barraLote = h('div', { class: 'barra-lote' });
  const atualizarBarra = () => {
    montar(barraLote, selecao.size
      ? [h('span', {}, `${selecao.size} selecionado(s)`),
        h('a', { class: 'botao', href: '#/lote' }, 'Sem interesse em lote'),
        h('button', { class: 'secundario pequeno', onclick: () => { selecao.clear(); gravarLote([]); document.querySelectorAll('.cartao-prospect input[type=checkbox]').forEach((c) => { c.checked = false; }); atualizarBarra(); } }, 'Limpar seleção')]
      : h('span', { class: 'ajuda' }, 'Marque os prospects para registrar "sem interesse" em lote.'));
  };
  if (loteVisivel) atualizarBarra();

  const cartoes = pagina.map((p) => {
    const marca = loteVisivel && Number(p.na_lista) ? h('input', {
      type: 'checkbox', 'aria-label': `Selecionar ${p.razao_social}`, checked: selecao.has(Number(p.id)),
      onchange: (ev) => { if (ev.target.checked) selecao.add(Number(p.id)); else selecao.delete(Number(p.id)); gravarLote([...selecao]); atualizarBarra(); },
    }) : null;
    const info = [
      p.nome_fantasia && p.nome_fantasia !== p.razao_social ? p.nome_fantasia : null,
      [p.bairro, p.cidade && `${p.cidade}/${p.uf ?? ''}`].filter(Boolean).join(' — '),
      p.onda ? `Onda ${p.onda}` : null,
      comRota && p.rota ? `Rota ${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : null,
    ].filter(Boolean).join(' · ');
    const alertas = [
      Number(p.retorno_pendente) ? h('span', { class: 'selo alerta' }, `Retorno ${formatar.data(p.data_proxima_acao)}`) : null,
      Number(p.prazo_cadastro_vencido) ? h('span', { class: 'selo erro' }, 'Prazo de cadastro vencido') : null,
      p.dias_corridos != null ? h('span', { class: 'selo' }, `${p.dias_corridos} dia(s) corrido(s)`) : null,
    ];
    return h('div', { class: 'cartao-prospect' }, marca,
      h('a', { class: 'cartao-prospect-corpo', href: `#/ficha?id=${p.id}` },
        h('div', { class: 'cartao-prospect-topo' }, h('b', {}, p.razao_social), seloStatus(p)),
        h('div', { class: 'ajuda', style: 'margin:2px 0' }, `${formatar.cnpj(p.cnpj)}${info ? ' · ' + info : ''}`),
        p.status_descricao !== p.status_nome ? h('div', { class: 'ajuda', style: 'margin:2px 0' }, p.status_descricao) : null,
        h('div', { class: 'cartao-prospect-selos' }, alertas)));
  });

  const nav = h('div', { class: 'acoes' },
    e.pagina > 0 ? h('a', { class: 'botao secundario', href: endereco(e, { pagina: e.pagina - 1 }) }, '‹ Anteriores') : null,
    h('span', { class: 'ajuda', style: 'align-self:center' }, `Página ${e.pagina + 1} · ${e.pagina * POR_PAGINA + 1}–${e.pagina * POR_PAGINA + pagina.length}`),
    temMais ? h('a', { class: 'botao secundario', href: endereco(e, { pagina: e.pagina + 1 }) }, 'Próximos ›') : null);
  return h('div', {}, loteVisivel ? barraLote : null, h('div', { class: 'lista-prospects' }, cartoes), nav);
}
