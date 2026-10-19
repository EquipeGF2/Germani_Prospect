#!/usr/bin/env node
// Lista de quem é REPRESENTANTE (sem rota) e quem é VENDEDOR (com rota).
//   npm run importar:tipos -- tipos.xlsx [--col-codigo COD] [--col-tipo TIPO] [--simular]
// Arquivo mínimo: uma coluna com o código do representante/vendedor (o mesmo COD da planilha base)
// e uma coluna com REPRESENTANTE ou VENDEDOR. Outras colunas (ex.: NOME) são ignoradas.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { abrir } from '../lib/db.mjs';
import { carimbo, executor, imprimirResumo, sha256Arquivo } from '../lib/cli.mjs';
import { importarTipos } from '../shared/importar-tipos.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { gravarRelatorioCsv } from '../lib/relatorio.mjs';

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'col-codigo': { type: 'string', default: 'COD' },
    'col-tipo': { type: 'string', default: 'TIPO' },
    simular: { type: 'boolean', default: false },
    'executado-por': { type: 'string' },
  },
});
const arquivo = positionals[0];
if (!arquivo) {
  console.error('uso: npm run importar:tipos -- <arquivo.xlsx|.csv> [--col-codigo COD] [--col-tipo TIPO] [--simular]');
  process.exit(1);
}
const planilha = await lerPlanilha(arquivo);
const db = await abrir();
const { resumo, resultados, importacaoId } = await importarTipos(db, {
  linhas: planilha.linhas,
  colunas: { codigo: op['col-codigo'], tipo: op['col-tipo'] },
  arquivoNome: path.basename(arquivo),
  arquivoSha256: await sha256Arquivo(arquivo),
  executadoPor: executor(op['executado-por']),
  simular: op.simular,
});
db.close();
const rel = await gravarRelatorioCsv(
  path.join('relatorios', `tipos-${importacaoId ?? 'simulacao'}-${carimbo()}.csv`),
  ['linha', 'resultado', 'mensagens'],
  resultados.map((r) => ({ linha: r.numeroLinha, resultado: r.resultado, mensagens: r.mensagens.join(' | ') })),
);
imprimirResumo(op.simular ? 'SIMULAÇÃO (nada gravado)' : `Importação #${importacaoId} concluída`, resumo);
console.log(`  relatório: ${rel}`);
if (resumo.semTipoDefinido) console.log(`  atenção: ${resumo.semTipoDefinido} representante(s)/vendedor(es) ainda sem tipo — tratados como representante`);
