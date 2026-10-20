// Início = dashboard de acompanhamento (docs/03 §10).
// Celular: layout clássico (cartões). Computador: 3 visualizações à escolha do usuário (Executivo · Arrojado · Equipe)
// e filtro por período (posição atual ou eventos no período).
// Admin, gerente comercial e financeiro: geral + seletor de supervisor. Supervisor: só a equipe dele.
// Vendedor/representante: só a própria carteira.
import { bancoApp, lerComCache, leitorComCache, modoDemonstracao } from '../db.js';
import { carregarExemplo, SENHA_EXEMPLO } from '../../shared/exemplo.mjs';
import { lerPlanilhaDeBytes } from '../../shared/planilha.mjs';
import { normalizarMapaStatus } from '../../shared/importacao-base.mjs';
import { gerarHashSenha } from '../../shared/senha.mjs';
import { consultaPainel, diasUteisCampanha, funilPainel, lerParametrosPainel, PERIODOS, percentuais, resolverPeriodo, somarPainel, supervisoresDoPainel, valoresPainel, vePainelCompleto } from '../../shared/painel.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, formatar, aviso, comEspera } from '../ui.js';

const pct = (v) => `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const CHAVE_SUP = 'germani.painelSupervisor';

function kpis(t) {
  const da = (v) => (t.total ? (Number(v) / t.total) * 100 : 0);
  const cartao = (classe, rotulo, valor, detalhe) => h('div', { class: `kpi ${classe}` },
    h('div', { class: 'rotulo' }, rotulo), h('div', { class: 'valor' }, formatar.numero(valor)), h('div', { class: 'detalhe' }, h('b', {}, pct(detalhe)), ' da base'));
  return h('div', { class: 'kpis' },
    cartao('total', 'Total de prospects', t.total, 100),
    cartao('neutro', 'Não contactado', t.nao_contactado, da(t.nao_contactado)),
    cartao('perdido', 'Sem interesse', t.sem_interesse, da(t.sem_interesse)),
    cartao('liberado', 'Crédito liberado', t.credito_liberado, da(t.credito_liberado)),
    cartao('ganho', 'Venda realizada', t.venda_realizada, da(t.venda_realizada)));
}

function valores(t, p, primeiro) {
  const v = valoresPainel(t, p);
  const pctPipe = `${p.percentual_pipeline}%`;
  const valor = formatar.moeda(Number(p.valor_medio_cliente));
  return h('div', { class: 'kpis tres' },
    primeiro,
    h('div', { class: 'kpi dinheiro' }, h('div', { class: 'rotulo' }, 'Potencial do pipeline de abertura'), h('div', { class: 'valor' }, formatar.moeda(v.pipeline)),
      h('div', { class: 'detalhe' }, h('b', {}, pctPipe), ' da base de prospects × ', h('b', {}, valor))),
    h('div', { class: 'kpi ganho' }, h('div', { class: 'rotulo' }, 'Valor de conversão'), h('div', { class: 'valor' }, formatar.moeda(v.conversao)),
      h('div', { class: 'detalhe' }, 'Venda realizada × ', h('b', {}, valor), ' · pedidos: ', h('b', { id: 'valor-pedidos' }, formatar.moeda(Number(t.valor_pedidos))))));
}

function barra(valor, classe = '') {
  return h('div', { class: `barra ${classe}` }, h('span', { style: `width:${Math.min(100, Number(valor)).toFixed(2)}%` }));
}

function tipoAgente(l) {
  const vend = l.tipo_atuacao === 'vendedor';
  return h('span', { class: `tipo ${vend ? 'vendedor' : 'representante'}` }, vend ? 'Vendedor' : 'Representante');
}

function agentes(linhas, { link, rodape }) {
  const nome = (l) => (link ? h('a', { href: `#/carteira?vendedorId=${l.agente_id}`, title: 'Abrir a carteira' }, h('b', {}, l.agente_nome)) : h('b', {}, l.agente_nome));
  const celulas = (l) => { const p = percentuais(l); return [
    h('td', { class: 'num' }, formatar.numero(l.total)), h('td', { class: 'num' }, formatar.numero(l.nao_contactado)),
    h('td', { class: 'num' }, formatar.numero(l.sem_interesse)), h('td', { class: 'num' }, formatar.numero(l.credito_liberado)),
    h('td', { class: 'num' }, formatar.numero(l.venda_realizada)),
    h('td', { class: 'num pct' }, pct(p.pct_contactado), barra(p.pct_contactado, 'azul')),
    h('td', { class: 'num pct' }, pct(p.pct_conversao), barra(p.pct_conversao))]; };
  const tabela = h('div', { class: 'tabela-wrap agentes' }, h('table', { class: 'tabela-agentes' },
    h('thead', {}, h('tr', {}, ['Agente', 'Tipo', 'Total', 'Não contactado', 'Sem interesse', 'Crédito liberado', 'Venda realizada', '% contactado', '% conversão']
      .map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
    h('tbody', {}, linhas.map((l) => h('tr', {}, h('td', {}, nome(l)), h('td', {}, tipoAgente(l)), celulas(l)))),
    rodape ? h('tfoot', {}, h('tr', {}, h('td', {}, rodape.titulo), h('td'), celulas(rodape.total))) : null));
  const numero = (v, rotulo, cor) => h('div', {}, h('span', { style: cor ? `color:${cor}` : null }, formatar.numero(v)), h('small', {}, rotulo));
  const cartoes = h('div', { class: 'agentes-cartoes' }, linhas.map((l) => { const p = percentuais(l); return h('div', { class: 'agente' },
    h('div', { class: 'agente-topo' }, nome(l), tipoAgente(l)),
    h('div', { class: 'agente-numeros' }, numero(l.total, 'Total'), numero(l.nao_contactado, 'Não cont.'), numero(l.sem_interesse, 'Sem int.', '#B42318'),
      numero(l.credito_liberado, 'Liberado', '#0F766E'), numero(l.venda_realizada, 'Venda', '#15803D')),
    h('div', { class: 'agente-taxas' },
      h('div', {}, 'Contactado ', h('b', {}, pct(p.pct_contactado)), barra(p.pct_contactado, 'azul')),
      h('div', {}, 'Conversão ', h('b', {}, pct(p.pct_conversao)), barra(p.pct_conversao)))); }));
  return [cartoes, tabela];
}

function renderClassico(conteudo, { usuario, linhas, p, dias }) {
  const completo = vePainelCompleto(usuario);
  const equipe = usuario.perfil === 'supervisor';
  const geral = somarPainel(linhas);
  const cartaoDias = h('div', { class: 'kpi neutro dias' }, h('div', { class: 'rotulo' }, 'Dias úteis da campanha'), h('div', { class: 'valor' }, String(dias)),
    h('div', { class: 'detalhe' }, `Desde ${formatar.data(p.data_inicio_campanha)}`));
  const subtitulo = completo ? 'Visão consolidada dos registros e do status atual' : equipe ? 'Sua equipe: registros e status atual' : 'Sua carteira: registros e status atual';

  const blocos = [
    h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, 'Dashboard de acompanhamento'), h('p', {}, subtitulo)),
      h('span', { class: 'atualizado' }, `Atualizado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`)),
    linhas.length ? null : mensagem('Ainda não há prospects nesta visão. A base é carregada pelo administrador em Administração → Base de prospects.', 'info'),
    kpis(geral),
    valores(geral, p, cartaoDias),
  ];

  if (completo || equipe) {
    const supervisores = supervisoresDoPainel(linhas);
    let escolhido = null;
    if (completo) {
      try { escolhido = Number(sessionStorage.getItem(CHAVE_SUP)) || null; } catch { /* sem armazenamento */ }
      if (!supervisores.some((s) => s.id === escolhido)) escolhido = supervisores[0]?.id ?? null;
    }
    const area = h('div');
    const desenhar = () => {
      const doSup = completo ? linhas.filter((l) => Number(l.supervisor_id) === escolhido) : linhas;
      const t = somarPainel(doSup);
      const nomeSup = completo ? supervisores.find((s) => s.id === escolhido)?.nome ?? '' : usuario.nome;
      const cartaoAgentes = h('div', { class: 'kpi neutro dias' }, h('div', { class: 'rotulo' }, 'Agentes de vendas'), h('div', { class: 'valor' }, String(t.agentes)),
        h('div', { class: 'detalhe' }, `${t.vendedores} vendedor(es) · ${t.representantes} representante(s)`));
      montar(area,
        completo ? [kpis(t), valores(t, p, cartaoAgentes)] : null,
        h('div', { class: 'secao' }, h('h2', {}, 'Consolidado por agente de vendas'), h('span', { class: 'atualizado' }, `Supervisor: ${nomeSup} · toque no agente para abrir a carteira`)),
        doSup.length ? agentes(doSup, { link: true, rodape: { titulo: 'Total do supervisor', total: t } }) : mensagem('Nenhum agente com prospects.', 'info'));
    };
    const seletor = completo && supervisores.length ? h('div', { class: 'seletor' }, h('label', { for: 'painel-supervisor' }, 'Supervisor'),
      h('select', { id: 'painel-supervisor', onchange: (ev) => { escolhido = Number(ev.target.value); try { sessionStorage.setItem(CHAVE_SUP, String(escolhido)); } catch { /* nada */ } desenhar(); } },
        supervisores.map((s) => h('option', { value: s.id, selected: s.id === escolhido }, s.nome)))) : null;
    if (completo) blocos.push(h('div', { class: 'secao' }, h('h2', {}, 'Visão por supervisor'), seletor));
    blocos.push(area);
    desenhar();
  }
  montar(conteudo, blocos);
}

