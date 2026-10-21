// Lista principal e Acompanhamento no COMPUTADOR (docs/03 §6) — sempre em lista (tabela), filtros em grupos:
// Equipe (supervisor / representante) · Local (UF / cidade / bairro, este só com a cidade) · Carteira (onda / segmento)
// · Período (só no Acompanhamento). Os filtros só valem no botão Buscar (nada é lido antes); a gestão escolhe a equipe e
// o Acompanhamento exige o período. Situação com contagem, "Agrupar por" (só na Lista), ficha ao lado e "Carregar mais".
// No celular, a Lista principal segue em carteira.js; o Acompanhamento usa esta mesma tela (`celular`): filtros num
// painel que abre e fecha, situação em faixa, cada prospect num cartão e a ficha subindo por baixo — as mesmas leituras.
import { bancoApp, lerComCache } from '../db.js';
import {
  AGRUPAMENTOS, agrupamentosPossiveis, consultaBairros, consultaCarteira, consultaLinhaTempo, datasDoPeriodo, faltaParaLista,
  PERIODOS_LISTA, visoesPermitidas,
} from '../../shared/carteira.mjs';
import { minhaEquipe, veTodasEquipes } from '../../shared/perfis.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, formatar, comEspera } from '../ui.js';
import { gerarPdfLista } from '../relatorio.js';
import { icone } from '../menu.js';
import { consultaResumo, opcoesEmCascata } from '../../shared/explorar.mjs';
import { endereco, gravarLote, lerEstado, lerLote, papelDoAgente, seloStatus } from './_carteira.js';

const LIMITE = 5000;   // uma carteira (representante) cabe com folga; acima disso pede para refinar os filtros

