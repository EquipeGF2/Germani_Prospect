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
