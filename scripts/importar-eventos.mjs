#!/usr/bin/env node
// Importa arquivos do ERP Senior / lista de CNPJs baixados.
//   npm run importar:eventos -- --tipo cadastro arquivo.xlsx --col-cnpj "CNPJ" --col-data "Data Cadastro" --col-documento "Cód. Cliente"
//   npm run importar:eventos -- --tipo pedido   arquivo.xlsx --col-cnpj "CNPJ" --col-data "Data Pedido"  --col-documento "Nº Pedido"
//   npm run importar:eventos -- --tipo baixa    arquivo.csv  --col-cnpj "CNPJ" --data-padrao 2026-10-19
//   --listar-colunas mostra o cabeçalho do arquivo · --simular valida sem gravar
import path from 'node:path';
import { parseArgs } from 'node:util';
import { abrir } from '../lib/db.mjs';
import { carimbo, executor, imprimirResumo, sha256Arquivo } from '../lib/cli.mjs';
import { importarEventos } from '../lib/importar-eventos.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { gravarRelatorioCsv } from '../lib/relatorio.mjs';
import { analisarData, hojeSaoPaulo } from '../shared/datas.mjs';

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tipo: { type: 'string' },
    'col-cnpj': { type: 'string', default: 'CNPJ' },
    'col-data': { type: 'string' },
    'col-documento': { type: 'string' },
    'data-padrao': { type: 'string' },
    simular: { type: 'boolean', default: false },
    'listar-colunas': { type: 'boolean', default: false },
    'executado-por': { type: 'string' },
  },
});
const arquivo = positionals[0];
if (!arquivo || (!op.tipo && !op['listar-colunas'])) {
  console.error('uso: npm run importar:eventos -- --tipo <cadastro|pedido|baixa> <arquivo> --col-cnpj X [--col-data Y | --data-padrao AAAA-MM-DD] [--col-documento Z] [--simular]');
  process.exit(1);
}
const planilha = await lerPlanilha(arquivo);
if (op['listar-colunas']) {
  console.log(`Colunas de ${path.basename(arquivo)} (${planilha.observacao}):`);
  (planilha.linhas[0] ?? []).forEach((c, i) => console.log(`  ${i + 1}. ${c ?? ''}`));
  process.exit(0);
}
let dataPadrao = null;
if (op['data-padrao']) {
  const d = analisarData(op['data-padrao']);
  if (d.erro || !d.data) throw new Error(`--data-padrao inválida: ${op['data-padrao']}`);
  dataPadrao = d.data;
}

const db = await abrir();
const { resumo, resultados, importacaoId } = await importarEventos(db, {
  tipo: op.tipo,
  linhas: planilha.linhas,
  colunas: { cnpj: op['col-cnpj'], data: op['col-data'], documento: op['col-documento'] },
  dataPadrao,
  hoje: hojeSaoPaulo(),
  arquivoNome: path.basename(arquivo),
  arquivoSha256: await sha256Arquivo(arquivo),
  executadoPor: executor(op['executado-por']),
  simular: op.simular,
});
db.close();
const rel = await gravarRelatorioCsv(
  path.join('relatorios', `${op.tipo}-${importacaoId ?? 'simulacao'}-${carimbo()}.csv`),
  ['linha', 'resultado', 'cnpj', 'mensagens'],
  resultados.map((r) => ({ linha: r.numeroLinha, resultado: r.resultado, cnpj: r.cnpj, mensagens: (r.resultado === 'aceita' ? r.avisos : r.erros).join(' | ') })),
);
imprimirResumo(op.simular ? 'SIMULAÇÃO (nada gravado)' : `Importação #${importacaoId} concluída`, resumo);
console.log(`  relatório: ${rel}`);
