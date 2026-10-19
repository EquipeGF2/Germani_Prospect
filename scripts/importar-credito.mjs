#!/usr/bin/env node
// Contingência: relatório de crédito por linha de comando (a operação normal é pela tela).
//   npm run importar:credito -- relatorio.xlsx [--simular]
import path from 'node:path';
import { parseArgs } from 'node:util';
import { abrir } from '../lib/db.mjs';
import { carimbo, executor, imprimirResumo, sha256Arquivo } from '../lib/cli.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { gravarRelatorioCsv } from '../lib/relatorio.mjs';
import { importarCredito } from '../shared/importar-credito.mjs';
import { hojeSaoPaulo } from '../shared/datas.mjs';

const { values: op, positionals } = parseArgs({ allowPositionals: true, options: { simular: { type: 'boolean', default: false }, 'executado-por': { type: 'string' } } });
if (!positionals[0]) { console.error('uso: npm run importar:credito -- <arquivo.xlsx|.csv> [--simular]'); process.exit(1); }
const arquivo = positionals[0];
const planilha = await lerPlanilha(arquivo);
const db = await abrir();
const { resumo, resultados, importacaoId } = await importarCredito(db, {
  linhas: planilha.linhas, hoje: hojeSaoPaulo(), arquivoNome: path.basename(arquivo), arquivoSha256: await sha256Arquivo(arquivo),
  executadoPor: executor(op['executado-por']), simular: op.simular,
});
db.close();
const rel = await gravarRelatorioCsv(path.join('relatorios', `credito-${importacaoId ?? 'simulacao'}-${carimbo()}.csv`), ['linha', 'resultado', 'cnpj', 'mensagens'],
  resultados.map((r) => ({ linha: r.numeroLinha, resultado: r.resultado, cnpj: r.cnpj, mensagens: (r.resultado === 'aceita' ? r.avisos : r.erros).join(' | ') })));
imprimirResumo(op.simular ? 'SIMULAÇÃO (nada gravado)' : `Importação #${importacaoId} concluída`, resumo);
console.log(`  relatório: ${rel}`);
