import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe } from './auxiliar.mjs';
import { carregarAcesso, definirPerfilUsuario, listarPerfis, opcoesDePerfil, perfisPossiveis, salvarPerfil, telasDoUsuario, telasPadrao, TELAS } from '../shared/perfis.mjs';
import { criarUsuarioEquipe, criarUsuarioSistema } from '../shared/usuarios.mjs';

test('perfis do sistema: um por tipo-base, com as telas de hoje (financeiro só crédito; administrador todas)', async () => {
  const db = await bancoTeste();
  const perfis = await listarPerfis(db);
  assert.equal(perfis.filter((p) => p.sistema).length, 5);
  for (const p of perfis) assert.deepEqual([...p.telas].sort(), [...telasPadrao(p.base)].sort(), p.base);
  assert.deepEqual(telasDoUsuario({ perfil: 'administrador' }).sort(), TELAS.map((t) => t.codigo).sort());
  assert.deepEqual(telasDoUsuario({ perfil: 'financeiro' }), ['credito']);
});

test('perfil criado: telas só do tipo-base, atribuído ao usuário de mesmo tipo; administrador do sistema é fixo', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);   // sup 1, vendedores 2 e 3, admin 4
  const id = await salvarPerfil(db, { nome: 'Supervisor regional', base: 'supervisor', telas: ['inicio', 'lista'], executadoPor: 'adm' });
  await assert.rejects(salvarPerfil(db, { nome: 'Errado', base: 'supervisor', telas: ['credito'], executadoPor: 'adm' }), /não serve para o tipo-base/);
  await assert.rejects(salvarPerfil(db, { nome: 'Vazio', base: 'vendedor', telas: [], executadoPor: 'adm' }), /ao menos uma tela/);
  const admin = (await listarPerfis(db)).find((p) => p.sistema && p.base === 'administrador');
  await assert.rejects(salvarPerfil(db, { id: admin.id, nome: 'Administrador', base: 'administrador', telas: ['inicio'], executadoPor: 'adm' }), /sempre todas as telas/);
  await assert.rejects(db.execute({ sql: 'DELETE FROM perfil_telas WHERE perfil_id = ?', args: [admin.id] }), /sempre todas as telas/);

  // sem perfil gravado = perfil do sistema do tipo-base
  assert.deepEqual((await carregarAcesso(db, { usuarioId: 1 })).telas.sort(), telasPadrao('supervisor').sort());
  await definirPerfilUsuario(db, { usuarioId: 1, perfilId: id, executadoPor: 'adm' });
  const acesso = await carregarAcesso(db, { usuarioId: 1 });
  assert.equal(acesso.perfil_nome, 'Supervisor regional');
  assert.deepEqual(acesso.telas.sort(), ['inicio', 'lista']);
  assert.deepEqual(telasDoUsuario({ perfil: 'supervisor', ...acesso }).sort(), ['inicio', 'lista']);
  // tipo-base diferente do perfil técnico do usuário: o banco recusa
  await assert.rejects(definirPerfilUsuario(db, { usuarioId: 2, perfilId: id, executadoPor: 'adm' }), /tipo-base do perfil não corresponde/);
  // editar o perfil muda as telas de quem o usa
  await salvarPerfil(db, { id, nome: 'Supervisor regional', base: 'supervisor', telas: ['inicio', 'lista', 'acompanhamento'], executadoPor: 'adm' });
  assert.equal((await carregarAcesso(db, { usuarioId: 1 })).telas.length, 3);
  assert.equal((await listarPerfis(db)).find((p) => p.id === id).usuarios, 1);
});

