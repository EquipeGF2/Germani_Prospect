// Perfis de acesso: cada perfil tem um TIPO-BASE (o perfil técnico em usuarios.perfil) e a lista de TELAS que acessa.
// O tipo-base decide o escopo dos dados e as regras do banco (vendedor/representante = própria carteira;
// supervisor = equipe; gerente = tudo; financeiro = análise de crédito; administrador = tudo). O perfil decide as telas.
// O perfil Administrador do sistema tem sempre todas as telas (sem restrição). Migração 0008 · docs/03 §11.

export const TIPOS_BASE = Object.freeze({
  administrador: 'Administrador', gerente: 'Gerente comercial', supervisor: 'Supervisor',
  vendedor: 'Vendedor / representante', financeiro: 'Analista financeiro',
});

/** Telas que um perfil pode receber. `bases`: tipos-base que conseguem usá-las (as regras do banco valem por cima). */
export const TELAS = Object.freeze([
  { codigo: 'inicio', rotulo: 'Início', grupo: 'Prospecção' },
  { codigo: 'lista', rotulo: 'Lista principal', grupo: 'Prospecção' },
  { codigo: 'acompanhamento', rotulo: 'Acompanhamento', grupo: 'Prospecção' },
  { codigo: 'registrar', rotulo: 'Registrar atendimento e lote', grupo: 'Prospecção', bases: ['administrador', 'gerente', 'supervisor', 'vendedor'] },
  { codigo: 'credito', rotulo: 'Console de crédito', grupo: 'Financeiro', bases: ['administrador', 'financeiro'] },
  { codigo: 'admin_base', rotulo: 'Base de prospects', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_tipos', rotulo: 'Representantes / vendedores', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_erp', rotulo: 'Cadastro · Pedidos · Baixados', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_credito', rotulo: 'Relatório de crédito', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_importacoes', rotulo: 'Importações', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_usuarios', rotulo: 'Usuários e perfis', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_parametros', rotulo: 'Parâmetros', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_feriados', rotulo: 'Feriados', grupo: 'Administração', bases: ['administrador'] },
]);
const CODIGOS = TELAS.map((t) => t.codigo);

/** Telas que o tipo-base consegue usar. */
export function telasPossiveis(base) {
  return TELAS.filter((t) => !t.bases || t.bases.includes(base)).map((t) => t.codigo);
}

/** Telas iniciais de cada perfil do sistema (e de sessões antigas): financeiro só a análise de crédito. */
export function telasPadrao(base) {
  return base === 'financeiro' ? ['credito'] : telasPossiveis(base);
}

/** Telas efetivas de um usuário logado: administrador do sistema = todas; senão as do perfil (ou o padrão do tipo-base). */
export function telasDoUsuario(usuario) {
  if (!usuario) return [];
  if (usuario.perfil === 'administrador' && (usuario.perfil_sistema ?? true)) return [...CODIGOS];
  const possiveis = telasPossiveis(usuario.perfil);
  return (Array.isArray(usuario.telas) ? usuario.telas : telasPadrao(usuario.perfil)).filter((t) => possiveis.includes(t));
}

export function podeTela(usuario, tela) {
  return telasDoUsuario(usuario).includes(tela);
}

/** Lê do banco o perfil e as telas de um usuário (no login). */
export async function carregarAcesso(db, { usuarioId }) {
  const r = await db.execute({
    sql: `SELECT p.id, p.nome, p.sistema, (SELECT group_concat(t.tela) FROM perfil_telas t WHERE t.perfil_id = p.id) AS telas
            FROM usuarios u JOIN perfis p ON p.id = COALESCE(u.perfil_id, (SELECT s.id FROM perfis s WHERE s.sistema = 1 AND s.base = u.perfil))
           WHERE u.id = ?`,
    args: [usuarioId],
  });
  const p = r.rows[0];
  if (!p) return null;
  return { perfil_id: Number(p.id), perfil_nome: p.nome, perfil_sistema: Boolean(Number(p.sistema)), telas: p.telas ? String(p.telas).split(',') : [] };
}

export async function listarPerfis(db) {
  const r = await db.execute(`SELECT p.id, p.nome, p.base, p.sistema, p.ativo,
      (SELECT group_concat(t.tela) FROM perfil_telas t WHERE t.perfil_id = p.id) AS telas,
      (SELECT COUNT(*) FROM usuarios u WHERE COALESCE(u.perfil_id, (SELECT s.id FROM perfis s WHERE s.sistema = 1 AND s.base = u.perfil)) = p.id AND u.ativo = 1) AS usuarios
    FROM perfis p ORDER BY p.sistema DESC, p.nome`);
  return r.rows.map((p) => ({ ...p, id: Number(p.id), sistema: Number(p.sistema), telas: p.telas ? String(p.telas).split(',') : [], usuarios: Number(p.usuarios) }));
}

/** Valida um perfil antes de gravar; devolve a lista de erros (vazia = ok). */
export function validarPerfil({ nome, base, telas }) {
  const erros = [];
  if (String(nome ?? '').trim().length < 3) erros.push('nome do perfil: ao menos 3 letras');
  if (!TIPOS_BASE[base]) erros.push('escolha o tipo-base');
  const possiveis = telasPossiveis(base);
  for (const t of telas ?? []) {
    if (!CODIGOS.includes(t)) erros.push(`tela desconhecida: ${t}`);
    else if (!possiveis.includes(t)) erros.push(`"${TELAS.find((x) => x.codigo === t).rotulo}" não serve para o tipo-base ${TIPOS_BASE[base] ?? base}`);
  }
  if (!(telas ?? []).length) erros.push('marque ao menos uma tela');
  return erros;
}

/**
 * Inclui (sem `id`) ou altera um perfil e grava as telas dele (substitui a lista). Perfil do sistema: o tipo-base não
 * muda; o Administrador do sistema tem sempre todas as telas (não é editável aqui).
 */
export async function salvarPerfil(db, { id = null, nome, base, telas, executadoPor }) {
  const lista = [...new Set(telas ?? [])];
  let atual = null;
  if (id) {
    atual = (await db.execute({ sql: 'SELECT id, base, sistema FROM perfis WHERE id = ?', args: [id] })).rows[0];
    if (!atual) throw new Error('perfil não encontrado');
    if (Number(atual.sistema) && atual.base === 'administrador') throw new Error('o perfil Administrador tem sempre todas as telas');
    if (Number(atual.sistema)) base = atual.base;
  }
  const erros = validarPerfil({ nome, base, telas: lista });
  if (erros.length) throw new Error(erros.join('; '));
  const n = String(nome).trim();
  let perfilId = id ? Number(id) : null;
  if (id) {
    await db.execute({ sql: "UPDATE perfis SET nome = ?, base = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", args: [n, base, id] });
  } else {
    perfilId = Number((await db.execute({ sql: 'INSERT INTO perfis (nome, base) VALUES (?, ?) RETURNING id', args: [n, base] })).rows[0].id);
  }
  await db.batch([
    { sql: 'DELETE FROM perfil_telas WHERE perfil_id = ?', args: [perfilId] },
    ...lista.map((t) => ({ sql: 'INSERT INTO perfil_telas (perfil_id, tela) VALUES (?, ?)', args: [perfilId, t] })),
    { sql: "INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, ?, 'perfis', ?, ?)",
      args: [executadoPor, id ? 'alterar_perfil' : 'incluir_perfil', String(perfilId), JSON.stringify({ nome: n, base, telas: lista })] },
  ], 'write');
  return perfilId;
}

/** Atribui um perfil ao usuário (o tipo-base do perfil tem de ser o perfil técnico do usuário — gatilho no banco). */
export async function definirPerfilUsuario(db, { usuarioId, perfilId, executadoPor }) {
  await db.batch([
    { sql: "UPDATE usuarios SET perfil_id = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", args: [perfilId, usuarioId] },
    { sql: "INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, 'perfil_usuario', 'usuarios', ?, ?)",
      args: [executadoPor, String(usuarioId), JSON.stringify({ perfil_id: perfilId })] },
  ], 'write');
}
