// Peças comuns das telas de carteira (lista, ficha, registro).
import { h, selo } from '../ui.js';

const CHAVE_LOTE = 'germani.lote';

export function seloStatus(p) {
  const el = selo(p.status_nome ?? p.rotulo ?? p.status_atual, 'status');
  el.style.background = p.status_cor ?? '#EEE';
  el.style.color = ['nao_contactado', 'invalido'].includes(p.status_atual) ? '#1C1F23' : '#fff';
  return el;
}

/** Barra de navegação de quem trabalha a carteira. */
export function abasCarteira(ativa, usuario) {
  const itens = [['/inicio', 'Início'], ['/carteira', 'Lista principal'], ['/carteira?aba=acompanhamento', 'Acompanhamento']];
  if (usuario.perfil === 'administrador') itens.push(['/admin', 'Administração']);
  return h('nav', { class: 'abas' }, itens.map(([c, t]) => h('a', { href: `#${c}`, class: c === ativa ? 'ativa' : '' }, t)));
}

// Seleção para registro em lote — fica só nesta aba do navegador.
export function lerLote() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_LOTE)) ?? []; } catch { return []; }
}
export function gravarLote(ids) {
  try { sessionStorage.setItem(CHAVE_LOTE, JSON.stringify([...new Set(ids)])); } catch { /* sem armazenamento: lote some ao sair */ }
}
