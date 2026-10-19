// Conexão com o Turso (libSQL). Credenciais SOMENTE por variável de ambiente:
//   TURSO_DATABASE_URL  libsql://<banco>-<org>.turso.io
//   TURSO_AUTH_TOKEN    token do banco (ver docs/06-operacao.md)
// Localmente vêm do arquivo .env (fora do git); no GitHub Actions vêm dos Secrets.
import { createClient } from '@libsql/client';

export function conectar({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  if (!url) {
    throw new Error('TURSO_DATABASE_URL não definida. Copie .env.example para .env e preencha (docs/06-operacao.md).');
  }
  if (url.startsWith('libsql://') && !authToken) {
    throw new Error('TURSO_AUTH_TOKEN não definida para banco remoto.');
  }
  return createClient({ url, authToken });
}

/** Abre a conexão já com chaves estrangeiras ligadas. */
export async function abrir(opcoes) {
  const db = conectar(opcoes);
  await db.execute('PRAGMA foreign_keys = ON');
  return db;
}

/** Valor de um parâmetro da tabela parametros (inteiro). */
export async function parametroInteiro(db, chave) {
  const r = await db.execute({ sql: 'SELECT valor FROM parametros WHERE chave = ?', args: [chave] });
  if (!r.rows.length) throw new Error(`parâmetro ausente: ${chave}`);
  return Number(r.rows[0].valor);
}
