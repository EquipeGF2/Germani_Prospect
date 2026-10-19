import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { importarTipos } from '../../shared/importar-tipos.mjs';
import { chaveCabecalho } from '../../shared/texto.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso } from '../ui.js';
import { abasAdmin } from './_admin.js';
import { blocoResultado } from './_resultado.js';

const ETAPAS = ['Arquivo', 'Colunas', 'Simulação', 'Gravação'];

export function seletorColuna(id, rotulo, cabecalho, padrao, { opcional = false } = {}) {
  const sel = h('select', { id }, opcional ? h('option', { value: '' }, '— não tem —') : null,
    cabecalho.map((c) => String(c ?? '')).filter(Boolean).map((c) => h('option', { value: c, selected: chaveCabecalho(c) === chaveCabecalho(padrao) }, c)));
  return { el: h('div', {}, h('label', { for: id }, rotulo), sel), valor: () => sel.value || null };
}

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  let planilha = null;
  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-tipos' });
  const bLer = h('button', { onclick: async () => { planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0])); if (planilha) colunas(); } }, 'Ler arquivo');
  let cCod; let cTipo;

  const paraTela = (rs) => rs.map((r) => ({ numeroLinha: r.numeroLinha, resultado: r.resultado, cnpj: null, mensagens: r.mensagens }));
  const parametros = () => ({ linhas: planilha.linhas, colunas: { codigo: cCod.valor(), tipo: cTipo.valor() }, arquivoNome: planilha.nome, arquivoSha256: planilha.sha256, executadoPor: ctx.usuario.login });

  function colunas() {
    const cab = planilha.linhas[0] ?? [];
    cCod = seletorColuna('col-cod', 'Coluna do código do representante/vendedor', cab, 'COD');
    cTipo = seletorColuna('col-tipo', 'Coluna do tipo (REPRESENTANTE / VENDEDOR)', cab, 'TIPO');
    const bSim = h('button', { onclick: async () => {
      const r = await comEspera(bSim, () => importarTipos(db, { ...parametros(), simular: true }));
      if (!r) return;
      const bGravar = h('button', { onclick: async () => {
        const g = await comEspera(bGravar, () => importarTipos(db, parametros()));
        if (!g) return;
        aviso('Lista gravada.');
        montar(area, passos(ETAPAS, 4), blocoResultado({ titulo: `Importação nº ${g.importacaoId}`, resumo: g.resumo, resultados: paraTela(g.resultados), nomeRelatorio: `importacao-${g.importacaoId}-tipos.csv` }),
          g.resumo.semTipoDefinido ? mensagem(`${g.resumo.semTipoDefinido} representante(s)/vendedor(es) continuam sem tipo — tratados como representante (sem rota).`, 'info') : null);
      } }, 'Confirmar e gravar');
      montar(area, passos(ETAPAS, 2), blocoResultado({ titulo: 'Resultado da simulação', resumo: r.resumo, resultados: paraTela(r.resultados), nomeRelatorio: `simulacao-tipos-${hojeSaoPaulo()}.csv` }),
        h('div', { class: 'acoes' }, bGravar, h('button', { class: 'secundario', onclick: colunas }, 'Voltar')));
    } }, 'Simular');
    montar(area, passos(ETAPAS, 1), h('div', { class: 'cartao' }, h('p', {}, `${planilha.nome} · ${planilha.observacao}`),
      h('div', { class: 'linha-campos' }, cCod.el, cTipo.el), h('div', { class: 'acoes' }, bSim)));
  }

  montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-tipos' }, 'Lista (.xlsx ou .csv)'), arquivo),
    h('p', { class: 'ajuda' }, 'Duas colunas bastam: o código (o mesmo COD da planilha base) e o tipo. Aceita REPRESENTANTE, REP, RCA · VENDEDOR, VENDEDOR INTERNO, INTERNO. Também dá para ajustar um a um na tela de Usuários.'),
    bLer));
  montar(conteudo, abasAdmin('/admin/importar/tipos'), h('h1', {}, 'Representantes e vendedores'),
    h('p', { class: 'ajuda' }, 'Representante: lista, cidade, bairro, onda e status — sem rota. Vendedor: o mesmo + rota/subrota e montagem de rotas.'), area);
}