export async function renderComputador(conteudo, { usuario, parametros }, { celular = false } = {}) {
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
  // supervisor que vê todas as equipes entra com a equipe dele já escolhida (só o filtro; nada é lido antes do Buscar)
  if (!e.ver && minhaEquipe(usuario) && !e.filtros.supervisorId && !e.filtros.vendedorId) e.filtros.supervisorId = minhaEquipe(usuario);
  // a lista vem inteira numa leitura só; situação, ordem e agrupamento mudam no navegador, sem voltar ao banco.
  // Na Lista o representante é obrigatório, então não se agrupa por ele.
  const agrupaveis = acomp ? [] : agrupamentosPossiveis(usuario, e.filtros).filter((k) => k !== 'representante');
  const vista = { agrupar: agrupaveis.includes(e.agrupar) ? e.agrupar : '', ordem: e.ordem, desc: e.desc, status: e.filtros.status ?? '' };
  delete e.filtros.status;
  const falta = faltaParaLista(usuario, { aba: e.aba, filtros: e.filtros, busca: e.busca });

  let consulta;
  try {
    consulta = consultaCarteira({ usuario, visao: 'lista', filtros: { ...e.filtros, foraDaLista: acomp }, busca: e.busca, limite: LIMITE + 1, ordemNatural: true });
  } catch (erro) { return montar(conteudo, mensagem(erro.message, 'erro')); }

  // nada é lido da lista enquanto os filtros não forem aplicados no botão Buscar (?ver=1); o representante já entra com a
  // própria carteira. As opções dos filtros saem do resumo pronto (em cache) e mudam no navegador, sem ir ao banco.
  const ler = (e.ver || usuario.perfil === 'vendedor') && !falta.length;
  const [lidas, resumo] = await Promise.all([
    ler ? db.execute(consulta).then((r) => r.rows) : [],
    lerComCache(db, consultaResumo({ usuario }), 300).then((r) => r.rows),
  ]);
  const codigoDe = new Map(resumo.map((l) => [Number(l.vendedor_id), l.vendedor_codigo]));

  // ---------- filtros: um rascunho que só vale ao clicar em Buscar ----------
  const rascunho = { filtros: { ...e.filtros }, periodo: e.periodo };
  const bairrosDe = (cidadeBusca, uf) => lerComCache(db, consultaBairros({ usuario, cidadeBusca, uf }), 300).then((r) => r.rows);
  const painelFiltros = h('form', { class: 'cartao lista-filtros', 'aria-label': 'Filtros', onsubmit: (ev) => { ev.preventDefault(); aplicar(); } });
  const campoBusca = h('input', { type: 'search', id: 'busca', value: e.busca, 'aria-label': 'Buscar',
    placeholder: 'Buscar: prospect, CNPJ, representante (nome ou código), cidade ou bairro' });
  function aplicar() {
    const f = { ...rascunho.filtros };
    if (rascunho.periodo !== 'periodo') { delete f.dataDe; delete f.dataAte; }
    // a situação e a ordem continuam; filtros, período e busca passam a ser os do painel
    location.hash = endereco({ aba: e.aba, ordem: vista.ordem, desc: vista.desc, agrupar: vista.agrupar, filtros: {} },
      { filtros: f, periodo: rascunho.periodo, busca: campoBusca.value.trim(), ver: true });
  }
  const mudar = (muda, extra = {}) => { Object.assign(rascunho.filtros, muda); Object.assign(rascunho, extra); desenharFiltros(); };

  const selecao = (id, rotulo, valor, opcoesSel, aoMudar, { vazio = 'Todos', classe = '' } = {}) => h('div', { class: `filtro ${classe}` },
    h('label', { for: id }, rotulo),
    h('select', { id, onchange: (ev) => aoMudar(ev.target.value) },
      h('option', { value: '' }, vazio), opcoesSel.map(([v, t]) => h('option', { value: v, selected: String(v) === String(valor ?? '') }, t))));
  const grupo = (titulo, obrigatorio, ...campos) => h('div', { class: `lista-grupo${obrigatorio && falta.includes(obrigatorio) ? ' falta' : ''}` },
    h('span', { class: 'lista-grupo-tit' }, titulo, obrigatorio ? h('span', { class: 'obrigatorio' }, ' • obrigatório') : null),
    h('div', { class: 'lista-grupo-campos' }, campos.filter(Boolean)));

  async function desenharFiltros() {
    const f = rascunho.filtros;
    const opcoes = opcoesEmCascata(resumo, f);
    const bairros = f.cidadeBusca ? await bairrosDe(f.cidadeBusca, f.uf) : [];
    const grupos = [];
    if (gestao) {
      // quem vê todas as equipes escolhe supervisor (ou direto o representante); o supervisor só escolhe na própria equipe
      const todas = veTodasEquipes(usuario);
      // Lista: supervisor e representante obrigatórios; Acompanhamento: a equipe (supervisor ou representante) para quem vê todas
      grupos.push(grupo('Equipe', !acomp ? 'representante' : todas ? 'equipe' : null,
        todas ? selecao('filtro-supervisor', 'Supervisor', f.supervisorId, opcoes.supervisores.map((s) => [s.id, `${s.nome}${s.codigo_erp ? ' · ' + s.codigo_erp : ''}`]),
          (v) => mudar({ supervisorId: v ? Number(v) : null, vendedorId: null }), { vazio: 'Escolha…' }) : null,
        selecao('filtro-vendedor', 'Representante', f.vendedorId, opcoes.vendedores.map((v) => [v.id, `${v.nome} · ${papelDoAgente(v)}${v.codigo_erp ? ' · ' + v.codigo_erp : ''}`]),
          (v) => mudar({ vendedorId: v ? Number(v) : null }), { vazio: !acomp ? 'Escolha…' : f.supervisorId || !todas ? 'Toda a equipe' : 'Escolha…' })));
    }
    const cidadeAtual = f.cidadeBusca ? `${f.cidadeBusca}|${f.uf ?? ''}` : '';
    const repetida = new Set(opcoes.cidades.filter((c, i) => opcoes.cidades.findIndex((x) => x.cidade_busca === c.cidade_busca) !== i).map((c) => c.cidade_busca));
    grupos.push(grupo('Local', null,
      selecao('filtro-uf', 'UF', f.uf, opcoes.ufs.map((u) => [u, u]), (v) => mudar({ uf: v || null, cidadeBusca: null, bairroBusca: null }), { vazio: 'Todas', classe: 'estreito' }),
      h('div', { class: 'filtro' }, h('label', { for: 'filtro-cidade' }, 'Cidade'),
        h('select', { id: 'filtro-cidade', onchange: (ev) => { const [c, u] = ev.target.value ? ev.target.value.split('|') : [null, null];
          mudar({ cidadeBusca: c, uf: c ? u || null : f.uf ?? null, bairroBusca: null }); } },
        h('option', { value: '' }, 'Todas'),
        opcoes.cidades.map((c) => { const v = `${c.cidade_busca}|${c.uf ?? ''}`; return h('option', { value: v, selected: v === cidadeAtual }, `${c.cidade}${repetida.has(c.cidade_busca) && c.uf ? '/' + c.uf : ''}`); }))),
      // bairro só filtra com a cidade escolhida; sem cidade o campo nem aparece
      f.cidadeBusca ? selecao('filtro-bairro', 'Bairro', f.bairroBusca, bairros.map((b) => [b.bairro_busca, b.bairro ?? b.bairro_busca]),
        (v) => mudar({ bairroBusca: v || null })) : null));
    grupos.push(grupo('Carteira', null,
      selecao('filtro-onda', 'Onda', f.onda, opcoes.ondas.map((o) => [o, `Onda ${o}`]), (v) => mudar({ onda: v || null }), { vazio: 'Todas', classe: 'estreito' }),
      selecao('filtro-segmento', 'Segmento', f.segmento, opcoes.segmentos.map((s) => [s, s]), (v) => mudar({ segmento: v || null }))));
    if (acomp) {
      const data = (id, rotulo, chave) => h('input', { type: 'date', id, 'aria-label': rotulo, value: f[chave] ?? '',
        onchange: (ev) => { f[chave] = ev.target.value || null; } });
      grupos.push(grupo('Período', 'periodo',
        selecao('filtro-periodo', 'Último registro', rascunho.periodo, Object.entries(PERIODOS_LISTA), (v) => mudar({}, { periodo: v }), { vazio: 'Escolha…' }),
        rascunho.periodo === 'periodo' ? h('div', { class: 'filtro' }, h('label', { for: 'filtro-data-de' }, 'De · até'),
          h('div', { class: 'datas' }, data('filtro-data-de', 'Último registro de', 'dataDe'), data('filtro-data-ate', 'Último registro até', 'dataAte'))) : null));
    }
    if (agrupaveis.length) {
      grupos.push(grupo('Exibição', null, selecao('agrupar', 'Agrupar por', vista.agrupar, agrupaveis.map((k) => [k, AGRUPAMENTOS[k].nome]),
        (v) => { vista.agrupar = v; if (ler) desenharTabela(); }, { vazio: 'Nenhum' })));
    }
    montar(painelFiltros,
      h('div', { class: `lista-filtros-grupos g${grupos.length}` }, grupos),
      h('div', { class: 'lista-busca' },
        h('span', { class: 'lupa', 'aria-hidden': 'true' }, icone('buscar')), campoBusca,
        h('button', { type: 'submit', id: 'aplicar-filtros' }, 'Buscar'),
        h('a', { href: endereco({ aba: e.aba, filtros: {} }), class: 'limpar' }, 'Limpar filtros')));
  }
  await desenharFiltros();
  // no celular os filtros ficam num painel que abre e fecha (aberto enquanto a lista não foi lida)
  const filtrosNaTela = () => (celular
    ? h('details', { class: 'filtros-celular', open: !ler },
      h('summary', {}, 'Filtros', h('span', { class: 'ajuda' }, ` · ${[PERIODOS_LISTA[e.periodo] ?? (e.periodo ? 'Período' : ''), e.busca && `"${e.busca}"`].filter(Boolean).join(' · ') || 'escolha e clique em Buscar'}`)),
      painelFiltros)
    : painelFiltros);

  const titulo = acomp ? 'Acompanhamento' : 'Lista principal';
  const cabecalho = h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, titulo),
    acomp ? h('p', {}, 'Quem já saiu da lista principal: aguardando cadastro, análise financeira, aguardando pedido, venda, sem interesse e inválidos.') : null));

  if (!ler) {
    const texto = !e.ver ? 'Defina os filtros e clique em Buscar'
      : falta.includes('representante') ? 'Escolha o supervisor e o representante e clique em Buscar'
      : falta.includes('equipe') && falta.includes('periodo') ? 'Escolha a equipe e o período e clique em Buscar'
        : falta.includes('equipe') ? 'Escolha a equipe e clique em Buscar' : 'Escolha o período e clique em Buscar';
    return montar(conteudo, cabecalho, filtrosNaTela(),
      h('div', { class: 'lista-vazia', id: 'lista-falta' }, h('b', {}, texto),
        h('span', {}, falta.includes('representante') ? 'Supervisor e representante. ' : falta.includes('equipe') ? 'Equipe: supervisor (com toda a equipe) ou representante. ' : '',
          falta.includes('periodo') ? 'Período: pela data do último registro. ' : '', 'A lista só é lida depois disso — nunca a base inteira.')));
  }

  // ---------- lista inteira já lida: situação, ordem e grupos no navegador ----------
  const excedeu = lidas.length > LIMITE;
  const linhas = lidas.slice(0, LIMITE);
  const STATUS_ORDEM = ['nao_contactado', 'em_prospeccao', 'aguardando_cadastro', 'analise_financeira', 'aguardando_pedido', 'venda_realizada', 'sem_interesse', 'invalido'];
  const natural = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true });
  const ORDENS = {
    prospect: (a, b) => natural(a.razao_social, b.razao_social),
    cidade: (a, b) => natural(a.cidade, b.cidade) || natural(a.bairro, b.bairro),
    onda: (a, b) => (a.onda == null) - (b.onda == null) || natural(a.onda, b.onda),
    rota: (a, b) => natural(a.rota, b.rota) || natural(a.subrota, b.subrota),
    status: (a, b) => STATUS_ORDEM.indexOf(a.status_atual) - STATUS_ORDEM.indexOf(b.status_atual),
    dias: (a, b) => (a.dias_corridos ?? -1) - (b.dias_corridos ?? -1),
    ultimo: (a, b) => natural(a.dt_ultimo_contato, b.dt_ultimo_contato),
  };
  const posicao = new Map(linhas.map((p, i) => [p.id, i]));   // ordem de trabalho do banco (pendências primeiro)
  const contagem = new Map();
  for (const p of linhas) contagem.set(p.status_atual, (contagem.get(p.status_atual) ?? 0) + 1);
  const statusDaAba = STATUS_ORDEM.filter((c) => contagem.get(c));
  const nomeStatus = Object.fromEntries(linhas.map((p) => [p.status_atual, [p.status_nome, p.status_cor]]));

  const podeRegistrar = usuario.perfil !== 'financeiro';
  const comLote = podeRegistrar && !acomp;
  const lote = new Set(lerLote());
  const colunas = [
    comLote ? { t: '', classe: 'marca' } : null,
    { t: 'Prospect', o: 'prospect' }, { t: 'Cidade · bairro', o: 'cidade' }, { t: 'Onda', o: 'onda', classe: 'num' }, { t: 'Segmento' },
    colunaRota ? { t: 'Rota', o: 'rota' } : null, gestao && acomp ? { t: 'Representante' } : null, { t: 'Status', o: 'status' },
    ...(acomp ? [{ t: 'Último registro', o: 'ultimo' }, { t: 'Próxima ação' }] : [{ t: 'Tentativas', classe: 'num' }, { t: 'Contato da planilha', o: 'ultimo' }]),
    { t: 'Dias', o: 'dias', classe: 'num' }, podeRegistrar ? { t: '' } : null,
  ].filter(Boolean);
  const cab = h('thead', {});
  const corpo = h('tbody', {});
  const situacao = h('div', { class: 'lista-situacao', role: 'group', 'aria-label': 'Situação' });
  const rodape = h('div', { class: 'lista-rodape' });
  const abertos = new Set();   // grupos expandidos (começam recolhidos)
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

  function linha(p, grupo) {
    const cod = codigoDe.get(Number(p.vendedor_id));
    const tr = h('tr', { dados: { id: p.id, grupo: grupo ?? '' }, hidden: grupo != null && !abertos.has(grupo),
      onclick: (ev) => { if (!ev.target.closest('a, input, button, label')) abrirFicha(p, tr); } },
      comLote ? h('td', { class: 'marca' }, Number(p.na_lista) ? h('input', { type: 'checkbox', 'aria-label': `Selecionar ${p.razao_social}`, checked: lote.has(Number(p.id)), dados: { lote: p.id },
        onchange: (ev) => { if (ev.target.checked) lote.add(Number(p.id)); else lote.delete(Number(p.id)); gravarLote([...lote]); atualizarLote(); } }) : null) : null,
      h('td', {}, h('a', { href: `#/ficha?id=${p.id}`, class: 'nome', title: p.razao_social }, p.razao_social),
        h('small', {}, formatar.cnpj(p.cnpj))),
      h('td', {}, h('span', { class: 'corta' }, p.cidade ? `${p.cidade}/${p.uf ?? ''}` : '—'), h('small', { class: 'corta' }, p.bairro ?? '')),
      h('td', { class: 'num' }, p.onda ?? ''),
      h('td', {}, h('span', { class: 'corta' }, p.tipologia_gtm ?? '')),
      colunaRota ? h('td', {}, p.rota ? `${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : '') : null,
      gestao && acomp ? h('td', {}, h('span', { class: 'corta', title: p.vendedor_nome ?? '' }, p.vendedor_nome ?? '—'), cod ? h('small', {}, `cód. ${cod}`) : null) : null,
      h('td', {}, seloStatus(p), Number(p.prazo_cadastro_vencido) ? h('small', { class: 'alerta-txt' }, 'prazo de cadastro vencido') : null),
      ...(acomp
        ? [h('td', {}, formatar.data(p.dt_ultimo_contato) || '—'),
          h('td', { class: Number(p.retorno_pendente) ? 'alerta-txt' : '' }, p.data_proxima_acao ? `Retorno ${formatar.data(p.data_proxima_acao)}` : '—')]
        : [h('td', { class: 'num' }, String(p.tentativas ?? 0)), h('td', {}, formatar.data(p.dt_ultimo_contato) || '—')]),
      h('td', { class: 'num' }, p.dias_corridos != null ? `${p.dias_corridos} d` : '—'),
      podeRegistrar ? h('td', {}, registrarPermitido(p) ? h('a', { href: `#/registrar?id=${p.id}`, class: 'registrar' }, 'Registrar') : null) : null);
    // no celular a linha vira cartão: cada célula leva o nome da coluna como rótulo
    if (celular) [...tr.children].forEach((td, i) => { td.dataset.r = colunas[i]?.t ?? ''; });
    return tr;
  }

  /** Linhas visíveis (situação), na ordem escolhida e agrupadas: [{ grupo, rotulo, linhas }]. */
  function visiveis() {
    const ordem = ORDENS[vista.ordem];
    const lista = linhas.filter((p) => !vista.status || p.status_atual === vista.status)
      .sort((a, b) => (ordem ? (vista.desc ? -1 : 1) * ordem(a, b) : 0) || posicao.get(a.id) - posicao.get(b.id));
    if (!vista.agrupar) return [{ grupo: null, linhas: lista }];
    const def = AGRUPAMENTOS[vista.agrupar];
    const grupos = new Map();
    for (const p of lista) { const g = def.rotulo(p); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p); }
    return [...grupos.entries()].sort((a, b) => natural(a[0], b[0])).map(([g, ls]) => ({ grupo: g, linhas: ls }));
  }

  function desenharTabela() {
    const chip = (codigo, texto, n, cor) => h('button', { type: 'button', class: `chip-situacao${vista.status === codigo ? ' ativa' : ''}`, dados: { status: codigo || 'todos' },
      onclick: () => { vista.status = codigo; desenharTabela(); } },
    cor ? h('span', { class: 'ponto', style: `background:${cor}` }) : null, texto, ' ', h('b', {}, formatar.numero(n)));
    montar(situacao, h('span', { class: 'lista-grupo-tit' }, 'Situação'), chip('', 'Todos', linhas.length),
      statusDaAba.map((c) => chip(c, c === 'em_prospeccao' ? 'Em prospecção (contato da planilha)' : nomeStatus[c][0], contagem.get(c), nomeStatus[c][1])),
      // no celular não há títulos de coluna: a ordem é escolhida numa lista
      celular ? h('select', { id: 'ordem-celular', 'aria-label': 'Ordenar', onchange: (ev) => { const [o, d] = ev.target.value.split('|'); Object.assign(vista, { ordem: o, desc: d === 'desc' }); desenharTabela(); } },
        h('option', { value: '|' }, 'Ordem: pendências primeiro'),
        colunas.filter((c) => c.o).flatMap((c) => [['', c.t], ['desc', `${c.t} (decrescente)`]].map(([d, t]) => h('option', { value: `${c.o}|${d}`, selected: vista.ordem === c.o && vista.desc === (d === 'desc') }, `Ordem: ${t}`)))) : null,
      h('span', { class: 'lista-situacao-acoes' }, h('button', { type: 'button', class: 'secundario pequeno', id: 'imprimir-lista', onclick: imprimir }, 'Gerar PDF')));
    // rótulo = ordenação: 1º clique crescente, 2º decrescente, 3º volta à ordem de trabalho (tudo no navegador)
    montar(cab, h('tr', {}, colunas.map((c) => h('th', { class: c.classe ?? '', 'aria-sort': c.o && vista.ordem === c.o ? (vista.desc ? 'descending' : 'ascending') : null },
      c.o ? h('button', { type: 'button', class: `ordenar ${vista.ordem === c.o ? 'ativa' : ''}`, dados: { ordem: c.o }, title: 'Ordenar',
        onclick: () => { if (vista.ordem !== c.o) Object.assign(vista, { ordem: c.o, desc: false }); else if (!vista.desc) vista.desc = true; else Object.assign(vista, { ordem: '', desc: false }); desenharTabela(); } },
      c.t, vista.ordem === c.o ? (vista.desc ? ' ▼' : ' ▲') : '') : c.t))));
    const blocos = visiveis();
    const linhasTr = [];
    for (const b of blocos) {
      if (b.grupo != null) {
        const aberto = abertos.has(b.grupo);
        linhasTr.push(h('tr', { class: 'linha-grupo', dados: { grupo: b.grupo } },
          h('td', { colspan: String(colunas.length) }, h('button', { type: 'button', class: 'abre-grupo', 'aria-expanded': aberto ? 'true' : 'false',
            onclick: () => { if (abertos.has(b.grupo)) abertos.delete(b.grupo); else abertos.add(b.grupo); desenharTabela(); } },
          aberto ? '▼ ' : '▶ ', b.grupo, h('span', { class: 'conta' }, ` · ${formatar.numero(b.linhas.length)} prospect(s)`)))));
        if (!aberto) continue;
      }
      for (const p of b.linhas) linhasTr.push(linha(p, b.grupo));
    }
    montar(corpo, linhasTr);
    const n = blocos.reduce((t, b) => t + b.linhas.length, 0);
    montar(rodape, h('span', {}, `${formatar.numero(n)} prospect(s)`, vista.agrupar ? ` em ${blocos.length} grupo(s) — clique no grupo para abrir` : '',
      vista.ordem || vista.agrupar ? '' : ' · ordem: pendências primeiro (clique no título da coluna para ordenar)'),
    excedeu ? h('span', { class: 'alerta-txt' }, `Mostrando os primeiros ${formatar.numero(LIMITE)}: refine os filtros.`) : null);
  }

  // Relatório em PDF para o representante: exatamente o que está na tela (filtros aplicados, situação, ordem e grupos).
  async function imprimir(ev) {
    const botao = ev.currentTarget;
    const rep = resumo.find((l) => Number(l.vendedor_id) === Number(e.filtros.vendedorId));
    const sup = resumo.find((l) => Number(l.supervisor_id) === Number(e.filtros.supervisorId ?? rep?.supervisor_id));
    const representante = rep ? `Representante ${rep.vendedor_nome}${rep.vendedor_codigo ? ' · cód. ' + rep.vendedor_codigo : ''}`
      : usuario.perfil === 'vendedor' ? usuario.nome : sup ? `Equipe de ${sup.supervisor_nome}` : 'Equipe';
    const supervisor = sup && rep ? `Supervisor ${sup.supervisor_nome}` : '';
    const cidade = e.filtros.cidadeBusca ? resumo.find((l) => l.cidade_busca === e.filtros.cidadeBusca)?.cidade ?? e.filtros.cidadeBusca : null;
    const filtros = [
      `UF: ${e.filtros.uf ?? 'todas'}`, `Cidade: ${cidade ?? 'todas'}`, e.filtros.bairroBusca ? `Bairro: ${e.filtros.bairroBusca}` : null,
      `Onda: ${e.filtros.onda ?? 'todas'}`, `Segmento: ${e.filtros.segmento ?? 'todos'}`,
      acomp ? `Período: ${formatar.data(e.filtros.dataDe) || '…'} a ${formatar.data(e.filtros.dataAte) || '…'}` : null,
      vista.status ? `Situação: ${nomeStatus[vista.status]?.[0]}` : null, e.busca ? `Busca: "${e.busca}"` : null,
      vista.agrupar ? `Agrupado por ${AGRUPAMENTOS[vista.agrupar].nome.toLowerCase()}` : null,
    ].filter(Boolean).join(' · ');
    const blocos = visiveis();
    const n = blocos.reduce((t, b) => t + b.linhas.length, 0);
    const porStatus = new Map();
    for (const b of blocos) for (const p of b.linhas) porStatus.set(p.status_atual, (porStatus.get(p.status_atual) ?? 0) + 1);
    const resumoPdf = [['Prospects', n], ...STATUS_ORDEM.filter((c) => porStatus.get(c)).map((c) => [nomeStatus[c][0], porStatus.get(c)])];
    const linhaPdf = (p) => [p.razao_social ?? '', p.nome_fantasia && p.nome_fantasia !== p.razao_social ? p.nome_fantasia : '', formatar.cnpj(p.cnpj),
      p.endereco ?? '', p.bairro ?? '', p.cidade ? `${p.cidade}/${p.uf ?? ''}` : '', p.telefone ?? '', p.onda ?? '', p.tipologia_gtm ?? '',
      p.status_nome ?? '', String(p.tentativas ?? 0), formatar.data(p.dt_primeiro_contato) || '—', p.dias_corridos != null ? String(p.dias_corridos) : '—'];
    const hoje = hojeSaoPaulo();
    const arquivo = `lista-${(rep?.vendedor_codigo ?? rep?.vendedor_nome ?? 'equipe').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hoje}.pdf`;
    await comEspera(botao, () => gerarPdfLista({ titulo, representante, supervisor, emissao: formatar.data(hoje), resumo: resumoPdf, filtros,
      blocos: blocos.map((b) => ({ grupo: b.grupo, linhas: b.linhas.map(linhaPdf) })), nomeArquivo: arquivo }));
  }

  if (comLote) atualizarLote();
  desenharTabela();
  const tabela = linhas.length
    ? h('section', { class: `cartao lista-tabela${celular ? ' celular' : ''}` }, h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-carteira' }, cab, corpo)), rodape)
    : mensagem(e.busca ? `Nada encontrado para "${e.busca}".` : 'Nenhum prospect com esses filtros.', 'info');
  montar(conteudo, cabecalho, filtrosNaTela(), linhas.length ? situacao : null, tabela, comLote ? barraLote : null, painel);
}
