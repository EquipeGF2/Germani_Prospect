// Lista principal (Não contactado / Em prospecção) e Acompanhamento (demais status). docs/03 §6
// Computador: _lista.js (sempre em tabela, filtros em grupos, ficha ao lado). Aqui: o CELULAR, layout de sempre —
// visões lista, cidade, bairro, onda, status e (só vendedor) rota; busca sem acento.
import { bancoApp, lerComCache } from '../db.js';
import { consultaCarteira, precisaFiltro, visoesPermitidas } from '../../shared/carteira.mjs';
import { h, montar, mensagem, formatar, numeros } from '../ui.js';
import { endereco, gravarLote, lerEstado, lerLote, opcoesDosFiltros, papelDoAgente, seloStatus } from './_carteira.js';
import { renderComputador } from './_lista.js';
import { veTodasEquipes } from '../../shared/perfis.mjs';

const POR_PAGINA = 50;
const NOMES_VISAO = { lista: 'Lista', cidade: 'Cidade', bairro: 'Bairro', onda: 'Onda', status: 'Status', rota: 'Rota' };
const ehCelular = () => matchMedia('(max-width: 900px)').matches;

function descreverFiltros(e) {
  const f = e.filtros;
  const partes = [];
  if (f.status) partes.push(['status', `Status: ${f.status.replace(/_/g, ' ')}`]);
  if (f.uf) partes.push(['uf', `UF: ${f.uf}`]);
  if (f.cidadeBusca) partes.push(['cidadeBusca', `Cidade: ${f.cidadeBusca}`]);
  if (f.bairroBusca) partes.push(['bairroBusca', `Bairro: ${f.bairroBusca}`]);
  if (f.onda) partes.push(['onda', `Onda ${f.onda}`]);
  if (f.segmento) partes.push(['segmento', `Segmento: ${f.segmento}`]);
  if (f.rota) partes.push(['rota', `Rota ${f.rota}${f.subrota ? ' / ' + f.subrota : ''}`]);
  if (f.somenteRetornos) partes.push(['somenteRetornos', 'Só retornos vencidos/hoje']);
  if (f.dataDe || f.dataAte) partes.push(['dataDe', `Último registro ${f.dataDe ? 'de ' + formatar.data(f.dataDe) : ''}${f.dataAte ? ' até ' + formatar.data(f.dataAte) : ''}`]);
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
  // ao cruzar o limite celular/computador a tela se redesenha no outro layout
  const mq = matchMedia('(max-width: 900px)');
  const troca = () => { mq.removeEventListener('change', troca); if (conteudo.isConnected) render(conteudo, ctx); };
  mq.addEventListener('change', troca);
  // computador: lista sempre em tabela, filtros em grupos, ficha ao lado (_lista.js); daqui para baixo é o celular
  if (!ehCelular()) return renderComputador(conteudo, ctx);

  // Na aba Acompanhamento a lista mostra a carteira fora da lista principal (por status)
  const filtros = { ...e.filtros, foraDaLista: e.aba === 'acompanhamento' && !e.filtros.status };
  let consulta;
  try {
    consulta = consultaCarteira({ usuario, visao: e.visao, filtros, busca: e.busca, limite: POR_PAGINA + 1, deslocamento: e.pagina * POR_PAGINA,
    });
  } catch (erro) {
    return montar(conteudo, mensagem(erro.message, 'erro'));
  }
  // gestão: a Lista principal só é lida depois de um filtro ou busca (não varre a base inteira a cada entrada)
  const aguardaFiltro = e.aba === 'principal' && precisaFiltro(usuario, { visao: e.visao, filtros: e.filtros, busca: e.busca });
  const gestao = usuario.perfil !== 'vendedor';
  const [linhas, opcoes] = await Promise.all([
    aguardaFiltro ? [] : db.execute(consulta).then((r) => r.rows),
    opcoesDosFiltros(db, usuario, e.filtros, e.aba)]);
  const { supervisores, vendedores } = opcoes;
  const ufs = gestao ? opcoes.ufs : [];
  const cidades = gestao ? opcoes.cidades : [];
  const segmentos = gestao ? opcoes.segmentos : [];

  const campoBusca = h('input', { type: 'search', id: 'busca', value: e.busca, placeholder: 'Nome/CNPJ', title: 'Busca por nome, CNPJ, cidade ou bairro', 'aria-label': 'Buscar prospect' });
  const formBusca = h('form', { class: 'barra-busca', onsubmit: (ev) => { ev.preventDefault(); location.hash = endereco(e, { busca: campoBusca.value.trim(), pagina: 0 }); } },
    campoBusca, h('button', { type: 'submit' }, 'Buscar'));

  const visoesDaAba = permitidas.filter((v) => (e.aba === 'acompanhamento' ? ['status', 'lista', 'cidade', 'bairro', 'onda', 'rota'].includes(v) : v !== 'status'));
  const visoes = h('div', { class: 'visoes', role: 'tablist' }, visoesDaAba
    .map((v) => h('a', { href: endereco(e, { visao: v, pagina: 0 }), class: v === e.visao ? 'ativa' : '' }, NOMES_VISAO[v])));

  const extras = [];
  // gestão e supervisor sempre veem os filtros de carteira (mesmo antes da importação da base: só "Todos")
  if (veTodasEquipes(usuario)) {
    // trocar o supervisor limpa o vendedor (a lista de vendedores passa a ser só a equipe escolhida)
    const sel = h('select', { id: 'filtro-supervisor', onchange: () => { location.hash = endereco(e, { filtros: { supervisorId: sel.value ? Number(sel.value) : null, vendedorId: null }, pagina: 0 }); } },
      h('option', { value: '' }, 'Todos'),
      supervisores.map((s) => h('option', { value: s.id, selected: Number(s.id) === e.filtros.supervisorId }, `${s.nome}${s.codigo_erp ? ' · ' + s.codigo_erp : ''}`)));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-supervisor' }, 'Supervisor'), sel));
  }
  if (veTodasEquipes(usuario) || usuario.perfil === 'supervisor') {
    const sel = h('select', { id: 'filtro-vendedor', onchange: () => { location.hash = endereco(e, { filtros: { vendedorId: sel.value ? Number(sel.value) : null }, pagina: 0 }); } },
      h('option', { value: '' }, e.filtros.supervisorId || usuario.perfil === 'supervisor' ? 'Toda a equipe' : 'Todos'),
      vendedores.map((v) => h('option', { value: v.id, selected: Number(v.id) === e.filtros.vendedorId }, `${v.nome} · ${papelDoAgente(v)}${v.codigo_erp ? ' · ' + v.codigo_erp : ''}`)));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-vendedor' }, 'Representante'), sel));
  }
  if (ufs.length) {
    // trocar a UF limpa a cidade (a lista de cidades passa a ser só a da UF)
    const sel = h('select', { id: 'filtro-uf', onchange: () => { location.hash = endereco(e, { filtros: { uf: sel.value || null, cidadeBusca: null, bairroBusca: null }, pagina: 0 }); } },
      h('option', { value: '' }, 'Todas'), ufs.map((u) => h('option', { value: u, selected: u === e.filtros.uf }, u)));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-uf' }, 'UF'), sel));
  }
  if (cidades.length) {
    const atual = e.filtros.cidadeBusca ? `${e.filtros.cidadeBusca}|${e.filtros.uf ?? ''}` : '';
    // mesma cidade em duas UFs (sem UF escolhida): a UF aparece no nome para diferenciar
    const repetida = new Set(cidades.filter((c, i) => cidades.findIndex((x) => x.cidade_busca === c.cidade_busca) !== i).map((c) => c.cidade_busca));
    const sel = h('select', { id: 'filtro-cidade', onchange: () => {
      const [cidadeBusca, uf] = sel.value ? sel.value.split('|') : [null, null];
      location.hash = endereco(e, { filtros: { cidadeBusca, uf: cidadeBusca ? uf || null : e.filtros.uf ?? null, bairroBusca: null }, pagina: 0 });
    } }, h('option', { value: '' }, 'Todas'),
    cidades.map((c) => { const v = `${c.cidade_busca}|${c.uf ?? ''}`; return h('option', { value: v, selected: v === atual }, `${c.cidade}${repetida.has(c.cidade_busca) && c.uf ? '/' + c.uf : ''}`); }));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-cidade' }, 'Cidade'), sel));
  }
  if (segmentos.length) {
    const sel = h('select', { id: 'filtro-segmento', onchange: () => { location.hash = endereco(e, { filtros: { segmento: sel.value || null }, pagina: 0 }); } },
      h('option', { value: '' }, 'Todos'), segmentos.map((s) => h('option', { value: s, selected: s === e.filtros.segmento }, s)));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-segmento' }, 'Segmento'), sel));
  }
  extras.push(h('label', { class: 'marcador' },
    h('input', { type: 'checkbox', id: 'so-retornos', checked: Boolean(e.filtros.somenteRetornos), onchange: (ev) => { location.hash = endereco(e, { filtros: { somenteRetornos: ev.target.checked }, pagina: 0 }); } }),
    ' Só retornos vencidos/hoje'));

  const chips = descreverFiltros(e).map(([chave, texto]) => {
    const limpa = { [chave]: null };
    if (chave === 'uf' || chave === 'cidadeBusca') Object.assign(limpa, { cidadeBusca: null, bairroBusca: null });
    if (chave === 'rota') limpa.subrota = null;
    if (chave === 'dataDe') limpa.dataAte = null;
    return h('a', { class: 'chip', href: endereco(e, { filtros: limpa, pagina: 0 }), title: 'Remover filtro' }, texto, ' ✕');
  });

  let corpo;
  if (aguardaFiltro) corpo = mensagem('Escolha um filtro — supervisor, representante, cidade, segmento, onda ou rota — ou faça uma busca para ver a lista. Para ver os números de toda a base, use a visão Cidade, Bairro ou Onda.', 'info');
  else if (e.visao === 'status') corpo = blocoStatus(e, linhas);
  else if (e.visao === 'lista') {
    const opcoes = { podeRegistrar, selecao, comRota: permitidas.includes('rota'), mostrarCarteira: usuario.perfil !== 'vendedor' };
    corpo = blocoLista(e, linhas, opcoes);
  } else corpo = blocoGrupos(e, linhas);

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

function blocoGrupos(e, linhas, { rotaEmNiveis = false } = {}) {
  if (!linhas.length) return mensagem('Nada encontrado com esses filtros.', 'info');
  const filtroDo = (g) => ({
    cidade: { cidadeBusca: g.cidade_busca, uf: g.uf },
    bairro: { cidadeBusca: g.cidade_busca, uf: g.uf, bairroBusca: g.bairro_busca },
    onda: { onda: g.onda },
    rota: rotaEmNiveis && !e.filtros.rota ? { rota: g.rota } : { rota: g.rota, subrota: g.subrota },
  }[e.visao]);
  // rota em 2 níveis: o 1º clique abre as subrotas da rota (continua na visão rota); o 2º abre a lista
  const proximaVisao = rotaEmNiveis && e.visao === 'rota' && !e.filtros.rota ? 'rota' : 'lista';
  const total = linhas.reduce((s, g) => s + Number(g.prospects), 0);
  return h('div', {},
    numeros([['grupos', linhas.length], ['prospects', total], ['pendentes hoje', linhas.reduce((s, g) => s + Number(g.pendentes_hoje ?? 0), 0), 'alerta']]),
    h('div', { class: 'lista-grupos' }, linhas.map((g) => {
      const f = filtroDo(g);
      const semChave = Object.values(f).every((v) => v == null);
      const conteudo = [h('b', {}, g.rotulo), h('span', { class: 'ajuda' },
        `${g.prospects} prospect(s) · ${g.pendentes_hoje ?? 0} pendente(s) hoje · ${g.nao_contactados ?? 0} não contactado(s) · ${g.em_prospeccao ?? 0} em prospecção`)];
      return semChave ? h('div', { class: 'grupo' }, conteudo) : h('a', { class: 'grupo', href: endereco({ ...e, visao: proximaVisao }, { filtros: f, pagina: 0 }) }, conteudo);
    })));
}

function blocoLista(e, linhas, { podeRegistrar, selecao, comRota, mostrarCarteira }) {
  const temMais = linhas.length > POR_PAGINA;
  const pagina = linhas.slice(0, POR_PAGINA);
  if (!pagina.length) return mensagem(e.busca ? `Nada encontrado para "${e.busca}".` : 'Nenhum prospect nesta lista.', 'info');
  // lote: só para quem ainda está na lista principal (sem interesse em lote)
  const loteVisivel = podeRegistrar && e.aba === 'principal';
  const barraLote = h('div', { class: 'barra-lote' });
  // a barra só aparece com algum prospect marcado
  const atualizarBarra = () => {
    barraLote.hidden = !selecao.size;
    montar(barraLote, selecao.size
      ? [h('span', {}, `${selecao.size} selecionado(s)`),
        h('a', { class: 'botao', href: '#/lote' }, 'Sem interesse em lote'),
        h('button', { class: 'secundario pequeno', onclick: () => { selecao.clear(); gravarLote([]); document.querySelectorAll('input[data-lote]').forEach((c) => { c.checked = false; }); atualizarBarra(); } }, 'Limpar seleção')]
      : []);
  };
  if (loteVisivel) atualizarBarra();

  const cartoes = pagina.map((p) => {
    const marca = loteVisivel && Number(p.na_lista) ? h('input', {
      type: 'checkbox', 'aria-label': `Selecionar ${p.razao_social}`, checked: selecao.has(Number(p.id)), dados: { lote: p.id },
      onchange: (ev) => { if (ev.target.checked) selecao.add(Number(p.id)); else selecao.delete(Number(p.id)); gravarLote([...selecao]); atualizarBarra(); },
    }) : null;
    const info = [
      p.nome_fantasia && p.nome_fantasia !== p.razao_social ? p.nome_fantasia : null,
      [p.bairro, p.cidade && `${p.cidade}/${p.uf ?? ''}`].filter(Boolean).join(' — '),
      p.onda ? `Onda ${p.onda}` : null,
      comRota && p.rota ? `Rota ${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : null,
      mostrarCarteira ? `Carteira: ${p.vendedor_nome}` : null,
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
  const corpo = h('div', { class: 'lista-prospects' }, cartoes);
  return h('div', {}, loteVisivel ? barraLote : null, corpo, nav);
}
