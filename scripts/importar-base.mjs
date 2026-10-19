#!/usr/bin/env node
// Carga inicial da planilha base de prospects.
//   npm run importar:base -- caminho/base.xlsx --listar-status   (mostra os valores de "Status Atual")
//   npm run importar:base -- caminho/base.xlsx --simular         (valida tudo, não grava)
//   npm run importar:base -- caminho/base.xlsx                   (grava)
// Relatório de todas as linhas em relatorios/ (pasta fora do git).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { abrir } from '../lib/db.mjs';
import { carimbo, executor, imprimirResumo, sha256Arquivo } from '../lib/cli.mjs';
import { importarBase } from '../shared/importar-base.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { gravarRelatorioCsv } from '../lib/relatorio.mjs';
import { extrairCampos, linhaVazia, mapearCabecalho, normalizarMapaStatus } from '../shared/importacao-base.mjs';
import { hojeSaoPaulo } from '../shared/datas.mjs';
import { limparTexto, normalizarBusca } from '../shared/texto.mjs';

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    simular: { type: 'boolean', default: false },
    'listar-status': { type: 'boolean', default: false },
    'mapa-status': { type: 'string', default: new URL('../config/mapa-status-planilha.json', import.meta.url).pathname },
    'executado-por': { type: 'string' },
  },
});
const arquivo = positionals[0];
if (!arquivo) {
  console.error('uso: npm run importar:base -- <arquivo.xlsx|.csv> [--simular] [--listar-status]');
  process.exit(1);
}

const planilha = await lerPlanilha(arquivo);
console.log(`Arquivo lido: ${path.basename(arquivo)} (${planilha.observacao}), ${planilha.linhas.length - 1} linhas abaixo do cabeçalho`);

if (op['listar-status']) {
  const mapa = mapearCabecalho(planilha.linhas[0] ?? []);
  const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile(op['mapa-status'], 'utf8')));
  const contagem = new Map();
  for (const l of planilha.linhas.slice(1)) {
    if (linhaVazia(l)) continue;
    const s = limparTexto(extrairCampos(l, mapa.indices).status_planilha) ?? '';
    contagem.set(s, (contagem.get(s) ?? 0) + 1);
  }
  console.log('\nValores de "Status Atual" → mapeamento atual:');
  for (const [s, n] of [...contagem].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${JSON.stringify(s).padEnd(32)} ${String(n).padStart(6)}  → ${mapaStatus[normalizarBusca(s)] ?? 'NÃO MAPEADO (linha será rejeitada)'}`);
  }
  process.exit(0);
}

const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile(op['mapa-status'], 'utf8')));
const db = await abrir();
const { resumo, resultados, importacaoId } = await importarBase(db, {
  linhas: planilha.linhas,
  arquivoNome: path.basename(arquivo),
  arquivoSha256: await sha256Arquivo(arquivo),
  executadoPor: executor(op['executado-por']),
  mapaStatus,
  hoje: hojeSaoPaulo(),
  simular: op.simular,
});
db.close();

const rel = await gravarRelatorioCsv(
  path.join('relatorios', `base-${importacaoId ?? 'simulacao'}-${carimbo()}.csv`),
  ['linha', 'resultado', 'cnpj', 'mensagens'],
  resultados.map((r) => ({ linha: r.numeroLinha, resultado: r.dados ? 'aceita' : 'rejeitada', cnpj: r.dados?.prospect.cnpj ?? r.bruto.cnpj,
    mensagens: (r.dados ? r.avisos : r.erros).join(' | ') })),
);
imprimirResumo(op.simular ? 'SIMULAÇÃO (nada gravado)' : `Importação #${importacaoId} concluída`, resumo);
console.log(`  relatório: ${rel}`);
