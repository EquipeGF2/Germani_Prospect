// Início = dashboard de acompanhamento (docs/03 §10).
// Admin, gerente comercial e financeiro: geral + seletor de supervisor. Supervisor: só a equipe dele.
// Vendedor/representante: só a própria carteira.
import { bancoApp } from '../db.js';
import { consultaPainel, diasUteisCampanha, lerParametrosPainel, percentuais, somarPainel, supervisoresDoPainel, valoresPainel, vePainelCompleto } from '../../shared/painel.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, formatar } from '../ui.js';

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
      h('div', { class: 'detalhe' }, 'Venda realizada × ', h('b', {}, valor))));
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

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const hoje = hojeSaoPaulo();
  const [linhas, p] = await Promise.all([db.execute(consultaPainel({ usuario })).then((r) => r.rows), lerParametrosPainel(db)]);
  const dias = await diasUteisCampanha(db, { inicio: p.data_inicio_campanha, hoje });
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
