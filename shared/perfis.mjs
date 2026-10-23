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
  { codigo: 'explorar', rotulo: 'Explorar carteira', grupo: 'Prospecção', bases: ['administrador', 'gerente', 'supervisor', 'vendedor'] },
  { codigo: 'lista', rotulo: 'Lista principal', grupo: 'Prospecção' },
  { codigo: 'acompanhamento', rotulo: 'Acompanhamento', grupo: 'Prospecção' },
  { codigo: 'registrar', rotulo: 'Registrar atendimento e lote', grupo: 'Prospecção', bases: ['administrador', 'gerente', 'supervisor', 'vendedor'] },
  { codigo: 'credito', rotulo: 'Console de crédito', grupo: 'Financeiro', bases: ['administrador', 'financeiro'] },
  { codigo: 'admin_base', rotulo: 'Base de prospects', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_tipos', rotulo: 'Representantes / vendedores', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_erp', rotulo: 'Pedidos · Baixados (ERP)', grupo: 'Administração', bases: ['administrador'] },
  { codigo: 'admin_credito', rotulo: 'Cadastro e crédito (ERP)', grupo: 'Administração', bases: ['administrador'] },
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
/**
 * Lê os dados de todas as equipes? Administrador, gerente e financeiro sempre; supervisor só com perfil marcado
 * "vê todas as equipes" (migração 0009). Vale para leitura — registrar continua restrito à própria equipe (banco).
 */
export function veTodasEquipes(usuario) {
  return ['administrador', 'gerente', 'financeiro'].includes(usuario?.perfil) || (usuario?.perfil === 'supervisor' && Boolean(usuario?.ve_todos));
}


export async function carregarAcesso(db, { usuarioId }) {
  // sem a migração 0009 aplicada (site publicado antes de migrar), lê sem ve_todos em vez de perder o perfil
  const consulta = (ve) => db.execute({
    sql: `SELECT p.id, p.nome, p.sistema, ${ve ? 'p.ve_todos' : '0 AS ve_todos'}, (SELECT group_concat(t.tela) FROM perfil_telas t WHERE t.perfil_id = p.id) AS telas
            FROM usuarios u JOIN perfis p ON p.id = COALESCE(u.perfil_id, (SELECT s.id FROM perfis s WHERE s.sistema = 1 AND s.base = u.perfil))
           WHERE u.id = ?`,
    args: [usuarioId],
  });
  const r = await consulta(true).catch((e) => (/no such column/i.test(String(e?.message)) ? consulta(false) : Promise.reject(e)));
  const p = r.rows[0];
  if (!p) return null;
  return { perfil_id: Number(p.id), perfil_nome: p.nome, perfil_sistema: Boolean(Number(p.sistema)), ve_todos: Boolean(Number(p.ve_todos)), telas: p.telas ? String(p.telas).split(',') : [] };
}