// ---------------------------------------------------------------------------------------------
// Computador: três visualizações (escolha do usuário, guardada no navegador) + filtro por período
// ---------------------------------------------------------------------------------------------
const CHAVE_VISAO = 'germani.painelVisao';
const VISOES_WEB = { executivo: 'Executivo', arrojado: 'Arrojado', equipe: 'Equipe' };
const CORES_FUNIL = ['#E9A0A5', '#E9A0A5', '#D3666E', '#B8333D', '#9F1D24', '#6B1016'];   // um só tom, do claro ao escuro
const moedaCurta = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
  : v >= 1e4 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : formatar.moeda(v));
const pct1 = (v) => pct(v).replace(/(\d),(\d)\d%$/, '$1,$2%');

function lerArmazenado(chave, padrao, armazenamento = localStorage) {
  try { return armazenamento.getItem(chave) ?? padrao; } catch { return padrao; }
}
function guardar(chave, valor, armazenamento = localStorage) {
  try { armazenamento.setItem(chave, valor); } catch { /* preferência só nesta visita */ }
}

function meter(valor) {
  return h('div', { class: 'medidor' }, h('span', { style: `width:${Math.min(100, Math.max(0, valor)).toFixed(2)}%` }));
}

function rotuloPedidos(t) {
  const n = Number(t.qtd_pedidos);
  return n ? `${formatar.numero(n)} pedido(s) importado(s) do ERP` : 'nenhum pedido importado';
}

