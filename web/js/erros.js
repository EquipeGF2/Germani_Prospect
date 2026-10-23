// Erros do app: mostram na tela um código para copiar e ficam registrados no banco (erros_app, 0019) para o
// administrador ver em Administração → Erros do app — o usuário não precisa anotar nada.
// Também cobre o erro de "versão antiga": quando o site é republicado com a tela aberta, o navegador pode misturar
// arquivos novos e antigos; nesse caso a página recarrega sozinha uma vez.
import { bancoApp, configuracao } from './db.js';
import { usuarioAtual } from './sessao.js';
import { h } from './ui.js';

const CHAVE_LOCAL = 'germani.erros';
const CHAVE_RECARGA = 'germani.recarregouVersao';
const enviados = new Map();

/** Erro de módulo de outra versão do site (publicação nova com a página aberta). */
export function ehVersaoAntiga(e) {
  return /dynamically imported module|Importing a module script failed|does not provide an export named|Failed to fetch dynamically/i
    .test(`${e?.message ?? e}`);
}

/** Erro de rede/servidor momentâneo (vale tentar de novo). */
export function ehErroDeRede(e) {
  const t = `${e?.message ?? ''} ${e?.cause?.message ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''}`;
  return /Failed to fetch|NetworkError|Load failed|network|timed? ?out|ECONNRESET|ETIMEDOUT|fetch failed|\b50[234]\b|STREAM_EXPIRED|SERVER_ERROR/i.test(t);
}

/** Recarrega a página uma única vez por sessão quando o erro é de versão antiga. Retorna true se recarregou. */
export function recarregarSeVersaoAntiga(e) {
  if (!ehVersaoAntiga(e)) return false;
  try {
    if (sessionStorage.getItem(CHAVE_RECARGA)) return false;
    sessionStorage.setItem(CHAVE_RECARGA, String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}

/** Tela aberta sem erro: libera uma nova recarga automática para a próxima publicação do site. */
export function telaAbriuSemErro() {
  try { sessionStorage.removeItem(CHAVE_RECARGA); } catch { /* nada */ }
}

/** Erros guardados neste aparelho (os últimos 20). */
export function errosDoAparelho() {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? '[]'); } catch { return []; }
}

/** Código curto para o usuário informar (ex.: E-2610-1432-7F3A): data, hora e um sufixo do texto do erro. */
function codigoDo(registro) {
  let soma = 0;
  for (const c of `${registro.tipo}${registro.mensagem}`) soma = (soma * 31 + c.charCodeAt(0)) >>> 0;
  const d = new Date(registro.quando);
  const dois = (n) => String(n).padStart(2, '0');
  return `E-${dois(d.getDate())}${dois(d.getMonth() + 1)}-${dois(d.getHours())}${dois(d.getMinutes())}-${(soma & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

function montarRegistro(e, contexto = '') {
  const usuario = usuarioAtual();
  const r = {
    quando: new Date().toISOString(),
    usuarioId: usuario?.id ?? null,
    login: usuario?.login ?? null,
    tela: `${location.hash || '#/'}${contexto ? ` · ${contexto}` : ''}`.slice(0, 300),
    versao: configuracao().versao ?? null,
    tipo: String(e?.name ?? typeof e).slice(0, 60),
    mensagem: String(e?.message ?? e ?? 'erro sem mensagem').slice(0, 1000),
    detalhe: [e?.code ? `código: ${e.code}` : null, e?.cause?.message ? `causa: ${e.cause.message}` : null,
      e?.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : null].filter(Boolean).join('\n').slice(0, 4000) || null,
    navegador: String(navigator.userAgent ?? '').slice(0, 300),
    online: navigator.onLine === false ? 0 : 1,
  };
  r.codigo = codigoDo(r);
  return r;
}

function guardarLocal(r) {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? '[]');
    lista.unshift(r);
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista.slice(0, 20)));
  } catch { /* sem armazenamento */ }
}

async function enviar(r) {
  // o mesmo erro, da mesma tela, vai uma vez por minuto (evita repetir quando a tela é aberta várias vezes)
  const chave = `${r.tela}|${r.mensagem}`;
  if (Date.now() - (enviados.get(chave) ?? 0) < 60_000) return;
  enviados.set(chave, Date.now());
  try {
    const db = await bancoApp();
    await db.execute({
      sql: `INSERT INTO erros_app (usuario_id, login, tela, versao, tipo, mensagem, detalhe, navegador, online)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [r.usuarioId, r.login, r.tela, r.versao, r.tipo, r.mensagem, `código do erro: ${r.codigo}${r.detalhe ? `\n${r.detalhe}` : ''}`.slice(0, 4000), r.navegador, r.online],
    });
  } catch { /* sem conexão ou sem permissão: o registro fica no aparelho e o usuário pode copiar os detalhes */ }
}

/** Registra o erro (aparelho + banco) e devolve o registro, com o código para mostrar ao usuário. */
export function registrarErro(e, contexto = '') {
  const r = montarRegistro(e, contexto);
  console.error(e);
  guardarLocal(r);
  enviar(r);
  return r;
}

const textoDetalhes = (r) => [`Código: ${r.codigo}`, `Quando: ${new Date(r.quando).toLocaleString('pt-BR')}`, `Tela: ${r.tela}`,
  `Versão: ${r.versao ?? '—'}`, `Usuário: ${r.login ?? '—'}`, `Erro: ${r.tipo} — ${r.mensagem}`, r.detalhe ? `\n${r.detalhe}` : ''].join('\n');

/** Bloco de erro da tela: mensagem clara, código, "Copiar detalhes" e "Tentar de novo". */
export function painelErro(e, { titulo = 'Não foi possível abrir a tela.', aoTentar = () => location.reload() } = {}) {
  const r = registrarErro(e);
  const rede = ehErroDeRede(e) || navigator.onLine === false;
  const bCopiar = h('button', { class: 'secundario pequeno', onclick: async () => {
    try { await navigator.clipboard.writeText(textoDetalhes(r)); bCopiar.textContent = 'Copiado'; }
    catch { bCopiar.textContent = 'Não deu para copiar — mande um print'; }
  } }, 'Copiar detalhes');
  return h('div', { class: 'mensagem erro painel-erro', role: 'alert' },
    h('b', {}, titulo),
    h('p', { style: 'margin:6px 0' }, rede
      ? 'A conexão com o banco falhou (internet instável ou servidor ocupado). Tente de novo em alguns segundos.'
      : r.mensagem),
    h('p', { class: 'ajuda', style: 'margin:6px 0' }, `Código do erro: ${r.codigo} — já ficou registrado para o administrador.`),
    h('div', { class: 'acoes', style: 'margin:0' },
      h('button', { class: 'pequeno', onclick: aoTentar }, 'Tentar de novo'), bCopiar));
}

/** Captura erros soltos (fora das telas) — também ficam registrados. */
export function capturarErrosGlobais() {
  addEventListener('error', (ev) => { if (ev.error) registrarErro(ev.error, 'erro global'); });
  addEventListener('unhandledrejection', (ev) => {
    if (recarregarSeVersaoAntiga(ev.reason)) return;
    registrarErro(ev.reason, 'promessa sem tratamento');
  });
}