test('trocar o tipo do usuário pela tela: só entre administrador, gerente e financeiro; ex-administrador perde o cofre', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);   // sup 1, vendedores 2 e 3, admin 4
  const perfis = await listarPerfis(db);
  const sistema = (base) => perfis.find((p) => p.sistema && p.base === base).id;
  const { id: g } = await criarUsuarioSistema(db, { perfil: 'gerente', login: 'ger', nome: 'Gerente Um', executadoPor: 'adm' });
  assert.deepEqual(perfisPossiveis(perfis, { perfil: 'gerente' }).map((p) => p.base).sort(), ['administrador', 'financeiro', 'gerente']);
  assert.deepEqual(perfisPossiveis(perfis, { perfil: 'vendedor' }).map((p) => p.base), ['vendedor']);

  const r = await definirPerfilUsuario(db, { usuarioId: g, perfilId: sistema('financeiro'), executadoPor: 'adm', executadoPorId: 4 });
  assert.deepEqual(r, { base: 'financeiro', perfilId: null, mudouBase: true });
  assert.equal((await db.execute({ sql: 'SELECT perfil FROM usuarios WHERE id = ?', args: [g] })).rows[0].perfil, 'financeiro');
  assert.deepEqual((await carregarAcesso(db, { usuarioId: g })).telas, ['credito']);

  await db.execute({ sql: "UPDATE usuarios SET cofre_admin = 'x' WHERE id = ?", args: [g] });
  await definirPerfilUsuario(db, { usuarioId: g, perfilId: sistema('administrador'), executadoPor: 'adm', executadoPorId: 4 });
  await definirPerfilUsuario(db, { usuarioId: g, perfilId: sistema('gerente'), executadoPor: 'adm', executadoPorId: 4 });
  assert.equal((await db.execute({ sql: 'SELECT cofre_admin FROM usuarios WHERE id = ?', args: [g] })).rows[0].cofre_admin, null);

  await assert.rejects(definirPerfilUsuario(db, { usuarioId: 2, perfilId: sistema('gerente'), executadoPor: 'adm', executadoPorId: 4 }), /vêm da importação/);
  await assert.rejects(definirPerfilUsuario(db, { usuarioId: 4, perfilId: sistema('gerente'), executadoPor: 'adm', executadoPorId: 4 }), /próprio usuário/);
});

test('lista de perfis do usuário: todos aparecem; os que não servem trazem o motivo', async () => {
  const db = await bancoTeste();
  const id = await salvarPerfil(db, { nome: 'Supervisor regional', base: 'supervisor', telas: ['inicio'], executadoPor: 'adm' });
  const perfis = await listarPerfis(db);
  const op = (u, o) => Object.fromEntries(opcoesDePerfil(perfis, u, o).map((x) => [x.perfil.nome, x.motivo]));
  const gerente = op({ perfil: 'gerente' });
  assert.equal(Object.keys(gerente).length, perfis.length);
  assert.equal(gerente['Analista financeiro'], null);
  assert.match(gerente['Supervisor regional'], /novo usuário/);
  assert.match(op({ perfil: 'administrador' }, { proprio: true })['Gerente comercial'], /próprio usuário/);
  assert.match(op({ perfil: 'vendedor' })['Gerente comercial'], /só perfis do tipo Vendedor/);
  assert.equal(op(null)['Supervisor regional'], null, 'usuário novo pode ser supervisor ou vendedor');
  assert.ok(perfis.some((p) => p.id === id));
});

