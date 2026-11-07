// E-mail diário de avisos (docs/03 §18, migração 0035): dia útil anterior, avisos numa data = vw_avisos, quem recebe o quê.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, registrarContato } from './auxiliar.mjs';
import { consultaAvisos, consultaAvisosEm, consultaDestinatariosAvisos, consultaParaConferirEm, prepararAviso } from '../shared/avisos.mjs';
import { diaUtilAnterior, ehDiaUtil } from '../shared/feriados.mjs';
import { arquivoDaEquipe, listaDeEmails, montarEmails, primeiroNome } from '../shared/email-avisos.mjs';
import { montarPdfPendencias } from '../shared/pdf-pendencias.mjs';
import { pendenciasPorRepresentante, TIPOS_AVISO } from '../shared/avisos.mjs';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import { normalizarBusca } from '../shared/texto.mjs';

applyPlugin(jsPDF);
let db;
const hoje = new Date(Date.now() - 3 * 3600 * 1000);
const d = (n) => new Date(hoje.getTime() - n * 86400000).toISOString().slice(0, 10);
const chave = (a) => `${a.tipo}|${a.prospect_id}|${a.vendedor_id}|${a.data_ref}|${a.atraso}`;

before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);   // 1 Sup Um (2, 3) · 4 Admin · 5 Sup Dois
  await db.execute({ sql: "INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES ('vendedor', '12', 'Vend Doze', ?, 'v12', 5)", args: [normalizarBusca('Vend Doze')] });   // 6
  await db.execute({ sql: "UPDATE parametros SET valor = ? WHERE chave = 'data_inicio_campanha'", args: [d(90)] });
  const p = {};
  for (let n = 1; n <= 6; n += 1) p[n] = await criarProspect(db, { n, vendedorId: n <= 4 ? 2 : 6 });
  await registrarContato(db, { prospectId: p[1], resultado: 'atendido', data: d(30) });                 // cadastro vencido (Sup Um)
  await registrarContato(db, { prospectId: p[2], resultado: 'sem_interesse', motivo: 'PRECO', data: d(9), retorno: d(5) });   // retorno vencido
  await registrarContato(db, { prospectId: p[5], usuarioId: 6, resultado: 'atendido', data: d(20) });   // cadastro vencido (Sup Dois)
  await registrarContato(db, { prospectId: p[6], usuarioId: 5, resultado: 'sem_interesse', motivo: 'REP_FORA_ROTA', data: d(2), retorno: false });
});

test('dia útil anterior: terça → segunda; segunda → sexta; sexta feriado → quinta; sábado e feriado não são dia útil', () => {
  assert.equal(diaUtilAnterior('2026-11-10'), '2026-11-09');
  assert.equal(diaUtilAnterior('2026-11-09'), '2026-11-06');
  assert.equal(diaUtilAnterior('2026-11-09', new Set(['2026-11-06'])), '2026-11-05');
  assert.equal(diaUtilAnterior('2026-11-03', new Set(['2026-11-02'])), '2026-10-30', 'terça depois de Finados: a sexta');
  assert.ok(!ehDiaUtil('2026-11-07') && !ehDiaUtil('2026-11-08') && ehDiaUtil('2026-11-09'));
  assert.ok(!ehDiaUtil('2026-11-20', new Set(['2026-11-20'])));
});

test('avisos numa data: na data de hoje, o mesmo que a tela (vw_avisos); num dia antes, contam até aquele dia', async () => {
  const tela = (await db.execute(consultaAvisos({ usuario: { id: 4, perfil: 'administrador' } }))).rows.map(prepararAviso).map(chave).sort();
  const hojeEm = (await db.execute(consultaAvisosEm(d(0)))).rows.map(prepararAviso).map(chave).sort();
  assert.deepEqual(hojeEm, tela);
  assert.ok(tela.length >= 3);
  const ontem = (await db.execute(consultaAvisosEm(d(1)))).rows.map(prepararAviso);
  const cad = ontem.find((a) => a.tipo === 'cadastro' && a.vendedor_id === 2);
  const cadHoje = (await db.execute(consultaAvisosEm(d(0)))).rows.map(prepararAviso).find((a) => a.tipo === 'cadastro' && a.vendedor_id === 2);
  assert.equal(cad.atraso, cadHoje.atraso - 1, 'um dia a menos de atraso');
  assert.throws(() => consultaAvisosEm("2026-11-06'; DROP"), /data inválida/);
  const conferir = (await db.execute(consultaParaConferirEm(d(0)))).rows;
  assert.deepEqual(conferir.map((c) => Number(c.vendedor_id)), [6]);
  assert.equal((await db.execute(consultaParaConferirEm(d(3)))).rows.length, 0, 'o registro de 2 dias atrás ainda não existia');
});

