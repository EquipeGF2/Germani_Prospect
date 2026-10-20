// Conexões com o banco (ADR-0001).
//   bancoApp()   — token do APP embutido no site (permissões restritas)
//   bancoAdmin() — chave de ADMINISTRAÇÃO: aberta do cofre no login do administrador (ADR-0006) ou, em último caso,
//                  colada na tela "Acesso de administração"; fica só nesta aba (sessionStorage)
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
    return db;
  })();
  return demo;
}

async function cliente(token) {
  const { createClient } = await import('../vendor/libsql-web.js');
  return createClient({ url: cfg.tursoUrl, authToken: token });
}

export async function bancoApp() {
  if (modoDemonstracao()) return bancoDemonstracao();
  app ??= await cliente(cfg.tokenApp);
  return app;
}

export function temTokenAdmin() {
  if (modoDemonstracao()) return true;
  try { return Boolean(sessionStorage.getItem(CHAVE_TOKEN)); } catch { return false; }
}

export async function bancoAdmin() {
  if (modoDemonstracao()) return bancoDemonstracao();
  let token = null;
  try { token = sessionStorage.getItem(CHAVE_TOKEN); } catch { /* armazenamento indisponível */ }
  if (!token) throw new ErroAcessoAdmin();
  admin ??= await cliente(token);
  return admin;
}

/** Guarda o token de administração nesta aba depois de conferir que ele conecta. */
export async function definirTokenAdmin(token) {
  const t = String(token ?? '').trim();
  if (!t) throw new Error('informe o token');
  const teste = await cliente(t);
  await teste.execute('SELECT count(*) FROM parametros');
  try { sessionStorage.setItem(CHAVE_TOKEN, t); } catch { throw new Error('o navegador bloqueou o armazenamento da sessão'); }
  admin = teste;
}

/** Chave de administração aberta nesta aba (para trancar no cofre de outro administrador), ou null. */
export function tokenAdminAtual() {
  if (modoDemonstracao()) return null;
  try { return sessionStorage.getItem(CHAVE_TOKEN); } catch { return null; }
}

/** Guarda a chave aberta do cofre no login (sem testar a conexão: o login já falou com o banco). */
export function guardarTokenAdmin(token) {
  try { sessionStorage.setItem(CHAVE_TOKEN, token); } catch { /* sem armazenamento: cai na tela de acesso */ }
  admin = null;
}

export function limparTokenAdmin() {
  try { sessionStorage.removeItem(CHAVE_TOKEN); } catch { /* nada */ }
  admin = null;
}