function linkAgente(l, gestao) {
  return gestao ? h('a', { href: `#/carteira?vendedorId=${l.agente_id}`, title: 'Abrir a carteira' }, l.agente_nome) : l.agente_nome;
}

function papel(l) {
  return l.agente_perfil === 'supervisor' ? 'Supervisor' : l.tipo_atuacao === 'vendedor' ? 'Vendedor' : 'Representante';
}

function funilBarras(t) {
  const f = funilPainel(t);
  const base = f[0].valor || 1;
  return h('div', { class: 'funil-barras' }, f.map((e, i) => h('div', { class: 'etapa' },
    h('span', { class: 'rot' }, e.rotulo),
    h('div', { class: 'trilho' }, h('span', { style: `width:${Math.max(e.valor ? 1.5 : 0, (e.valor / base) * 100)}%;background:${CORES_FUNIL[i]}` })),
    h('b', { class: 'v' }, formatar.numero(e.valor)),
    h('span', { class: 'taxa' }, pct1(e.pctBase)))));
}

function funilColunas(t) {
  const f = funilPainel(t);
  const base = f[0].valor || 1;
  return h('div', { class: 'funil-colunas' }, f.map((e, i) => h('div', { class: 'col' },
    h('b', { class: 'v' }, formatar.numero(e.valor)),
    h('div', { class: 'bloco', style: `height:${Math.max(e.valor ? 3 : 0, Math.sqrt(e.valor / base) * 100)}%;background:${CORES_FUNIL[i]}` }),
    h('span', { class: 'rot' }, e.rotulo),
    h('span', { class: 'taxa' }, pct1(e.pctBase)))));
}

