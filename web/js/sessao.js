// Login por usuário e senha (senha gerada pelo administrador; hash PBKDF2 conferido no aparelho — ADR-0001).
import { bancoApp, limparTokenAdmin } from './db.js';
import { conferirSenha } from '../shared/senha.mjs';

const CHAVE = 'germani.sessao';

export function usuarioAtual() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) ?? null; } catch { return null; }
}

export async function entrar(login, senha) {
  const db = await bancoApp();
  const r = await db.execute({
    sql: 'SELECT id, login, nome, perfil, tipo_atuacao, supervisor_id, senha_hash, ativo FROM usuarios WHERE login = ?',
    args: [String(login ?? '').trim()],
  });
  const u = r.rows[0];
  const ok = u && Number(u.ativo) === 1 && u.senha_hash && (await conferirSenha(String(senha ?? ''), u.senha_hash));
  if (!ok) throw new Error('Login ou senha inválidos, ou acesso ainda não liberado.');
  const sessao = { id: Number(u.id), login: u.login, nome: u.nome, perfil: u.perfil, tipo_atuacao: u.tipo_atuacao ?? null,
    supervisor_id: u.supervisor_id == null ? null : Number(u.supervisor_id) };
  try { localStorage.setItem(CHAVE, JSON.stringify(sessao)); } catch { /* sessão só nesta página */ }
  return sessao;
}

export function sair() {
  try { localStorage.removeItem(CHAVE); } catch { /* nada */ }
  limparTokenAdmin();
}
