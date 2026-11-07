// E-mail diário de avisos (docs/03 §18, mockup aprovado): o supervisor recebe a equipe dele (um PDF); gerente, administrador e
// supervisor que vê todas as equipes recebem um e-mail com um anexo por supervisor, com a consultoria em cópia. Supervisor sem
// pendência não recebe nada. Os números são do dia útil anterior. Monta os e-mails (texto e HTML) sem ler nem enviar nada: quem
// envia é scripts/enviar-avisos.mjs.
import { contarAvisos, pendenciasPorRepresentante, TIPOS_AVISO } from './avisos.mjs';

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const n0 = (x) => Number(x).toLocaleString('pt-BR');
const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, um, varios) => `${n0(n)} ${n === 1 ? um : varios}`;
/** "sexta-feira, 06/11/2026" e "sexta, 06/11/2026". */
export const diaPorExtenso = (iso) => `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${br(iso)}`;
const diaCurto = (iso) => diaPorExtenso(iso).replace('-feira', '');
/** Primeiro nome, sem "Supervisor(a)" na frente e com só a inicial maiúscula ("JULIO REICHEL" → "Julio"). */
export function primeiroNome(nome) {
  const partes = String(nome ?? '').trim().split(/\s+/).filter((p) => !/^supervisor[a]?$/i.test(p));
  const p = partes[0] ?? '';
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
}
/** Nome do arquivo do PDF de uma equipe. */
export const arquivoDaEquipe = (supervisor, dataRef) => `pendencias-${String(supervisor ?? 'equipe').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${dataRef}.pdf`;

