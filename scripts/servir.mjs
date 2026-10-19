#!/usr/bin/env node
// Servidor estático local para testar o site: npm run servir [-- porta]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = fileURLToPath(new URL('../_site/', import.meta.url));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.sql': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.svg': 'image/svg+xml' };

export function servir(porta = 0) {
  const srv = http.createServer(async (req, res) => {
    try {
      let f = path.join(raiz, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!f.startsWith(raiz)) throw new Error('fora');
      if ((await stat(f)).isDirectory()) f = path.join(f, 'index.html');
      const dados = await readFile(f);
      res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(dados);
    } catch {
      res.writeHead(404);
      res.end('não encontrado');
    }
  });
  return new Promise((ok) => srv.listen(porta, () => ok(srv)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = await servir(Number(process.argv[2] ?? 8080));
  console.log(`Site em http://localhost:${srv.address().port}/`);
}
