import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { lerPlanilhaDeBytes } from '../shared/planilha.mjs';

// .xlsx no formato que o ERP exporta: caminhos com "\", aba solta em xl/sheet1.xml e textos em CDATA.
async function xlsxDoErp() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels\\.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl\\workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl\\_rels\\workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="sheet1.xml"/></Relationships>');
  zip.file('xl\\sheet1.xml', '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t><![CDATA[Cliente]]></t></is></c><c r="B1" t="inlineStr"><is><t><![CDATA[Razão Social & Cia]]></t></is></c></row>'
    + '<row r="2"><c r="A2"><v>123</v></c><c r="B2" t="inlineStr"><is><t><![CDATA[EMPRESA <TESTE>]]></t></is></c></row>'
    + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array' });
}

test('lê .xlsx do ERP com caminhos "\\", aba solta e textos CDATA', async () => {
  const { linhas } = await lerPlanilhaDeBytes(await xlsxDoErp(), 'relatorio.xlsx', { ExcelJS, JSZip });
  assert.deepEqual(linhas[0].slice(0, 2), ['Cliente', 'Razão Social & Cia']);
  assert.equal(String(linhas[1][0]), '123');
  assert.equal(linhas[1][1], 'EMPRESA <TESTE>');
});
