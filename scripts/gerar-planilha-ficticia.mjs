#!/usr/bin/env node
// Gera uma planilha FICTÍCIA no layout real da base (docs/05-importacao.md) para desenvolvimento e testes.
// Nenhum CNPJ real: as raízes são aleatórias com DV calculado (parte delas alfanuméricas).
//   npm run exemplo:planilha [-- --linhas 300 --saida exemplos/base-ficticia.xlsx]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { calcularDv, formatarCnpj } from '../shared/cnpj.mjs';
import { COLUNAS_BASE } from '../shared/importacao-base.mjs';

const { values: op } = parseArgs({ options: { linhas: { type: 'string', default: '120' }, saida: { type: 'string', default: 'exemplos/base-ficticia.xlsx' } } });

let semente = 20261019;
const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
const escolher = (lista) => lista[Math.floor(aleatorio() * lista.length)];

const CIDADES = [
  ['Santa Cruz do Sul', 'RS', '96810', -29.7175, -52.4258], ['Venâncio Aires', 'RS', '95800', -29.6061, -52.1919],
  ['Lajeado', 'RS', '95900', -29.4669, -51.9614], ['Cachoeira do Sul', 'RS', '96501', -30.0392, -52.8939],
  ['Santa Maria', 'RS', '97010', -29.6842, -53.8069], ['Passo Fundo', 'RS', '99010', -28.2628, -52.4067],
];
const EQUIPE = [
  { sup: ['901', 'Supervisora Ana Exemplo'], reps: [['1101', 'Representante Bruno Teste'], ['1102', 'Vendedora Carla Ficticia']] },
  { sup: ['902', 'Supervisor Davi Modelo'], reps: [['1201', 'Representante Érica Demo'], ['1202', 'Vendedor Fábio Amostra']] },
];
const TIPOLOGIAS = ['MINIMERCADO', 'MERCADO', 'PADARIA', 'CONVENIÊNCIA', 'ATACAREJO'];
const NOMES = ['Mercado', 'Mini Mercado', 'Padaria', 'Armazém', 'Fruteira', 'Conveniência'];
const SOBRENOMES = ['São João', 'Boa Vista', 'Esperança', 'Do Vale', 'Central', 'Três Irmãos', 'Pôr do Sol', 'Avenida'];

function cnpjFicticio(alfa) {
  const chars = alfa ? '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ' : '0123456789';
  let base = '';
  for (let i = 0; i < 8; i++) base += escolher(chars.split(''));
  base += '0001';
  return base + calcularDv(base);
}

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('BASE');
ws.addRow(COLUNAS_BASE.map((c) => c.cabecalho));
const n = Number(op.linhas);
for (let i = 0; i < n; i++) {
  const [cidade, uf, cepBase, lat, lng] = escolher(CIDADES);
  const equipe = escolher(EQUIPE);
  const [cod, nome] = escolher(equipe.reps);
  const cnpj = cnpjFicticio(i % 10 === 0);
  const fantasia = `${escolher(NOMES)} ${escolher(SOBRENOMES)}`;
  const r = aleatorio();
  let dt1 = null, dt2 = null, status = 'Não contactado';
  if (r > 0.45) { dt1 = new Date(Date.UTC(2026, 8, 1 + Math.floor(aleatorio() * 25))); status = 'Em prospecção'; }
  if (r > 0.7) { dt2 = new Date(dt1.getTime() + (3 + Math.floor(aleatorio() * 10)) * 86400000); status = escolher(['Sem interesse', 'Em negociação', 'Em prospecção']); }
  const formatado = formatarCnpj(cnpj);
  ws.addRow([
    i % 7 === 0 ? cnpj : formatado, `${fantasia.toUpperCase()} LTDA (FICTÍCIO)`, fantasia, `Rua Exemplo ${i + 1}, ${10 + i}`, escolher(['Centro', 'Universitário', 'Arroio Grande', 'Goiás']),
    cidade, uf, `${cepBase}-${String(100 + (i % 800)).padStart(3, '0')}`, (lat + (aleatorio() - 0.5) / 50).toFixed(6).replace('.', ','),
    (lng + (aleatorio() - 0.5) / 50).toFixed(6).replace('.', ','), escolher(TIPOLOGIAS), `(51) 3${String(1000000 + i).slice(1)}`, String(1 + (i % 3)),
    formatado, escolher(['A', 'B', 'C']), equipe.sup[0], equipe.sup[1], cod, nome, `R${cod.slice(-2)}`, `S${1 + (i % 4)}`, i % 11 === 0 ? 'Cliente pediu visita à tarde' : null,
    dt1, dt2, status, null,
  ]);
}
// linhas de erro de propósito (para ver o relatório de rejeitadas)
ws.addRow(['11.111.111/1111-11', 'CNPJ INVÁLIDO DE TESTE (FICTÍCIO)', null, null, null, 'Santa Cruz do Sul', 'RS', null, null, null, null, null, null, null, null, '901', 'Supervisora Ana Exemplo', '1101', 'Representante Bruno Teste']);
ws.addRow([formatarCnpj(cnpjFicticio(false)), 'STATUS DESCONHECIDO (FICTÍCIO)', null, null, null, 'Lajeado', 'RS', null, null, null, null, null, null, null, null, '902', 'Supervisor Davi Modelo', '1201', 'Representante Érica Demo', null, null, null, null, null, 'Ligar depois']);
ws.getColumn(23).numFmt = 'dd/mm/yyyy';
ws.getColumn(24).numFmt = 'dd/mm/yyyy';
await mkdir(path.dirname(op.saida), { recursive: true });
await wb.xlsx.writeFile(op.saida);
console.log(`Planilha fictícia gravada em ${op.saida} (${n + 2} linhas; 2 com erro proposital).`);
