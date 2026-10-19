// Utilitários de tela. Todo texto vai por textContent (nunca innerHTML com dado do banco).
import { formatarCnpj } from '../shared/cnpj.mjs';
import { formatarDataBr } from '../shared/datas.mjs';

export function h(tag, atributos = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dados') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

export function montar(destino, ...nos) {
  destino.replaceChildren(...nos.flat(Infinity).filter(Boolean));
}

export function aviso(texto, tipo = 'ok') {
  const el = h('div', { class: `aviso ${tipo}` }, texto);
  document.getElementById('avisos').append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 3500);
}

export function mensagem(texto, tipo = 'info') {
  return h('div', { class: `mensagem ${tipo}` }, texto);
}

export const formatar = {
  data: (v) => (v ? formatarDataBr(String(v)) : ''),
  dataHora: (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''),
  cnpj: (v) => (v ? formatarCnpj(String(v)) : ''),
  numero: (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR')),
  moeda: (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })),
};

/**
 * Tabela simples. colunas: [{ titulo, campo | valor(linha) → texto/Node, classe }]
 */
export function tabela(colunas, linhas, { vazio = 'Nenhum registro.' } = {}) {
  if (!linhas.length) return h('p', { class: 'ajuda' }, vazio);
  return h('div', { class: 'tabela-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { class: c.classe }, c.titulo)))),
      h('tbody', {}, linhas.map((l) => h('tr', {}, colunas.map((c) => h('td', { class: c.classe }, c.valor ? c.valor(l) : l[c.campo] ?? '')))))));
}

export function numeros(itens) {
  return h('div', { class: 'numeros' }, itens.map(([rotulo, valor, tipo]) => h('div', { class: `numero ${tipo ?? ''}` }, h('b', {}, formatar.numero(valor)), h('span', {}, rotulo))));
}

export function selo(texto, classe = '') {
  return h('span', { class: `selo ${classe}` }, texto);
}

export function passos(lista, atual) {
  return h('div', { class: 'passos' }, lista.map((p, i) => h('span', { class: i < atual ? 'feito' : i === atual ? 'atual' : '' }, `${i + 1}. ${p}`)));
}

/** Baixa um CSV (";" e BOM — abre direto no Excel). */
export function baixarCsv(nomeArquivo, colunas, linhas) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const corpo = [colunas.map((c) => esc(c.titulo)).join(';'), ...linhas.map((l) => colunas.map((c) => esc(c.texto ? c.texto(l) : l[c.campo])).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + corpo + '\r\n'], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: nomeArquivo });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Executa uma ação de botão mostrando "aguarde" e tratando erro. */
export async function comEspera(botao, fn) {
  const texto = botao?.textContent;
  if (botao) { botao.disabled = true; botao.textContent = 'Aguarde…'; }
  try { return await fn(); }
  catch (e) { console.error(e); aviso(e.message ?? String(e), 'erro'); return undefined; }
  finally { if (botao) { botao.disabled = false; botao.textContent = texto; } }
}
