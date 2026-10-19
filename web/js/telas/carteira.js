// Lista principal (Não contactado / Em prospecção) e Acompanhamento (demais status). docs/03 §6
// Visões: lista, cidade, bairro, onda, status e — só vendedor — rota. Busca sem acento.
// Computador: uma barra só (busca, visões, supervisor, vendedor, data do último registro), cards ou lista, onda em ordem
// e rota em 2 níveis (rota → subrota). Celular: layout de sempre.
import { bancoApp } from '../db.js';
import { consultaCarteira, consultaOndas, ORDENACOES, visoesPermitidas } from '../../shared/carteira.mjs';
import { h, montar, mensagem, formatar, numeros } from '../ui.js';
import { gravarLote, lerLote, seloStatus } from './_carteira.js';

const POR_PAGINA = 50;
const NOMES_VISAO = { lista: 'Lista', cidade: 'Cidade', bairro: 'Bairro', onda: 'Onda', status: 'Status', rota: 'Rota' };
const FILTROS = ['cidadeBusca', 'uf', 'bairroBusca', 'onda', 'rota', 'subrota', 'status', 'supervisorId', 'vendedorId', 'somenteRetornos', 'dataDe', 'dataAte'];
const CHAVE_EXIBICAO = 'germani.carteiraExibicao';
const ehCelular = () => matchMedia('(max-width: 900px)').matches;

function lerEstado(parametros) {
  const e = { aba: parametros.get('aba') === 'acompanhamento' ? 'acompanhamento' : 'principal', visao: parametros.get('visao') ?? '',
    busca: parametros.get('busca') ?? '', pagina: Math.max(0, Number(parametros.get('pagina')) || 0), filtros: {},
    ordem: ORDENACOES[parametros.get('ordem')] ? parametros.get('ordem') : '', desc: parametros.get('dir') === 'desc' };
  for (const f of FILTROS) if (parametros.get(f)) e.filtros[f] = parametros.get(f);
  if (e.filtros.vendedorId) e.filtros.vendedorId = Number(e.filtros.vendedorId);
  if (e.filtros.supervisorId) e.filtros.supervisorId = Number(e.filtros.supervisorId);
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
  if (n.ordem) { q.set('ordem', n.ordem); if (n.desc) q.set('dir', 'desc'); }
  if (n.pagina) q.set('pagina', n.pagina);
  const s = q.toString();
  return `#/carteira${s ? '?' + s : ''}`;
}

const VE_TUDO = ['administrador', 'gerente', 'financeiro'];

// Donos de carteira que o usuário pode filtrar (gestão vê todos; supervisor, a equipe). Com supervisorId, só a equipe dele.
async function vendedoresDoEscopo(db, usuario, supervisorId) {
  const sup = VE_TUDO.includes(usuario.perfil) ? supervisorId : usuario.perfil === 'supervisor' ? usuario.id : null;
  if (!VE_TUDO.includes(usuario.perfil) && usuario.perfil !== 'supervisor') return [];
  return (await db.execute({
    sql: `SELECT id, nome, codigo_erp, perfil, tipo_atuacao FROM usuarios
           WHERE perfil IN ('vendedor','supervisor') AND ativo = 1 ${sup ? 'AND COALESCE(supervisor_id, id) = ?' : ''}
           ORDER BY nome`,
    args: sup ? [sup] : [],
  })).rows;
}

async function supervisoresDoEscopo(db, usuario) {
  if (!VE_TUDO.includes(usuario.perfil)) return [];
  return (await db.execute("SELECT id, nome, codigo_erp FROM usuarios WHERE perfil = 'supervisor' AND ativo = 1 ORDER BY nome")).rows;
}

const papelDoAgente = (v) => (v.perfil === 'supervisor' ? 'Supervisor' : v.tipo_atuacao === 'vendedor' ? 'Vendedor' : 'Representante');

