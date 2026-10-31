// Peças comuns das telas de pedidos: tabela no padrão (rótulo centralizado, texto à esquerda, número centralizado) e cards numa linha.
import { h, formatar, selo } from '../ui.js';
import { formatarCnpj } from '../../shared/cnpj.mjs';

export const moeda = (v) => formatar.moeda(Number(v ?? 0));
export const valor = (v) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function cartoes(itens) {
  return h('div', { class: 'ped-kpis' }, itens.map(([rotulo, numero, detalhe, classe]) =>
    h('div', { class: `ped-kpi ${classe ?? ''}` }, h('span', {}, rotulo), h('b', {}, numero), detalhe ? h('span', {}, detalhe) : null)));
}

export const documento = (d) => (!d ? '' : String(d).length === 11 ? 'CPF' : formatarCnpj(String(d)));

/** "6199 - Razão social", com o CNPJ na linha de baixo. */
export function razaoSocial({ codigo, razao, doc, prospectId = null }) {
  const titulo = `${codigo ?? '—'} - ${razao ?? ''}`;
  return [prospectId ? h('a', { href: `#/ficha?id=${prospectId}` }, titulo) : titulo, h('span', { class: 'doc' }, documento(doc))];
}

const SELO_FASE = { digitado: 'alerta', carteira: '', parcial: 'ok', faturado: 'ok', cancelado: 'erro' };
export const seloSituacao = (p) => selo(p.situacao_descricao, SELO_FASE[p.fase] ?? '');
export const RELACAO = { propria: ['Na lista', 'ok'], outra: ['Fora da lista', ''] };
export const seloRelacao = (r) => selo(...(RELACAO[r] ?? ['—', '']));

/** Tabela: colunas [{ titulo, valor(l) | campo, classe: 'num' | 'cen' }]; `rodape`: células do tfoot. */
export function tabelaPedidos(colunas, linhas, { vazio = 'Nenhum registro.', rodape = null, fixa = null, id = null } = {}) {
  if (!linhas.length) return h('p', { class: 'ajuda' }, vazio);
  return h('div', { class: 'tabela-wrap' }, h('table', { class: `ped-tabela ${fixa ? 'ped-fixa' : ''}`, id },
    fixa ? h('colgroup', {}, fixa.map((w) => h('col', { style: `width:${w}%` }))) : null,
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', {}, c.titulo)))),
    h('tbody', {}, linhas.map((l) => h('tr', {}, colunas.map((c) => h('td', { class: c.classe }, c.valor ? c.valor(l) : l[c.campo] ?? ''))))),
    rodape ? h('tfoot', {}, h('tr', {}, rodape.map((c) => (c && typeof c === 'object' && !(c instanceof Node) ? h('td', { class: c.classe, colspan: c.colspan }, c.texto) : h('td', { class: 'num' }, c ?? ''))))) : null));
}
