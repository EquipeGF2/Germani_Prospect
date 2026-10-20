import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe } from './auxiliar.mjs';
import { carregarAcesso, definirPerfilUsuario, listarPerfis, perfisPossiveis, salvarPerfil, telasDoUsuario, telasPadrao, TELAS } from '../shared/perfis.mjs';
import { criarUsuarioSistema } from '../shared/usuarios.mjs';

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