function descreverFiltros(e) {
  const f = e.filtros;
  const partes = [];
  if (f.status) partes.push(['status', `Status: ${f.status.replace(/_/g, ' ')}`]);
  if (f.cidadeBusca) partes.push(['cidadeBusca', `Cidade: ${f.cidadeBusca}${f.uf ? '/' + f.uf : ''}`]);
  if (f.bairroBusca) partes.push(['bairroBusca', `Bairro: ${f.bairroBusca}`]);
  if (f.onda) partes.push(['onda', `Onda ${f.onda}`]);
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
  const computador = !ehCelular();
  // ao cruzar o limite celular/computador a tela se redesenha no outro layout
  const mq = matchMedia('(max-width: 900px)');
  const troca = () => { mq.removeEventListener('change', troca); if (conteudo.isConnected) render(conteudo, ctx); };
  mq.addEventListener('change', troca);

  // Na aba Acompanhamento a lista mostra a carteira fora da lista principal (por status)
  const filtros = { ...e.filtros, foraDaLista: e.aba === 'acompanhamento' && !e.filtros.status };
  let consulta;
  try {
    consulta = consultaCarteira({ usuario, visao: e.visao, filtros, busca: e.busca, limite: POR_PAGINA + 1, deslocamento: e.pagina * POR_PAGINA,
      ordemNatural: computador, rotaEmNiveis: computador, ordenar: computador && e.ordem ? { campo: e.ordem, desc: e.desc } : null });
  } catch (erro) {
    return montar(conteudo, mensagem(erro.message, 'erro'));
  }
  const linhas = (await db.execute(consulta)).rows;
  const [supervisores, vendedores, ondas] = await Promise.all([supervisoresDoEscopo(db, usuario), vendedoresDoEscopo(db, usuario, e.filtros.supervisorId),
    computador ? db.execute(consultaOndas()).then((r) => r.rows.map((x) => String(x.onda))) : []]);

  const campoBusca = h('input', { type: 'search', id: 'busca', value: e.busca, placeholder: 'Nome, CNPJ, cidade ou bairro', 'aria-label': 'Buscar prospect' });
  const formBusca = h('form', { class: 'barra-busca', onsubmit: (ev) => { ev.preventDefault(); location.hash = endereco(e, { busca: campoBusca.value.trim(), pagina: 0 }); } },
    campoBusca, h('button', { type: 'submit' }, 'Buscar'));

  const visoesDaAba = permitidas.filter((v) => (e.aba === 'acompanhamento' ? ['status', 'lista', 'cidade', 'bairro', 'onda', 'rota'].includes(v) : v !== 'status'));
  const visoes = h('div', { class: 'visoes', role: 'tablist' }, visoesDaAba
    .map((v) => h('a', { href: endereco(e, { visao: v, pagina: 0 }), class: v === e.visao ? 'ativa' : '' }, NOMES_VISAO[v])));

  const extras = [];
  if (supervisores.length) {
    // trocar o supervisor limpa o vendedor (a lista de vendedores passa a ser só a equipe escolhida)
    const sel = h('select', { id: 'filtro-supervisor', onchange: () => { location.hash = endereco(e, { filtros: { supervisorId: sel.value ? Number(sel.value) : null, vendedorId: null }, pagina: 0 }); } },
      h('option', { value: '' }, 'Todos os supervisores'),
      supervisores.map((s) => h('option', { value: s.id, selected: Number(s.id) === e.filtros.supervisorId }, `${s.nome}${s.codigo_erp ? ' · ' + s.codigo_erp : ''}`)));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-supervisor' }, 'Supervisor'), sel));
  }
  if (vendedores.length) {
    const sel = h('select', { id: 'filtro-vendedor', onchange: () => { location.hash = endereco(e, { filtros: { vendedorId: sel.value ? Number(sel.value) : null }, pagina: 0 }); } },
      h('option', { value: '' }, e.filtros.supervisorId || usuario.perfil === 'supervisor' ? 'Toda a equipe' : 'Todos'),
      vendedores.map((v) => h('option', { value: v.id, selected: Number(v.id) === e.filtros.vendedorId }, `${v.nome} · ${papelDoAgente(v)}${v.codigo_erp ? ' · ' + v.codigo_erp : ''}`)));
    extras.push(h('div', { class: 'filtro' }, h('label', { for: 'filtro-vendedor' }, 'Vendedor / representante'), sel));
  }
  if (!computador) {
    extras.push(h('label', { class: 'marcador' },
      h('input', { type: 'checkbox', id: 'so-retornos', checked: Boolean(e.filtros.somenteRetornos), onchange: (ev) => { location.hash = endereco(e, { filtros: { somenteRetornos: ev.target.checked }, pagina: 0 }); } }),
      ' Só retornos vencidos/hoje'));
  }
  let exibicao = 'cards';
  try { exibicao = localStorage.getItem(CHAVE_EXIBICAO) === 'lista' ? 'lista' : 'cards'; } catch { /* padrão */ }

  const chips = descreverFiltros(e).map(([chave, texto]) => {
    const limpa = { [chave]: null };
    if (chave === 'cidadeBusca') Object.assign(limpa, { uf: null, bairroBusca: null });
    if (chave === 'rota') limpa.subrota = null;
    if (chave === 'dataDe') limpa.dataAte = null;
    return h('a', { class: 'chip', href: endereco(e, { filtros: limpa, pagina: 0 }), title: 'Remover filtro' }, texto, ' ✕');
  });

  let corpo;
  if (e.visao === 'status') corpo = blocoStatus(e, linhas);
  else if (e.visao === 'lista') {
    const opcoes = { podeRegistrar, selecao, comRota: permitidas.includes('rota'), mostrarCarteira: usuario.perfil !== 'vendedor' };
    corpo = blocoLista(e, linhas, { ...opcoes, comoTabela: computador && exibicao === 'lista' });
  } else corpo = blocoGrupos(e, linhas, { rotaEmNiveis: computador });

  const titulo = e.aba === 'acompanhamento' ? 'Acompanhamento' : 'Lista principal';
  const ajuda = e.aba === 'acompanhamento'
    ? 'Clientes que já saíram da lista principal: aguardando cadastro, análise financeira, aguardando pedido, venda realizada, sem interesse e inválidos. Todos continuam nos indicadores.'
    : 'Não contactados e em prospecção. Registrou atendido ou sem interesse, o cliente passa para o acompanhamento.';
  if (!computador) {
    return montar(conteudo,
      h('h1', {}, titulo),
      h('p', { class: 'ajuda' }, ajuda),
      formBusca, visoes,
      h('div', { class: 'filtros-linha' }, extras),
      chips.length ? h('div', { class: 'chips' }, chips) : null,
      corpo);
  }

  // computador: todos os filtros numa linha só (visão em lista, datas lado a lado)
  const data = (id, rotulo, chave) => h('input', { type: 'date', id, 'aria-label': rotulo, value: e.filtros[chave] ?? '',
    onchange: (ev) => { location.hash = endereco(e, { filtros: { [chave]: ev.target.value || null }, pagina: 0 }); } });
  const selOnda = ondas.length ? h('div', { class: 'filtro' }, h('label', { for: 'filtro-onda' }, 'Onda'),
    h('select', { id: 'filtro-onda', onchange: (ev) => { location.hash = endereco(e, { filtros: { onda: ev.target.value || null }, pagina: 0 }); } },
      h('option', { value: '' }, 'Todas'), ondas.map((o) => h('option', { value: o, selected: o === String(e.filtros.onda ?? '') }, `Onda ${o}`)))) : null;
  const selVisao = h('select', { id: 'filtro-visao', 'aria-label': 'Visão', onchange: (ev) => { location.hash = endereco(e, { visao: ev.target.value, pagina: 0 }); } },
    visoesDaAba.map((v) => h('option', { value: v, selected: v === e.visao }, NOMES_VISAO[v])));
  const botoesExibicao = e.visao === 'lista' ? h('div', { class: 'filtro' }, h('label', {}, 'Exibir'),
    h('div', { class: 'visoes exibicao', role: 'tablist' }, [['cards', 'Cards'], ['lista', 'Lista']].map(([k, t]) => h('a', {
      href: '#', class: k === exibicao ? 'ativa' : '', dados: { exibicao: k },
      onclick: (ev) => { ev.preventDefault(); try { localStorage.setItem(CHAVE_EXIBICAO, k); } catch { /* nada */ } render(conteudo, ctx); },
    }, t)))) : null;
  montar(conteudo,
    h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, titulo), h('p', {}, ajuda))),
    h('div', { class: 'barra-carteira' },
      h('div', { class: 'filtro busca' }, h('label', { for: 'busca' }, 'Buscar'), formBusca),
      h('div', { class: 'filtro' }, h('label', { for: 'filtro-visao' }, 'Visão'), selVisao),
      selOnda,
      extras,
      h('div', { class: 'filtro' }, h('label', { for: 'filtro-data-de' }, 'Último registro (de · até)'),
        h('div', { class: 'datas' }, data('filtro-data-de', 'Último registro de', 'dataDe'), data('filtro-data-ate', 'Último registro até', 'dataAte'))),
      botoesExibicao),
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

