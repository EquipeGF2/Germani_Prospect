// Grupos de CNPJ — base × arquivo do ERP pela raiz do CNPJ, com sugestão e expurgo (docs/03 §13 · 0021).
import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { analisarGrupos, comandosExpurgo, EXPURGAVEIS, MOTIVOS_EXPURGO } from '../../shared/grupos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, numeros, comEspera, aviso, formatar, baixarCsv } from '../ui.js';
import { seloStatus } from './_carteira.js';

const NOMES_SUGESTAO = { expurgar: 'Expurgar', manter: 'Manter', decidir: 'Decidir', expurgado: 'Expurgado' };
const LIMITE_TELA = 400;

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-grupos' });
  let planilha = null;
  const bLer = h('button', { onclick: async () => {
    planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0]));
    if (planilha) await analisar();
  } }, 'Ler arquivo');

  async function analisar() {
    const r = await comEspera(null, () => analisarGrupos(db, { linhas: planilha.linhas }));
    if (r) mostrar(r);
  }

  function mostrar({ grupos, resumo }) {
    // ação escolhida por prospect: começa pela sugestão (expurgar só onde o banco aceita)
    const acao = new Map();
    for (const p of grupos.flatMap((g) => g.prospects)) acao.set(p.id, p.sugestao === 'expurgar' ? 'expurgar' : 'manter');
    const filtro = { sugestao: '', supervisor: '', busca: '' };
    const supervisores = [...new Map(grupos.flatMap((g) => g.prospects).filter((p) => p.supervisor_id)
      .map((p) => [String(p.supervisor_id), p.supervisor_nome ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const tabelaArea = h('div');
    const contagem = () => {
      let e = 0; let d = 0;
      for (const [, a] of acao) { if (a === 'expurgar') e++; else if (a === 'desfazer') d++; }
      return { e, d };
    };
    const bAplicar = h('button', { onclick: confirmar }, '');
    const atualizarBotao = () => { const { e, d } = contagem(); bAplicar.textContent = `Aplicar (${e} expurgar${d ? ` · ${d} desfazer` : ''})`; bAplicar.disabled = !(e + d); };

    const casaBusca = (p) => {
      if (!filtro.busca) return true;
      const q = filtro.busca.toUpperCase();
      const digitos = q.replace(/\D/g, '');
      return String(p.razao_social ?? '').toUpperCase().includes(q) || (digitos.length >= 3 && String(p.cnpj).includes(digitos));
    };
    const visivel = (p) => (!filtro.sugestao || p.sugestao === filtro.sugestao)
      && (!filtro.supervisor || String(p.supervisor_id) === filtro.supervisor) && casaBusca(p);

    function desenharTabela() {
      const linhas = [];
      let n = 0;
      for (const g of grupos) {
        const itens = g.prospects.filter(visivel);
        if (!itens.length || n >= LIMITE_TELA) continue;
        linhas.push(h('tr', { class: 'grupo-raiz' }, h('td', { colspan: '7' },
          h('b', {}, `Raiz ${formatar.cnpj(g.prospects[0].cnpj).slice(0, 10)}`), ` · ${g.nome ?? ''} · ${g.prospects.length} na base`,
          h('span', { class: 'ajuda', style: 'margin-left:12px' }, `no arquivo: ${g.arquivoQtd} CNPJ(s)${g.credGrupo != null ? ` · Créd. grupo ${formatar.moeda(g.credGrupo)}` : ''}`))));
        for (const p of itens) {
          n++;
          const opcoes = [['manter', 'Manter']];
          if (EXPURGAVEIS.includes(p.status_atual)) opcoes.push(['expurgar', 'Expurgar']);
          if (p.status_atual === 'expurgado') opcoes.push(['desfazer', 'Desfazer expurgo']);
          const sel = h('select', { 'aria-label': `Ação para ${p.razao_social}`, onchange: (ev) => { acao.set(p.id, ev.target.value); atualizarBotao(); } },
            opcoes.map(([v, t]) => h('option', { value: v, selected: acao.get(p.id) === v }, t)));
          linhas.push(h('tr', {},
            h('td', {}, h('a', { href: `#/ficha?id=${p.id}` }, formatar.cnpj(p.cnpj))),
            h('td', {}, p.razao_social),
            h('td', { class: 'centro' }, seloStatus(p)),
            h('td', { class: 'centro' }, p.vendedor_nome ?? '—'),
            h('td', { class: 'centro' }, p.noArquivo ? `sim${p.noArquivo.codigo ? ` · cód. ${p.noArquivo.codigo}` : ''}${p.noArquivo.dataCadastro ? ` · cadastro ${formatar.data(p.noArquivo.dataCadastro)}` : ''}` : 'não · filial nova do grupo'),
            h('td', { class: 'centro' }, h('span', { class: `selo sugestao-${p.sugestao}` }, NOMES_SUGESTAO[p.sugestao])),
            h('td', { class: 'centro' }, sel)));
        }
      }
      const total = grupos.reduce((s, g) => s + g.prospects.filter(visivel).length, 0);
      montar(tabelaArea, linhas.length
        ? h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-grupos' },
          h('thead', {}, h('tr', {}, ['CNPJ', 'Razão social', 'Situação', 'Carteira', 'No arquivo do ERP', 'Sugestão', 'Ação'].map((t) => h('th', {}, t)))),
          h('tbody', {}, linhas)))
        : h('p', { class: 'ajuda' }, 'Nenhuma empresa com esse filtro.'),
      total > LIMITE_TELA ? h('p', { class: 'ajuda' }, `Mostrando ${LIMITE_TELA} de ${formatar.numero(total)} — use os filtros ou baixe o relatório para ver tudo.`) : null);
    }

    function baixar() {
      const linhas = grupos.flatMap((g) => g.prospects.map((p) => ({ ...p, grupo: g.nome, arquivoQtd: g.arquivoQtd, credGrupo: g.credGrupo })));
      baixarCsv(`grupos-cnpj-${hojeSaoPaulo()}.csv`, [
        { titulo: 'Raiz', campo: 'cnpj_raiz' }, { titulo: 'Grupo (arquivo)', campo: 'grupo' }, { titulo: 'CNPJs no arquivo', campo: 'arquivoQtd' },
        { titulo: 'Créd. grupo', campo: 'credGrupo' }, { titulo: 'CNPJ', campo: 'cnpj' }, { titulo: 'Razão social', campo: 'razao_social' },
        { titulo: 'Cidade', texto: (p) => (p.cidade ? `${p.cidade}/${p.uf ?? ''}` : '') }, { titulo: 'Situação', campo: 'status_nome' },
        { titulo: 'Supervisor', campo: 'supervisor_nome' }, { titulo: 'Carteira', campo: 'vendedor_nome' },
        { titulo: 'No arquivo', texto: (p) => (p.noArquivo ? 'sim' : 'não (filial nova)') }, { titulo: 'Cód. cliente', texto: (p) => p.noArquivo?.codigo ?? '' },
        { titulo: 'Cadastro no ERP', texto: (p) => (p.noArquivo?.dataCadastro ? formatar.data(p.noArquivo.dataCadastro) : '') },
        { titulo: 'Sugestão', texto: (p) => NOMES_SUGESTAO[p.sugestao] }, { titulo: 'Ação escolhida', texto: (p) => acao.get(p.id) },
      ], linhas);
    }

    function confirmar() {
      const { e, d } = contagem();
      const todos = grupos.flatMap((g) => g.prospects);
      const porSituacao = new Map();
      for (const p of todos) if (acao.get(p.id) === 'expurgar') porSituacao.set(p.status_nome, (porSituacao.get(p.status_nome) ?? 0) + 1);
      const motivo = h('select', { id: 'motivo-expurgo' }, MOTIVOS_EXPURGO.map((m) => h('option', { value: m }, m)));
      const bOk = h('button', { onclick: async () => {
        const ok = await comEspera(bOk, async () => {
          const data = hojeSaoPaulo();
          const ids = (a) => todos.filter((p) => acao.get(p.id) === a).map((p) => p.id);
          const cmds = [...comandosExpurgo({ usuario: ctx.usuario, prospectIds: ids('expurgar'), acao: 'expurgar', motivo: motivo.value, data }),
            ...(ids('desfazer').length ? comandosExpurgo({ usuario: ctx.usuario, prospectIds: ids('desfazer'), acao: 'desfazer', motivo: 'Desfeito em Grupos de CNPJ', data }) : [])];
          for (let i = 0; i < cmds.length; i += 200) await db.batch(cmds.slice(i, i + 200), 'write');
          return true;
        });
        if (ok) { aviso(`Pronto: ${e} expurgado(s)${d ? `, ${d} desfeito(s)` : ''}.`); await analisar(); }
      } }, `Expurgar ${e}${d ? ` · desfazer ${d}` : ''}`);
      montar(painel, h('div', { class: 'cartao confirmar-expurgo', role: 'dialog', 'aria-label': 'Confirmar expurgo' },
        h('h2', { style: 'margin-top:0' }, `Expurgar ${e} prospect(s)${d ? ` e desfazer ${d}` : ''}?`),
        h('ul', {},
          h('li', {}, 'Nada é apagado: a situação vira "Expurgado (já cliente)" — sai da carteira válida e das contas (como o inválido) e não aceita registro.'),
          h('li', {}, 'Fica no histórico da ficha (quem, quando e o motivo) e pode ser desfeito aqui mesmo, voltando à situação anterior.'),
          h('li', {}, 'Só entra quem ainda não foi trabalhado (Não contactado / Em prospecção); o banco recusa os demais.')),
        porSituacao.size ? h('p', {}, [...porSituacao].map(([s, n]) => `${s}: ${n}`).join(' · ')) : null,
        h('div', { class: 'campo' }, h('label', { for: 'motivo-expurgo' }, 'Motivo (fica no histórico)'), motivo),
        h('p', { class: 'ajuda' }, 'Baixe o relatório antes, para guardar a lista.'),
        h('div', { class: 'acoes' }, bOk, h('button', { class: 'secundario', onclick: () => montar(painel) }, 'Voltar'))));
      painel.scrollIntoView({ block: 'start' });
    }

    const chips = h('div', { class: 'visoes', role: 'group', 'aria-label': 'Sugestão' },
      [['', 'Todas'], ['expurgar', 'Expurgar'], ['manter', 'Manter'], ['decidir', 'Decidir'], ['expurgado', 'Expurgados']].map(([v, t]) =>
        h('a', { href: '#', class: v === filtro.sugestao ? 'ativa' : '', dados: { sugestao: v || 'todas' }, onclick: (ev) => {
          ev.preventDefault(); filtro.sugestao = v; [...chips.children].forEach((c) => c.classList.toggle('ativa', c === ev.currentTarget)); desenharTabela();
        } }, t)));
    const supSel = h('select', { id: 'grupos-supervisor', onchange: (ev) => { filtro.supervisor = ev.target.value; desenharTabela(); } },
      h('option', { value: '' }, 'Todos'), supervisores.map(([id, nome]) => h('option', { value: id }, nome)));
    const busca = h('input', { id: 'grupos-busca', placeholder: 'raiz, CNPJ ou razão social', oninput: (ev) => { filtro.busca = ev.target.value.trim(); desenharTabela(); } });
    const painel = h('div');
    atualizarBotao();
    montar(area,
      h('div', { class: 'cartao' }, h('p', { style: 'margin:0' }, `${planilha.nome} · ${formatar.numero(resumo.linhasArquivo)} linhas · ${formatar.numero(resumo.raizesArquivo)} raízes de CNPJ`
        + (resumo.ignoradasArquivo ? ` · ${formatar.numero(resumo.ignoradasArquivo)} sem CNPJ válido (CPF/vazio) ignoradas` : ''))),
      numeros([['raízes em comum', resumo.raizesEmComum], ['prospects nesses grupos', resumo.prospects], ['mesmo CNPJ no arquivo', resumo.mesmoCnpj],
        ['filial nova do grupo', resumo.filialNova], ['sugeridos para expurgo', resumo.expurgar, resumo.expurgar ? 'erro' : ''], ['já expurgados', resumo.expurgados]]),
      h('div', { class: 'cartao filtros-grupos' }, h('span', {}, 'Sugestão:'), chips,
        h('label', { for: 'grupos-supervisor' }, 'Supervisor'), supSel, h('label', { for: 'grupos-busca' }, 'Buscar'), busca),
      h('div', { class: 'acoes' }, h('button', { class: 'secundario', onclick: baixar }, 'Baixar relatório (CSV)'), bAplicar),
      painel, tabelaArea,
      h('div', { class: 'cartao ajuda' },
        h('p', {}, h('b', {}, 'Expurgar (sugestão): '), 'mesmo CNPJ no arquivo, cadastro anterior ao início da campanha e ainda não trabalhado — já era cliente.'),
        h('p', {}, h('b', {}, 'Manter (sugestão): '), 'cadastro feito na campanha (é conversão) ou prospect já trabalhado.'),
        h('p', {}, h('b', {}, 'Decidir: '), 'filial nova de um grupo que já é cliente, ainda sem atendimento — oportunidade ou duplicidade.')));
    desenharTabela();
  }

  montar(area, h('div', { class: 'cartao' },
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-grupos' }, 'Arquivo do ERP (.xlsx ou .csv) com a coluna CPF / CNPJ'), arquivo),
    h('p', { class: 'ajuda' }, 'O relatório de cadastro do ERP serve (as colunas Cliente, Razão Social, Dt. Cadastro e Créd. Grupo, se houver, entram no relatório). O arquivo é lido no navegador; nada é gravado até você aplicar.'),
    bLer));
  montar(conteudo, h('h1', {}, 'Grupos de CNPJ — base × arquivo do ERP'),
    h('p', { class: 'ajuda' }, 'Compara só a raiz do CNPJ (8 primeiros dígitos): o que a base de prospects tem de cada grupo que já está no arquivo, com uma sugestão por empresa. Você escolhe manter ou expurgar e aplica.'),
    area);
}