function visaoExecutivo({ t, agentesDaVez, p, dias, gestao }) {
  const v = valoresPainel(t, p);
  const pr = percentuais(t);
  const ordenados = [...agentesDaVez].sort((a, b) => b.venda_realizada - a.venda_realizada || b.contactados - a.contactados);
  return h('div', { class: 'vis-executivo' },
    h('section', { class: 'faixa-hero' },
      h('div', {}, h('div', { class: 'r' }, 'Vendas realizadas'), h('div', { class: 'grande', id: 'painel-vendas' }, formatar.numero(t.venda_realizada)),
        h('div', { class: 's' }, h('b', {}, pct1(pr.pct_conversao)), ' de conversão sobre os contactados')),
      h('div', {}, h('div', { class: 'r' }, 'Cobertura da base'), h('div', { class: 'media' }, pct1(pr.pct_contactado)), meter(pr.pct_contactado),
        h('div', { class: 's' }, h('b', {}, formatar.numero(t.contactados)), ` de ${formatar.numero(t.total)} contactados`)),
      h('div', {}, h('div', { class: 'r' }, 'Valor de conversão'), h('div', { class: 'media' }, formatar.moeda(v.conversao)), h('div', { class: 's' }, `vendas × ${formatar.moeda(Number(p.valor_medio_cliente))}`)),
      h('div', {}, h('div', { class: 'r' }, 'Valor dos pedidos'), h('div', { class: 'media', id: 'valor-pedidos' }, formatar.moeda(Number(t.valor_pedidos))), h('div', { class: 's' }, rotuloPedidos(t))),
      h('div', {}, h('div', { class: 'r' }, 'Potencial do pipeline'), h('div', { class: 'media' }, moedaCurta(v.pipeline)),
        h('div', { class: 's' }, `${p.percentual_pipeline}% da base × ${formatar.moeda(Number(p.valor_medio_cliente))} · ${dias} dia(s) útil(eis)`))),
    h('div', { class: 'duas' },
      h('section', { class: 'painel' }, h('h2', {}, 'Funil da campanha'), h('p', { class: 's' }, '% sobre a base de prospects'), funilBarras(t),
        h('p', { class: 's', style: 'margin:14px 0 0' }, 'Fora do funil: ', h('b', {}, formatar.numero(t.sem_interesse)), ' sem interesse')),
      h('section', { class: 'painel' }, h('h2', {}, 'Agentes de vendas'), h('p', { class: 's' }, 'Ordenados por vendas · barra = % da carteira contactada'),
        ordenados.length ? h('div', { class: 'lista-agentes' }, ordenados.map((l) => { const x = percentuais(l); return h('div', { class: 'ag' },
          h('div', {}, h('b', {}, linkAgente(l, gestao)), h('small', {}, `${papel(l)} · ${formatar.numero(l.total)} prospects`)),
          h('div', {}, meter(x.pct_contactado), h('small', {}, `${Math.round(x.pct_contactado)}% contactado`)),
          h('div', { class: 'vv' }, formatar.numero(l.venda_realizada), h('small', {}, 'vendas'))); })) : mensagem('Nenhum agente nesta visão.', 'info'))));
}

