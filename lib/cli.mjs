// Utilidades comuns aos scripts de linha de comando.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

export async function sha256Arquivo(caminho) {
  return createHash('sha256').update(await readFile(caminho)).digest('hex');
}

export function executor(valor) {
  return valor || process.env.GERMANI_EXECUTADO_POR || os.userInfo().username || 'admin';
}

export function carimbo() {
  return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
}

export function imprimirResumo(titulo, resumo) {
  console.log(`\n${titulo}`);
  for (const [k, v] of Object.entries(resumo)) {
    if (Array.isArray(v)) { if (v.length) console.log(`  ${k}: ${v.join(', ')}`); }
    else console.log(`  ${k}: ${v}`);
  }
}
