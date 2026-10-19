// Aplica db/migrations/NNNN_nome.sql em ordem. Migração aplicada nunca é editada:
// se o conteúdo mudar, a execução para (crie uma nova migração).
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PASTA_MIGRACOES = fileURLToPath(new URL('../db/migrations/', import.meta.url));

export async function aplicarMigracoes(db, { pasta = PASTA_MIGRACOES, log = () => {} } = {}) {
  await db.execute(`CREATE TABLE IF NOT EXISTS _migracoes (
    versao TEXT PRIMARY KEY, arquivo TEXT NOT NULL, sha256 TEXT NOT NULL,
    aplicada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const aplicadas = new Map((await db.execute('SELECT versao, sha256 FROM _migracoes')).rows.map((r) => [r.versao, r.sha256]));
  const arquivos = (await readdir(pasta)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const novas = [];
  for (const arquivo of arquivos) {
    const versao = arquivo.slice(0, 4);
    const sql = await readFile(path.join(pasta, arquivo), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    if (aplicadas.has(versao)) {
      if (aplicadas.get(versao) !== sha) throw new Error(`migração ${arquivo} foi alterada depois de aplicada — crie uma nova migração`);
      continue;
    }
    log(`aplicando ${arquivo}…`);
    await db.executeMultiple(sql);
    await db.execute({ sql: 'INSERT INTO _migracoes (versao, arquivo, sha256) VALUES (?, ?, ?)', args: [versao, arquivo, sha] });
    novas.push(arquivo);
  }
  return novas;
}
