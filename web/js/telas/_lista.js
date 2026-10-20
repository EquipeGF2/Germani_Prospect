// Lista principal e Acompanhamento no COMPUTADOR (docs/03 §6) — sempre em lista (tabela), filtros em grupos:
// Equipe (supervisor / representante) · Local (UF / cidade / bairro, este só com a cidade) · Carteira (onda / segmento)
// · Período (só no Acompanhamento). A gestão escolhe a equipe antes de ler; o Acompanhamento exige o período.
// Atalhos de situação com contagem, "Agrupar por", ficha ao lado e "Carregar mais". O celular segue em carteira.js.
import { bancoApp, lerComCache } from '../db.js';
import {
  AGRUPAMENTOS, agrupamentosPossiveis, consultaBairros, consultaCarteira, consultaLinhaTempo, datasDoPeriodo, faltaParaLista,
  PERIODOS_LISTA, visoesPermitidas,
} from '../../shared/carteira.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, formatar } from '../ui.js';
import { icone } from '../menu.js';
import { endereco, gravarLote, lerEstado, lerLote, opcoesDosFiltros, papelDoAgente, seloStatus } from './_carteira.js';

const POR_VEZ = 50;
const NA_LISTA = ['nao_contactado', 'em_prospeccao'];

export async function renderComputador(conteudo, { usuario, parametros }) {
  const db = await bancoApp();
  const e = lerEstado(parametros);
  e.visao = 'lista';   // no computador a lista é sempre lista; agrupar substitui as antigas visões
  e.pagina = 0;
  const acomp = e.aba === 'acompanhamento';
  const gestao = usuario.perfil !== 'vendedor';
  const comRota = visoesPermitidas(usuario).includes('rota');
  // coluna Rota só para o vendedor (é quem monta rota); a gestão agrupa por rota quando quiser
  const colunaRota = comRota && usuario.perfil === 'vendedor';

  // período (só Acompanhamento): este mês / último mês / período de · até. Representante já entra no mês atual.
  if (!acomp) { delete e.filtros.dataDe; delete e.filtros.dataAte; e.periodo = ''; }
  else {
    if (!PERIODOS_LISTA[e.periodo]) e.periodo = e.filtros.dataDe || e.filtros.dataAte ? 'periodo' : usuario.perfil === 'vendedor' ? 'mes' : '';
    if (e.periodo && e.periodo !== 'periodo') Object.assign(e.filtros, datasDoPeriodo(e.periodo, { hoje: hojeSaoPaulo() }));
  }
  if (!e.filtros.cidadeBusca) delete e.filtros.bairroBusca;
  const agrupaveis = agrupamentosPossiveis(usuario, e.filtros);
  if (!agrupaveis.includes(e.agrupar)) e.agrupar = '';
  const falta = faltaParaLista(usuario, { aba: e.aba, filtros: e.filtros, busca: e.busca });
  const ir = (muda) => { location.hash = endereco(e, muda); };

  const filtrosLista = { ...e.filtros, foraDaLista: acomp && !e.filtros.status };
  const pedir = (deslocamento) => consultaCarteira({ usuario, visao: 'lista', filtros: filtrosLista, busca: e.busca, limite: POR_VEZ + 1, deslocamento,
    ordemNatural: true, ordenar: e.ordem ? { campo: e.ordem, desc: e.desc } : null, agrupar: e.agrupar || null });
  let consulta;
  try { consulta = pedir(0); } catch (erro) { return montar(conteudo, mensagem(erro.message, 'erro')); }
  const contagem = consultaCarteira({ usuario, visao: 'status', filtros: { ...e.filtros, status: null, foraDaLista: acomp }, busca: e.busca });

  const [linhas, porStatus, opcoes, bairros] = await Promise.all([
    falta.length ? [] : db.execute(consulta).then((r) => r.rows),
    falta.length ? [] : db.execute(contagem).then((r) => r.rows),
    opcoesDosFiltros(db, usuario, e.filtros, e.aba),
    e.filtros.cidadeBusca ? lerComCache(db, consultaBairros({ usuario, cidadeBusca: e.filtros.cidadeBusca, uf: e.filtros.uf }), 300).then((r) => r.rows) : [],
  ]);
  const codigoDe = new Map(opcoes.vendedores.map((v) => [Number(v.id), v.codigo_erp]));

  // ---------- filtros ----------
  const selecao = (id, rotulo, valor, opcoesSel, aoMudar, { vazio = 'Todos', classe = '' } = {}) => h('div', { class: `filtro ${classe}` },
    h('label', { for: id }, rotulo),
    h('select', { id, onchange: (ev) => aoMudar(ev.target.value) },
      h('option', { value: '' }, vazio), opcoesSel.map(([v, t]) => h('option', { value: v, selected: String(v) === String(valor ?? '') }, t))));
  const grupo = (titulo, obrigatorio, ...campos) => h('div', { class: `lista-grupo${obrigatorio && falta.includes(obrigatorio) ? ' falta' : ''}` },
    h('span', { class: 'lista-grupo-tit' }, titulo, obrigatorio ? h('span', { class: 'obrigatorio' }, ' • obrigatório') : null),
    h('div', { class: 'lista-grupo-campos' }, campos.filter(Boolean)));

  const grupos = [];
  if (gestao) {
    // quem vê todas as equipes escolhe supervisor (ou direto o representante); o supervisor só escolhe na própria equipe
    const todas = veTodasEquipes(usuario);
    grupos.push(grupo('Equipe', todas ? 'equipe' : null,
      todas ? selecao('filtro-supervisor', 'Supervisor', e.filtros.supervisorId, opcoes.supervisores.map((s) => [s.id, `${s.nome}${s.codigo_erp ? ' · ' + s.codigo_erp : ''}`]),
        (v) => ir({ filtros: { supervisorId: v ? Number(v) : null, vendedorId: null } }), { vazio: 'Escolha…' }) : null,
      selecao('filtro-vendedor', 'Representante', e.filtros.vendedorId, opcoes.vendedores.map((v) => [v.id, `${v.nome} · ${papelDoAgente(v)}${v.codigo_erp ? ' · ' + v.codigo_erp : ''}`]),
        (v) => ir({ filtros: { vendedorId: v ? Number(v) : null } }), { vazio: e.filtros.supervisorId || !todas ? 'Toda a equipe' : 'Escolha…' })));
  }
  const cidadeAtual = e.filtros.cidadeBusca ? `${e.filtros.cidadeBusca}|${e.filtros.uf ?? ''}` : '';
  const repetida = new Set(opcoes.cidades.filter((c, i) => opcoes.cidades.findIndex((x) => x.cidade_busca === c.cidade_busca) !== i).map((c) => c.cidade_busca));
  grupos.push(grupo('Local', null,
    selecao('filtro-uf', 'UF', e.filtros.uf, opcoes.ufs.map((u) => [u, u]), (v) => ir({ filtros: { uf: v || null, cidadeBusca: null, bairroBusca: null } }), { vazio: 'Todas', classe: 'estreito' }),
    h('div', { class: 'filtro' }, h('label', { for: 'filtro-cidade' }, 'Cidade'),
      h('select', { id: 'filtro-cidade', onchange: (ev) => { const [c, u] = ev.target.value ? ev.target.value.split('|') : [null, null];
        ir({ filtros: { cidadeBusca: c, uf: c ? u || null : e.filtros.uf ?? null, bairroBusca: null } }); } },
      h('option', { value: '' }, 'Todas'),
      opcoes.cidades.map((c) => { const v = `${c.cidade_busca}|${c.uf ?? ''}`; return h('option', { value: v, selected: v === cidadeAtual }, `${c.cidade}${repetida.has(c.cidade_busca) && c.uf ? '/' + c.uf : ''}`); }))),
    // bairro só filtra com a cidade escolhida; sem cidade o campo nem aparece
    e.filtros.cidadeBusca ? selecao('filtro-bairro', 'Bairro', e.filtros.bairroBusca, bairros.map((b) => [b.bairro_busca, b.bairro ?? b.bairro_busca]),
      (v) => ir({ filtros: { bairroBusca: v || null } })) : null));
  grupos.push(grupo('Carteira', null,
    selecao('filtro-onda', 'Onda', e.filtros.onda, opcoes.ondas.map((o) => [o, `Onda ${o}`]), (v) => ir({ filtros: { onda: v || null } }), { vazio: 'Todas', classe: 'estreito' }),
    selecao('filtro-segmento', 'Segmento', e.filtros.segmento, opcoes.segmentos.map((s) => [s, s]), (v) => ir({ filtros: { segmento: v || null } }))));
  if (acomp) {
    const data = (id, rotulo, chave) => h('input', { type: 'date', id, 'aria-label': rotulo, value: e.filtros[chave] ?? '',
      onchange: (ev) => ir({ periodo: 'periodo', filtros: { [chave]: ev.target.value || null } }) });
    grupos.push(grupo('Período', 'periodo',
      selecao('filtro-periodo', 'Último registro', e.periodo, Object.entries(PERIODOS_LISTA),
        (v) => ir({ periodo: v, filtros: v === 'periodo' ? {} : { dataDe: null, dataAte: null } }), { vazio: 'Escolha…' }),
      e.periodo === 'periodo' ? h('div', { class: 'filtro' }, h('label', { for: 'filtro-data-de' }, 'De · até'),
        h('div', { class: 'datas' }, data('filtro-data-de', 'Último registro de', 'dataDe'), data('filtro-data-ate', 'Último registro até', 'dataAte'))) : null));
  }

  const campoBusca = h('input', { type: 'search', id: 'busca', value: e.busca, 'aria-label': 'Buscar',
    placeholder: 'Buscar: prospect, CNPJ, representante (nome ou código), cidade ou bairro' });
  const busca = h('form', { class: 'lista-busca', onsubmit: (ev) => { ev.preventDefault(); ir({ busca: campoBusca.value.trim() }); } },
    h('span', { class: 'lupa', 'aria-hidden': 'true' }, icone('buscar')), campoBusca,
    h('button', { type: 'submit', class: 'secundario pequeno' }, 'Buscar'),
    h('a', { href: endereco({ aba: e.aba, filtros: {} }), class: 'limpar' }, 'Limpar filtros'));

  const agrupar = h('div', { class: 'filtro' }, h('label', { for: 'agrupar' }, 'Agrupar por'),
    h('select', { id: 'agrupar', onchange: (ev) => ir({ agrupar: ev.target.value }) },
      h('option', { value: '' }, 'Nenhum'), agrupaveis.map((k) => h('option', { value: k, selected: k === e.agrupar }, AGRUPAMENTOS[k].nome))));

  const titulo = acomp ? 'Acompanhamento' : 'Lista principal';
  const ajuda = acomp
    ? 'Quem já saiu da lista principal: aguardando cadastro, análise financeira, aguardando pedido, venda, sem interesse e inválidos.'
    : 'Não contactados e em prospecção. Registrou atendido ou sem interesse, o cliente passa para o Acompanhamento.';
  const cabecalho = h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, titulo), h('p', {}, ajuda)), h('div', { class: 'cabecalho-controles' }, agrupar));
  const painelFiltros = h('section', { class: 'cartao lista-filtros', 'aria-label': 'Filtros' },
    h('div', { class: `lista-filtros-grupos g${grupos.length}` }, grupos), busca);

  if (falta.length) {
    const texto = falta.includes('equipe') && falta.includes('periodo') ? 'Escolha a equipe e o período para ver a lista'
      : falta.includes('equipe') ? 'Escolha a equipe para ver a lista' : 'Escolha o período para ver a lista';
    return montar(conteudo, cabecalho, painelFiltros,
      h('div', { class: 'lista-vazia', id: 'lista-falta' }, h('b', {}, texto),
        h('span', {}, falta.includes('equipe') ? 'Supervisor (com toda a equipe) ou representante. ' : '',
          falta.includes('periodo') ? 'O período vale pela data do último registro. ' : '', 'A lista só é lida depois disso — nunca a base inteira.')));
  }

  // ---------- situação (atalhos com contagem, das mesmas linhas de status) ----------
  const daAba = porStatus.filter((s) => (acomp ? !NA_LISTA.includes(s.status_atual) : NA_LISTA.includes(s.status_atual)) && Number(s.prospects) > 0);
  const total = daAba.reduce((t, s) => t + Number(s.prospects), 0);
  const chip = (codigo, texto, n, cor) => h('a', { class: `chip-situacao${(e.filtros.status ?? '') === codigo ? ' ativa' : ''}`, href: endereco(e, { filtros: { status: codigo || null } }), dados: { status: codigo || 'todos' } },
    cor ? h('span', { class: 'ponto', style: `background:${cor}` }) : null, texto, ' ', h('b', {}, formatar.numero(n)));
  const situacao = h('div', { class: 'lista-situacao', role: 'group', 'aria-label': 'Situação' },
    h('span', { class: 'lista-grupo-tit' }, 'Situação'), chip('', 'Todos', total),
    daAba.map((s) => chip(s.status_atual, s.status_atual === 'em_prospeccao' ? 'Em prospecção (contato da planilha)' : s.rotulo, Number(s.prospects), s.status_cor)));

  // ---------- tabela ----------
  const podeRegistrar = usuario.perfil !== 'financeiro';
  const comLote = podeRegistrar && !acomp;
  const lote = new Set(lerLote());
  const colunas = [
    comLote ? { t: '', classe: 'marca' } : null,
    { t: 'Prospect', o: 'prospect' }, { t: 'Cidade · bairro', o: 'cidade' }, { t: 'Onda', o: 'onda', classe: 'num' }, { t: 'Segmento' },
    colunaRota ? { t: 'Rota', o: 'rota' } : null, gestao ? { t: 'Representante', o: 'carteira' } : null, { t: 'Status', o: 'status' },
    ...(acomp ? [{ t: 'Último registro', o: 'ultimo' }, { t: 'Próxima ação' }] : [{ t: 'Tentativas', classe: 'num' }, { t: 'Contato da planilha', o: 'ultimo' }]),
    { t: 'Dias', o: 'dias', classe: 'num' }, podeRegistrar ? { t: '' } : null,
  ].filter(Boolean);
  const cab = h('tr', {}, colunas.map((c) => h('th', { class: c.classe ?? '', 'aria-sort': c.o && e.ordem === c.o ? (e.desc ? 'descending' : 'ascending') : null },
    // rótulo = ordenação: 1º clique crescente, 2º decrescente, 3º volta à ordem de trabalho
    c.o ? h('a', { class: `ordenar ${e.ordem === c.o ? 'ativa' : ''}`, dados: { ordem: c.o }, title: 'Ordenar',
      href: endereco(e, e.ordem !== c.o ? { ordem: c.o, desc: false } : !e.desc ? { desc: true } : { ordem: '', desc: false }) },
    c.t, e.ordem === c.o ? (e.desc ? ' ▼' : ' ▲') : '') : c.t)));
  const corpo = h('tbody', {});
  let ultimoGrupo = null;
  let carregados = 0;
  let aberta = null;
  const painel = h('aside', { class: 'ficha-lateral', hidden: true, 'aria-label': 'Ficha do prospect' });

  const barraLote = h('div', { class: 'lote-flutuante', hidden: true });
  const atualizarLote = () => {
    barraLote.hidden = !lote.size;
    montar(barraLote, lote.size ? [h('span', {}, `${lote.size} selecionado(s)`), h('a', { class: 'botao pequeno', href: '#/lote' }, 'Sem interesse em lote'),
      h('button', { type: 'button', class: 'pequeno secundario', onclick: () => { lote.clear(); gravarLote([]); corpo.querySelectorAll('input[data-lote]').forEach((c) => { c.checked = false; }); atualizarLote(); } }, 'Limpar seleção')] : []);
  };

  const registrarPermitido = (p) => podeRegistrar && !['venda_realizada', 'invalido'].includes(p.status_atual)
    && (usuario.perfil !== 'supervisor' || !usuario.ve_todos || Number(p.supervisor_id) === usuario.id || Number(p.vendedor_id) === usuario.id);

  async function abrirFicha(p, tr) {
    if (aberta === tr) { fecharFicha(); return; }
    corpo.querySelector('tr.aberta')?.classList.remove('aberta');
    tr.classList.add('aberta');
    aberta = tr;
    painel.hidden = false;
    const item = (k, v) => h('div', {}, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v ?? '—'));
    const historico = h('ul', { class: 'ficha-historico' }, h('li', { class: 'ajuda' }, 'carregando…'));
    montar(painel,
      h('div', { class: 'ficha-topo' }, h('div', {}, h('h2', {}, p.razao_social),
        h('span', { class: 'ajuda' }, [formatar.cnpj(p.cnpj), p.cidade && `${p.cidade}/${p.uf ?? ''}`, p.bairro].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'secundario pequeno', 'aria-label': 'Fechar ficha', onclick: fecharFicha }, '×')),
      h('div', { class: 'ficha-dados' },
        item('Status', p.status_descricao || p.status_nome), item('Representante', `${p.vendedor_nome ?? '—'}${codigoDe.get(Number(p.vendedor_id)) ? ' · ' + codigoDe.get(Number(p.vendedor_id)) : ''}`),
        item('Onda · Segmento', [p.onda && `Onda ${p.onda}`, p.tipologia_gtm].filter(Boolean).join(' · ') || '—'),
        item(acomp ? 'Próxima ação' : 'Tentativas', acomp ? (formatar.data(p.data_proxima_acao) || '—') : String(p.tentativas ?? 0)),
        item(acomp ? 'Último registro' : 'Contato da planilha', formatar.data(p.dt_ultimo_contato) || '—'),
        item('Dias desde o 1º contato', p.dias_corridos != null ? String(p.dias_corridos) : '—'),
        p.telefone ? item('Telefone', p.telefone) : null, p.endereco ? item('Endereço', p.endereco) : null),
      h('div', {}, h('span', { class: 'lista-grupo-tit' }, 'Histórico'), historico),
      h('div', { class: 'ficha-acoes' },
        registrarPermitido(p) ? h('a', { class: 'botao', href: `#/registrar?id=${p.id}` }, 'Registrar atendimento') : null,
        h('a', { class: 'botao secundario', href: `#/ficha?id=${p.id}` }, 'Abrir ficha completa')));
    // histórico curto: só depois de escolher a linha (o prospect já veio no escopo do usuário)
    const movs = (await db.execute(consultaLinhaTempo({ prospectId: p.id, limite: 5 }))).rows;
    if (aberta !== tr) return;
    montar(historico, movs.length ? movs.map((m) => h('li', {}, h('b', {}, formatar.data(m.data_evento)), ' · ',
      m.status_anterior && m.status_anterior !== m.status_novo ? `${m.status_anterior_nome} → ${m.status_novo_nome}` : m.status_novo_nome,
      m.detalhe ? h('span', { class: 'ajuda' }, ` — ${m.detalhe}`) : null)) : h('li', { class: 'ajuda' }, 'Sem movimentos.'));
  }
  function fecharFicha() { painel.hidden = true; aberta?.classList.remove('aberta'); aberta = null; }

  function linha(p) {
    const cod = codigoDe.get(Number(p.vendedor_id));
    const tr = h('tr', { dados: { id: p.id }, onclick: (ev) => { if (!ev.target.closest('a, input, button, label')) abrirFicha(p, tr); } },
      comLote ? h('td', { class: 'marca' }, Number(p.na_lista) ? h('input', { type: 'checkbox', 'aria-label': `Selecionar ${p.razao_social}`, checked: lote.has(Number(p.id)), dados: { lote: p.id },
        onchange: (ev) => { if (ev.target.checked) lote.add(Number(p.id)); else lote.delete(Number(p.id)); gravarLote([...lote]); atualizarLote(); } }) : null) : null,
      h('td', {}, h('a', { href: `#/ficha?id=${p.id}`, class: 'nome', title: p.razao_social }, p.razao_social),
        h('small', {}, formatar.cnpj(p.cnpj))),
      h('td', {}, h('span', { class: 'corta' }, p.cidade ? `${p.cidade}/${p.uf ?? ''}` : '—'), h('small', { class: 'corta' }, p.bairro ?? '')),
      h('td', { class: 'num' }, p.onda ?? ''),
      h('td', {}, h('span', { class: 'corta' }, p.tipologia_gtm ?? '')),
      colunaRota ? h('td', {}, p.rota ? `${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : '') : null,
      gestao ? h('td', {}, h('span', { class: 'corta', title: p.vendedor_nome ?? '' }, p.vendedor_nome ?? '—'), cod ? h('small', {}, `cód. ${cod}`) : null) : null,
      h('td', {}, seloStatus(p), Number(p.prazo_cadastro_vencido) ? h('small', { class: 'alerta-txt' }, 'prazo de cadastro vencido') : null),
      ...(acomp
        ? [h('td', {}, formatar.data(p.dt_ultimo_contato) || '—'),
          h('td', { class: Number(p.retorno_pendente) ? 'alerta-txt' : '' }, p.data_proxima_acao ? `Retorno ${formatar.data(p.data_proxima_acao)}` : '—')]
        : [h('td', { class: 'num' }, String(p.tentativas ?? 0)), h('td', {}, formatar.data(p.dt_ultimo_contato) || '—')]),
      h('td', { class: 'num' }, p.dias_corridos != null ? `${p.dias_corridos} d` : '—'),
      podeRegistrar ? h('td', {}, registrarPermitido(p) ? h('a', { href: `#/registrar?id=${p.id}`, class: 'registrar' }, 'Registrar') : null) : null);
    return tr;
  }
  function acrescentar(rows) {
    for (const p of rows) {
      if (e.agrupar) {
        const g = AGRUPAMENTOS[e.agrupar].rotulo(p);
        if (g !== ultimoGrupo) { corpo.append(h('tr', { class: 'linha-grupo' }, h('td', { colspan: String(colunas.length) }, g))); ultimoGrupo = g; }
      }
      corpo.append(linha(p));
    }
    carregados += rows.length;
  }

  const temMais = () => linhas.length > POR_VEZ;
  acrescentar(linhas.slice(0, POR_VEZ));
  const rodape = h('div', { class: 'lista-rodape' });
  let ha = temMais();
  const desenharRodape = () => montar(rodape,
    h('span', {}, `Mostrando ${formatar.numero(carregados)} de ${formatar.numero(e.filtros.status ? Number(daAba.find((s) => s.status_atual === e.filtros.status)?.prospects ?? carregados) : total)}`,
      e.ordem || e.agrupar ? '' : ' · ordem: pendências primeiro (clique no título da coluna para ordenar)'),
    ha ? h('button', { type: 'button', class: 'secundario pequeno', id: 'carregar-mais', onclick: async (ev) => {
      ev.target.disabled = true;
      const mais = (await db.execute(pedir(carregados))).rows;
      ha = mais.length > POR_VEZ;
      acrescentar(mais.slice(0, POR_VEZ));
      desenharRodape();
    } }, `Carregar mais ${POR_VEZ}`) : null);
  desenharRodape();
  if (comLote) atualizarLote();

  const tabela = linhas.length
    ? h('section', { class: 'cartao lista-tabela' }, h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-carteira' }, h('thead', {}, cab), corpo)), rodape)
    : mensagem(e.busca ? `Nada encontrado para "${e.busca}".` : 'Nenhum prospect com esses filtros.', 'info');
  montar(conteudo, cabecalho, painelFiltros, situacao, tabela, comLote ? barraLote : null, painel);
}