/** E-mails em cópia do parâmetro (separados por ";", "," ou espaço), só os que parecem e-mail. */
export const listaDeEmails = (texto) => [...new Set(String(texto ?? '').split(/[;,\s]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

const COR = { vinho: '#9F1D24', rosa: '#FCEBEC', vinhoEscuro: '#7E161C', texto: '#16181C', suave: '#5B616B', linha: '#EEF0F2' };

function tabelaHtml(linhas, primeira, rotuloTotal) {
  const th = (t) => `<th style="padding:8px 4px;text-align:center;font-weight:600;font-size:12px;color:${COR.vinhoEscuro}">${t}</th>`;
  const td = (v, extra = '') => `<td style="padding:8px 4px;text-align:center;font-size:13px;${extra}">${v || '<span style="color:#8A9099">—</span>'}</td>`;
  const corpo = linhas.map((l) => `<tr style="border-bottom:1px solid ${COR.linha}">
      <td style="padding:8px 6px;text-align:left;font-size:13px">${l.rotulo}</td>${TIPOS_AVISO.map((t) => td(l.cont[t.id] ? n0(l.cont[t.id]) : '')).join('')}${td(n0(l.cont.total), 'font-weight:700')}</tr>`).join('');
  const total = contarAvisos(linhas.flatMap((l) => l.avisos));
  return `<table role="presentation" style="width:100%;border-collapse:collapse"><thead><tr style="background:${COR.rosa}">${th(primeira)}${TIPOS_AVISO.map((t) => th(t.curto)).join('')}${th('Total')}</tr></thead>
    <tbody>${corpo}<tr style="border-top:2px solid ${COR.texto};font-weight:700"><td style="padding:8px 6px;text-align:left;font-size:13px">${rotuloTotal}</td>
    ${TIPOS_AVISO.map((t) => td(n0(total[t.id]), 'font-weight:700')).join('')}${td(n0(total.total), 'font-weight:700')}</tr></tbody></table>`;
}

function html({ titulo, saudacao, frase, tabela, depois, appUrl, responderPara }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title></head>
<body style="margin:0;background:#E9EBEE;font-family:'IBM Plex Sans',Arial,sans-serif;color:${COR.texto}">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" style="width:100%;max-width:640px;border-collapse:collapse;background:#FFFFFF;border:1px solid #D9DCE1">
<tr><td style="background:${COR.vinho};padding:18px 28px"><span style="display:inline-block;background:#FFFFFF;border-radius:6px;padding:6px 10px;vertical-align:middle"><img src="cid:logo-germani" alt="GERMANI" height="30" style="display:block;height:30px"></span>
<span style="color:#FFFFFF;font-size:15px;font-weight:600;vertical-align:middle;margin-left:14px">${escapar(titulo)}</span></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px">${saudacao}</p><p style="margin:0 0 16px">${frase}</p>${tabela}
<p style="margin:16px 0">${depois}</p>
<p style="margin:0 0 16px"><a href="${escapar(appUrl)}#/avisos" style="display:inline-block;background:${COR.vinho};color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Abrir os avisos no sistema</a></p>
<p style="margin:0;font-size:13px;color:${COR.suave}">Os números mostram como as pendências estavam no fim do último dia útil. No sistema, a tela Avisos mostra a situação de agora: o que já foi resolvido hoje não aparece mais lá.</p>
</td></tr>
<tr><td style="background:#F6F7F9;border-top:1px solid ${COR.linha};padding:16px 28px;font-size:12px;line-height:1.5;color:${COR.suave}">
<p style="margin:0">GERMANI Prospect · uso interno, não repassar a terceiros.</p>
<p style="margin:4px 0 0">Você recebe este e-mail porque seu usuário está marcado para receber avisos. Para parar, peça ao administrador do sistema.${responderPara ? ` Ao responder, a mensagem vai para ${escapar(responderPara)}.` : ''}</p>
</td></tr></table></td></tr></table></body></html>`;
}

/**
 * Monta os e-mails do dia. `avisos`: consultaAvisosEm(dataRef) já preparados; `conferir`: consultaParaConferirEm; `destinatarios`:
 * consultaDestinatariosAvisos; `copia`: e-mails em cópia da gerência; `teste`: um e-mail — tudo vai só para ele, sem cópia.
 * Devolve { emails: [{ para, cc, assunto, html, texto, anexos: [chave da equipe] }], equipes: Map(chave → { supervisor, reps, arquivo, total }) }.
 */
export function montarEmails({ avisos, conferir = [], destinatarios, copia = [], dataRef, appUrl, responderPara = null, teste = null }) {
  const equipes = new Map();
  for (const a of avisos) {
    const k = String(a.supervisor_id ?? '');
    if (!equipes.has(k)) equipes.set(k, { supervisorId: a.supervisor_id, supervisor: a.supervisor_nome ?? '(sem supervisor)', avisos: [] });
    equipes.get(k).avisos.push(a);
  }
  for (const [k, e] of equipes) {
    e.reps = pendenciasPorRepresentante(e.avisos, conferir.filter((c) => String(c.supervisor_id ?? '') === k));
    e.total = e.avisos.length;
    e.arquivo = arquivoDaEquipe(e.supervisor, dataRef);
  }
  const porTotal = [...equipes.entries()].sort((a, b) => b[1].total - a[1].total || a[1].supervisor.localeCompare(b[1].supervisor, 'pt-BR'));
  const quando = diaPorExtenso(dataRef);
  const emails = [];

  // supervisor: a própria equipe; sem pendência, nada
  for (const d of destinatarios.filter((x) => !Number(x.gestao) && x.perfil === 'supervisor')) {
    const e = equipes.get(String(d.id));
    if (!e?.total) continue;
    const linhas = e.reps.map((r) => ({ rotulo: escapar([r.codigo, r.nome].filter(Boolean).join(' - ')), cont: r.cont, avisos: r.avisos }));
    const titulo = 'Avisos da equipe';
    emails.push({
      para: [d.email], cc: [], anexos: [String(d.id)], quem: 'supervisor',
      assunto: `Avisos da sua equipe · ${plural(e.total, 'pendência', 'pendências')} · ${diaCurto(dataRef)}`,
      html: html({ titulo, saudacao: `Bom dia${primeiroNome(d.nome) ? `, ${escapar(primeiroNome(d.nome))}` : ''}.`, appUrl, responderPara,
        frase: `Na posição de <b>${quando}</b>, sua equipe tem <b style="color:#B91C1C">${plural(e.total, 'pendência', 'pendências')}</b>. Este é o resumo do que cobrar e de quem:`,
        tabela: tabelaHtml(linhas, 'Representante', 'Equipe'), depois: 'O PDF anexo traz uma página por representante, com cada cliente, os dias de atraso e um espaço para anotar o combinado.' }),
      texto: [`Bom dia. Na posição de ${quando}, sua equipe tem ${plural(e.total, 'pendência', 'pendências')}:`,
        ...e.reps.map((r) => `- ${r.nome}: ${r.avisos.length}`), '', 'O PDF anexo traz uma página por representante.', `Abrir os avisos: ${appUrl}#/avisos`].join('\n'),
    });
  }

  // gestão: um e-mail para todos, um anexo por supervisor com pendência, a consultoria em cópia
  const gestao = destinatarios.filter((x) => Number(x.gestao));
  if (gestao.length && porTotal.length) {
    const total = avisos.length;
    const linhas = porTotal.map(([, e]) => {
      const maior = e.reps.slice().sort((a, b) => b.avisos.length - a.avisos.length)[0];
      return { rotulo: `<b style="font-weight:600">${escapar(e.supervisor)}</b><span style="display:block;font-size:12px;color:${COR.suave}">${plural(e.reps.length, 'representante', 'representantes')}${maior ? ` · mais: ${escapar(maior.nome)} (${n0(maior.avisos.length)})` : ''}</span>`,
        cont: contarAvisos(e.avisos), avisos: e.avisos };
    });
    emails.push({
      para: gestao.map((d) => d.email), cc: copia, anexos: porTotal.map(([k]) => k), quem: 'gestao',
      assunto: `Avisos de todas as equipes · ${plural(total, 'pendência', 'pendências')} · ${diaCurto(dataRef)}`,
      html: html({ titulo: 'Avisos de todas as equipes', saudacao: 'Bom dia.', appUrl, responderPara,
        frase: `Na posição de <b>${quando}</b>, as equipes têm <b style="color:#B91C1C">${plural(total, 'pendência', 'pendências')}</b>. Segue um anexo por supervisor, com o detalhe de cada representante.`,
        tabela: tabelaHtml(linhas, 'Supervisor', 'Todas as equipes'), depois: 'Cada anexo é o mesmo PDF que o supervisor recebe: o resumo da equipe e uma página por representante. Supervisor sem pendência não entra na lista nem tem anexo.' }),
      texto: [`Bom dia. Na posição de ${quando}, as equipes têm ${plural(total, 'pendência', 'pendências')}:`,
        ...porTotal.map(([, e]) => `- ${e.supervisor}: ${e.total}`), '', 'Segue um anexo por supervisor.', `Abrir os avisos: ${appUrl}#/avisos`].join('\n'),
    });
  }

  // teste: tudo só para um endereço, sem cópia, com o assunto marcado
  if (teste) for (const m of emails) Object.assign(m, { para: [teste], cc: [], assunto: `[TESTE] ${m.assunto}` });
  return { emails, equipes };
}
