import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { COLUNAS_CREDITO, contarFormas, importarCredito, mapearColunasCredito } from '../../shared/importar-credito.mjs';
import { FORMAS_PAGAMENTO } from '../../shared/financeiro.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso, tabela, formatar } from '../ui.js';
import { blocoResultado } from './_resultado.js';

const ETAPAS = ['Arquivo', 'Colunas e formas de pagamento', 'Simulação', 'Gravação'];

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  let planilha = null;
  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-credito' });
  const bLer = h('button', { onclick: async () => { planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0])); if (planilha) configurar(); } }, 'Ler arquivo');

  function configurar() {
    const cab = (planilha.linhas[0] ?? []).map((c) => String(c ?? '')).filter(Boolean);
    const auto = mapearColunasCredito(planilha.linhas[0] ?? []).indices;
    const seletores = {};
    for (const c of COLUNAS_CREDITO) {
      const atual = auto[c.campo] !== undefined ? String(planilha.linhas[0][auto[c.campo]]) : '';
      seletores[c.campo] = h('select', { id: `col-${c.campo}` }, c.obrigatoria ? null : h('option', { value: '' }, '— não tem —'),
        cab.map((t) => h('option', { value: t, selected: t === atual }, t)));
    }
    const colunas = () => Object.fromEntries(Object.entries(seletores).map(([k, s]) => [k, s.value || null]));
    const areaFormas = h('div');
    let mapa = {};
    function desenharFormas() {
      const { indices, faltando } = mapearColunasCredito(planilha.linhas[0] ?? [], colunas());
      if (faltando.length) return montar(areaFormas, mensagem(`Escolha as colunas obrigatórias: ${faltando.join(', ')}`, 'erro'));
      const formas = contarFormas(planilha.linhas, indices);
      mapa = Object.fromEntries(formas.map((f) => [f.chave, mapa[f.chave] ?? f.sugerida]));
      montar(areaFormas, h('h3', {}, 'Como tratar cada forma de pagamento do arquivo'),
        tabela([
          { titulo: 'Valor no arquivo', valor: (f) => f.valor || '(vazio)' },
          { titulo: 'Linhas', valor: (f) => formatar.numero(f.quantidade), classe: 'num' },
          { titulo: 'Tratar como', valor: (f) => h('select', { 'aria-label': `forma ${f.valor}`, onchange: (ev) => { mapa[f.chave] = ev.target.value; } },
            h('option', { value: '', selected: !mapa[f.chave] }, '— rejeitar estas linhas —'),
            Object.entries(FORMAS_PAGAMENTO).map(([v, t]) => h('option', { value: v, selected: mapa[f.chave] === v }, t))) },
        ], formas));
    }
    Object.values(seletores).forEach((s) => s.addEventListener('change', desenharFormas));
    const parametros = () => ({ linhas: planilha.linhas, colunas: colunas(), mapaFormas: Object.fromEntries(Object.entries(mapa).filter(([, v]) => v)),
      hoje: hojeSaoPaulo(), arquivoNome: planilha.nome, arquivoSha256: planilha.sha256, executadoPor: ctx.usuario.login });
    const paraTela = (rs) => rs.map((r) => ({ numeroLinha: r.numeroLinha, resultado: r.resultado, cnpj: r.cnpj, mensagens: r.resultado === 'aceita' ? r.avisos : r.erros }));
    const bSim = h('button', { onclick: async () => {
      const r = await comEspera(bSim, () => importarCredito(db, { ...parametros(), simular: true }));
      if (!r) return;
      const bGravar = h('button', { onclick: async () => {
        const g = await comEspera(bGravar, () => importarCredito(db, parametros()));
        if (!g) return;
        aviso('Relatório de crédito importado.');
        montar(area, passos(ETAPAS, 4),
          mensagem(`Importação nº ${g.importacaoId}: ${g.resumo.aceitas} cliente(s) passaram para Aguardando pedido${g.resumo.cadastrosRegistrados ? ` (${g.resumo.cadastrosRegistrados} com o cadastro registrado pelo próprio relatório)` : ''}.`, 'ok'),
          blocoResultado({ titulo: `Importação nº ${g.importacaoId}`, resumo: g.resumo, resultados: paraTela(g.resultados), nomeRelatorio: `importacao-${g.importacaoId}-credito.csv` }));
      } }, 'Confirmar e gravar');
      montar(area, passos(ETAPAS, 2),
        mensagem(`Simulação: ${r.resumo.aceitas} liberação(ões) de crédito${r.resumo.cadastrosRegistrados ? `, ${r.resumo.cadastrosRegistrados} com cadastro registrado pelo relatório` : ''}. "Ignoradas" = fora da base, venda já realizada ou crédito igual ao já registrado.`, 'info'),
        blocoResultado({ titulo: 'Resultado da simulação', resumo: r.resumo, resultados: paraTela(r.resultados), nomeRelatorio: `simulacao-credito-${hojeSaoPaulo()}.csv` }),
        h('div', { class: 'acoes' }, bGravar, h('button', { class: 'secundario', onclick: configurar }, 'Voltar')));
    } }, 'Simular');
    montar(area, passos(ETAPAS, 1), h('div', { class: 'cartao' },
      h('p', {}, `${planilha.nome} · ${planilha.observacao}`),
      h('div', { class: 'linha-campos' }, COLUNAS_CREDITO.map((c) => h('div', {}, h('label', { for: `col-${c.campo}` }, c.cabecalho + (c.obrigatoria ? ' *' : '')), seletores[c.campo]))),
      areaFormas, h('div', { class: 'acoes' }, bSim, h('button', { class: 'secundario', onclick: () => render(conteudo, ctx) }, 'Trocar arquivo'))));
    desenharFormas();
  }

  montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-credito' }, 'Relatório de crédito (.xlsx ou .csv)'), arquivo),
    h('p', { class: 'ajuda' }, 'Colunas: CNPJ · Cód interno · Razão social · Forma de pagamento · Prazo de pagamento (dias) · Limite de crédito CNPJ · Limite de crédito grupo · Data de cadastro.'),
    bLer));
  montar(conteudo, h('h1', {}, 'Relatório de crédito'),
    h('p', { class: 'ajuda' }, 'Conclui a análise financeira: o cliente passa para Aguardando pedido. Limite: vale o do CNPJ; se estiver vazio, o do grupo. Cliente ainda sem cadastro tem o cadastro registrado pelo próprio relatório (data de cadastro e cód. interno). O console do analista continua disponível para casos pontuais.'),
    area);
}
