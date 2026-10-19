// Administração de usuários — usada pela tela de administração e pelo script de contingência.
// Senhas são SEMPRE geradas pelo sistema (10 caracteres aleatórios) e mostradas uma única vez (ADR-0001).
import { gerarHashSenha } from './senha.mjs';
import { normalizarBusca } from './texto.mjs';

export const PERFIS_SISTEMA = Object.freeze(['administrador', 'gerente', 'financeiro']); // criados manualmente
export const TIPOS_ATUACAO = Object.freeze(['representante', 'vendedor']);
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function gerarSenhaProvisoria(tamanho = 10) {
  const limite = 256 - (256 % ALFABETO.length); // evita viés
  const saida = [];
  while (saida.length < tamanho) {
    for (const b of crypto.getRandomValues(new Uint8Array(tamanho * 2))) {
      if (b < limite && saida.length < tamanho) saida.push(ALFABETO[b % ALFABETO.length]);
    }
  }
  return saida.join('');
}

function auditoria(executadoPor, acao, id, detalhes = {}) {
  return {
    sql: "INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, ?, 'usuarios', ?, ?)",
    args: [executadoPor, acao, String(id), JSON.stringify(detalhes)],
  };
}

export async function listarUsuarios(db) {
  const r = await db.execute(`
    SELECT u.id, u.login, u.perfil, u.tipo_atuacao, u.codigo_erp, u.nome, u.ativo, u.supervisor_id, s.nome AS supervisor_nome,
           CASE WHEN u.senha_hash IS NULL THEN 'sem_acesso' WHEN u.senha_provisoria = 1 THEN 'provisoria' ELSE 'ok' END AS situacao_senha,
           (SELECT count(*) FROM prospects p WHERE p.vendedor_id = u.id) AS prospects
      FROM usuarios u LEFT JOIN usuarios s ON s.id = u.supervisor_id
     ORDER BY CASE u.perfil WHEN 'administrador' THEN 1 WHEN 'gerente' THEN 2 WHEN 'financeiro' THEN 3 WHEN 'supervisor' THEN 4 ELSE 5 END, u.nome`);
  return r.rows;
}

/** Cria administrador, gerente comercial ou analista financeiro. Devolve a senha provisória (mostrar uma vez). */
export async function criarUsuarioSistema(db, { perfil, login, nome, executadoPor }) {
  if (!PERFIS_SISTEMA.includes(perfil)) throw new Error('perfil deve ser administrador, gerente ou financeiro');
  const l = String(login ?? '').trim();
  const n = String(nome ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(l)) throw new Error('login: 3 a 40 caracteres (letras, números, ponto, hífen)');
  if (n.length < 3) throw new Error('informe o nome');
  const senha = gerarSenhaProvisoria();
  const r = await db.execute({
    sql: 'INSERT INTO usuarios (perfil, nome, nome_busca, login, senha_hash) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: [perfil, n, normalizarBusca(n), l, await gerarHashSenha(senha)],
  });
  const id = Number(r.rows[0].id);
  await db.execute(auditoria(executadoPor, `criar_${perfil}`, id, { login: l }));
  return { id, login: l, senha };
}

/** Gera nova senha provisória (também libera o acesso de quem veio da importação sem senha). */
export async function redefinirSenha(db, { usuarioId, executadoPor }) {
  const senha = gerarSenhaProvisoria();
  const hash = await gerarHashSenha(senha);
  const r = await db.batch([
    { sql: "UPDATE usuarios SET senha_hash = ?, senha_provisoria = 1, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING login", args: [hash, usuarioId] },
    auditoria(executadoPor, 'senha_provisoria', usuarioId),
  ], 'write');
  if (!r[0].rows.length) throw new Error('usuário não encontrado');
  return { login: r[0].rows[0].login, senha };
}

export async function definirTipoAtuacao(db, { usuarioId, tipo, executadoPor }) {
  if (!TIPOS_ATUACAO.includes(tipo)) throw new Error('tipo deve ser representante ou vendedor');
  await db.batch([
    { sql: "UPDATE usuarios SET tipo_atuacao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", args: [tipo, usuarioId] },
    auditoria(executadoPor, 'tipo_atuacao', usuarioId, { tipo }),
  ], 'write');
}

export async function definirAtivo(db, { usuarioId, ativo, executadoPor }) {
  await db.batch([
    { sql: "UPDATE usuarios SET ativo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", args: [ativo ? 1 : 0, usuarioId] },
    auditoria(executadoPor, ativo ? 'ativar' : 'desativar', usuarioId),
  ], 'write');
}
