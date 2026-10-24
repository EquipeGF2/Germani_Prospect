// Bibliotecas de planilha (ExcelJS + JSZip, ~1 MB) carregadas só quando uma tela lê arquivo — antes iam em toda abertura
// do site e atrasavam o Início. Mesma versão (?v=) dos módulos publicados.
const versao = new URL(import.meta.url).search;
let carregando = null;

function script(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = `vendor/${src}${versao}`;
    s.onload = ok;
    s.onerror = () => falha(new Error(`não foi possível carregar ${src} — confira a conexão e tente de novo`));
    document.head.append(s);
  });
}

/** Devolve { ExcelJS, JSZip }, carregando na primeira vez. */
export function bibliotecasPlanilha() {
  if (window.ExcelJS && window.JSZip) return Promise.resolve({ ExcelJS: window.ExcelJS, JSZip: window.JSZip });
  carregando ??= Promise.all([script('jszip.min.js'), script('exceljs.min.js')])
    .then(() => ({ ExcelJS: window.ExcelJS, JSZip: window.JSZip }))
    .catch((e) => { carregando = null; throw e; });
  return carregando;
}

/** Gera e baixa um .xlsx (uma aba, cabeçalho em negrito, colunas com largura). colunas: [{ titulo, valor(linha), largura? }]. */
export async function baixarXlsx(nomeArquivo, colunas, linhas, { aba = 'Dados' } = {}) {
  const { ExcelJS } = await bibliotecasPlanilha();
  const livro = new ExcelJS.Workbook();
  const folha = livro.addWorksheet(aba, { views: [{ state: 'frozen', ySplit: 1 }] });
  folha.columns = colunas.map((c) => ({ header: c.titulo, width: c.largura ?? 18 }));
  folha.getRow(1).font = { bold: true };
  for (const l of linhas) folha.addRow(colunas.map((c) => c.valor(l) ?? ''));
  folha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  const bytes = await livro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
