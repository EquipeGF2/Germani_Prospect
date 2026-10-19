// Bloco de resultado de importação (simulação ou gravação), comum às três telas.
import { h, numeros, tabela, baixarCsv, selo, formatar } from '../ui.js';

/** resultados: [{ numeroLinha, resultado: aceita|rejeitada|ignorada, cnpj, mensagens: string[] }] */
export function blocoResultado({ titulo, resumo, resultados, nomeRelatorio }) {
  const comMensagem = resultados.filter((r) => r.resultado !== 'aceita' || r.mensagens.length);
  const colunas = [
    { titulo: 'Linha', campo: 'numeroLinha', classe: 'num', texto: (r) => r.numeroLinha },
    { titulo: 'Resultado', valor: (r) => selo(r.resultado, r.resultado), texto: (r) => r.resultado },
    { titulo: 'CNPJ', valor: (r) => (r.cnpj && String(r.cnpj).length === 14 ? formatar.cnpj(r.cnpj) : r.cnpj ?? ''), texto: (r) => r.cnpj ?? '' },
    { titulo: 'Mensagens', valor: (r) => r.mensagens.join(' | '), texto: (r) => r.mensagens.join(' | ') },
  ];
  return h('div', { class: 'cartao' },
    h('h2', {}, titulo),
    numeros([['linhas lidas', resumo.linhasLidas], ['aceitas', resumo.aceitas ?? resumo.linhasLidas - resumo.rejeitadas - (resumo.ignoradas ?? 0), 'ok'],
      ['rejeitadas', resumo.rejeitadas, resumo.rejeitadas ? 'erro' : ''], ...(resumo.ignoradas != null ? [['ignoradas', resumo.ignoradas]] : []),
      ['linhas vazias (fora da conta)', resumo.linhasVazias ?? 0]]),
    h('p', { class: 'ajuda' }, 'Aceitas + rejeitadas' + (resumo.ignoradas != null ? ' + ignoradas' : '') + ' = linhas lidas. Nenhuma linha é descartada em silêncio.'),
    h('div', { class: 'acoes', style: 'margin:0 0 12px' },
      h('button', { class: 'secundario pequeno', onclick: () => baixarCsv(nomeRelatorio, colunas, resultados) }, 'Baixar relatório completo (CSV)')),
    comMensagem.length ? h('div', {}, h('h3', {}, `Linhas com observação (${comMensagem.length}${comMensagem.length > 300 ? ', mostrando 300' : ''})`),
      tabela(colunas, comMensagem.slice(0, 300))) : h('p', { class: 'ajuda' }, 'Nenhuma linha com erro ou aviso.'));
}
