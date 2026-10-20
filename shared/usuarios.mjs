// Administração de usuários — usada pela tela de administração e pelo script de contingência.
// Senhas são SEMPRE geradas pelo sistema (10 caracteres aleatórios) e mostradas uma única vez (ADR-0001).
import { gerarHashSenha } from './senha.mjs';
import { normalizarBusca } from './texto.mjs';
import { abrirCofre, fecharCofre, VERSAO_CHAVE_ADMIN, versaoDoCofre } from './cofre.mjs';

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

/** Senha gerada para quem terá cofre de administração: 14 caracteres, com letras e números. */
function gerarSenhaAdmin() {
  for (;;) { const s = gerarSenhaProvisoria(14); if (/[A-Za-z]/.test(s) && /\d/.test(s)) return s; }
}

function auditoria(executadoPor, acao, id, detalhes = {}) {
  return {
    sql: "INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, ?, 'usuarios', ?, ?)",
    args: [executadoPor, acao, String(id), JSON.stringify(detalhes)],
  };
}

export async function listarUsuarios(db) {
  const r = await db.execute(`
    SELECT u.id, u.login, u.perfil, u.perfil_id, u.tipo_atuacao, u.codigo_erp, u.nome, u.ativo, u.supervisor_id, s.nome AS supervisor_nome,
           CASE WHEN u.senha_hash IS NULL THEN 'sem_acesso' WHEN u.senha_provisoria = 1 THEN 'provisoria' ELSE 'ok' END AS situacao_senha
      FROM usuarios u LEFT JOIN usuarios s ON s.id = u.supervisor_id
     ORDER BY CASE u.perfil WHEN 'administrador' THEN 1 WHEN 'gerente' THEN 2 WHEN 'financeiro' THEN 3 WHEN 'supervisor' THEN 4 ELSE 5 END, u.nome`);
  return r.rows;
}

/**
 * Cria administrador, gerente comercial ou analista financeiro.
 * `senha` (opcional, mín. 8 caracteres): senha definida pelo administrador (tela de usuários ou Secret do workflow
 * "Criar administrador"). Sem ela, gera uma senha provisória, devolvida para mostrar uma vez.
 * `chaveAdmin` (opcional): chave de administração a trancar no cofre do novo ADMINISTRADOR com a senha dele
 * (ADR-0006) — assim ele entra só com usuário e senha. Exige senha forte (shared/cofre.mjs). `versaoChave`: versão das
 * permissões dessa chave (a da sessão de quem cria; a do Actions é a atual).
 */
export async function criarUsuarioSistema(db, { perfil, login, nome, executadoPor, senha: senhaInicial = null, chaveAdmin = null, versaoChave = null }) {
  if (!PERFIS_SISTEMA.includes(perfil)) throw new Error('perfil deve ser administrador, gerente ou financeiro');
  const l = String(login ?? '').trim();
  const n = String(nome ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(l)) throw new Error('login: 3 a 40 caracteres (letras, números, ponto, hífen)');
  if (n.length < 3) throw new Error('informe o nome');
  const comCofre = perfil === 'administrador' && chaveAdmin;
  const senha = senhaInicial ?? (comCofre ? gerarSenhaAdmin() : gerarSenhaProvisoria());
  const cofre = comCofre ? await fecharCofre(chaveAdmin, senha, { versao: versaoChave }) : null;
  const r = await db.execute({
    sql: 'INSERT INTO usuarios (perfil, nome, nome_busca, login, senha_hash, senha_provisoria, cofre_admin) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    args: [perfil, n, normalizarBusca(n), l, await gerarHashSenha(senha), senhaInicial ? 0 : 1, cofre],
  });
  const id = Number(r.rows[0].id);
  await db.execute(auditoria(executadoPor, `criar_${perfil}`, id, { login: l }));
  return { id, login: l, senha };
}

/**
 * Cria supervisor ou vendedor/representante pela tela (antes ou além da importação da base). Precisa do código do ERP
 * (é por ele que a importação reconhece o mesmo usuário e liga os prospects) e, para vendedor, do supervisor da equipe.
 * `tipo` (vendedor): 'representante' (sem rota) ou 'vendedor' (com rota).
 */