export async function listarPerfis(db) {
  const r = await db.execute(`SELECT p.*,
      (SELECT group_concat(t.tela) FROM perfil_telas t WHERE t.perfil_id = p.id) AS telas,
      (SELECT COUNT(*) FROM usuarios u WHERE COALESCE(u.perfil_id, (SELECT s.id FROM perfis s WHERE s.sistema = 1 AND s.base = u.perfil)) = p.id AND u.ativo = 1) AS usuarios
    FROM perfis p ORDER BY p.sistema DESC, p.nome`);
  return r.rows.map((p) => ({ ...p, id: Number(p.id), sistema: Number(p.sistema), ve_todos: Number(p.ve_todos ?? 0), telas: p.telas ? String(p.telas).split(',') : [], usuarios: Number(p.usuarios) }));
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
export async function salvarPerfil(db, { id = null, nome, base, telas, veTodos = false, executadoPor }) {
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
  const ve = base === 'supervisor' && veTodos ? 1 : 0;   // só supervisor amplia a leitura (os outros tipos já veem o que veem)
  let perfilId = id ? Number(id) : null;
  if (id) {
    await db.execute({ sql: "UPDATE perfis SET nome = ?, base = ?, ve_todos = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", args: [n, base, ve, id] });
  } else {
    perfilId = Number((await db.execute({ sql: 'INSERT INTO perfis (nome, base, ve_todos) VALUES (?, ?, ?) RETURNING id', args: [n, base, ve] })).rows[0].id);
  }
  await db.batch([
    { sql: 'DELETE FROM perfil_telas WHERE perfil_id = ?', args: [perfilId] },
    ...lista.map((t) => ({ sql: 'INSERT INTO perfil_telas (perfil_id, tela) VALUES (?, ?)', args: [perfilId, t] })),
    { sql: "INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, ?, 'perfis', ?, ?)",
      args: [executadoPor, id ? 'alterar_perfil' : 'incluir_perfil', String(perfilId), JSON.stringify({ nome: n, base, telas: lista, ve_todos: ve })] },
  ], 'write');
  return perfilId;
}

// tipos-base trocáveis entre si na tela Usuários (supervisor e vendedor dependem do código do ERP e da equipe: vêm da importação)
export const BASES_TROCAVEIS = Object.freeze(['administrador', 'gerente', 'financeiro']);

/**
 * Todos os perfis ativos, cada um dizendo se serve para o usuário e, se não, por quê (a tela mostra todos, os que não
 * servem desabilitados). Serve: mesmo tipo-base, ou troca entre administrador, gerente e financeiro (não no próprio
 * usuário). `usuario` null = usuário novo (criado na tela: só administrador, gerente ou financeiro).
 */
export function opcoesDePerfil(perfis, usuario, { proprio = false } = {}) {
  return perfis.filter((p) => p.ativo == null || Number(p.ativo)).map((p) => {
    let motivo = null;
    if (!usuario) {
      // usuário novo: qualquer perfil (supervisor e vendedor pedem código do ERP e, vendedor, o supervisor)
    } else if (p.base !== usuario.perfil) {
      if (!BASES_TROCAVEIS.includes(p.base)) motivo = 'supervisor e vendedor: crie como novo usuário, com o código do ERP';
      else if (!BASES_TROCAVEIS.includes(usuario.perfil)) motivo = `${TIPOS_BASE[usuario.perfil]}: só perfis do tipo ${TIPOS_BASE[usuario.perfil]}`;
      else if (proprio) motivo = 'não dá para mudar o tipo do próprio usuário';
    }
    return { perfil: p, disponivel: !motivo, motivo };
  });
}

/** Perfis que podem ser escolhidos para o usuário. */
export function perfisPossiveis(perfis, usuario) {
  return opcoesDePerfil(perfis, usuario).filter((o) => o.disponivel).map((o) => o.perfil);
}

/**
 * Atribui um perfil ao usuário. Mesmo tipo-base: só muda as telas. Tipo-base diferente: permitido apenas entre
 * administrador, gerente e financeiro (muda também usuarios.perfil, que define o escopo dos dados). Quem deixa de ser
 * administrador perde o cofre de administração; quem passa a ser recebe o cofre ao ter a senha definida (ADR-0006).
 * Ninguém muda o próprio tipo-base (evita o administrador se trancar fora).
 */
export async function definirPerfilUsuario(db, { usuarioId, perfilId, executadoPor, executadoPorId = null }) {
  const u = (await db.execute({ sql: 'SELECT id, perfil FROM usuarios WHERE id = ?', args: [usuarioId] })).rows[0];
  if (!u) throw new Error('usuário não encontrado');
  // sem perfilId = perfil do sistema do tipo-base atual
  const p = perfilId == null ? { id: null, base: u.perfil, sistema: 1 }
    : (await db.execute({ sql: 'SELECT id, base, sistema FROM perfis WHERE id = ?', args: [perfilId] })).rows[0];
  if (!p) throw new Error('perfil não encontrado');
  const base = p.base;
  if (base !== u.perfil) {
    if (!BASES_TROCAVEIS.includes(base) || !BASES_TROCAVEIS.includes(u.perfil)) throw new Error('o tipo-base do perfil não corresponde ao usuário (supervisor e vendedor vêm da importação)');
    if (executadoPorId != null && Number(executadoPorId) === Number(usuarioId)) throw new Error('você não pode mudar o tipo do próprio usuário');
  }
  const gravado = Number(p.sistema) ? null : Number(p.id);   // perfil do sistema = NULL (padrão do tipo-base)
  const perdeCofre = u.perfil === 'administrador' && base !== 'administrador';
  await db.batch([
    { sql: `UPDATE usuarios SET perfil = ?, perfil_id = ?${perdeCofre ? ', cofre_admin = NULL' : ''}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, args: [base, gravado, usuarioId] },
    { sql: "INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, 'perfil_usuario', 'usuarios', ?, ?)",
      args: [executadoPor, String(usuarioId), JSON.stringify({ perfil_id: gravado, base, base_anterior: u.perfil })] },
  ], 'write');
  return { base, perfilId: gravado, mudouBase: base !== u.perfil };
}
