// Relatório da Lista (Lista principal / Acompanhamento) em PDF para enviar ao representante — layout aprovado no mockup:
// A4 paisagem, logotipo, resumo numa linha, rótulos das colunas centralizados e repetidos em cada página,
// "Página X de N" e rodapé de uso interno. jsPDF + AutoTable (~450 KB) carregados só ao gerar, com a versão (?v=) do site.
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

/** jsPDF com o AutoTable aplicado (o plugin se liga sozinho ao jsPDF carregado antes dele). */
export function bibliotecaPdf() {
  if (window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  carregando ??= script('jspdf.umd.min.js').then(() => script('jspdf.plugin.autotable.min.js')).then(() => window.jspdf.jsPDF)
    .catch((e) => { carregando = null; throw e; });
  return carregando;
}

async function logotipo() {
  const r = await fetch('logo-germani.jpg');
  if (!r.ok) return null;
  const blob = await r.blob();
  return new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(blob); });
}

// Larguras do mockup (px numa largura útil de 1067) → mm na largura útil da folha. Onda, Tent., 1º registro e Dias centralizados.
const COLUNAS = [
  ['Razão social', 179], ['Fantasia', 86], ['CNPJ', 118], ['Endereço', 162], ['Bairro', 68], ['Cidade/UF', 86], ['Telefone', 74],
  ['Onda', 22, 'center'], ['Segmento', 78], ['Status', 70], ['Tent.', 36, 'center'], ['1º registro em', 66, 'center'], ['Dias', 22, 'center'],
];
const VINHO = [126, 22, 28];
const ROSA = [252, 235, 236];

/**
 * Gera e baixa o PDF. `blocos`: [{ grupo (rótulo ou null), linhas: [[13 textos na ordem de COLUNAS]] }] — já na ordem e no
 * agrupamento da tela. `resumo`: [[rótulo, número]]. Devolve o nome do arquivo.
 */
export async function gerarPdfLista({ titulo, representante, supervisor, emissao, resumo, filtros, blocos, nomeArquivo }) {
  const [JsPDF, logo] = await Promise.all([bibliotecaPdf(), logotipo().catch(() => null)]);
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const L = 297; const A = 210; const M = 10; const util = L - 2 * M;

  const cabecalho = (pagina) => {
    if (pagina === 1) {
      if (logo) doc.addImage(logo, 'JPEG', M, 8, 26, 13);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(17, 24, 39);
      // título e subtítulo centralizados; logotipo à esquerda e emissão à direita
      doc.text(`Lista de prospects · ${titulo}`, L / 2, 13, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(55, 65, 81);
      doc.text([representante, supervisor].filter(Boolean).join(' · '), L / 2, 18, { align: 'center' });
      doc.setFontSize(7.5);
      doc.text(`Emitida em ${emissao}`, L - M, 15.5, { align: 'right' });
      doc.setDrawColor(159, 29, 36); doc.setLineWidth(0.6); doc.line(M, 23, L - M, 23);
      // resumo numa linha: número ao lado do texto; filtros à direita
      let x = M;
      doc.setFontSize(7);
      for (const [rotulo, n] of resumo) {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 114, 128); doc.text(rotulo.toUpperCase(), x, 28.5);
        x += doc.getTextWidth(rotulo.toUpperCase()) + 1.5;
        doc.setFont('helvetica', 'bold'); doc.setTextColor(17, 24, 39); doc.setFontSize(9); doc.text(String(n), x, 28.5);
        x += doc.getTextWidth(String(n)) + 6; doc.setFontSize(7);
      }
      if (filtros) { doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81); doc.text(filtros, L - M, 28.5, { align: 'right' }); }
    } else {
      if (logo) doc.addImage(logo, 'JPEG', M, 6, 14, 7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(55, 65, 81);
      doc.text(`Lista de prospects · ${representante} (continuação)`, L / 2, 11, { align: 'center' });
      doc.setDrawColor(232, 160, 164); doc.setLineWidth(0.3); doc.line(M, 15, L - M, 15);
    }
    // número da página só no rodapé
    doc.setFontSize(7); doc.setTextColor(107, 114, 128);
    doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(M, A - 9, L - M, A - 9);
    doc.text('GERMANI Prospect · uso interno — não repassar a terceiros', M, A - 5.5);
  };

  const corpo = [];
  for (const b of blocos) {
    if (b.grupo != null) {
      corpo.push([{ content: `${b.grupo} · ${b.linhas.length} prospect(s)`, colSpan: COLUNAS.length,
        styles: { fillColor: ROSA, textColor: VINHO, fontStyle: 'bold', fontSize: 7.5 } }]);
    }
    corpo.push(...b.linhas);
  }
  doc.autoTable({
    head: [COLUNAS.map(([t]) => t)],
    body: corpo,
    startY: 32,
    margin: { top: 18, left: M, right: M, bottom: 12 },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',   // um prospect nunca fica partido entre duas páginas
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 6.8, cellPadding: { top: 1.1, bottom: 1.1, left: 1.1, right: 1.1 }, overflow: 'linebreak', valign: 'top',
      textColor: [17, 24, 39], lineColor: [229, 231, 235], lineWidth: { bottom: 0.15 } },
    headStyles: { fillColor: VINHO, textColor: 255, fontStyle: 'bold', fontSize: 6.2, halign: 'center', valign: 'middle' },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: Object.fromEntries(COLUNAS.map(([, px, al], i) => [i, { cellWidth: (px / 1067) * util, halign: al ?? 'left',
      ...(i === 0 ? { fontStyle: 'bold' } : {}), ...(i === 6 ? { fontSize: 6.3 } : {}) }])),
    // rótulos das colunas estreitas (Onda, Tent., Dias) menores e sem respiro, para não quebrar a palavra
    didParseCell: (d) => {
      if (d.section === 'head' && [7, 10, 12].includes(d.column.index)) { d.cell.styles.fontSize = 5.4; d.cell.styles.cellPadding = 0.4; }
      if (d.section === 'body' && d.column.index === 8) d.cell.styles.fontSize = 6.2;
    },
    didDrawPage: (d) => cabecalho(d.pageNumber),
  });
  // "Página X de N" no rodapé, escrito no fim (com o total já conhecido, o alinhamento à direita fica exato)
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i += 1) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(107, 114, 128);
    doc.text(`Página ${i} de ${paginas}`, L - M, A - 5.5, { align: 'right' });
  }
  doc.save(nomeArquivo);
  return nomeArquivo;
}
