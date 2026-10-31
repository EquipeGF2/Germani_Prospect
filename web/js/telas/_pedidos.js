// Peças comuns das telas de pedidos: tabela no padrão (rótulo centralizado, texto à esquerda, número centralizado) e cards numa linha.
import { h, formatar, montar, selo } from '../ui.js';
import { lerComCache } from '../db.js';
import { comVersaoPedidos, consultaVersaoPedidos } from '../../shared/pedidos.mjs';
import { formatarCnpj } from '../../shared/cnpj.mjs';

// Leitura dos pedidos sem repetir: enquanto não houver arquivo novo, navegar entre as telas usa o que já foi lido nesta aba.
// Mudança de carteira ou de cadastro aparece em até 30 minutos; gravação feita neste aparelho limpa o cache na hora.
export async function lerPedidos(db, consulta) {
  const versao = (await lerComCache(db, consultaVersaoPedidos(), 30)).rows[0];
  return lerComCache(db, comVersaoPedidos(consulta, { ultima: Number(versao?.ultima ?? 0), apagadas: Number(versao?.apagadas ?? 0) }), 1800);
}

export const moeda = (v) => formatar.moeda(Number(v ?? 0));
export const valor = (v) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function cartoes(itens) {
  return h('div', { class: 'ped-kpis' }, itens.map(([rotulo, numero, detalhe, classe]) =>
    h('div', { class: `ped-kpi ${classe ?? ''}` }, h('span', {}, rotulo), h('b', {}, numero), detalhe ? h('span', {}, detalhe) : null)));
}

const raizFormatada = (r) => `raiz ${r.slice(0, 2)}.${r.slice(2, 5)}.${r.slice(5, 8)}`;
export const documento = (d) => (!d ? '' : String(d).length === 11 ? 'CPF' : String(d).length === 8 ? raizFormatada(String(d)) : formatarCnpj(String(d)));

// Chave "Ver por Empresa | Ver por Grupo" (Explorar pedidos e Acompanhamento): a escolha fica guardada no navegador
const CHAVE_VER_POR = 'germani.verPor';
export function lerVerPor() { try { return localStorage.getItem(CHAVE_VER_POR) === 'grupo' ? 'grupo' : 'empresa'; } catch { return 'empresa'; } }
export function chaveVerPor(atual, aoMudar) {
  const caixa = h('div', { class: 'ped-chave', role: 'group', 'aria-label': 'Ver por' });
  const desenhar = (valor) => montar(caixa, [['empresa', 'Ver por Empresa'], ['grupo', 'Ver por Grupo']].map(([v, t]) =>
    h('button', { type: 'button', id: `ver-${v}`, class: v === valor ? 'ativa' : '', 'aria-pressed': v === valor ? 'true' : 'false',
      onclick: () => { try { localStorage.setItem(CHAVE_VER_POR, v); } catch { /* só nesta visita */ } desenhar(v); aoMudar(v); } }, t)));
  desenhar(atual);
  return caixa;
}

/** "6199 - Razão social", com o CNPJ na linha de baixo. */
export function razaoSocial({ codigo, razao, doc, prospectId = null }) {
  const titulo = codigo == null ? razao ?? '' : `${codigo} - ${razao ?? ''}`;
  return [prospectId ? h('a', { href: `#/ficha?id=${prospectId}` }, titulo) : titulo, h('span', { class: 'doc' }, documento(doc))];
}

const SELO_FASE = { digitado: 'alerta', carteira: '', parcial: 'ok', faturado: 'ok', cancelado: 'erro' };
export const seloSituacao = (p) => selo(p.situacao_descricao, SELO_FASE[p.fase] ?? '');
export const RELACAO = { propria: ['Na lista', 'ok'], outra: ['Fora da lista', ''] };
export const seloRelacao = (r) => selo(...(RELACAO[r] ?? ['—', '']));
/** Na lista? do pedido: o de filial fora da base não tem lista própria. */
export const seloDoPedido = (p) => (p.prospect_id === null ? selo('Filial do grupo', 'alerta') : seloRelacao(p.relacao));

/** Tabela: colunas [{ titulo, valor(l) | campo, classe: 'num' | 'cen' }]; `rodape`: células do tfoot. */
export function tabelaPedidos(colunas, linhas, { vazio = 'Nenhum registro.', rodape = null, fixa = null, id = null } = {}) {
  if (!linhas.length) return h('p', { class: 'ajuda' }, vazio);
  return h('div', { class: 'tabela-wrap' }, h('table', { class: `ped-tabela ${fixa ? 'ped-fixa' : ''}`, id },
    fixa ? h('colgroup', {}, fixa.map((w) => h('col', { style: `width:${w}%` }))) : null,
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', {}, c.titulo)))),
    h('tbody', {}, linhas.map((l) => l.linhaGrupo ? h('tr', { class: 'ped-grupo' }, h('td', { colspan: String(colunas.length) }, l.linhaGrupo))
      : h('tr', {}, colunas.map((c) => h('td', { class: c.classe }, c.valor ? c.valor(l) : l[c.campo] ?? ''))))),
    rodape ? h('tfoot', {}, h('tr', {}, rodape.map((c) => (c && typeof c === 'object' && !(c instanceof Node) ? h('td', { class: c.classe, colspan: c.colspan }, c.texto) : h('td', { class: 'num' }, c ?? ''))))) : null));
}
