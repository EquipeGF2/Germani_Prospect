#!/usr/bin/env node
// E-mail diário de avisos (docs/03 §18): roda no GitHub (.github/workflows/avisos-email.yml) às 7h dos dias úteis, lê os avisos
// como estavam no dia útil anterior (uma leitura para todos), monta um PDF por equipe e envia pelo Zoho com
// contato@svoltagf2.com.br. O supervisor recebe a equipe dele; gerente, administrador e supervisor que vê todas as equipes, um
// anexo por supervisor, com a cópia do parâmetro avisos_email_copia. Supervisor sem pendência não recebe nada.
//   node scripts/enviar-avisos.mjs [--hoje=AAAA-MM-DD] [--teste] [--simular=pasta]
//   --teste   tudo vai só para AVISOS_RESPONDER_PARA (sem cópia), mesmo fora de dia útil
//   --simular grava os e-mails (.html) e os PDFs na pasta, sem enviar
// O repositório é público e o log do GitHub também: o log mostra só contagens — nada de e-mail, nome ou cliente.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import { consultaAvisosEm, consultaDestinatariosAvisos, consultaParametrosAvisos, consultaParaConferirEm, prepararAviso, rotuloDesde, textoParametro, TIPOS_AVISO } from '../shared/avisos.mjs';
import { listaDeEmails, montarEmails, diaPorExtenso } from '../shared/email-avisos.mjs';
import { montarPdfPendencias } from '../shared/pdf-pendencias.mjs';
import { datasDeFeriado, diaUtilAnterior, ehDiaUtil } from '../shared/feriados.mjs';
import { hojeSaoPaulo, somarDias } from '../shared/datas.mjs';

applyPlugin(jsPDF);
const arg = (nome) => process.argv.find((a) => a === `--${nome}` || a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=') ?? (process.argv.includes(`--${nome}`) ? '' : null);
const hoje = arg('hoje') || hojeSaoPaulo();
if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) { console.error('--hoje deve ser AAAA-MM-DD.'); process.exit(1); }
const teste = arg('teste') !== null;
const simular = arg('simular');
const env = process.env;
const responderPara = env.AVISOS_RESPONDER_PARA || null;

if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) { console.error('Faltam TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.'); process.exit(1); }
if (teste && !responderPara) { console.error('O teste vai para AVISOS_RESPONDER_PARA, que não está definido.'); process.exit(1); }
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const feriados = await datasDeFeriado(db, { inicio: somarDias(hoje, -40), fim: hoje });
if (!ehDiaUtil(hoje, feriados) && !teste) { console.log(`${hoje} não é dia útil: nada a enviar.`); process.exit(0); }
const dataRef = diaUtilAnterior(hoje, feriados);

// uma leitura de cada coisa, para todas as equipes
const [avisosR, conferirR, destR, paramsR, copiaR] = await Promise.all([
  db.execute(consultaAvisosEm(dataRef)), db.execute(consultaParaConferirEm(dataRef)), db.execute(consultaDestinatariosAvisos()),
  db.execute(consultaParametrosAvisos()), db.execute("SELECT valor FROM parametros WHERE chave = 'avisos_email_copia'"),
]);
const parametros = Object.fromEntries(paramsR.rows.map((p) => [p.chave, p.valor]));
const avisos = avisosR.rows.map(prepararAviso);
for (const a of avisos) a.desdeRotulo = rotuloDesde(a, parametros);
const appUrl = env.APP_URL || 'https://vendas.svoltagf2.com.br/';
const { emails, equipes } = montarEmails({ avisos, conferir: conferirR.rows, destinatarios: destR.rows, copia: listaDeEmails(copiaR.rows[0]?.valor),
  dataRef, appUrl, responderPara, teste: teste ? responderPara : null });

// um PDF por equipe que entra em algum e-mail
const logo = `data:image/jpeg;base64,${(await readFile(new URL('../web/logo-germani.jpg', import.meta.url))).toString('base64')}`;
const tipos = TIPOS_AVISO.map((t) => ({ ...t, textoParam: textoParametro(t.id, parametros) }));
const pdfs = new Map();
for (const k of new Set(emails.flatMap((m) => m.anexos))) {
  const e = equipes.get(k);
  const doc = montarPdfPendencias({ JsPDF: jsPDF, logo, reps: e.reps, tipos, equipe: `Equipe: ${e.supervisor}`, comSupervisor: false, emissao: dataRef.split('-').reverse().join('/') });
  pdfs.set(k, Buffer.from(doc.output('arraybuffer')));
}

console.log(`Posição de ${diaPorExtenso(dataRef)}: ${avisos.length} pendências em ${equipes.size} equipes; ${emails.length} e-mail(s) (${emails.filter((m) => m.quem === 'supervisor').length} de supervisor, ${emails.filter((m) => m.quem === 'gestao').length} da gestão)${teste ? ' — TESTE' : ''}.`);
if (!emails.length) process.exit(0);

if (simular) {
  await mkdir(simular, { recursive: true });
  for (const [i, m] of emails.entries()) await writeFile(path.join(simular, `email-${i + 1}-${m.quem}.html`), m.html.replace('cid:logo-germani', logo));
  for (const [k, b] of pdfs) await writeFile(path.join(simular, equipes.get(k).arquivo), b);
  console.log(`Simulação gravada (${emails.length} e-mail(s), ${pdfs.size} PDF(s)).`);
  process.exit(0);
}

if (!env.SMTP_SENHA) { console.error('Falta SMTP_SENHA.'); process.exit(1); }
const { default: nodemailer } = await import('nodemailer');
const usuario = env.SMTP_USUARIO || 'contato@svoltagf2.com.br';
const porta = Number(env.SMTP_PORTA) || 465;
const smtp = nodemailer.createTransport({ host: env.SMTP_HOST || 'smtp.zoho.com', port: porta, secure: porta === 465, auth: { user: usuario, pass: env.SMTP_SENHA } });
let enviados = 0;
for (const m of emails) {
  await smtp.sendMail({
    from: { name: 'GERMANI PROSPECT', address: usuario }, replyTo: responderPara ?? undefined, to: m.para, cc: m.cc.length ? m.cc : undefined,
    subject: m.assunto, html: m.html, text: m.texto,
    attachments: [{ filename: 'logo-germani.jpg', path: new URL('../web/logo-germani.jpg', import.meta.url).pathname, cid: 'logo-germani' },
      ...m.anexos.map((k) => ({ filename: equipes.get(k).arquivo, content: pdfs.get(k), contentType: 'application/pdf' }))],
  });
  enviados += 1;
}
console.log(`${enviados} e-mail(s) enviado(s).`);
