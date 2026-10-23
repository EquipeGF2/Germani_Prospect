// Peças comuns das telas de carteira (lista, ficha, registro).
import { h, selo } from '../ui.js';
import { ORDENACOES } from '../../shared/carteira.mjs';
import { consultaResumo, opcoesEmCascata } from '../../shared/explorar.mjs';
import { lerComCache } from '../db.js';

const FILTROS = ['cidadeBusca', 'uf', 'bairroBusca', 'onda', 'segmento', 'rota', 'subrota', 'status', 'supervisorId', 'vendedorId', 'somenteRetornos', 'dataDe', 'dataAte'];

const CHAVE_LOTE = 'germani.lote';

/** Nome do status para mostrar: "Sem interesse · cliente" / "Sem interesse · representante" (origem do motivo, migração 0015). */
export const nomeStatus = (p) => {
  const nome = p.status_nome ?? p.rotulo ?? p.status_atual;
  return p.status_atual === 'sem_interesse' && p.sem_interesse_origem ? `${nome} · ${p.sem_interesse_origem}` : nome;
};

export function seloStatus(p) {
  const el = selo(nomeStatus(p), 'status');
  el.style.background = p.status_cor ?? '#EEE';
  el.style.color = ['nao_contactado', 'invalido'].includes(p.status_atual) ? '#1C1F23' : '#fff';
  return el;
}

// Seleção para registro em lote — fica só nesta aba do navegador.
export function lerLote() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_LOTE)) ?? []; } catch { return []; }
}
export function gravarLote(ids) {
  try { sessionStorage.setItem(CHAVE_LOTE, JSON.stringify([...new Set(ids)])); } catch { /* sem armazenamento: lote some ao sair */ }
}

/** Estado da Lista principal / Acompanhamento a partir do endereço (#/carteira?…). */
export function lerEstado(parametros) {
  const e = { aba: parametros.get('aba') === 'acompanhamento' ? 'acompanhamento' : 'principal', visao: parametros.get('visao') ?? '',
    busca: parametros.get('busca') ?? '', pagina: Math.max(0, Number(parametros.get('pagina')) || 0), filtros: {},
    ordem: ORDENACOES[parametros.get('ordem')] ? parametros.get('ordem') : '', desc: parametros.get('dir') === 'desc',
    agrupar: parametros.get('agrupar') ?? '', periodo: parametros.get('periodo') ?? '', ver: parametros.get('ver') === '1',
    de: parametros.get('de') === 'explorar' ? 'explorar' : '' };
  for (const f of FILTROS) if (parametros.get(f)) e.filtros[f] = parametros.get(f);
  if (e.filtros.vendedorId) e.filtros.vendedorId = Number(e.filtros.vendedorId);
  if (e.filtros.supervisorId) e.filtros.supervisorId = Number(e.filtros.supervisorId);
  if (e.filtros.somenteRetornos) e.filtros.somenteRetornos = true;
  e.visao ||= e.aba === 'acompanhamento' && !e.filtros.status ? 'status' : 'lista';
  return e;
}

export function endereco(e, muda = {}) {
  const n = { ...e, ...muda, filtros: { ...e.filtros, ...(muda.filtros ?? {}) } };
  const q = new URLSearchParams();
  if (n.aba === 'acompanhamento') q.set('aba', 'acompanhamento');
  if (n.visao && n.visao !== 'lista') q.set('visao', n.visao);
  if (n.busca) q.set('busca', n.busca);
  if (n.agrupar) q.set('agrupar', n.agrupar);
  if (n.periodo) q.set('periodo', n.periodo);
  if (n.ver) q.set('ver', '1');
  if (n.de) q.set('de', n.de);   // veio do Explorar: o ramo dispensa supervisor e representante (faltaParaLista)
  for (const [k, v] of Object.entries(n.filtros)) if (v != null && v !== '' && v !== false) q.set(k, v === true ? '1' : v);
  if (n.ordem) { q.set('ordem', n.ordem); if (n.desc) q.set('dir', 'desc'); }
  if (n.pagina) q.set('pagina', n.pagina);
  const s = q.toString();
  return `#/carteira${s ? '?' + s : ''}`;
}



// Opções dos filtros em cascata: vêm do resumo pronto (resumo_carteira, o mesmo do Explorar e em cache), nunca da
// carteira inteira — cada filtro mostra só o que existe com os outros escolhidos (shared/explorar.mjs).
export async function opcoesDosFiltros(db, usuario, filtros) {
  const linhas = (await lerComCache(db, consultaResumo({ usuario }), 300)).rows;
  return opcoesEmCascata(linhas, filtros);
}

export const papelDoAgente = (v) => (v.perfil === 'supervisor' ? 'Supervisor' : v.tipo_atuacao === 'vendedor' ? 'Vendedor' : 'Representante');