test('supervisor e vendedor criados pela tela: código do ERP obrigatório, vendedor com supervisor e tipo', async () => {
  const db = await bancoTeste();
  const sup = await criarUsuarioEquipe(db, { perfil: 'supervisor', login: 'ana', nome: 'Ana Sup', codigoErp: '950', executadoPor: 'adm', senha: 'senha1234' });
  await assert.rejects(criarUsuarioEquipe(db, { perfil: 'supervisor', login: 'ana2', nome: 'Ana Dois', codigoErp: '950', executadoPor: 'adm' }), /já existe supervisor com o código 950/);
  await assert.rejects(criarUsuarioEquipe(db, { perfil: 'vendedor', login: 'rep1', nome: 'Rep Um', codigoErp: '', executadoPor: 'adm' }), /código do ERP/);
  await assert.rejects(criarUsuarioEquipe(db, { perfil: 'vendedor', login: 'rep1', nome: 'Rep Um', codigoErp: '1501', tipo: 'representante', executadoPor: 'adm' }), /supervisor da equipe/);
  const v = await criarUsuarioEquipe(db, { perfil: 'vendedor', login: 'rep1', nome: 'Rep Um', codigoErp: '1501', supervisorId: sup.id, tipo: 'vendedor', executadoPor: 'adm' });
  const u = (await db.execute({ sql: 'SELECT perfil, codigo_erp, supervisor_id, tipo_atuacao, senha_provisoria FROM usuarios WHERE id = ?', args: [v.id] })).rows[0];
  assert.deepEqual({ ...u }, { perfil: 'vendedor', codigo_erp: '1501', supervisor_id: sup.id, tipo_atuacao: 'vendedor', senha_provisoria: 1 });
  assert.equal(v.senha.length, 10);
});

test('supervisor que vê todas as equipes (migração 0009): lê tudo, registra só na própria equipe', async () => {
  const { bancoTeste: b, criarEquipe: ce, criarProspect: cp, registrarContato: rc } = await import('./auxiliar.mjs');
  const { consultaCarteira } = await import('../shared/carteira.mjs');
  const { consultaPainel } = await import('../shared/painel.mjs');
  const { veTodasEquipes } = await import('../shared/perfis.mjs');
  const db = await b();
  await ce(db);   // sup 1 (vendedores 2 e 3), admin 4, sup 5 (sem equipe)
  await db.execute("INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES ('vendedor', '12', 'Vend Doze', 'VEND DOZE', 'v12', 5)"); // id 6, equipe do sup 5
  await cp(db, { n: 1, vendedorId: 2 });
  const deOutra = await cp(db, { n: 2, vendedorId: 6 });
  const idGer = await salvarPerfil(db, { nome: 'Gerente que vê', base: 'gerente', telas: ['inicio'], veTodos: true, executadoPor: 'adm' });
  assert.equal(Number((await db.execute({ sql: 'SELECT ve_todos FROM perfis WHERE id = ?', args: [idGer] })).rows[0].ve_todos), 0, 'só supervisor amplia');
  await assert.rejects(db.execute("INSERT INTO perfis (nome, base, ve_todos) VALUES ('x', 'vendedor', 1)"), /CHECK constraint/);
  const id = await salvarPerfil(db, { nome: 'Supervisor gerente', base: 'supervisor', telas: ['inicio', 'lista', 'acompanhamento', 'registrar'], veTodos: true, executadoPor: 'adm' });
  await definirPerfilUsuario(db, { usuarioId: 5, perfilId: id, executadoPor: 'adm' });
  const acesso = await carregarAcesso(db, { usuarioId: 5 });
  assert.equal(acesso.ve_todos, true);
  const sup = { id: 5, perfil: 'supervisor', ...acesso };
  assert.ok(veTodasEquipes(sup));
  assert.ok(!veTodasEquipes({ id: 1, perfil: 'supervisor' }));
  const lista = (await db.execute(consultaCarteira({ usuario: sup }))).rows;
  assert.equal(lista.length, 2, 'vê as duas equipes');
  assert.equal((await db.execute(consultaCarteira({ usuario: { id: 1, perfil: 'supervisor' } }))).rows.length, 1, 'supervisor comum: só a equipe');
  assert.equal((await db.execute(consultaPainel({ usuario: sup }))).rows.length >= 2, true);
  // registrar fora da equipe: o banco recusa (a leitura ampliada não muda a regra de gravação)
  await assert.rejects(rc(db, { prospectId: 1, usuarioId: 5, resultado: 'atendido', data: '2026-10-01' }));
  await rc(db, { prospectId: deOutra, usuarioId: 5, resultado: 'atendido', data: '2026-10-01' });
});
