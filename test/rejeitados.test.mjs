// Rejeitados (docs/03 §16): baixados, expurgados e sem interesse do cliente e do representante, com hierarquia, motivos e exportação por tipo.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, registrarContato } from './auxiliar.mjs';
import { comandosExpurgo } from '../shared/grupos.mjs';
import { consultaResumo } from '../shared/explorar.mjs';
import { buscarRejeitados, consultaResumoRejeitados, naLinha, consultaRejeitados, contarMotivos, contarRejeitados, montarArvoreRejeitados, paraExportar, prepararRejeitado } from '../shared/rejeitados.mjs';
import { podeTela } from '../shared/perfis.mjs';

let db; let clientes; let base;
const ADMIN = { id: 4, perfil: 'administrador' };

before(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
  const p = [];
  for (let n = 1; n <= 8; n += 1) p.push(await criarProspect(db, { n, vendedorId: n <= 5 ? 2 : 3, onda: n <= 4 ? '1' : '2', razao: `Mercado ${n}` }));
  await registrarContato(db, { prospectId: p[0], resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-05' });
  await registrarContato(db, { prospectId: p[1], resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-06' });
  await registrarContato(db, { prospectId: p[2], resultado: 'sem_interesse', motivo: 'REP_FORA_ROTA', data: '2026-11-02' });
  await evento(db, { prospectId: p[5], tipo: 'baixa', data: '2026-10-10' });
  await db.batch(comandosExpurgo({ usuario: ADMIN, prospectIds: [p[6]], acao: 'expurgar', motivo: 'Já é cliente no ERP (mesmo CNPJ)', data: '2026-10-23' }), 'write');
  await registrarContato(db, { prospectId: p[7], usuarioId: 3, resultado: 'atendido', data: '2026-10-05' });   // atendido: não é rejeitado
  clientes = (await db.execute(consultaRejeitados({ usuario: ADMIN }))).rows.map(prepararRejeitado);
  base = (await db.execute(consultaResumo({ usuario: ADMIN }))).rows;
});

test('tipo, motivo e data de cada rejeitado; atendido fica de fora', () => {
  const por = Object.fromEntries(clientes.map((l) => [l.razao_social, [l.tipo, l.motivo, l.data]]));
  assert.deepEqual(por, {
    'Mercado 1': ['cliente', 'Preço acima do praticado', '2026-10-05'],
    'Mercado 2': ['cliente', 'Preço acima do praticado', '2026-10-06'],
    'Mercado 3': ['representante', 'Fora da rota / acesso difícil', '2026-11-02'],
    'Mercado 6': ['baixado', 'CNPJ baixado', '2026-10-10'],
    'Mercado 7': ['expurgado', 'Já é cliente no ERP (mesmo CNPJ)', '2026-10-23'],
  });
  assert.deepEqual(contarRejeitados(clientes), { baixado: 1, expurgado: 1, cliente: 2, representante: 1, total: 5 });
});

test('hierarquia com Na base do resumo; pelo mês da rejeição, Na base fica vazio', () => {
  const arvore = montarArvoreRejeitados({ clientes, base, niveis: ['representante', 'mes'], abertos: new Set(['', '/representante=2']) });
  assert.deepEqual(arvore.map((n) => [n.rotulo, n.cont.total, n.naBase]), [
    ['Todos os clientes', 5, 8], ['Vend Dez', 3, 5], ['out/2026', 2, null], ['nov/2026', 1, null], ['Vend Onze', 2, 3]]);
  const ondas = montarArvoreRejeitados({ clientes, base, niveis: ['onda'], abertos: new Set(['']) });
  assert.deepEqual(ondas.slice(1).map((n) => [n.rotulo, n.cont.total, n.naBase]), [['Onda 1', 3, 4], ['Onda 2', 2, 4]]);
});

test('motivos por tipo de sem interesse, busca e exportação de um ou mais tipos', () => {
  assert.deepEqual(contarMotivos(clientes, 'cliente'), [{ motivo: 'Preço acima do praticado', qtd: 2 }]);
  assert.deepEqual(contarMotivos(clientes, 'representante'), [{ motivo: 'Fora da rota / acesso difícil', qtd: 1 }]);
  assert.deepEqual(buscarRejeitados(clientes, 'mercado 7').map((l) => l.tipo), ['expurgado']);
  assert.deepEqual(paraExportar(clientes, ['baixado', 'cliente']).map((l) => [l.tipo, l.razao_social]), [['baixado', 'Mercado 6'], ['cliente', 'Mercado 1'], ['cliente', 'Mercado 2']]);
  assert.deepEqual(paraExportar(clientes, ['representante']).map((l) => l.razao_social), ['Mercado 3']);
  assert.deepEqual(paraExportar(clientes, []), []);
});

test('gerente, administrador e supervisor veem a tela; o supervisor só a equipe dele', async () => {
  assert.ok(podeTela({ id: 4, perfil: 'administrador' }, 'rejeitados'));
  assert.ok(podeTela({ id: 9, perfil: 'gerente' }, 'rejeitados'));
  assert.ok(podeTela({ id: 1, perfil: 'supervisor' }, 'rejeitados'));
  for (const perfil of ['vendedor', 'financeiro']) assert.ok(!podeTela({ id: 1, perfil, telas: ['rejeitados'] }, 'rejeitados'), perfil);
  const ler = async (usuario) => (await db.execute(consultaRejeitados({ usuario }))).rows.length;
  const resumo = async (usuario) => contarRejeitados((await db.execute(consultaResumoRejeitados({ usuario }))).rows.map(prepararRejeitado)).total;
  assert.equal(await ler({ id: 1, perfil: 'supervisor' }), 5, 'Sup Um: a equipe dele (Vend Dez e Vend Onze)');
  assert.equal(await resumo({ id: 1, perfil: 'supervisor' }), 5);
  assert.equal(await ler({ id: 5, perfil: 'supervisor' }), 0, 'Sup Dois: outra equipe, nada');
  assert.equal(await resumo({ id: 5, perfil: 'supervisor' }), 0);
  assert.throws(() => consultaRejeitados(), /usuário obrigatório/);
  const tela = (await db.execute("SELECT 1 FROM perfil_telas t JOIN perfis p ON p.id = t.perfil_id WHERE p.sistema = 1 AND p.base = 'supervisor' AND t.tela = 'rejeitados'")).rows.length;
  assert.equal(tela, 1, 'o perfil Supervisor já vem com a tela (0030)');
});

test('a tela lê só as contagens: mesmas contas, árvore e motivos que o detalhe; o detalhe vem só na exportação', async () => {
  const resumo = (await db.execute(consultaResumoRejeitados({ usuario: ADMIN }))).rows.map(prepararRejeitado);
  assert.ok(resumo.length <= clientes.length);
  assert.deepEqual(contarRejeitados(resumo), contarRejeitados(clientes));
  assert.deepEqual(contarMotivos(resumo, 'cliente'), contarMotivos(clientes, 'cliente'));
  const arv = (ls) => montarArvoreRejeitados({ clientes: ls, base, niveis: ['representante', 'mes'], abertos: new Set(['', '/representante=2']) }).map((n) => [n.caminho, n.cont.total, n.naBase]);
  assert.deepEqual(arv(resumo), arv(clientes));
  // a exportação da linha escolhida: o detalhe filtrado pelo mesmo caminho
  assert.deepEqual(clientes.filter((l) => naLinha('/representante=2/mes=2026-10', l)).map((l) => l.razao_social).sort(), ['Mercado 1', 'Mercado 2']);
  assert.equal(clientes.filter((l) => naLinha('', l)).length, 5);
  const dados = clientes.find((l) => l.razao_social === 'Mercado 1');
  for (const campo of ['endereco', 'bairro', 'cep', 'telefone', 'nome_fantasia', 'tentativas', 'observacao', 'vendedor_nome', 'supervisor_nome']) assert.ok(campo in dados, `exporta ${campo}`);
});
