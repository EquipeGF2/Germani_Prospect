// Leitura de planilhas (.xlsx / .csv) — usada pela tela de importação (navegador) e pelos scripts (Node).
// As bibliotecas são injetadas: { ExcelJS, JSZip } (no navegador vêm de vendor/, no Node do npm).
// Exportações do Senior às vezes geram .xlsx malformado (caminhos internos com "\" e styles.xml quebrado).
// Estratégia: 1) ler normalmente → 2) reempacotar o zip corrigindo caminhos e trocando styles.xml
// por um mínimo válido → 3) se ainda falhar, pedir CSV (";" e decimal com vírgula são aceitos).

const STYLES_MINIMO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

function valorCelula(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return valorCelula(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  return v;
}

async function lerXlsx(bytes, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('planilha sem abas');
  const linhas = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    linhas[n - 1] = vals.map(valorCelula);
  });
  for (let i = 0; i < linhas.length; i++) linhas[i] ??= [];
  return { linhas, aba: ws.name };
}

/** Reempacota um .xlsx malformado: "\" → "/" nos caminhos e styles.xml mínimo. Devolve Uint8Array. */
export async function reempacotarXlsx(bytes, JSZip) {
  const zip = await JSZip.loadAsync(bytes);
  const novo = new JSZip();
  for (const [nome, arq] of Object.entries(zip.files)) {
    if (arq.dir) continue;
    const corrigido = nome.replace(/\\/g, '/');
    const conteudo = /(^|\/)styles\.xml$/i.test(corrigido) ? STYLES_MINIMO : await arq.async('uint8array');
    novo.file(corrigido, conteudo);
  }
  return novo.generateAsync({ type: 'uint8array' });
}

/** Decodifica CSV: UTF-8 (com ou sem BOM); se houver bytes inválidos, Windows-1252 (padrão Senior). */
export function decodificarTexto(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** CSV com aspas, separador ";" (padrão) ou "," detectado pela 1ª linha. */
export function lerCsvTexto(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return { linhas, separador: sep };
}

/**
 * Lê os bytes de um .xlsx ou .csv e devolve { linhas: any[][], formato, observacao }. linhas[0] é o cabeçalho.
 * @param bytes        Uint8Array | ArrayBuffer
 * @param nomeArquivo  usado para identificar a extensão
 * @param libs         { ExcelJS, JSZip }
 */
export async function lerPlanilhaDeBytes(bytes, nomeArquivo, { ExcelJS, JSZip }) {
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = (nomeArquivo.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    const { linhas, separador } = lerCsvTexto(decodificarTexto(dados));
    return { linhas, formato: 'csv', observacao: `CSV separador "${separador}"` };
  }
  if (ext !== '.xlsx') throw new Error(`formato não suportado: ${ext || '(sem extensão)'} (use .xlsx ou .csv)`);
  try {
    const { linhas, aba } = await lerXlsx(dados, ExcelJS);
    return { linhas, formato: 'xlsx', observacao: `aba "${aba}"` };
  } catch (erro1) {
    try {
      const { linhas, aba } = await lerXlsx(await reempacotarXlsx(dados, JSZip), ExcelJS);
      return { linhas, formato: 'xlsx', observacao: `aba "${aba}" — arquivo malformado, lido após reempacotar (${erro1.message})` };
    } catch (erro2) {
      throw new Error(`não foi possível ler o .xlsx (${erro1.message}; após reempacotar: ${erro2.message}). Exporte em CSV com ";" e tente novamente.`);
    }
  }
}

/** SHA-256 em hexadecimal (Web Crypto — Node 22+ e navegador). */
export async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
