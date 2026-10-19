#!/usr/bin/env node
// Administração de usuários (executar localmente com o .env do administrador).
//   npm run usuarios -- listar
//   npm run usuarios -- criar-admin <login> "<Nome>"
//   npm run usuarios -- senha <login>          gera senha provisória (troca obrigatória no 1º acesso)
//   npm run usuarios -- tipo <login> representante|vendedor   forma de trabalho (representante não tem rota)
//   npm run usuarios -- desativar <login>
//   npm run usuarios -- ativar <login>
import { randomInt } from 'node:crypto';
import { abrir } from '../lib/db.mjs';
import { executor } from '../lib/cli.mjs';
import { gerarHashSenha } from '../shared/senha.mjs';
import { normalizarBusca } from '../shared/texto.mjs';

const [comando, login, nome] = process.argv.slice(2);
const TIPOS = ['representante', 'vendedor'];
const db = await abrir();
const quem = executor();

async function auditar(acao, entidadeId, detalhes = {}) {
  await db.execute({
    sql: 'INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, ?, ?, ?, ?)',
    args: [quem, acao, 'usuarios', String(entidadeId), JSON.stringify(detalhes)],
  });
}

function senhaProvisoria() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => alfabeto[randomInt(alfabeto.length)]).join('');
}

async function exigirUsuario(l) {
  const r = await db.execute({ sql: 'SELECT id, nome, perfil FROM usuarios WHERE login = ?', args: [l] });
  if (!r.rows.length) throw new Error(`usuário não encontrado: ${l}`);
  return r.rows[0];
}

switch (comando) {
  case 'listar': {
    const r = await db.execute(`SELECT u.login, u.perfil, u.tipo_atuacao, u.codigo_erp, u.nome, s.nome AS supervisor, u.ativo,
                                       CASE WHEN u.senha_hash IS NULL THEN 'sem acesso' WHEN u.senha_provisoria = 1 THEN 'provisória' ELSE 'ok' END AS senha
                                  FROM usuarios u LEFT JOIN usuarios s ON s.id = u.supervisor_id
                                 ORDER BY u.perfil, u.nome`);
    console.table(r.rows.map((x) => ({ ...x })));
    break;
  }
  case 'criar-admin': {
    if (!login || !nome) throw new Error('uso: criar-admin <login> "<Nome>"');
    const senha = senhaProvisoria();
    const r = await db.execute({
      sql: `INSERT INTO usuarios (perfil, nome, nome_busca, login, senha_hash) VALUES ('administrador', ?, ?, ?, ?) RETURNING id`,
      args: [nome, normalizarBusca(nome), login, await gerarHashSenha(senha)],
    });
    await auditar('criar_admin', r.rows[0].id, { login });
    console.log(`Administrador criado. Login: ${login}  Senha provisória: ${senha}`);
    break;
  }
  case 'senha': {
    const u = await exigirUsuario(login);
    const senha = senhaProvisoria();
    await db.execute({
      sql: `UPDATE usuarios SET senha_hash = ?, senha_provisoria = 1, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      args: [await gerarHashSenha(senha), u.id],
    });
    await auditar('senha_provisoria', u.id);
    console.log(`${u.nome} (${u.perfil}) — login: ${login}  senha provisória: ${senha}`);
    break;
  }
  case 'tipo': {
    if (!TIPOS.includes(nome)) throw new Error('uso: tipo <login> representante|vendedor');
    const u = await exigirUsuario(login);
    await db.execute({ sql: `UPDATE usuarios SET tipo_atuacao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, args: [nome, u.id] });
    await auditar('tipo_atuacao', u.id, { tipo: nome });
    console.log(`${u.nome}: ${nome}`);
    break;
  }
  case 'desativar':
  case 'ativar': {
    const u = await exigirUsuario(login);
    await db.execute({ sql: `UPDATE usuarios SET ativo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, args: [comando === 'ativar' ? 1 : 0, u.id] });
    await auditar(comando, u.id);
    console.log(`${u.nome}: ${comando === 'ativar' ? 'ativado' : 'desativado'}`);
    break;
  }
  default:
    console.error('comandos: listar | criar-admin <login> "<Nome>" | senha <login> | tipo <login> representante|vendedor | desativar <login> | ativar <login>');
    process.exitCode = 1;
}
db.close();
