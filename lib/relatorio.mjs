// Relatório de linhas (CSV ";" com BOM, abre direto no Excel). Pasta relatorios/ fica fora do git.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function gravarRelatorioCsv(caminho, colunas, linhas) {
  await mkdir(path.dirname(caminho), { recursive: true });
  const corpo = [colunas.map(esc).join(';'), ...linhas.map((l) => colunas.map((c) => esc(l[c])).join(';'))].join('\r\n');
  await writeFile(caminho, '﻿' + corpo + '\r\n', 'utf8');
  return caminho;
}