function visaoArrojado({ t, agentesDaVez, p, dias, gestao, titulo, subtitulo }) {
  const v = valoresPainel(t, p);
  const ordenados = [...agentesDaVez].sort((a, b) => b.venda_realizada - a.venda_realizada || b.contactados - a.contactados).slice(0, 10);
  const maxV = Math.max(1, ...ordenados.map((l) => l.venda_realizada));
  const kpi = (rotulo, valor, detalhe, cor) => h('div', {}, h('div', { class: 'r' }, h('i', { style: `background:${cor}` }), rotulo), h('div', { class: 'v' }, formatar.numero(valor)), h('div', { class: 'd' }, detalhe));
  const daBase = (x) => `${pct1(t.total ? (x / t.total) * 100 : 0)} da base`;
  return h('div', { class: 'vis-arrojado' },
    h('section', { class: 'faixa-escura' },
      h('div', { class: 'tit' }, h('h2', {}, titulo), h('p', {}, subtitulo)),
      h('div', { class: 'herois' },
        h('div', {}, h('div', { class: 'r' }, 'Valor de conversão'), h('div', { class: 'v' }, formatar.moeda(v.conversao)), h('div', { class: 'd' }, `${formatar.numero(t.venda_realizada)} vendas × ${formatar.moeda(Number(p.valor_medio_cliente))}`)),
        h('div', {}, h('div', { class: 'r' }, 'Valor dos pedidos'), h('div', { class: 'v', id: 'valor-pedidos' }, formatar.moeda(Number(t.valor_pedidos))), h('div', { class: 'd' }, rotuloPedidos(t))),
        h('div', {}, h('div', { class: 'r' }, 'Potencial do pipeline'), h('div', { class: 'v' }, moedaCurta(v.pipeline)), h('div', { class: 'd' }, `${p.percentual_pipeline}% da base de prospects × ${formatar.moeda(Number(p.valor_medio_cliente))}`)),
        h('div', {}, h('div', { class: 'r' }, 'Dias úteis'), h('div', { class: 'v' }, String(dias)), h('div', { class: 'd' }, `campanha desde ${formatar.data(p.data_inicio_campanha)}`)))),
    h('section', { class: 'kpis-linha' },
      kpi('Total de prospects', t.total, '100% da base', '#1E3A5F'), kpi('Não contactado', t.nao_contactado, daBase(t.nao_contactado), '#9CA3AF'),
      kpi('Sem interesse', t.sem_interesse, daBase(t.sem_interesse), '#6B7280'), kpi('Crédito liberado', t.credito_liberado, daBase(t.credito_liberado), '#B8333D'),
      kpi('Venda realizada', t.venda_realizada, daBase(t.venda_realizada), '#6B1016')),
    h('div', { class: 'duas' },
      h('section', { class: 'painel' }, h('h2', {}, 'Funil da campanha'), h('p', { class: 's' }, 'Quantos chegaram a cada etapa · % sobre a base de prospects'), funilColunas(t)),
      h('section', { class: 'painel' }, h('h2', {}, 'Ranking de agentes'), h('p', { class: 's' }, 'Vendas realizadas · destaque para os 3 primeiros'),
        ordenados.length ? h('div', { class: 'ranking' }, ordenados.map((l, i) => h('div', { class: `rk ${i < 3 ? 'top' : ''}` },
          h('span', { class: 'pos' }, String(i + 1)),
          h('div', {}, h('b', {}, linkAgente(l, gestao)), ' ', h('span', { class: 'chip-tipo' }, papel(l)), h('div', { class: 'trilho' }, h('span', { style: `width:${(l.venda_realizada / maxV) * 100}%` }))),
          h('b', { class: 'vv' }, formatar.numero(l.venda_realizada))))) : mensagem('Nenhum agente nesta visão.', 'info'))));
}

