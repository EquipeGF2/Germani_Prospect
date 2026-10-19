#!/usr/bin/env node
// Uso: npm run migrate            (lê TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)
import { abrir } from '../lib/db.mjs';
import { aplicarMigracoes } from '../lib/migracoes.mjs';

const db = await abrir();
const novas = await aplicarMigracoes(db, { log: console.log });
console.log(novas.length ? `${novas.length} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
db.close();
