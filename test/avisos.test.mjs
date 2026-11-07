// Avisos da equipe (docs/03 §4 e §18, migração 0031): vw_avisos, o recorte por usuário, a grade por níveis e o PDF por representante.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, prospect, registrarContato } from './auxiliar.mjs';
import { consultaAvisos, consultaParaConferir, contarAvisos, montarGradeAvisos, ordenarAvisos, pendenciasPorRepresentante, prepararAviso, resumoAvisos, rotuloDesde, textoParametro } from '../shared/avisos.mjs';
import { podeTela } from '../shared/perfis.mjs';
import { normalizarBusca } from '../shared/texto.mjs';

let db; const p = {};
const ADMIN = { id: 4, perfil: 'administrador' };
const SUP_UM = { id: 1, perfil: 'supervisor' };
const SUP_DOIS = { id: 5, perfil: 'supervisor' };
// datas relativas a hoje (São Paulo), para os prazos valerem em qualquer dia
const hoje = new Date(Date.now() - 3 * 3600 * 1000);
const d = (n) => new Date(hoje.getTime() - n * 86400000).toISOString().slice(0, 10);
const ler = async (usuario) => (await db.execute(consultaAvisos({ usuario }))).rows.map(prepararAviso);

before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  await db.batch([
    { sql: "INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES ('vendedor', '12', 'Vend Doze', ?, 'v12', 5)", args: [normalizarBusca('Vend Doze')] },   // id 6, equipe do Sup Dois
    { sql: "INSERT INTO usuarios (perfil, nome, nome_busca, login) VALUES ('financeiro', 'Analista Fin', ?, 'fin')", args: [normalizarBusca('Analista Fin')] },                              // id 7
  ], 'write');
  await db.execute({ sql: "UPDATE parametros SET valor = ? WHERE chave = 'data_inicio_campanha'", args: [d(90)] });   // campanha começou há 90 dias
  for (let n = 1; n <= 13; n += 1) p[n] = await criarProspect(db, { n, vendedorId: n <= 8 ? 2 : n <= 10 ? 3 : 6, onda: n === 9 || n === 10 ? '2' : '1', razao: `Mercado ${n}` });
  const imp = await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('base_prospects','t','x','t') RETURNING id");
  const planilha = (id, prospectId, data) => db.execute({ sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado, origem, importacao_id)
    VALUES (?, ?, 2, 1, ?, 'nao_informado', 'contato_planilha', 'importacao', ?)`, args: [id, prospectId, data, imp.rows[0].id] });
  // p1 não contactado (entrou na base há meses): sem aviso
  await planilha('pl-2', p[2], d(40));                                                          // p2 em prospecção, parado há 40 dias
  await planilha('pl-3', p[3], d(10));                                                          // p3 em prospecção há 10 dias: no prazo
  await registrarContato(db, { prospectId: p[4], resultado: 'atendido', data: d(30) });           // p4 cadastro vencido
  await registrarContato(db, { prospectId: p[5], resultado: 'atendido', data: d(3), retorno: d(2) });   // p5 retorno vencido há 2 dias
  await registrarContato(db, { prospectId: p[6], resultado: 'atendido', data: d(40) });
  await evento(db, { prospectId: p[6], tipo: 'cadastro', data: d(25), documento: 'C6' });          // p6 análise vencida
  await evento(db, { prospectId: p[7], tipo: 'cadastro', data: d(8), documento: 'C7' });           // p7 cadastro sem atendimento
  await registrarContato(db, { prospectId: p[8], resultado: 'atendido', data: d(4) });
  await registrarContato(db, { prospectId: p[11], usuarioId: 6, resultado: 'atendido', data: d(20) });   // Vend Doze: último registro há 20 dias
  await registrarContato(db, { prospectId: p[12], usuarioId: 5, resultado: 'sem_interesse', motivo: 'REP_FORA_ROTA', data: d(2) });   // para conferir (registrado pelo supervisor)
  // p13: cliente do Vend Doze ainda a procurar (o sem registrar só vale para quem tem cliente na lista)
});

test('cada tipo de aviso com a regra do banco; não contactado e cliente em dia ficam de fora', async () => {
  const todos = await ler(ADMIN);
  const por = (id) => todos.filter((a) => a.prospect_id === p[id]).map((a) => a.tipo).sort();
  assert.deepEqual(por(1), [], 'não contactado não é pendência');
  assert.deepEqual(por(2), ['parado']);
  assert.equal(todos.find((a) => a.prospect_id === p[2]).atraso, 40);
  assert.deepEqual(por(3), []);
  assert.deepEqual(por(4), ['cadastro']);
  const p4 = await prospect(db, p[4]);
  assert.equal(todos.find((a) => a.prospect_id === p[4]).atraso, Math.round((Date.parse(d(0)) - Date.parse(p4.prazo_cadastro_ate)) / 86400000), 'atraso = dias depois do prazo');
  assert.deepEqual(por(5), ['retorno']);
  assert.equal(todos.find((a) => a.prospect_id === p[5]).atraso, 2);
  assert.deepEqual(por(6), ['analise']);
  assert.deepEqual(por(7), [], 'cadastro do ERP sem atendimento não é aviso (0033)');
  assert.deepEqual(por(8), [], 'atendido há 4 dias: no prazo');
  const sem = todos.filter((a) => a.tipo === 'sem_lancar').map((a) => [a.vendedor_nome, a.atraso]).sort();
  assert.deepEqual(sem, [['Vend Doze', 20], ['Vend Onze', 90]], 'Vend Dez registrou há 3 dias; Vend Onze nunca registrou (conta do início da campanha); o sem registrar não tem cliente');
});

test('os dias contam a partir do início da campanha (Parâmetros): registro anterior conta do início', async () => {
  const mudar = (v) => db.execute({ sql: "UPDATE parametros SET valor = ? WHERE chave = 'data_inicio_campanha'", args: [v] });
  try {
    await mudar(d(5));   // começou há 5 dias: ninguém está há mais de 7 sem registrar nem há mais de 30 parado
    const cedo = await ler(ADMIN);
    assert.deepEqual(cedo.filter((a) => a.tipo === 'sem_lancar' || a.tipo === 'parado'), []);
    await mudar(d(10));  // há 10 dias: quem nunca registrou conta do início
    const sem = (await ler(ADMIN)).filter((a) => a.tipo === 'sem_lancar').map((a) => [a.vendedor_nome, a.data_ref, a.atraso]).sort();
    assert.deepEqual(sem, [['Vend Doze', d(10), 10], ['Vend Onze', d(10), 10]], 'o registro de 20 dias atrás é anterior à campanha');
    await mudar(d(35));  // parado há 40 dias, mas a campanha tem 35: conta 35
    const p2 = (await ler(ADMIN)).find((a) => a.prospect_id === p[2]);
    assert.deepEqual([p2.data_ref, p2.atraso], [d(35), 35]);
    assert.equal(rotuloDesde(p2, { data_inicio_campanha: d(35) }), 'início da campanha');
    assert.equal(rotuloDesde(p2, { data_inicio_campanha: d(90) }), 'último registro');
    assert.equal((await prospect(db, p[2])).parado, 1, 'vw_prospects segue a mesma conta');
  } finally { await mudar(d(90)); }
});

test('sem registrar só conta quem tem clientes a procurar nas ondas liberadas', async () => {
  await db.execute("UPDATE parametros SET valor = '[\"1\"]' WHERE chave = 'ondas_liberadas'");
  try {
    const sem = (await ler(ADMIN)).filter((a) => a.tipo === 'sem_lancar').map((a) => a.vendedor_nome);
    assert.deepEqual(sem, ['Vend Doze'], 'os clientes do Vend Onze estão na onda 2, ainda não liberada');
  } finally { await db.execute("UPDATE parametros SET valor = 'todas' WHERE chave = 'ondas_liberadas'"); }
});

test('sem movimento: aguardando pedido conta desde a liberação do crédito; vw_prospects.parado segue a mesma regra', async () => {
  await db.execute({ sql: "INSERT INTO liberacoes_credito (prospect_id, origem, usuario_id, data_liberacao, limite_credito, limite_origem, forma_pagamento, com_restricao) VALUES (?, 'console', 7, ?, 100, 'informado', 'a_vista', 0)", args: [p[6], d(0)] });
  assert.equal((await prospect(db, p[6])).status_atual, 'aguardando_pedido');
  assert.ok(!(await ler(ADMIN)).some((a) => a.prospect_id === p[6]), 'liberado hoje: sem aviso');
  const parados = (await db.execute('SELECT id FROM vw_prospects WHERE parado = 1 ORDER BY id')).rows.map((r) => Number(r.id));
  const avisos = (await ler(ADMIN)).filter((a) => a.tipo === 'parado').map((a) => a.prospect_id).sort((a, b) => a - b);
  assert.deepEqual(parados, avisos);
  assert.deepEqual(parados, [p[2]]);
});

test('recorte: gestão vê tudo, supervisor só a equipe', async () => {
  const todos = await ler(ADMIN);
  const um = await ler(SUP_UM);
  const dois = await ler(SUP_DOIS);
  assert.equal(um.length + dois.length, todos.length);
  assert.ok(um.every((a) => [2, 3].includes(Number(a.vendedor_id))));
  assert.deepEqual([...new Set(dois.map((a) => a.vendedor_nome))], ['Vend Doze']);
  assert.throws(() => consultaAvisos({}), /usuário obrigatório/);
  const conferir = (await db.execute(consultaParaConferir({ usuario: SUP_DOIS }))).rows;
  assert.deepEqual(conferir.map((c) => [c.razao_social, c.motivo]), [['Mercado 12', 'Fora da rota / acesso difícil']]);
  assert.equal((await db.execute(consultaParaConferir({ usuario: SUP_UM }))).rows.length, 0);
});

test('tela Avisos: administrador, gerente e supervisor; o perfil do sistema já vem com ela (0031)', async () => {
  for (const perfil of ['administrador', 'gerente', 'supervisor']) assert.ok(podeTela({ id: 1, perfil }, 'avisos'), perfil);
  for (const perfil of ['vendedor', 'financeiro']) assert.ok(!podeTela({ id: 1, perfil, telas: ['avisos'] }, 'avisos'), perfil);
  const bases = (await db.execute("SELECT p.base FROM perfil_telas t JOIN perfis p ON p.id = t.perfil_id WHERE t.tela = 'avisos' ORDER BY p.base")).rows.map((r) => r.base);
  assert.deepEqual(bases, ['administrador', 'gerente', 'supervisor']);
  assert.equal(textoParametro('cadastro', { prazo_cadastro_dias: '15' }), 'Prazo: 15 dias');
  assert.equal(textoParametro('sem_lancar', { dias_alerta_sem_lancamento: '7' }), 'Limite: 7 dias');
  assert.equal(textoParametro('retorno', {}), 'Data do representante');
});

test('grade: um ramo por representante com total e resumo; mais atrasados primeiro; ramo fechado esconde os avisos', async () => {
  const avisos = await ler(SUP_UM);
  assert.equal(montarGradeAvisos({ avisos, niveis: ['representante'] }).filter((l) => !l.grupo).length, 0, 'a grade abre recolhida');
  const ramos = montarGradeAvisos({ avisos, niveis: ['representante'] }).map((l) => l.caminho);
  const grade = montarGradeAvisos({ avisos, niveis: ['representante'], abertos: new Set(ramos) });
  const grupos = grade.filter((l) => l.grupo);
  assert.deepEqual(grupos.map((g) => [g.rotulo, g.avisos.length]), [['Vend Dez', avisos.filter((a) => a.vendedor_nome === 'Vend Dez').length], ['Vend Onze', 1]]);
  assert.ok(grupos[0].avisos.length > 1);
  assert.equal(grupos[0].resumo, resumoAvisos(grupos[0].avisos));
  assert.match(grupos[0].resumo, /^1 sem movimento · 1 retorno vencido · 1 cadastro vencido/, 'na sequência do processo');
  assert.equal(contarAvisos(grupos[1].avisos).sem_lancar, 1);
  const itens = grade.filter((l) => !l.grupo && l.aviso.vendedor_nome === 'Vend Dez').map((l) => l.aviso.atraso);
  assert.deepEqual(itens, [...itens].sort((a, b) => b - a));
  const umAberto = montarGradeAvisos({ avisos, niveis: ['representante'], abertos: new Set([grupos[1].caminho]) });
  assert.equal(umAberto.filter((l) => !l.grupo).length, 1, 'aberto só o ramo do Vend Onze: só o aviso dele');
  // por cidade: o sem registrar fica no ramo "Do representante"
  const cidade = montarGradeAvisos({ avisos, niveis: ['cidade'] }).filter((l) => l.grupo).map((l) => l.rotulo);   // recolhida: só os ramos
  assert.ok(cidade.includes('Do representante'));
  assert.equal(ordenarAvisos(avisos)[0].tipo, 'sem_lancar', 'quem nunca registrou conta desde o início da campanha: o mais atrasado');
  assert.equal(resumoAvisos([]), '');
});

test('PDF de pendências: um bloco por representante, avisos por tipo e o para conferir dele', async () => {
  const avisos = await ler(ADMIN);
  const conferir = (await db.execute(consultaParaConferir({ usuario: ADMIN }))).rows;
  const reps = pendenciasPorRepresentante(avisos, conferir);
  assert.equal(reps.reduce((t, r) => t + r.avisos.length, 0), avisos.length);
  const doze = reps.find((r) => r.nome === 'Vend Doze');
  assert.deepEqual(doze.porTipo.map((b) => b.tipo.id), ['sem_lancar', 'cadastro']);
  assert.deepEqual(doze.conferir.map((c) => c.razao_social), ['Mercado 12']);
  assert.deepEqual(reps.map((r) => r.supervisor), [...reps.map((r) => r.supervisor)].sort((a, b) => a.localeCompare(b, 'pt-BR')), 'agrupado por supervisor');
});