function blocoLista(e, linhas, { podeRegistrar, selecao, comRota, mostrarCarteira, comoTabela = false }) {
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
        h('button', { class: 'secundario pequeno', onclick: () => { selecao.clear(); gravarLote([]); document.querySelectorAll('input[data-lote]').forEach((c) => { c.checked = false; }); atualizarBarra(); } }, 'Limpar seleção')]
      : h('span', { class: 'ajuda' }, 'Marque os prospects para registrar "sem interesse" em lote.'));
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
    if (comoTabela) {
      return h('tr', {},
        loteVisivel ? h('td', { class: 'marca' }, marca) : null,
        h('td', {}, h('a', { href: `#/ficha?id=${p.id}`, class: 'nome' }, p.razao_social),
          h('small', {}, [formatar.cnpj(p.cnpj), p.nome_fantasia && p.nome_fantasia !== p.razao_social ? p.nome_fantasia : null].filter(Boolean).join(' · '))),
        h('td', {}, [p.cidade && `${p.cidade}/${p.uf ?? ''}`, p.bairro].filter(Boolean).join(' · ')),
        h('td', {}, p.onda ? `Onda ${p.onda}` : ''),
        comRota ? h('td', {}, p.rota ? `${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : '') : null,
        mostrarCarteira ? h('td', {}, p.vendedor_nome) : null,
        h('td', {}, seloStatus(p), Number(p.prazo_cadastro_vencido) ? h('small', { class: 'alerta-txt' }, 'prazo de cadastro vencido') : null),
        h('td', { class: 'num' }, p.dias_corridos != null ? `${p.dias_corridos} d` : '—'),
        h('td', {}, formatar.data(p.dt_ultimo_contato) || '—'));
    }
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
  const corpo = comoTabela
    ? h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-carteira' },
      h('thead', {}, h('tr', {}, [loteVisivel ? ['', null] : null, ['Prospect', 'prospect'], ['Cidade · bairro', 'cidade'], ['Onda', 'onda'], comRota ? ['Rota', 'rota'] : null,
        mostrarCarteira ? ['Carteira', 'carteira'] : null, ['Status', 'status'], ['Dias', 'dias'], ['Último registro', 'ultimo']]
        .filter(Boolean).map(([t, chave]) => h('th', { class: t === 'Dias' ? 'num' : '', 'aria-sort': chave && e.ordem === chave ? (e.desc ? 'descending' : 'ascending') : null },
          // rótulo = ordenação: 1º clique crescente, 2º decrescente, 3º volta à ordem de trabalho
          chave ? h('a', { class: `ordenar ${e.ordem === chave ? 'ativa' : ''}`, dados: { ordem: chave }, title: 'Ordenar',
            href: endereco(e, e.ordem !== chave ? { ordem: chave, desc: false, pagina: 0 } : !e.desc ? { desc: true, pagina: 0 } : { ordem: '', desc: false, pagina: 0 }) },
          t, e.ordem === chave ? (e.desc ? ' ▼' : ' ▲') : '') : t)))),
      h('tbody', {}, cartoes)))
    : h('div', { class: 'lista-prospects' }, cartoes);
  return h('div', {}, loteVisivel ? barraLote : null, corpo, nav);
}
