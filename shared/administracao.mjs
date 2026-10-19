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
    sql: `SELECT id, tipo, arquivo_nome, executado_por, iniciado_em, concluido_em, situacao,
                 linhas_lidas, linhas_aceitas, linhas_rejeitadas, linhas_ignoradas, observacao
            FROM importacoes ORDER BY id DESC LIMIT ?`,
    args: [limite],
  })).rows;
}

/** Linhas de uma importação (relatório). `resultado` opcional: aceita | rejeitada | ignorada. */
export async function linhasDaImportacao(db, { importacaoId, resultado = null }) {
  return (await db.execute({
    sql: `SELECT numero_linha, cnpj, resultado, mensagens FROM importacao_linhas
           WHERE importacao_id = ? AND (? IS NULL OR resultado = ?) ORDER BY numero_linha`,
    args: [importacaoId, resultado, resultado],
  })).rows.map((l) => ({ ...l, mensagens: JSON.parse(l.mensagens).join(' | ') }));
}