test('cadastro do e-mail: só com e-mail válido, e só supervisor, gerente e administrador recebem (0035)', async () => {
  await assert.rejects(db.execute("UPDATE usuarios SET avisos_email = 1 WHERE id = 1"), /exige o e-mail/);
  await assert.rejects(db.execute("UPDATE usuarios SET email = 'sem-arroba' WHERE id = 1"), /e-mail inválido/);
  await assert.rejects(db.execute("UPDATE usuarios SET email = 'v@x.com', avisos_email = 1 WHERE id = 2"), /supervisor, gerente e administrador/);
  await db.execute("UPDATE usuarios SET email = 'um@empresa.com', avisos_email = 1 WHERE id = 1");
  await db.execute("UPDATE usuarios SET email = 'dois@empresa.com', avisos_email = 1 WHERE id = 5");
  await db.execute("UPDATE usuarios SET email = 'admin@empresa.com', avisos_email = 1 WHERE id = 4");
  const dest = (await db.execute(consultaDestinatariosAvisos())).rows.map((r) => [r.email, Number(r.gestao)]).sort();
  assert.deepEqual(dest, [['admin@empresa.com', 1], ['dois@empresa.com', 0], ['um@empresa.com', 0]]);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM parametros WHERE chave = 'avisos_email_copia'")).rows[0].n), 1);
});

test('quem recebe o quê: supervisor a própria equipe; gestão um anexo por supervisor, com a cópia; sem pendência, nada; teste vai só para um', async () => {
  const avisos = (await db.execute(consultaAvisosEm(d(0)))).rows.map(prepararAviso);
  const destinatarios = (await db.execute(consultaDestinatariosAvisos())).rows;
  const { emails, equipes } = montarEmails({ avisos, destinatarios, copia: ['neo@consultoria.com'], dataRef: '2026-11-06', appUrl: 'https://x/', responderPara: 'r@x.com' });
  const porQuem = Object.fromEntries(emails.map((m) => [m.para.join(','), m]));
  assert.deepEqual(porQuem['um@empresa.com'].anexos, ['1']);
  assert.match(porQuem['um@empresa.com'].assunto, /^Avisos da sua equipe · \d+ pendências · sexta, 06\/11\/2026$/);
  assert.deepEqual(porQuem['um@empresa.com'].cc, [], 'supervisor sem cópia');
  assert.deepEqual(porQuem['admin@empresa.com'].cc, ['neo@consultoria.com']);
  assert.deepEqual(porQuem['admin@empresa.com'].anexos.sort(), ['1', '5']);
  assert.match(porQuem['admin@empresa.com'].html, /Todas as equipes/);
  assert.equal(equipes.get('1').arquivo, 'pendencias-sup-um-2026-11-06.pdf');
  // sem pendência na equipe do Sup Dois: ele não recebe
  const semDois = montarEmails({ avisos: avisos.filter((a) => Number(a.supervisor_id) !== 5), destinatarios, copia: [], dataRef: '2026-11-06', appUrl: 'https://x/' });
  assert.ok(!semDois.emails.some((m) => m.para.includes('dois@empresa.com')));
  assert.deepEqual(montarEmails({ avisos: [], destinatarios, dataRef: '2026-11-06', appUrl: 'https://x/' }).emails, [], 'ninguém com pendência: nenhum e-mail');
  const t = montarEmails({ avisos, destinatarios, copia: ['neo@consultoria.com'], dataRef: '2026-11-06', appUrl: 'https://x/', teste: 'genaro@teste.com' });
  assert.ok(t.emails.every((m) => m.para.join() === 'genaro@teste.com' && !m.cc.length && m.assunto.startsWith('[TESTE] ')), 'teste: só para um, sem a consultoria');
  // o HTML escapa os nomes
  const x = montarEmails({ avisos: avisos.map((a) => ({ ...a, vendedor_nome: '<b>Rep</b>' })), destinatarios, dataRef: '2026-11-06', appUrl: 'https://x/' });
  assert.ok(!x.emails[0].html.includes('<b>Rep</b>'));
});

test('auxiliares: cópia, primeiro nome, arquivo; o PDF da equipe sai também fora do navegador', async () => {
  assert.deepEqual(listaDeEmails('a@x.com; b@y.com.br, invalido, a@x.com'), ['a@x.com', 'b@y.com.br']);
  assert.equal(primeiroNome('JULIO REICHEL'), 'Julio');
  assert.equal(primeiroNome('Supervisora Ana Exemplo'), 'Ana');
  assert.equal(arquivoDaEquipe('Júlio Reichel', '2026-11-06'), 'pendencias-julio-reichel-2026-11-06.pdf');
  const avisos = (await db.execute(consultaAvisosEm(d(0)))).rows.map(prepararAviso);
  const doc = montarPdfPendencias({ JsPDF: jsPDF, reps: pendenciasPorRepresentante(avisos), tipos: TIPOS_AVISO.map((t) => ({ ...t, textoParam: '' })), equipe: 'Equipe: Sup Um', emissao: '06/11/2026' });
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(doc.getNumberOfPages() >= 2);
});
