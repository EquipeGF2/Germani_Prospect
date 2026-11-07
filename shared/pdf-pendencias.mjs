// PDF de pendências (tela Avisos e e-mail diário, docs/03 §18), layout do modelo aprovado: A4 retrato. Página 1 = resumo da
// equipe (representante × tipo, mais avisos primeiro) e o que cada coluna quer dizer; depois uma página por representante,
// com o "sem registrar" em destaque, um bloco por tipo (regra, o que fazer, clientes com atraso, caixinha e espaço para o
// combinado) e os sem interesse dele para conferir. Sem dependência de navegador nem de Node: quem chama entrega o jsPDF
// (com o AutoTable) e o logotipo — a tela (web/js/relatorio.js) e a rotina do e-mail (scripts/enviar-avisos.mjs).
const VINHO = [126, 22, 28];
const ROSA = [252, 235, 236];

/**
 * Desenha e devolve o documento (jsPDF). `reps`: pendenciasPorRepresentante (shared/avisos.mjs); `tipos`: os tipos marcados,
 * cada um com `textoParam`; `logo`: data URL JPEG ou null.
 */
export function montarPdfPendencias({ JsPDF, logo = null, reps, tipos, equipe, comSupervisor = false, emissao }) {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const L = 210; const A = 297; const M = 12; const util = L - 2 * M;
  const total = reps.reduce((t, r) => t + r.avisos.length, 0);
  const n = (x) => Number(x).toLocaleString('pt-BR');
  const dias = (a) => (a.atraso == null ? 'nunca' : `${n(a.atraso)} ${a.atraso === 1 ? 'dia' : 'dias'}`);
  const data = (v) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '—');
  const cnpj = (c) => (c && String(c).length === 14 ? String(c).replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\w{2})$/, '$1.$2.$3/$4-$5') : c ?? '');
  const tabelaBase = { theme: 'plain', margin: { left: M, right: M, top: 30, bottom: 16 }, rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, textColor: [17, 24, 39], lineColor: [229, 231, 235], lineWidth: { bottom: 0.15 }, valign: 'middle' },
    headStyles: { fillColor: ROSA, textColor: VINHO, fontStyle: 'bold', fontSize: 7, halign: 'center' } };

  const topo = (titulo, subtitulo, numero) => {
    if (logo) doc.addImage(logo, 'JPEG', M, 9, 24, 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39);
    doc.text(titulo, M + 28, 14.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(75, 85, 99);
    doc.text(subtitulo, M + 28, 19.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(185, 28, 28);
    doc.text(n(numero), L - M - 12, 15.5, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(107, 114, 128);
    doc.text(numero === 1 ? 'pendência' : 'pendências', L - M - 12, 20, { align: 'center' });
    doc.setDrawColor(...VINHO); doc.setLineWidth(0.6); doc.line(M, 24, L - M, 24);
  };
  const titulo2 = (texto, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(17, 24, 39); doc.text(texto, M, y); };

  // página 1: resumo da equipe
  topo('Pendências da equipe', `${equipe} · posição de ${emissao} · prazos dos Parâmetros`, total);
  titulo2('Por representante: de quem cobrar', 32);
  const colunas = [...(comSupervisor ? ['Supervisor'] : []), 'Representante', ...tipos.map((t) => t.curto), 'Total'];
  const somas = tipos.map((t) => reps.reduce((s, r) => s + r.cont[t.id], 0));
  doc.autoTable({ ...tabelaBase, startY: 35,
    head: [colunas],
    body: [...reps.map((r) => [...(comSupervisor ? [r.supervisor] : []), [r.codigo, r.nome].filter(Boolean).join(' - '), ...tipos.map((t) => (r.cont[t.id] ? n(r.cont[t.id]) : '—')), n(r.avisos.length)]),
      [{ content: 'Total', colSpan: comSupervisor ? 2 : 1, styles: { fontStyle: 'bold' } }, ...somas.map((s) => ({ content: n(s), styles: { fontStyle: 'bold' } })), { content: n(total), styles: { fontStyle: 'bold' } }]],
    columnStyles: Object.fromEntries(colunas.map((_, i) => [i, { halign: i < (comSupervisor ? 2 : 1) ? 'left' : 'center' }])),
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === colunas.length - 1) d.cell.styles.fontStyle = 'bold'; } });
  let y = doc.lastAutoTable.finalY + 9;
  titulo2('O que cada coluna quer dizer', y);
  doc.autoTable({ ...tabelaBase, startY: y + 3, head: [['Aviso', 'Regra', 'Prazo']], body: tipos.map((t) => [t.curto, t.regra, t.textoParam]),
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 }, 1: { cellWidth: util - 34 - 52 }, 2: { cellWidth: 52, fontSize: 7.2 } } });
  y = doc.lastAutoTable.finalY + 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(75, 85, 99);
  doc.text(doc.splitTextToSize('Nas páginas seguintes, uma por representante: cada cliente com o atraso e um espaço para anotar o combinado. A pendência some do sistema sozinha quando o cliente avança ou o representante registra.', util), M, y);

  // uma página por representante
  for (const r of reps) {
    doc.addPage();
    topo(`Pendências · ${r.nome}`, [r.codigo ? `cód. ${r.codigo}` : null, r.supervisor ? `Equipe: ${r.supervisor}` : null, `posição de ${emissao}`].filter(Boolean).join(' · '), r.avisos.length);
    y = 31;
    for (const b of r.porTipo) {
      if (b.tipo.id === 'sem_lancar') {
        const a = b.avisos[0];
        doc.setFillColor(254, 242, 242); doc.setDrawColor(252, 165, 165); doc.setLineWidth(0.3); doc.roundedRect(M, y, util, 13, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17, 24, 39);
        doc.text(a.atraso == null ? 'Nunca registrou atendimento no app' : `Sem registrar há ${dias(a)}`, M + 3, y + 5.2);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(75, 85, 99);
        const desde = !a.data_ref ? '' : a.desdeRotulo === 'início da campanha' ? `Sem registro desde o início da campanha (${data(a.data_ref)}). ` : `Último registro em ${data(a.data_ref)}. `;
        doc.text(`${desde}${b.tipo.textoParam}. ${b.tipo.acao}`, M + 3, y + 10);
        y += 18;
        continue;
      }
      if (y > A - 50) { doc.addPage(); y = 31; }
      titulo2(`${b.tipo.nome} · ${n(b.avisos.length)}`, y + 1);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128);
      doc.text(doc.splitTextToSize(`${b.tipo.regra} O que fazer: ${b.tipo.acao}`, util), M, y + 5.5);
      doc.autoTable({ ...tabelaBase, startY: y + 8,
        head: [['', 'Cliente · CNPJ', 'Cidade', 'Desde', 'Atraso', 'Combinado']],
        body: b.avisos.map((a) => ['', `${a.codigo_cliente_erp ? `${a.codigo_cliente_erp} - ` : ''}${a.razao_social ?? ''}\n${cnpj(a.cnpj)}`, [a.cidade, a.uf].filter(Boolean).join('/'), `${data(a.data_ref)}\n${a.desdeRotulo ?? b.tipo.desde}`, dias(a), '']),
        columnStyles: { 0: { cellWidth: 6 }, 1: { cellWidth: 62 }, 2: { cellWidth: 42, fontSize: 7.5 }, 3: { cellWidth: 22, halign: 'center', fontSize: 7.5 }, 4: { cellWidth: 18, halign: 'center', fontStyle: 'bold', textColor: [153, 27, 27] }, 5: { cellWidth: util - 150 } },
        didDrawCell: (d) => {
          if (d.section !== 'body') return;
          if (d.column.index === 0) { doc.setDrawColor(107, 114, 128); doc.setLineWidth(0.25); doc.rect(d.cell.x + 1.2, d.cell.y + d.cell.height / 2 - 1.6, 3.2, 3.2); }
          if (d.column.index === 5) { doc.setDrawColor(156, 163, 175); doc.setLineWidth(0.2); doc.line(d.cell.x + 1, d.cell.y + d.cell.height - 1, d.cell.x + d.cell.width - 1, d.cell.y + d.cell.height - 1); }
        } });
      y = doc.lastAutoTable.finalY + 7;
    }
    if (r.conferir.length) {
      if (y > A - 45) { doc.addPage(); y = 31; }
      titulo2(`Para conferir: sem interesse do representante (7 dias) · ${n(r.conferir.length)}`, y + 1);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128);
      doc.text('Não é pendência: são clientes que o representante decidiu não trabalhar. Vale perguntar o motivo.', M, y + 5.5);
      doc.autoTable({ ...tabelaBase, startY: y + 8, head: [['Cliente', 'Cidade', 'Data', 'Motivo']],
        body: r.conferir.map((c) => [c.razao_social, [c.cidade, c.uf].filter(Boolean).join('/'), data(c.data_ref), c.motivo]),
        columnStyles: { 0: { cellWidth: 66 }, 1: { cellWidth: 38 }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: util - 124 } } });
    }
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i += 1) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(107, 114, 128);
    doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(M, A - 11, L - M, A - 11);
    doc.text('GERMANI Prospect · uso interno — não repassar a terceiros', M, A - 7);
    doc.text(`Página ${i} de ${paginas}`, L - M, A - 7, { align: 'right' });
  }
  return doc;
}