function visaoEquipe({ linhas, t, p, dias, gestao, supervisores, supAtual, aoEscolher }) {
  const v = valoresPainel(t, p);
  const kpi = (rotulo, valor, destaque) => h('div', {}, h('div', { class: 'r' }, rotulo), h('div', { class: `v ${destaque ? 'destaque' : ''}` }, valor));
  const doSup = supAtual ? linhas.filter((l) => Number(l.supervisor_id) === supAtual) : linhas;
  const ts = somarPainel(doSup);
  const nomeSup = supervisores.find((s) => s.id === supAtual)?.nome;
  const maxT = Math.max(1, ...doSup.map((l) => Number(l.total)));
  const cartoes = supervisores.length > 1 || gestao ? h('section', { class: 'sups' }, supervisores.map((s) => {
    const x = somarPainel(linhas.filter((l) => Number(l.supervisor_id) === s.id));
    return h('button', { type: 'button', class: `sup ${s.id === supAtual ? 'sel' : ''}`, dados: { supervisor: s.id }, onclick: () => aoEscolher(s.id) },
      h('span', { class: 'nome' }, s.nome), h('span', { class: 'tot' }, `${formatar.numero(x.total)} prospects`),
      h('span', { class: 'grande' }, pct1(x.pct_contactado)), h('span', { class: 'gl' }, 'da carteira contactada'), meter(x.pct_contactado),
      h('span', { class: 'mini' },
        h('span', {}, h('b', {}, formatar.numero(x.venda_realizada)), 'vendas'),
        h('span', {}, h('b', {}, pct1(x.pct_conversao)), 'conversão'),
        h('span', {}, h('b', {}, moedaCurta(Number(x.valor_pedidos))), 'em pedidos')));
  })) : null;
  return h('div', { class: 'vis-equipe' },
    h('section', { class: 'kpis-fina' },
      kpi('Prospects', formatar.numero(t.total)), kpi('Não contactados', formatar.numero(t.nao_contactado)), kpi('Sem interesse', formatar.numero(t.sem_interesse)),
      kpi('Crédito liberado', formatar.numero(t.credito_liberado)), kpi('Vendas', formatar.numero(t.venda_realizada), true), kpi('Valor de conversão', moedaCurta(v.conversao), true),
      kpi('Valor dos pedidos', moedaCurta(Number(t.valor_pedidos)), true)),
    cartoes ? [h('div', { class: 'tit' }, h('h2', {}, 'Supervisores'), h('span', {}, 'Clique para ver a equipe')), cartoes] : null,
    h('div', { class: 'duas' },
      h('section', { class: 'painel' },
        h('div', { class: 'tit' }, h('h2', {}, nomeSup ? `Equipe de ${nomeSup}` : 'Equipe'), h('span', {}, `${doSup.length} agente(s)`)),
        h('div', { class: 'legenda' }, h('span', {}, h('i', { style: 'background:#F6D9DB' }), 'Carteira'), h('span', {}, h('i', { style: 'background:#E9A0A5' }), 'Contactados'),
          h('span', {}, h('i', { style: 'background:#9F1D24' }), 'Atendidos')),
        doSup.length ? h('div', { class: 'barras-equipe' }, [...doSup].sort((a, b) => b.total - a.total).map((l) => { const x = percentuais(l); return h('div', { class: 'br' },
          h('div', { class: 'nm' }, h('b', {}, linkAgente(l, gestao)), h('small', {}, `${papel(l)} · ${Math.round(x.pct_contactado)}% contactado`)),
          h('div', { class: 'trilho', style: `width:${Math.max(4, (l.total / maxT) * 100)}%` },
            h('span', { class: 'c', style: `width:${l.total ? (l.contactados / l.total) * 100 : 0}%` }),
            h('span', { class: 'a', style: `width:${l.total ? (l.atendidos / l.total) * 100 : 0}%` })),
          h('div', { class: 'num' }, formatar.numero(l.total), h('small', {}, `${l.venda_realizada} venda(s)`))); })) : mensagem('Nenhum agente nesta visão.', 'info')),
      h('section', { class: 'painel' }, h('div', { class: 'tit' }, h('h2', {}, 'Funil da equipe')),
        funilPainel(ts).map((e) => h('div', { class: 'etp' }, h('span', {}, e.rotulo), h('span', {}, h('b', {}, formatar.numero(e.valor)),
          h('small', {}, ts.total ? pct1((e.valor / ts.total) * 100) : '')))),
        h('div', { class: 'etp' }, h('span', {}, 'Sem interesse'), h('span', {}, h('b', {}, formatar.numero(ts.sem_interesse)))),
        // um valor por linha (o card é estreito)
        h('div', { class: 's resumo-equipe', style: 'margin:14px 0 0' },
          h('div', {}, 'Valor de conversão ', h('b', {}, formatar.moeda(ts.venda_realizada * Number(p.valor_medio_cliente)))),
          h('div', {}, 'Valor dos pedidos ', h('b', {}, formatar.moeda(Number(ts.valor_pedidos)))),
          h('div', {}, `${dias} dia(s) útil(eis)`)))));
}

