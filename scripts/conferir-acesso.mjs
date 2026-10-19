#!/usr/bin/env node
// Diagnóstico do login (workflow "Criar administrador"): entra no banco do jeito que o SITE entra
// (URL da variável + token do app) e diz se encontra o usuário e se a senha confere. Nunca imprime senha nem token.
//   CONF_LOGIN, CONF_SENHA, SITE_URL (vars.TURSO_DATABASE_URL), SITE_TOKEN (secrets.TURSO_APP_TOKEN), ADMIN_URL (secrets.TURSO_DATABASE_URL)
import { createClient } from '@libsql/client';
import { conferirSenha } from '../shared/senha.mjs';

const { CONF_LOGIN: login, CONF_SENHA: senha, SITE_URL: url, SITE_TOKEN: token, ADMIN_URL: urlAdmin } = process.env;
const linha = (ok, texto) => console.log(`${ok ? 'OK  ' : 'ERRO'} ${texto}`);
let falhou = false;
const erro = (texto) => { falhou = true; linha(false, texto); };

if (!url) erro('Variável TURSO_DATABASE_URL (Settings → Variables) não está definida: o site é publicado em MODO DEMONSTRAÇÃO.');
if (!token) erro('Secret TURSO_APP_TOKEN não está definido: o site é publicado em MODO DEMONSTRAÇÃO.');
if (url && urlAdmin) {
  if (url.trim() === urlAdmin.trim()) linha(true, 'o site e os workflows usam o mesmo banco');
  else erro('a VARIÁVEL TURSO_DATABASE_URL (site) é diferente do SECRET TURSO_DATABASE_URL (workflows): o usuário foi criado em outro banco');
}
if (url && token) {
  try {
    const db = createClient({ url: url.trim(), authToken: token.trim() });
    const r = await db.execute({ sql: 'SELECT login, perfil, ativo, senha_hash FROM usuarios WHERE login = ?', args: [login] });
    const u = r.rows[0];
    if (!u) erro(`com o token do app, o usuário "${login}" não foi encontrado`);
    else {
      linha(true, `com o token do app, o site encontra "${login}" (perfil ${u.perfil})`);
      if (!Number(u.ativo)) erro('usuário desativado');
      else if (!u.senha_hash) erro('usuário sem senha');
      else if (await conferirSenha(senha, u.senha_hash)) linha(true, 'a senha do Secret ADMIN_SENHA_INICIAL confere — digite exatamente essa senha no site');
      else erro('a senha gravada não confere com o Secret ADMIN_SENHA_INICIAL');
    }
  } catch (e) {
    erro(`o token do app não conseguiu ler o banco: ${String(e.message).replace(/eyJ[\w.-]+/g, '***')}`);
  }
}
if (falhou) process.exitCode = 1;
