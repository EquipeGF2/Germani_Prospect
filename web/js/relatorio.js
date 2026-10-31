// Relatório da Lista (Lista principal / Acompanhamento) e manual da Ajuda em PDF. O relatório vai para o representante — layout aprovado no mockup:
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

/**
 * Manual em PDF, gerado na hora a partir do conteúdo da Ajuda (shared/ajuda.mjs): A4 retrato, logotipo no cabeçalho, capa, sumário
 * e "Página X de N". Com um capítulo só, vai sem capa nem sumário.
 */
export async function gerarManualPdf({ capitulos, perfil, emissao, nomeArquivo }) {
  const [JsPDF, logo] = await Promise.all([bibliotecaPdf(), logotipo().catch(() => null)]);
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const L = 210; const A = 297; const M = 18; const util = L - 2 * M; const FIM = A - 20; const TOPO = 30;
  let y = TOPO;
  const novaPagina = () => { doc.addPage(); y = TOPO; };
  const cabe = (altura) => { if (y + altura > FIM) novaPagina(); };
  const escrever = (texto, { tam = 11, estilo = 'normal', cor = [17, 24, 39], recuo = 0, depois = 2 } = {}) => {
    doc.setFont('helvetica', estilo); doc.setFontSize(tam); doc.setTextColor(...cor);
    const linhas = doc.splitTextToSize(String(texto), util - recuo);
    const altura = linhas.length * tam * 0.42;
    cabe(altura);
    doc.text(linhas, M + recuo, y + tam * 0.3);
    y += altura + depois;
  };
  const completo = capitulos.length > 1;
  if (completo) {
    if (logo) doc.addImage(logo, 'JPEG', M, 60, 60, 30);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(...VINHO);
    doc.text('Manual de utilização', M, 115);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(55, 65, 81);
    doc.text(`Perfil: ${perfil}`, M, 128);
    doc.text(`Gerado em ${emissao}`, M, 136);
    novaPagina();
    escrever('Sumário', { tam: 20, estilo: 'bold', depois: 6 });
    for (const c of capitulos) { escrever(`${c.n}. ${c.nome}`, { tam: 12, estilo: 'bold', depois: 1 }); escrever(c.desc, { tam: 10, cor: [55, 65, 81], depois: 4 }); }
  }
  capitulos.forEach((c, i) => {
    if (completo || i) novaPagina();
    escrever(`${c.n}. ${c.nome}`, { tam: 20, estilo: 'bold', depois: 5 });
    for (const b of c.blocos) {
      if (b[0] === 'p') escrever(b[1], { depois: 4 });
      else if (b[0] === 'h') { cabe(14); y += 2; escrever(b[1], { tam: 14, estilo: 'bold', cor: VINHO, depois: 3 }); }
      else if (b[0] === 'lista' || b[0] === 'passos') {
        b[1].forEach((x, k) => escrever(`${b[0] === 'passos' ? `${k + 1}.` : '•'} ${Array.isArray(x) ? `${x[0]}: ${x[1]}` : x}`, { recuo: 3, depois: 2 }));
        y += 2;
      } else {
        cabe(20);
        doc.autoTable({ startY: y, margin: { left: M, right: M, top: TOPO, bottom: 22 }, head: [b[1]], body: b[2], styles: { font: 'helvetica', fontSize: 10, cellPadding: 1.8, valign: 'top', lineColor: [209, 213, 219], lineWidth: 0.1, textColor: [17, 24, 39] },
          headStyles: { fillColor: ROSA, textColor: VINHO, halign: 'center', fontStyle: 'bold' }, columnStyles: { 0: { fontStyle: 'bold' } } });
        y = doc.lastAutoTable.finalY + 5;
      }
    }
  });
  const total = doc.getNumberOfPages();
  for (let p = completo ? 2 : 1; p <= total; p++) {
    doc.setPage(p);
    if (logo) doc.addImage(logo, 'JPEG', M, 9, 24, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(55, 65, 81);
    doc.text(`Manual de utilização · perfil ${perfil}`, L - M, 16, { align: 'right' });
    doc.setDrawColor(...VINHO); doc.setLineWidth(0.5); doc.line(M, 23, L - M, 23);
    doc.setDrawColor(107, 114, 128); doc.setLineWidth(0.1); doc.line(M, A - 16, L - M, A - 16);
    doc.text(`Gerado em ${emissao}`, M, A - 11);
    doc.text(`Página ${p} de ${total}`, L - M, A - 11, { align: 'right' });
  }
  doc.save(nomeArquivo);
  return nomeArquivo;
}

