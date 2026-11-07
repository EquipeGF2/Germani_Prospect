// Parâmetros e histórico de importações — telas de administração.

export async function listarParametros(db) {
  return (await db.execute('SELECT chave, valor, tipo, descricao, alterado_em, alterado_por FROM parametros ORDER BY chave')).rows;
}

/** Altera um parâmetro (a auditoria é gravada pelo trigger do banco). Vale para os próximos eventos. */
export async function alterarParametro(db, { chave, valor, executadoPor }) {
  const v = String(valor ?? '').trim();
  const p = (await db.execute({ sql: 'SELECT tipo FROM parametros WHERE chave = ?', args: [chave] })).rows[0];
  if (!p) throw new Error(`parâmetro inexistente: ${chave}`);
  if (p.tipo === 'inteiro' && !/^\d+$/.test(v)) throw new Error('informe um número inteiro maior ou igual a zero');
  if (chave.startsWith('data_') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('informe a data');
  // e-mails em cópia dos avisos (0035): vazio ou e-mails separados por ";"
  if (chave === 'avisos_email_copia' && v && v.split(/[;,\s]+/).filter(Boolean).some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) throw new Error('informe e-mails válidos, separados por ";"');
  const r = await db.execute({
    sql: "UPDATE parametros SET valor = ?, alterado_por = ?, alterado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE chave = ? RETURNING chave",
    args: [v, executadoPor, chave],
  });
  if (!r.rows.length) throw new Error(`parâmetro inexistente: ${chave}`);
}

export const NOMES_IMPORTACAO = Object.freeze({
  base_prospects: 'Base de prospects',
  tipo_atuacao: 'Representantes / vendedores',
  cadastro_erp: 'Cadastro (ERP)',
  pedido_erp: 'Pedidos (ERP)',
  cnpj_baixado: 'CNPJs baixados',
  credito_erp: 'Relatório de crédito',
});

export async function listarImportacoes(db, { limite = 100 } = {}) {
  return (await db.execute({
    sql: `SELECT i.id, i.tipo, i.arquivo_nome, i.executado_por, i.iniciado_em, i.concluido_em, i.situacao,
                 i.linhas_lidas, i.linhas_aceitas, i.linhas_rejeitadas, i.linhas_ignoradas, i.observacao,
                 e.registrado_em AS base_apagada_em, u.login AS base_apagada_por, e.qtd_prospects AS base_apagados
            FROM importacoes i
            LEFT JOIN base_exclusoes e ON e.importacao_id = i.id
            LEFT JOIN usuarios u ON u.id = e.usuario_id
           ORDER BY i.id DESC LIMIT ?`,
    args: [limite],
  })).rows;
}

/**
 * O que sai ao apagar uma importação da base (0029): clientes que entraram por ela, o histórico deles, os já trabalhados
 * (que impedem a exclusão), os que já existiam (cadastro atualizado, ficam) e quem será desativado.
 */
export async function conferirExclusaoBase(db, importacaoId) {
  const [r, trab, usuarios] = await Promise.all([
    db.execute({
      sql: `SELECT (SELECT COUNT(*) FROM prospects WHERE importacao_id = ?) AS prospects,
                   (SELECT COUNT(*) FROM contatos WHERE prospect_id IN (SELECT id FROM prospects WHERE importacao_id = ?)) AS contatos,
                   (SELECT COUNT(DISTINCT l.cnpj) FROM importacao_linhas l WHERE l.importacao_id = ? AND l.resultado = 'aceita'
                       AND EXISTS (SELECT 1 FROM prospects p WHERE p.cnpj = l.cnpj AND p.importacao_id IS NOT ?)) AS atualizados,
                   (SELECT COUNT(*) FROM vw_base_trabalhados WHERE importacao_id = ?) AS trabalhados`,
      args: [importacaoId, importacaoId, importacaoId, importacaoId, importacaoId],
    }),
    db.execute({ sql: `SELECT p.cnpj, p.razao_social, s.nome AS status_nome FROM vw_base_trabalhados t JOIN prospects p ON p.id = t.prospect_id JOIN status s ON s.codigo = p.status_atual
                        WHERE t.importacao_id = ? ORDER BY p.razao_social LIMIT 50`, args: [importacaoId] }),
    db.execute({
      sql: `SELECT u.nome, u.perfil, u.codigo_erp FROM usuarios u
             WHERE u.ativo = 1 AND u.perfil IN ('vendedor','supervisor') AND u.senha_hash IS NULL
               AND u.criado_em >= (SELECT iniciado_em FROM importacoes WHERE id = ?)
               AND NOT EXISTS (SELECT 1 FROM prospects p WHERE p.vendedor_id = u.id AND p.importacao_id IS NOT ?)
               AND (u.perfil = 'vendedor' OR NOT EXISTS (SELECT 1 FROM usuarios v WHERE v.supervisor_id = u.id AND v.ativo = 1
                      AND EXISTS (SELECT 1 FROM prospects p WHERE p.vendedor_id = v.id AND p.importacao_id IS NOT ?)))
             ORDER BY u.perfil, u.nome`,
      args: [importacaoId, importacaoId, importacaoId],
    }),
  ]);
  const l = r.rows[0];
  return { prospects: Number(l.prospects), contatos: Number(l.contatos), atualizados: Number(l.atualizados), trabalhados: Number(l.trabalhados), exemplosTrabalhados: trab.rows, usuarios: usuarios.rows };
}

/** Apaga uma importação da base. A regra está no banco (trigger de base_exclusoes, 0029): administrador, nada já trabalhado. */
export async function apagarImportacaoBase(db, { importacaoId, usuarioId }) {
  await db.execute({ sql: 'INSERT INTO base_exclusoes (importacao_id, usuario_id) VALUES (?, ?)', args: [importacaoId, usuarioId] });
  return (await db.execute({ sql: 'SELECT qtd_prospects, qtd_contatos, qtd_atualizados, qtd_usuarios FROM base_exclusoes WHERE importacao_id = ?', args: [importacaoId] })).rows[0];
}

/** Linhas de uma importação (relatório). `resultado` opcional: aceita | rejeitada | ignorada. */
export async function linhasDaImportacao(db, { importacaoId, resultado = null }) {
  return (await db.execute({
    sql: `SELECT numero_linha, cnpj, resultado, mensagens FROM importacao_linhas
           WHERE importacao_id = ? AND (? IS NULL OR resultado = ?) ORDER BY numero_linha`,
    args: [importacaoId, resultado, resultado],
  })).rows.map((l) => ({ ...l, mensagens: JSON.parse(l.mensagens).join(' | ') }));
}

/** Erros do app (0019) dos últimos `dias`: lista (mais recentes primeiro) e os mais frequentes por mensagem. */
export async function listarErrosApp(db, { dias = 7, limite = 300 } = {}) {
  const desde = `-${Number(dias)} days`;
  const [lista, frequentes] = await Promise.all([
    db.execute({ sql: `SELECT id, registrado_em, login, tela, versao, tipo, mensagem, detalhe, navegador, online FROM erros_app
                        WHERE registrado_em >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) ORDER BY registrado_em DESC LIMIT ?`, args: [desde, limite] }),
    db.execute({ sql: `SELECT mensagem, COUNT(*) AS vezes, COUNT(DISTINCT login) AS usuarios, MAX(registrado_em) AS ultimo FROM erros_app
                        WHERE registrado_em >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) GROUP BY mensagem ORDER BY vezes DESC LIMIT 20`, args: [desde] }),
  ]);
  return { lista: lista.rows, frequentes: frequentes.rows };
}

/** Base inteira para exportar (Importações › Exportar): CNPJ, razão social, cidade, UF, onda, segmento, status, representante e supervisor. */
export function consultaExportarBase() {
  return { sql: `SELECT cnpj, razao_social, cidade, uf, onda, tipologia_gtm, status_nome, status_descricao, vendedor_codigo, vendedor_nome, supervisor_nome
                   FROM vw_prospects ORDER BY razao_social, cnpj`, args: [] };
}
