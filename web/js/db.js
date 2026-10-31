// Conexões com o banco (ADR-0001).
//   bancoApp()   — token do APP embutido no site (permissões restritas)
//   bancoAdmin() — chave de ADMINISTRAÇÃO: aberta do cofre no login do administrador (ADR-0006) ou, em último caso,
//                  colada na tela "Acesso de administração"; fica neste navegador enquanto durar o login (localStorage) e sai no Sair
// Modo demonstração: banco SQLite temporário no navegador, com a mesma estrutura e regras.
const cfg = window.GERMANI_CONFIG ?? { modo: 'demonstracao' };
const CHAVE_TOKEN = 'germani.tokenAdmin';
let app = null;
let admin = null;
let demo = null;

export const modoDemonstracao = () => cfg.modo === 'demonstracao';
export const configuracao = () => cfg;

export class ErroAcessoAdmin extends Error {
  constructor() { super('informe o token de administração'); this.name = 'ErroAcessoAdmin'; }
}

async function bancoDemonstracao() {
  demo ??= (async () => {
    const { createClient } = await import('../vendor/libsql-wasm.js');
    const db = createClient({ url: 'file::memory:' });
    await db.execute('PRAGMA foreign_keys = ON');
    const lista = await (await fetch('migrations/index.json')).json();
    for (const arquivo of lista) await db.executeMultiple(await (await fetch(`migrations/${arquivo}`)).text());
    const { gerarHashSenha } = await import('../shared/senha.mjs');
    await db.execute({
      sql: `INSERT INTO usuarios (perfil, nome, nome_busca, login, senha_hash, senha_provisoria)
            VALUES ('administrador', 'Administrador (demonstração)', 'ADMINISTRADOR (DEMONSTRACAO)', 'admin', ?, 0)`,
      args: [await gerarHashSenha('demo1234')],
    });
    return comLimpezaDeCache(db);
  })();
  return demo;
}

async function cliente(token) {
  const { createClient } = await import('../vendor/libsql-web.js');
  return comLimpezaDeCache(createClient({ url: cfg.tursoUrl, authToken: token }));
}

// Cache curto de leituras que não mudam a cada clique (Início, listas de supervisores/vendedores/ondas, parâmetros):
// evita ida ao banco (e leitura de linhas no Turso) ao navegar entre as telas. Qualquer gravação feita por este
// aparelho limpa tudo na hora; mudanças de outros usuários aparecem em até `segundos`.
const cache = new Map();
export function limparCache() { cache.clear(); }
export async function lerComCache(db, consulta, segundos = 120) {
  const chave = JSON.stringify(typeof consulta === 'string' ? [consulta] : [consulta.sql, consulta.args ?? []]);
  const item = cache.get(chave);
  if (item && item.ate > Date.now()) return item.valor;
  const valor = db.execute(consulta).then((r) => ({ rows: r.rows, columns: r.columns }));
  cache.set(chave, { ate: Date.now() + segundos * 1000, valor });
  valor.catch(() => cache.delete(chave));
  return valor;
}
/** Só leitura, com cache: para funções de shared/ que recebem `db` e leem dados que mudam pouco (parâmetros, feriados). */
export function leitorComCache(db, segundos = 600) {
  return { execute: (c) => lerComCache(db, c, segundos) };
}
// Falha momentânea de rede/servidor (internet do celular, Turso ocupado): leitura tenta de novo uma vez. Gravação não
// (poderia duplicar) — o erro vai para a tela com o código, e o usuário decide tentar de novo.
const falhaDeRede = (e) => /Failed to fetch|NetworkError|Load failed|network|timed? ?out|ECONNRESET|fetch failed|\b50[234]\b|STREAM_EXPIRED/i
  .test(`${e?.message ?? ''} ${e?.cause?.message ?? ''} ${e?.code ?? ''}`);
function comLimpezaDeCache(db) {
  const leitura = (c) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(typeof c === 'string' ? c : c?.sql ?? '');
  const execute = db.execute.bind(db);
  const batch = db.batch.bind(db);
  const lerDeNovo = async (c, r) => {
    try { return await execute(c, ...r); }
    catch (e) {
      if (!falhaDeRede(e)) throw e;
      await new Promise((ok) => setTimeout(ok, 800));
      return execute(c, ...r);
    }
  };
  db.execute = (c, ...r) => { if (!leitura(c)) { limparCache(); return execute(c, ...r); } return lerDeNovo(c, r); };
  db.batch = (...r) => { limparCache(); return batch(...r); };
  return db;
}

export async function bancoApp() {
  if (modoDemonstracao()) return bancoDemonstracao();
  app ??= await cliente(cfg.tokenApp);
  return app;
}

/** A chave acompanha o login: vale em outra aba e com o navegador reaberto, sem pedir a senha de novo (ADR-0006). */
function lerToken() {
  try { return localStorage.getItem(CHAVE_TOKEN); } catch { return null; }
}

export function temTokenAdmin() {
  if (modoDemonstracao()) return true;
  return Boolean(lerToken());
}

export async function bancoAdmin() {
  if (modoDemonstracao()) return bancoDemonstracao();
  const token = lerToken();
  if (!token) throw new ErroAcessoAdmin();
  admin ??= await cliente(token);
  return admin;
}

/** Chave de administração aberta neste navegador (para trancar no cofre de outro administrador), ou null. */
export function tokenAdminAtual() {
  if (modoDemonstracao()) return null;
  return lerToken();
}

/** Guarda a chave aberta do cofre no login (sem testar a conexão: o login já falou com o banco). */
export function guardarTokenAdmin(token, versao = null) {
  try {
    localStorage.setItem(CHAVE_TOKEN, token);
    if (versao) localStorage.setItem(`${CHAVE_TOKEN}.versao`, String(versao)); else localStorage.removeItem(`${CHAVE_TOKEN}.versao`);
  } catch { /* sem armazenamento: cai na tela de acesso */ }
  admin = null;
}

/** Versão das permissões da chave aberta neste navegador (shared/cofre.mjs), para regravá-la no cofre sem perder a marca. */
export function versaoTokenAdmin() {
  try { return Number(localStorage.getItem(`${CHAVE_TOKEN}.versao`)) || null; } catch { return null; }
}

export function limparTokenAdmin() {
  try { localStorage.removeItem(CHAVE_TOKEN); localStorage.removeItem(`${CHAVE_TOKEN}.versao`); } catch { /* nada */ }
  admin = null;
}
