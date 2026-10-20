#!/usr/bin/env node
// Renova o cofre de administração antigo na publicação do site (pages.yml), sem ninguém rodar workflow (ADR-0006).
//   node scripts/renovar-cofres.mjs verificar   → grava precisa=true|false em $GITHUB_OUTPUT (só gera chave quando precisa)
//   node scripts/renovar-cofres.mjs gravar      → tranca GERMANI_CHAVE_ADMIN no cofre de quem precisa
// Senha: GERMANI_SENHA_INICIAL (Secret ADMIN_SENHA_INICIAL). Nunca imprime senha nem chave.
import { appendFile } from 'node:fs/promises';
import { abrir } from '../lib/db.mjs';
import { renovarCofresAdmin } from '../shared/usuarios.mjs';

const modo = process.argv[2];
if (modo !== 'verificar' && modo !== 'gravar') throw new Error('uso: renovar-cofres.mjs verificar|gravar');
const senha = process.env.GERMANI_SENHA_INICIAL?.trim() || null;
const novaChave = modo === 'gravar' ? process.env.GERMANI_CHAVE_ADMIN?.trim() || null : null;
if (modo === 'gravar' && !novaChave) throw new Error('GERMANI_CHAVE_ADMIN vazio');
const db = await abrir();
const r = await renovarCofresAdmin(db, { senha, novaChave, executadoPor: 'publicacao' });
db.close();
for (const l of r.semSenha) {
  console.log(`::warning::O cofre de ${l} tem chave antiga e a senha do Secret ADMIN_SENHA_INICIAL não o abre (senha trocada?). `
    + 'Para renová-lo: cadastre a senha atual nesse Secret e publique de novo.');
}
if (modo === 'gravar') {
  console.log(r.renovados.length ? `Cofre renovado: ${r.renovados.join(', ')}.` : 'Nenhum cofre a renovar.');
} else {
  console.log(r.pendentes.length ? `Cofre a renovar: ${r.pendentes.join(', ')}.` : 'Cofres de administração em dia.');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `precisa=${r.pendentes.length > 0}\n`);
}
