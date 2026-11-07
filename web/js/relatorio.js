// Relatório da Lista (Lista principal / Acompanhamento) e manual da Ajuda em PDF. O relatório vai para o representante — layout aprovado no mockup:
// A4 paisagem, logotipo, resumo numa linha, rótulos das colunas centralizados e repetidos em cada página,
// "Página X de N" e rodapé de uso interno. jsPDF + AutoTable (~450 KB) carregados só ao gerar, com a versão (?v=) do site.
import { blocosSimples } from '../shared/ajuda.mjs';

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
 * agrupamento da tela. `resumo`: [[rótulo, número]]. Devolve o nome do arquivo; com `baixar: false`, devolve os bytes do PDF
 * (Listas por equipe, que junta vários num ZIP).
 */
export async function gerarPdfLista({ titulo, representante, supervisor, emissao, resumo, filtros, blocos, nomeArquivo, baixar = true }) {
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
  if (!baixar) return new Uint8Array(doc.output('arraybuffer'));
  doc.save(nomeArquivo);
  return nomeArquivo;
}

const MAX_ALTURA_IMAGEM = 80;    // mm: os recortes da Ajuda saem pequenos, ao lado do texto que os explica
/** Imagem de uma tela, com o tamanho. Se faltar, o manual sai sem ela. */
async function imagemDaAjuda(arquivo) {
  const r = await fetch(`img/ajuda/${arquivo}`).catch(() => null);
  if (!r?.ok) return null;
  const dados = await new Promise(async (ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(await r.blob()); });
  if (!dados) return null;
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok({ dados, largura: i.naturalWidth, altura: i.naturalHeight }); i.onerror = () => ok(null); i.src = dados; });
}

/**
 * Manual em PDF, gerado na hora a partir do conteúdo da Ajuda (shared/ajuda.mjs): A4 retrato, logotipo no cabeçalho, capa, sumário
 * e "Página X de N". Com um capítulo só, vai sem capa nem sumário.
 */
export async function gerarManualPdf({ capitulos: originais, perfil, usuario = null, emissao, nomeArquivo }) {
  const capitulos = originais.map((c) => ({ ...c, blocos: blocosSimples(c, usuario) }));   // blocos ricos da tela viram p, h, img e tabela
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
  // imagens das telas: lidas antes de desenhar, com o tamanho de cada uma
  const imagens = new Map();
  await Promise.all(capitulos.flatMap((c) => c.blocos).filter((b) => b[0] === 'img').map(async (b) => {
    const dados = await imagemDaAjuda(b[1]);
    if (dados) imagens.set(b[1], dados);
  }));
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
      else if (b[0] === 'destaque') escrever(b[1], { estilo: 'bold', cor: [30, 58, 138], depois: 5 });
      else if (b[0] === 'img') {
        const img = imagens.get(b[1]);
        if (!img) continue;
        const largura = Math.min(util * 0.8, (MAX_ALTURA_IMAGEM * img.largura) / img.altura);
        const altura = (largura * img.altura) / img.largura;
        cabe(altura + 8);
        doc.addImage(img.dados, 'JPEG', M + (util - largura) / 2, y, largura, altura);
        doc.setDrawColor(209, 213, 219); doc.setLineWidth(0.1); doc.rect(M + (util - largura) / 2, y, largura, altura);
        y += altura + 2;
        escrever(b[2], { tam: 9, cor: [55, 65, 81], depois: 5 });
      } else if (b[0] === 'h') { cabe(14); y += 2; escrever(b[1], { tam: 14, estilo: 'bold', cor: VINHO, depois: 3 }); }
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


/**
 * PDF de pendências (tela Avisos), layout do modelo aprovado: A4 retrato. Página 1 = resumo da equipe (representante × tipo,
 * mais avisos primeiro) e o que cada coluna quer dizer; depois uma página por representante, com o "sem registrar" em
 * destaque, um bloco por tipo (regra, o que fazer, clientes com atraso, caixinha e espaço para o combinado) e os sem
 * interesse dele para conferir. `reps`: pendenciasPorRepresentante (shared/avisos.mjs); `tipos`: os tipos marcados.
 */
export async function gerarPdfPendencias({ reps, tipos, equipe, comSupervisor = false, emissao, nomeArquivo }) {
  const [JsPDF, logo] = await Promise.all([bibliotecaPdf(), logotipo().catch(() => null)]);
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
  doc.save(nomeArquivo);
  return nomeArquivo;
}
