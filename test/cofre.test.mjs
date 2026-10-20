import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirCofre, fecharCofre, VERSAO_CHAVE_ADMIN, versaoDoCofre } from '../shared/cofre.mjs';
import { bancoTeste, criarEquipe } from './auxiliar.mjs';
import { criarUsuarioSistema, redefinirSenha, renovarCofresAdmin } from '../shared/usuarios.mjs';

test('cofre: abre só com a senha certa; senha fraca não tranca; texto cifrado não mostra a chave', async () => {
  const c = await fecharCofre('eyJ.chave.secreta', 'Germani2026forte');
  assert.ok(!c.includes('chave.secreta'));
  assert.equal(await abrirCofre(c, 'Germani2026forte'), 'eyJ.chave.secreta');
  assert.equal(await abrirCofre(c, 'outra-senha-123'), null);
  assert.equal(await abrirCofre('lixo', 'Germani2026forte'), null);
  await assert.rejects(fecharCofre('x', '1234567'), /8 caracteres/);
  assert.equal(await abrirCofre(await fecharCofre('eyJ.x', '12345678'), '12345678'), 'eyJ.x');   // 8 dígitos bastam
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
  await assert.rejects(criarUsuarioSistema(db, { perfil: 'administrador', login: 'fraco', nome: 'Fraco Teste', executadoPor: 't', senha: 'curta', chaveAdmin: 'eyJ.adm' }), /8 caracteres/);
  // outros perfis nunca recebem cofre
  const f = await criarUsuarioSistema(db, { perfil: 'financeiro', login: 'fin', nome: 'Fin Teste', executadoPor: 't', senha: 'financeiro1', chaveAdmin: 'eyJ.adm' });
  assert.equal((await db.execute({ sql: 'SELECT cofre_admin FROM usuarios WHERE id = ?', args: [f.id] })).rows[0].cofre_admin, null);
});

test('publicação renova sozinha o cofre de chave antiga que a senha do Secret abre; o resto fica como está', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const a = await criarUsuarioSistema(db, { perfil: 'administrador', login: 'chefe', nome: 'Chefe Teste', executadoPor: 't', senha: 'SenhaSecret2026', chaveAdmin: 'eyJ.antiga' });
  const b = await criarUsuarioSistema(db, { perfil: 'administrador', login: 'trocou', nome: 'Trocou Senha', executadoPor: 't', senha: 'OutraSenha2026', chaveAdmin: 'eyJ.antiga' });
  const c = await criarUsuarioSistema(db, { perfil: 'administrador', login: 'novo', nome: 'Novo Teste', executadoPor: 't', senha: 'SenhaSecret2026', chaveAdmin: 'eyJ.ampla', versaoChave: VERSAO_CHAVE_ADMIN });
  const cofre = async (id) => (await db.execute({ sql: 'SELECT cofre_admin FROM usuarios WHERE id = ?', args: [id] })).rows[0].cofre_admin;
  assert.equal(versaoDoCofre(await cofre(a.id)), 1);
  assert.equal(versaoDoCofre(await cofre(c.id)), VERSAO_CHAVE_ADMIN);
  // verificar não grava nada
  assert.deepEqual(await renovarCofresAdmin(db, { senha: 'SenhaSecret2026' }), { pendentes: ['chefe'], semSenha: ['trocou'], renovados: [] });
  assert.equal(await abrirCofre(await cofre(a.id), 'SenhaSecret2026'), 'eyJ.antiga');
  const g = await renovarCofresAdmin(db, { senha: 'SenhaSecret2026', novaChave: 'eyJ.ampla', executadoPor: 'publicacao' });
  assert.deepEqual(g.renovados, ['chefe']);
  assert.equal(await abrirCofre(await cofre(a.id), 'SenhaSecret2026'), 'eyJ.ampla');
  assert.equal(versaoDoCofre(await cofre(a.id)), VERSAO_CHAVE_ADMIN);
  assert.equal(await abrirCofre(await cofre(b.id), 'OutraSenha2026'), 'eyJ.antiga', 'quem trocou a senha não perde o cofre');
  assert.equal(await abrirCofre(await cofre(c.id), 'SenhaSecret2026'), 'eyJ.ampla');
  // publicação seguinte: nada a fazer (não gera chave nova a cada semana)
  assert.deepEqual((await renovarCofresAdmin(db, { senha: 'SenhaSecret2026' })).pendentes, []);
  // trocar a senha pela tela com a chave da sessão mantém a versão
  await redefinirSenha(db, { usuarioId: a.id, executadoPor: 't', senha: 'NovaSenha2027', chaveAdmin: 'eyJ.ampla', versaoChave: VERSAO_CHAVE_ADMIN });
  assert.equal(versaoDoCofre(await cofre(a.id)), VERSAO_CHAVE_ADMIN);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'cofre_renovado'")).rows[0].n), 1);
});