export async function criarUsuarioEquipe(db, { perfil, login, nome, codigoErp, supervisorId = null, tipo = null, executadoPor, senha: senhaInicial = null }) {
  if (!['supervisor', 'vendedor'].includes(perfil)) throw new Error('perfil deve ser supervisor ou vendedor');
  const l = String(login ?? '').trim();
  const n = String(nome ?? '').trim();
  const cod = String(codigoErp ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(l)) throw new Error('login: 3 a 40 caracteres (letras, números, ponto, hífen)');
  if (n.length < 3) throw new Error('informe o nome');
  if (!cod) throw new Error('informe o código do ERP (a importação da base usa esse código)');
  if (perfil === 'vendedor') {
    if (!TIPOS_ATUACAO.includes(tipo)) throw new Error('escolha representante ou vendedor');
    const sup = (await db.execute({ sql: "SELECT id FROM usuarios WHERE id = ? AND perfil = 'supervisor'", args: [supervisorId ?? 0] })).rows[0];
    if (!sup) throw new Error('escolha o supervisor da equipe');
  }
  const repetido = (await db.execute({ sql: 'SELECT login FROM usuarios WHERE perfil = ? AND codigo_erp = ?', args: [perfil, cod] })).rows[0];
  if (repetido) throw new Error(`já existe ${perfil} com o código ${cod} (login ${repetido.login})`);
  const senha = senhaInicial ?? gerarSenhaProvisoria();
  const r = await db.execute({
    sql: `INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, senha_hash, senha_provisoria, supervisor_id, tipo_atuacao)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [perfil, cod, n, normalizarBusca(n), l, await gerarHashSenha(senha), senhaInicial ? 0 : 1,
      perfil === 'vendedor' ? supervisorId : null, perfil === 'vendedor' ? tipo : null],
  });
  const id = Number(r.rows[0].id);
  await db.execute(auditoria(executadoPor, `criar_${perfil}`, id, { login: l, codigo_erp: cod, tipo }));
  return { id, login: l, senha };
}

/**
 * Define a senha do usuário (também libera o acesso de quem veio da importação sem senha).
 * `senha` informada pelo administrador (mín. 8 caracteres); sem ela, gera uma senha provisória.
 * Para um ADMINISTRADOR, `chaveAdmin` regrava o cofre com a nova senha; sem ela, o cofre antigo é apagado
 * (nunca fica um cofre que abre com a senha anterior).
 */
export async function redefinirSenha(db, { usuarioId, executadoPor, senha: definida = null, chaveAdmin = null, versaoChave = null }) {
  const alvo = (await db.execute({ sql: 'SELECT perfil FROM usuarios WHERE id = ?', args: [usuarioId] })).rows[0];
  if (!alvo) throw new Error('usuário não encontrado');
  const comCofre = alvo.perfil === 'administrador' && chaveAdmin;
  const senha = definida ?? (comCofre ? gerarSenhaAdmin() : gerarSenhaProvisoria());
  const cofre = comCofre ? await fecharCofre(chaveAdmin, senha, { versao: versaoChave }) : null;
  const hash = await gerarHashSenha(senha);
  const r = await db.batch([
    { sql: "UPDATE usuarios SET senha_hash = ?, senha_provisoria = ?, cofre_admin = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING login", args: [hash, definida ? 0 : 1, cofre, usuarioId] },
    auditoria(executadoPor, definida ? 'senha_definida' : 'senha_provisoria', usuarioId),
  ], 'write');
  if (!r[0].rows.length) throw new Error('usuário não encontrado');
  return { login: r[0].rows[0].login, senha };
}

/**
 * Renova, sem ninguém rodar workflow, o cofre dos administradores cuja chave é de versão antiga (ADR-0006): a publicação do
 * site chama isto com a senha do Secret ADMIN_SENHA_INICIAL. Só renova o cofre que essa senha abre (quem trocou a senha
 * fica em `semSenha`). Sem `novaChave`, só verifica: `pendentes` diz se vale gerar uma chave nova (gera só quando precisa).
 */
export async function renovarCofresAdmin(db, { senha, novaChave = null, executadoPor = 'publicacao' }) {
  const r = await db.execute("SELECT id, login, cofre_admin FROM usuarios WHERE perfil = 'administrador' AND ativo = 1 AND cofre_admin IS NOT NULL ORDER BY id");
  const saida = { pendentes: [], semSenha: [], renovados: [] };
  for (const u of r.rows) {
    if (versaoDoCofre(u.cofre_admin) >= VERSAO_CHAVE_ADMIN) continue;
    if (!senha || (await abrirCofre(u.cofre_admin, senha)) === null) { saida.semSenha.push(u.login); continue; }
    saida.pendentes.push(u.login);
    if (!novaChave) continue;
    await db.batch([
      { sql: "UPDATE usuarios SET cofre_admin = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        args: [await fecharCofre(novaChave, senha, { versao: VERSAO_CHAVE_ADMIN }), u.id] },
      auditoria(executadoPor, 'cofre_renovado', u.id, { versao: VERSAO_CHAVE_ADMIN }),
    ], 'write');
    saida.renovados.push(u.login);
  }
  return saida;
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