function renderComputador(conteudo, { usuario, linhas, p, dias, periodo, chavePeriodo, parametros }) {
  const completo = vePainelCompleto(usuario);
  const gestao = completo || usuario.perfil === 'supervisor';
  const supervisores = gestao ? supervisoresDoPainel(linhas) : [];
  let visao = lerArmazenado(CHAVE_VISAO, 'executivo');
  if (!VISOES_WEB[visao]) visao = 'executivo';
  // supervisor escolhido: '' = todos (Executivo/Arrojado); na visão Equipe sempre há um selecionado
  let sup = completo ? Number(lerArmazenado(CHAVE_SUP, '', sessionStorage)) || null : null;
  if (sup && !supervisores.some((s) => s.id === sup)) sup = null;

  const irPeriodo = (muda) => {
    const q = new URLSearchParams(parametros);
    for (const [k, v] of Object.entries(muda)) { if (v) q.set(k, v); else q.delete(k); }
    location.hash = `#/inicio${q.toString() ? '?' + q : ''}`;
  };
  const selPeriodo = h('select', { id: 'painel-periodo', 'aria-label': 'Período', onchange: (ev) => {
    if (ev.target.value === 'personalizado') { campoDe.hidden = campoAte.hidden = botaoAplicar.hidden = false; campoDe.focus(); return; }
    irPeriodo({ periodo: ev.target.value === 'atual' ? null : ev.target.value, de: null, ate: null });
  } }, Object.entries(PERIODOS).map(([k, t]) => h('option', { value: k, selected: k === chavePeriodo }, t)));
  const personalizado = chavePeriodo === 'personalizado';
  const campoDe = h('input', { type: 'date', id: 'painel-de', 'aria-label': 'De', value: periodo?.inicio ?? '', hidden: !personalizado });
  const campoAte = h('input', { type: 'date', id: 'painel-ate', 'aria-label': 'Até', value: periodo?.fim ?? '', hidden: !personalizado });
  const botaoAplicar = h('button', { type: 'button', class: 'secundario', hidden: !personalizado, onclick: () => {
    if (campoDe.value && campoAte.value) irPeriodo({ periodo: 'personalizado', de: campoDe.value, ate: campoAte.value });
  } }, 'Aplicar');
  const selSup = h('select', { id: 'painel-supervisor', 'aria-label': 'Supervisor', onchange: (ev) => {
    sup = Number(ev.target.value) || null; guardar(CHAVE_SUP, ev.target.value, sessionStorage); desenhar();
  } }, h('option', { value: '' }, 'Todos os supervisores'), supervisores.map((s) => h('option', { value: s.id, selected: s.id === sup }, s.nome)));
  // visualização em lista (ocupa menos espaço que os botões, sobretudo com o período personalizado aberto)
  const selVisao = h('select', { id: 'painel-visao', 'aria-label': 'Visualização', onchange: (ev) => {
    visao = ev.target.value; guardar(CHAVE_VISAO, visao); desenhar();
  } }, Object.entries(VISOES_WEB).map(([k, t]) => h('option', { value: k, selected: k === visao }, t)));
  const rotuloPeriodo = periodo ? `Eventos de ${formatar.data(periodo.inicio)} a ${formatar.data(periodo.fim)}` : 'Posição atual da carteira';
  const titulo = completo ? 'Campanha de prospecção' : usuario.perfil === 'supervisor' ? 'Sua equipe' : 'Sua carteira';
  const area = h('div', { class: 'painel-web' });
  const filtroSup = completo && supervisores.length ? h('div', { class: 'filtro' }, h('label', { for: 'painel-supervisor' }, 'Supervisor'), selSup) : null;

  function desenhar() {
    if (filtroSup) filtroSup.hidden = visao === 'equipe';   // na visão Equipe o supervisor é escolhido pelos cartões
    let supAtual = sup;
    if (visao === 'equipe' && gestao) {
      if (!supervisores.some((s) => s.id === supAtual)) supAtual = supervisores[0]?.id ?? null;
    }
    const daVez = visao !== 'equipe' && sup ? linhas.filter((l) => Number(l.supervisor_id) === sup) : linhas;
    const t = somarPainel(daVez);
    const comum = { t, agentesDaVez: daVez, p, dias, gestao, titulo, subtitulo: rotuloPeriodo };
    montar(area,
      linhas.length ? null : mensagem('Ainda não há prospects nesta visão. A base é carregada pelo administrador em Administração → Base de prospects.', 'info'),
      visao === 'arrojado' ? visaoArrojado(comum)
        : visao === 'equipe' ? visaoEquipe({ linhas, t: somarPainel(linhas), p, dias, gestao, supervisores, supAtual,
          aoEscolher: (id) => { sup = id; guardar(CHAVE_SUP, String(id), sessionStorage); selSup.value = String(id); desenhar(); } })
          : visaoExecutivo(comum));
  }

  montar(conteudo,
    h('div', { class: 'cabecalho-pagina' },
      h('div', {}, h('h1', {}, completo ? `Olá, ${usuario.nome.split(' ')[0]}` : titulo), h('p', {}, `${rotuloPeriodo} · ${dias} dia(s) útil(eis) desde ${formatar.data(p.data_inicio_campanha)}`)),
      h('div', { class: 'controles-painel' },
        h('div', { class: 'filtro' }, h('label', { for: 'painel-periodo' }, 'Período'), h('div', { class: 'periodo' }, selPeriodo, campoDe, campoAte, botaoAplicar)),
        filtroSup,
        h('div', { class: 'filtro' }, h('label', { for: 'painel-visao' }, 'Visualização'), selVisao))),
    area);
  desenhar();
}

