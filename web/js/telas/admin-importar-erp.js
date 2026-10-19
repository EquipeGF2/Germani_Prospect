import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { importarEventos } from '../../shared/importar-eventos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso } from '../ui.js';
import { blocoResultado } from './_resultado.js';
import { seletorColuna } from './admin-importar-tipos.js';

const TIPOS = {
  cadastro: { titulo: 'Cadastro de clientes (ERP)', efeito: 'CNPJ encontrado → Análise financeira', documento: 'Código do cliente', data: 'Data do cadastro' },
  pedido: { titulo: 'Pedidos (ERP)', efeito: 'CNPJ encontrado → Venda realizada', documento: 'Número do pedido', data: 'Data do pedido' },
  baixa: { titulo: 'CNPJs baixados', efeito: 'CNPJ encontrado → Inválido (congelado)', documento: null, data: 'Data da baixa' },
};
const ETAPAS = ['Tipo e arquivo', 'Colunas', 'Simulação', 'Gravação'];

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  const tipo = h('select', { id: 'tipo-erp' }, Object.entries(TIPOS).map(([v, t]) => h('option', { value: v }, `${t.titulo} — ${t.efeito}`)));
  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-erp' });
  let planilha = null;
  const bLer = h('button', { onclick: async () => { planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0])); if (planilha) colunas(); } }, 'Ler arquivo');

  function colunas() {
    const t = TIPOS[tipo.value];
    const cab = planilha.linhas[0] ?? [];
    const cCnpj = seletorColuna('col-cnpj', 'Coluna do CNPJ', cab, 'CNPJ');
    const cData = seletorColuna('col-data', `Coluna da ${t.data.toLowerCase()}`, cab, 'DATA', { opcional: true });
    const cDoc = t.documento ? seletorColuna('col-doc', `Coluna do ${t.documento.toLowerCase()}`, cab, t.documento, { opcional: tipo.value !== 'pedido' }) : null;
    const dataPadrao = h('input', { id: 'data-padrao', type: 'date', value: hojeSaoPaulo() });
    const parametros = () => ({ tipo: tipo.value, linhas: planilha.linhas, colunas: { cnpj: cCnpj.valor(), data: cData.valor(), documento: cDoc?.valor() ?? null },
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
      h('div', { class: 'linha-campos' }, cCnpj.el, cData.el, cDoc?.el,
        h('div', {}, h('label', { for: 'data-padrao' }, 'Data para todas as linhas (se não houver coluna de data)'), dataPadrao)),
      h('div', { class: 'acoes' }, bSim, h('button', { class: 'secundario', onclick: () => render(conteudo, ctx) }, 'Trocar arquivo'))));
  }

  montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
    h('div', { class: 'campo' }, h('label', { for: 'tipo-erp' }, 'Tipo de arquivo'), tipo),
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-erp' }, 'Arquivo (.xlsx ou .csv — o .xlsx malformado do Senior é corrigido automaticamente)'), arquivo),
    bLer));
  montar(conteudo, h('h1', {}, 'Cadastro · Pedidos · Baixados'),
    h('p', { class: 'ajuda' }, 'Os arquivos do ERP prevalecem: valem para qualquer cliente da base, inclusive Sem interesse. Tudo entra no histórico de movimentação.'), area);
}
