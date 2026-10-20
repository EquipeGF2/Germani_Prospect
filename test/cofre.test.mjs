import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirCofre, fecharCofre } from '../shared/cofre.mjs';
import { bancoTeste, criarEquipe } from './auxiliar.mjs';
import { criarUsuarioSistema, redefinirSenha } from '../shared/usuarios.mjs';

test('cofre: abre só com a senha certa; senha fraca não tranca; texto cifrado não mostra a chave', async () => {
  const c = await fecharCofre('eyJ.chave.secreta', 'Germani2026forte');
  assert.ok(!c.includes('chave.secreta'));
  assert.equal(await abrirCofre(c, 'Germani2026forte'), 'eyJ.chave.secreta');
  assert.equal(await abrirCofre(c, 'outra-senha-123'), null);
  assert.equal(await abrirCofre('lixo', 'Germani2026forte'), null);
  await assert.rejects(fecharCofre('x', '37197525'), /12 caracteres/);
  await assert.rejects(fecharCofre('x', 'somenteletrasaqui'), /letras e números/);
});

test('administrador com cofre: criado com a chave; nova senha regrava; senha sem chave apaga o cofre', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const a = await criarUsuarioSistema(db, { perfil: 'administrador', login: 'chefe', nome: 'Chefe Teste', executadoPor: 't', senha: 'SenhaForte2026', chaveAdmin: 'eyJ.adm' });
  const cofre = async () => (await db.execute({ sql: 'SELECT cofre_admin FROM usuarios WHERE id = ?', args: [a.id] })).rows[0].cofre_admin;
  assert.equal(await abrirCofre(await cofre(), 'SenhaForte2026'), 'eyJ.adm');
  // senha gerada para administrador com cofre: forte (14, letras e números) e abre o cofre
  const g = await redefinirSenha(db, { usuarioId: a.id, executadoPor: 't', chaveAdmin: 'eyJ.adm' });
  assert.match(g.senha, /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{14}$/);
  assert.equal(await abrirCofre(await cofre(), g.senha), 'eyJ.adm');
  assert.equal(await abrirCofre(await cofre(), 'SenhaForte2026'), null, 'a senha anterior não abre mais');
  await redefinirSenha(db, { usuarioId: a.id, executadoPor: 't', senha: 'OutraSenha2027' });
  assert.equal(await cofre(), null, 'sem a chave, o cofre antigo é apagado');
  await assert.rejects(criarUsuarioSistema(db, { perfil: 'administrador', login: 'fraco', nome: 'Fraco Teste', executadoPor: 't', senha: '37197525', chaveAdmin: 'eyJ.adm' }), /12 caracteres/);
  // outros perfis nunca recebem cofre
  const f = await criarUsuarioSistema(db, { perfil: 'financeiro', login: 'fin', nome: 'Fin Teste', executadoPor: 't', senha: 'financeiro1', chaveAdmin: 'eyJ.adm' });
  assert.equal((await db.execute({ sql: 'SELECT cofre_admin FROM usuarios WHERE id = ?', args: [f.id] })).rows[0].cofre_admin, null);
});
