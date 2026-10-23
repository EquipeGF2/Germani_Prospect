import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { importarEventos } from '../../shared/importar-eventos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso } from '../ui.js';
import { blocoResultado } from './_resultado.js';
import { seletorColuna } from './admin-importar-tipos.js';

const TIPOS = {
  cadastro: { titulo: 'Cadastro de clientes', descricao: 'CNPJs cadastrados no ERP (data e código do cliente).', efeito: 'Análise financeira', documento: 'Código do cliente', data: 'Data do cadastro',
    icone: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4' },
  pedido: { titulo: 'Pedidos', descricao: 'Pedidos emitidos (data, número e valor do pedido).', efeito: 'Venda realizada', documento: 'Número do pedido', data: 'Data do pedido',
    icone: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
  baixa: { titulo: 'CNPJs baixados', descricao: 'Empresas com CNPJ baixado na Receita.', efeito: 'Inválido (congelado)', documento: null, data: 'Data da baixa',
    icone: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2' },
};

function iconeSvg(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icone');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}
const ETAPAS = ['Tipo e arquivo', 'Colunas', 'Simulação', 'Gravação'];

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  // tipo do arquivo escolhido por cards (rádio); `tipo.value` lê o marcado
  const tipo = { get value() { return cards.querySelector('input[name="tipo-erp"]:checked')?.value ?? 'cadastro'; } };   // cards continua em memória nas etapas seguintes
  const cards = h('div', { class: 'cards-tipo', role: 'radiogroup', 'aria-label': 'Tipo de arquivo' }, Object.entries(TIPOS).map(([v, t], i) =>
    h('label', { class: 'card-tipo', dados: { tipo: v } },
      h('input', { type: 'radio', name: 'tipo-erp', value: v, checked: i === 0 }),
      h('span', { class: 'ic' }, iconeSvg(t.icone)),
      h('span', {}, h('b', {}, t.titulo), h('small', {}, t.descricao), h('span', { class: 'efeito' }, `→ ${t.efeito}`)))));
  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-erp' });
  let planilha = null;
  const bLer = h('button', { onclick: async () => { planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0])); if (planilha) colunas(); } }, 'Ler arquivo');

  function colunas() {
    const t = TIPOS[tipo.value];
    const cab = planilha.linhas[0] ?? [];
    const cCnpj = seletorColuna('col-cnpj', 'Coluna do CNPJ', cab, 'CNPJ');
    const cData = seletorColuna('col-data', `Coluna da ${t.data.toLowerCase()}`, cab, 'DATA', { opcional: true });
    const cDoc = t.documento ? seletorColuna('col-doc', `Coluna do ${t.documento.toLowerCase()}`, cab, t.documento, { opcional: tipo.value !== 'pedido' }) : null;
    const cValor = tipo.value === 'pedido' ? seletorColuna('col-valor', 'Coluna do valor do pedido', cab, 'VALOR', { opcional: true }) : null;
    const dataPadrao = h('input', { id: 'data-padrao', type: 'date', value: hojeSaoPaulo() });
    const parametros = () => ({ tipo: tipo.value, linhas: planilha.linhas, colunas: { cnpj: cCnpj.valor(), data: cData.valor(), documento: cDoc?.valor() ?? null, valor: cValor?.valor() ?? null },
      dataPadrao: cData.valor() ? null : dataPadrao.value, hoje: hojeSaoPaulo(), arquivoNome: planilha.nome, arquivoSha256: planilha.sha256, executadoPor: ctx.usuario.login });
    const paraTela = (rs) => rs.map((r) => ({ numeroLinha: r.numeroLinha, resultado: r.resultado, cnpj: r.cnpj, mensagens: r.resultado === 'aceita' ? r.avisos : r.erros }));
    const bSim = h('button', { onclick: async () => {
      const r = await comEspera(bSim, () => importarEventos(db, { ...parametros(), simular: true }));
      if (!r) return;
      const bGravar = h('button', { onclick: async () => {
        const g = await comEspera(bGravar, () => importarEventos(db, parametros()));
        if (!g) return;
        aviso('Arquivo importado.');
        montar(area, passos(ETAPAS, 4), mensagem(`Importação nº ${g.importacaoId}: ${g.resumo.aceitas} movimento(s) gravado(s) no histórico.`, 'ok'),
          blocoResultado({ titulo: `Importação nº ${g.importacaoId}`, resumo: g.resumo, resultados: paraTela(g.resultados), nomeRelatorio: `importacao-${g.importacaoId}-${tipo.value}.csv` }));
      } }, 'Confirmar e gravar');
      montar(area, passos(ETAPAS, 2),
        mensagem('"Ignoradas" = CNPJ que não está na base de prospects (ex.: cliente antigo do ERP) ou evento já importado.', 'info'),
        blocoResultado({ titulo: 'Resultado da simulação', resumo: r.resumo, resultados: paraTela(r.resultados), nomeRelatorio: `simulacao-${tipo.value}-${hojeSaoPaulo()}.csv` }),
        h('div', { class: 'acoes' }, bGravar, h('button', { class: 'secundario', onclick: colunas }, 'Voltar')));
    } }, 'Simular');
    montar(area, passos(ETAPAS, 1), h('div', { class: 'cartao' },
      h('p', {}, `${t.titulo} · ${planilha.nome} · ${planilha.observacao}`),
      h('div', { class: 'linha-campos' }, cCnpj.el, cData.el, cDoc?.el, cValor?.el,
        h('div', {}, h('label', { for: 'data-padrao' }, 'Data para todas as linhas (se não houver coluna de data)'), dataPadrao)),
      h('div', { class: 'acoes' }, bSim, h('button', { class: 'secundario', onclick: () => render(conteudo, ctx) }, 'Trocar arquivo'))));
  }

  montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
    h('label', {}, 'Tipo de arquivo'), cards,
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-erp' }, 'Arquivo (.xlsx ou .csv — o .xlsx malformado do Senior é corrigido automaticamente)'), arquivo),
    bLer));
  montar(conteudo, h('h1', {}, 'Pedidos · Baixados (ERP)'),
    h('p', { class: 'ajuda' }, 'Os arquivos do ERP prevalecem: valem para qualquer cliente da base, inclusive Sem interesse. Tudo entra no histórico de movimentação.'), area);
}
