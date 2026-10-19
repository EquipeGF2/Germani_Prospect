// Leitura de planilhas no Node (scripts). A lógica está em shared/planilha.mjs (a mesma da tela).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { lerPlanilhaDeBytes } from '../shared/planilha.mjs';

export { lerCsvTexto, reempacotarXlsx } from '../shared/planilha.mjs';

export async function lerPlanilha(caminho) {
  return lerPlanilhaDeBytes(await readFile(caminho), path.basename(caminho), { ExcelJS, JSZip });
}