export async function render(conteudo, ctx) {
  const { usuario, parametros } = ctx;
  const db = await bancoApp();
  const hoje = hojeSaoPaulo();
  const leitor = leitorComCache(db, 600);   // parâmetros e feriados mudam pouco
  const p = await lerParametrosPainel(leitor);
  const mq = matchMedia('(max-width: 900px)');
  const celular = mq.matches;
  // no celular o Início não muda: sempre a posição atual, layout clássico
  const chavePeriodo = !celular && PERIODOS[parametros.get('periodo')] ? parametros.get('periodo') : 'atual';
  const periodo = resolverPeriodo(chavePeriodo, { hoje, inicioCampanha: p.data_inicio_campanha, de: parametros.get('de'), ate: parametros.get('ate') });
  const [linhas, dias] = await Promise.all([
    // posição atual: do resumo pronto (0012); banco ainda sem a migração → agrega pelo índice (0011)
    lerComCache(db, consultaPainel({ usuario, periodo }), 120)
      .catch((e) => (/no such table/i.test(String(e?.message)) ? lerComCache(db, consultaPainel({ usuario, periodo, fonte: 'indice' }), 120) : Promise.reject(e)))
      .then((r) => r.rows),
    diasUteisCampanha(leitor, { inicio: p.data_inicio_campanha, hoje, periodo }),
  ]);
  // ao cruzar o limite celular/computador (girar o tablet, redimensionar a janela) a tela se redesenha
  const troca = () => { mq.removeEventListener('change', troca); if (conteudo.isConnected) render(conteudo, ctx); };
  mq.addEventListener('change', troca);
  const dados = { usuario, linhas, p, dias, periodo, chavePeriodo: periodo ? chavePeriodo : 'atual', parametros };
  if (celular) renderClassico(conteudo, dados);
  else renderComputador(conteudo, dados);
  if (modoDemonstracao() && usuario.perfil === 'administrador' && !linhas.length) conteudo.prepend(blocoExemplo(db, () => render(conteudo, ctx)));
}

// Modo demonstração: preenche o banco temporário com a base fictícia e um processo simulado (shared/exemplo.mjs)
function blocoExemplo(db, aoTerminar) {
  const botao = h('button', { id: 'carregar-exemplo', onclick: async () => {
    const r = await comEspera(botao, async () => {
      if (!window.ExcelJS || !window.JSZip) throw new Error('bibliotecas de planilha ainda carregando — tente de novo em instantes');
      const [bytes, mapa] = await Promise.all([fetch('exemplos/base-ficticia.xlsx').then((x) => x.arrayBuffer()), fetch('config/mapa-status-planilha.json').then((x) => x.json())]);
      const { linhas } = await lerPlanilhaDeBytes(new Uint8Array(bytes), 'base-ficticia.xlsx', { ExcelJS: window.ExcelJS, JSZip: window.JSZip });
      return carregarExemplo(db, { linhasBase: linhas, mapaStatus: normalizarMapaStatus(mapa), hoje: hojeSaoPaulo(), gerarHash: gerarHashSenha });
    });
    if (!r) return;
    aviso(`Dados de exemplo carregados: ${r.contatos} registros, ${r.cadastrados} cadastros, ${r.liberados} liberações e ${r.vendas} vendas.`);
    aoTerminar();
  } }, 'Carregar dados de exemplo');
  return h('div', { class: 'cartao exemplo' },
    h('h2', {}, 'Ver o sistema preenchido'),
    h('p', { style: 'margin:0 0 12px' }, 'Carrega neste navegador a base fictícia (120 prospects) e simula a campanha: atendimentos e "sem interesse" dos vendedores, ',
      'arquivo de cadastro do ERP, liberações de crédito no console e arquivo de pedidos — com o histórico de movimentação completo. Some ao recarregar a página.'),
    h('p', { class: 'ajuda' }, `Depois entre com outros perfis (senha ${SENHA_EXEMPLO}): gerente · financeiro · sup + código do supervisor (ex.: sup901) · código do vendedor/representante (ex.: 1101).`),
    botao);
}
