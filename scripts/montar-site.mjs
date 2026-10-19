#!/usr/bin/env node
// Monta o site estático em _site/ (publicado no GitHub Pages pelo workflow pages.yml).
//   npm run site                         → modo demonstração se não houver token do app
// Variáveis: TURSO_DATABASE_URL, TURSO_APP_TOKEN (token do APP, permissões restritas — ADR-0001),
//            GERMANI_MODO = producao | demonstracao (opcional; padrão: producao se houver token)
// O token de ADMINISTRAÇÃO nunca entra aqui: é digitado na tela pelo administrador.
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const destino = path.join(raiz, '_site');
const de = (...p) => path.join(raiz, ...p);

await rm(destino, { recursive: true, force: true });
await mkdir(path.join(destino, 'vendor'), { recursive: true });
await cp(de('web'), destino, { recursive: true });
await cp(de('shared'), path.join(destino, 'shared'), { recursive: true });
await cp(de('config'), path.join(destino, 'config'), { recursive: true });
await cp(de('db', 'migrations'), path.join(destino, 'migrations'), { recursive: true });
const migracoes = (await readdir(de('db', 'migrations'))).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
await writeFile(path.join(destino, 'migrations', 'index.json'), JSON.stringify(migracoes));
await mkdir(path.join(destino, 'exemplos'), { recursive: true });
await cp(de('exemplos', 'base-ficticia.xlsx'), path.join(destino, 'exemplos', 'base-ficticia.xlsx'));

// bibliotecas do navegador (versões travadas no package-lock.json)
const comum = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'warning' };
await build({ ...comum, stdin: { contents: "export { createClient } from '@libsql/client/web';", resolveDir: raiz }, outfile: path.join(destino, 'vendor', 'libsql-web.js') });
await build({ ...comum, stdin: { contents: "export { createClient } from '@libsql/client-wasm';", resolveDir: raiz }, outfile: path.join(destino, 'vendor', 'libsql-wasm.js') });
await cp(de('node_modules', '@libsql', 'client-wasm', 'node_modules', '@libsql', 'libsql-wasm-experimental', 'sqlite-wasm', 'jswasm', 'sqlite3.wasm'),
  path.join(destino, 'vendor', 'sqlite3.wasm'));
await cp(de('node_modules', 'exceljs', 'dist', 'exceljs.min.js'), path.join(destino, 'vendor', 'exceljs.min.js'));
await cp(de('node_modules', 'jszip', 'dist', 'jszip.min.js'), path.join(destino, 'vendor', 'jszip.min.js'));

const token = process.env.TURSO_APP_TOKEN ?? '';
const modo = process.env.GERMANI_MODO || (token ? 'producao' : 'demonstracao');
if (modo === 'producao' && (!process.env.TURSO_DATABASE_URL || !token)) {
  throw new Error('modo produção exige TURSO_DATABASE_URL e TURSO_APP_TOKEN');
}
const config = { modo, tursoUrl: modo === 'producao' ? process.env.TURSO_DATABASE_URL : null, tokenApp: modo === 'producao' ? token : null,
  versao: process.env.GITHUB_SHA?.slice(0, 7) ?? 'local', geradoEm: new Date().toISOString() };
await writeFile(path.join(destino, 'config.js'), `window.GERMANI_CONFIG = ${JSON.stringify(config)};\n`);
await writeFile(path.join(destino, '.nojekyll'), '');
console.log(`Site montado em _site/ (modo ${modo}).`);
