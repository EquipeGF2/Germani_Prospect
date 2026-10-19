// Indicadores de prospecção (docs/03-regras-negocio.md §5).
// Duas leituras, ambas disponíveis como filtro de relatório/consulta:
//   * POSIÇÃO  — foto da carteira numa data (status de cada prospect naquele dia, via movimentacoes)
//   * ATIVIDADE — o que aconteceu dentro de um período (contatos, encerramentos, cadastros, pedidos)
//
// Tudo o que acontece na base conta aqui — inclusive prospects fora da lista de trabalho
// (Aguardando cadastro, Sem interesse, Cadastrado, Venda, Inválido). Painel por equipe = agrupar 'supervisor'.
// Fórmulas (posição):
//   carteira_valida  = total − inválidos
//   contactados      = status com conta_contactado = 1 (tudo exceto "Não contactado" e "Inválido")
//   pct_contactado   = contactados ÷ carteira_valida
//   pct_cadastro     = (análise financeira + aguardando pedido + vendas) ÷ contactados
//   pct_conversao    = vendas ÷ contactados
// Agrupamento por vendedor/supervisor usa a carteira ATUAL (transferências não reescrevem o passado).
// Agrupamentos: geral · vendedor · supervisor · cidade · bairro · onda · rota (rota: só vendedores, nunca representantes).

const AGRUPAMENTOS = {
  geral: { chave: "'geral'", rotulo: "'Total geral'" },
  vendedor: { chave: 'v.id', rotulo: 'v.nome' },
  supervisor: { chave: 'COALESCE(v.supervisor_id, v.id)', rotulo: 'COALESCE(sup.nome, v.nome)' },
  cidade: { chave: "COALESCE(p.cidade_busca, '') || '/' || COALESCE(p.uf, '')", rotulo: "COALESCE(p.cidade, '(sem cidade)') || '/' || COALESCE(p.uf, '')" },
  bairro: {
    chave: "COALESCE(p.cidade_busca, '') || '/' || COALESCE(p.uf, '') || '|' || COALESCE(p.bairro_busca, '')",
    rotulo: "COALESCE(p.bairro, '(sem bairro)') || ' — ' || COALESCE(p.cidade, '(sem cidade)') || '/' || COALESCE(p.uf, '')",
  },
  onda: { chave: "COALESCE(p.onda, '')", rotulo: "COALESCE('Onda ' || p.onda, '(sem onda)')" },
  // rota existe só para vendedores (tipo_atuacao = 'vendedor'); representantes ficam fora deste agrupamento
  rota: { chave: "COALESCE(p.rota, '') || '|' || COALESCE(p.subrota, '')", rotulo: "COALESCE(p.rota, '(sem rota)') || COALESCE(' / ' || p.subrota, '')", somenteVendedor: true },
};

function filtrosSql(filtros = {}, g = {}) {
  const where = g.somenteVendedor ? ["v.tipo_atuacao = 'vendedor'"] : [];
  const args = [];
  if (filtros.vendedorId) { where.push('v.id = ?'); args.push(filtros.vendedorId); }
  if (filtros.supervisorId) { where.push('COALESCE(v.supervisor_id, v.id) = ?'); args.push(filtros.supervisorId); }
  if (filtros.cidadeBusca) { where.push('p.cidade_busca = ?'); args.push(filtros.cidadeBusca); }
  if (filtros.uf) { where.push('p.uf = ?'); args.push(filtros.uf); }
  if (filtros.bairroBusca) { where.push('p.bairro_busca = ?'); args.push(filtros.bairroBusca); }
  if (filtros.onda) { where.push('p.onda = ?'); args.push(String(filtros.onda)); }
  return { where, args };
}

function agrupamento(nome) {
  const g = AGRUPAMENTOS[nome];
  if (!g) throw new Error(`agrupamento inválido: ${nome}`);
  return g;
}

/**
 * Indicadores de posição. Sem `data` = posição atual (prospects.status_atual).
 * @returns {{sql: string, args: any[]}}
 */
export function consultaPosicao({ agrupar = 'geral', data = null, filtros } = {}) {
  const g = agrupamento(agrupar);
  const f = filtrosSql(filtros, g);
  const statusExpr = data
    ? `(SELECT h.status_novo FROM movimentacoes h WHERE h.prospect_id = p.id AND h.data_evento <= ? ORDER BY h.id DESC LIMIT 1)`
    : 'p.status_atual';
  const args = data ? [data, ...f.args] : [...f.args];
  const sql = `
WITH base AS (
  SELECT ${g.chave} AS chave, ${g.rotulo} AS rotulo, ${statusExpr} AS status
    FROM prospects p
    JOIN usuarios v ON v.id = p.vendedor_id
    LEFT JOIN usuarios sup ON sup.id = v.supervisor_id
   ${f.where.length ? 'WHERE ' + f.where.join(' AND ') : ''}
)
SELECT b.chave, MIN(b.rotulo) AS rotulo,
       COUNT(*)                                                     AS total,
       SUM(b.status = 'invalido')                                   AS invalidos,
       SUM(s.conta_carteira)                                        AS carteira_valida,
       SUM(s.conta_contactado)                                      AS contactados,
       SUM(b.status = 'nao_contactado')                             AS nao_contactados,
       SUM(b.status = 'em_prospeccao')                              AS em_prospeccao,
       SUM(b.status = 'aguardando_cadastro')                              AS aguardando_cadastro,
       SUM(b.status = 'sem_interesse')                              AS sem_interesse,
       SUM(b.status = 'analise_financeira')                             AS analise_financeira,
       SUM(b.status = 'aguardando_pedido')                          AS aguardando_pedido,
       SUM(b.status = 'venda_realizada')                            AS vendas
  FROM base b JOIN status s ON s.codigo = b.status
 GROUP BY b.chave
 ORDER BY rotulo`;
  return { sql, args };
}

/**
 * Indicadores de ATIVIDADE entre `inicio` e `fim` (inclusive), lidos do histórico de movimentação.
 * Cada movimento conta para o vendedor dono da carteira NO DIA do movimento (movimentacoes.vendedor_id).
 */
export function consultaAtividade({ agrupar = 'geral', inicio, fim, filtros } = {}) {
  if (!inicio || !fim) throw new Error('informe início e fim do período');
  const g = agrupamento(agrupar);
  const f = filtrosSql(filtros, g);
  const filtroWhere = f.where.length ? 'AND ' + f.where.join(' AND ') : '';
  const entrou = (st) => `SUM(m.status_novo = '${st}' AND COALESCE(m.status_anterior, '') <> '${st}')`;
  const sql = `
SELECT ${g.chave} AS chave, MIN(${g.rotulo}) AS rotulo,
       SUM(m.tipo <> 'entrada_base')                                             AS movimentos,
       SUM(m.origem = 'contato')                                                 AS registros,
       SUM(m.tipo = 'atendido')                                                  AS atendidos,
       SUM(m.tipo = 'sem_interesse')                                             AS registros_sem_interesse,
       SUM(m.tipo = 'pedido_informado')                                          AS pedidos_informados,
       COUNT(DISTINCT CASE WHEN m.origem = 'contato' THEN m.prospect_id END)     AS prospects_trabalhados,
       SUM(m.origem = 'contato' AND EXISTS (SELECT 1 FROM contatos c WHERE c.id = m.referencia AND c.numero_tentativa = 1)) AS primeiros_registros,
       ${entrou('aguardando_cadastro')}                                          AS entradas_aguardando_cadastro,
       ${entrou('sem_interesse')}                                                AS encerrados_sem_interesse,
       ${entrou('analise_financeira')}                                           AS entradas_analise_financeira,
       ${entrou('aguardando_pedido')}                                            AS entradas_aguardando_pedido,
       ${entrou('venda_realizada')}                                              AS vendas,
       SUM(m.tipo = 'liberacao_credito')                                         AS liberacoes_credito,
       SUM(m.tipo = 'cadastro')                                                  AS arquivos_cadastro,
       SUM(m.tipo = 'pedido')                                                    AS arquivos_pedido,
       SUM(m.tipo = 'baixa')                                                     AS baixas,
       SUM(m.tipo = 'transferencia')                                             AS transferencias
  FROM movimentacoes m
  JOIN prospects p ON p.id = m.prospect_id
  JOIN usuarios v ON v.id = m.vendedor_id
  LEFT JOIN usuarios sup ON sup.id = v.supervisor_id
 WHERE m.data_evento BETWEEN ? AND ? ${filtroWhere}
 GROUP BY 1
 ORDER BY rotulo`;
  return { sql, args: [inicio, fim, ...f.args] };
}

export const TIPOS_MOVIMENTO = Object.freeze(['entrada_base', 'contato_planilha', 'atendido', 'sem_interesse', 'pedido_informado',
  'cadastro', 'liberacao_credito', 'pedido', 'baixa', 'transferencia']);

/**
 * Lista do histórico de movimentação com filtros (relatório / consulta).
 * @param usuario  escopo: vendedor = só a própria carteira (na data do movimento); supervisor = equipe; admin = tudo
 * @param filtros  { tipos: [], statusNovo, vendedorId, supervisorId, cidadeBusca, bairroBusca, uf, onda, prospectId }
 */
export function consultaMovimentacoes({ usuario, inicio, fim, filtros = {}, limite = 500, deslocamento = 0 } = {}) {
  const where = [];
  const args = [];
  if (usuario?.perfil === 'vendedor') { where.push('vendedor_id = ?'); args.push(usuario.id); }
  else if (usuario?.perfil === 'supervisor') { where.push('supervisor_id = ?'); args.push(usuario.id); }
  if (inicio) { where.push('data_evento >= ?'); args.push(inicio); }
  if (fim) { where.push('data_evento <= ?'); args.push(fim); }
  if (filtros.tipos?.length) {
    if (filtros.tipos.some((t) => !TIPOS_MOVIMENTO.includes(t))) throw new Error('tipo de movimento inválido');
    where.push(`tipo IN (${filtros.tipos.map(() => '?').join(', ')})`); args.push(...filtros.tipos);
  }
  for (const [campo, coluna] of [['statusNovo', 'status_novo'], ['vendedorId', 'vendedor_id'], ['supervisorId', 'supervisor_id'],
    ['cidadeBusca', 'cidade_busca'], ['bairroBusca', 'bairro_busca'], ['uf', 'uf'], ['onda', 'onda'], ['prospectId', 'prospect_id']]) {
    if (filtros[campo] != null && filtros[campo] !== '') { where.push(`${coluna} = ?`); args.push(filtros[campo]); }
  }
  return {
    sql: `SELECT * FROM vw_movimentacoes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY data_evento DESC, id DESC LIMIT ? OFFSET ?`,
    args: [...args, limite, deslocamento],
  };
}

const razao = (a, b) => (Number(b) > 0 ? Number(a) / Number(b) : null);

/** Percentuais a partir de uma linha de consultaPosicao (frações 0–1; null quando o denominador é zero). */
export function calcularPercentuais(l) {
  return {
    pct_contactado: razao(l.contactados, l.carteira_valida),
    pct_cadastro: razao(Number(l.analise_financeira) + Number(l.aguardando_pedido ?? 0) + Number(l.vendas), l.contactados),
    pct_conversao: razao(l.vendas, l.contactados),
  };
}

/**
 * Execução das rotas no período (planejado × atendido). Rotas canceladas ficam fora.
 * agrupar: 'geral' | 'vendedor' | 'supervisor'
 */
export function consultaExecucaoRotas({ agrupar = 'geral', inicio, fim, filtros = {} } = {}) {
  if (!inicio || !fim) throw new Error('informe início e fim do período');
  const g = { geral: ["'geral'", "'Total geral'"], vendedor: ['e.vendedor_id', 'e.vendedor_nome'], supervisor: ['e.supervisor_id', 'COALESCE(s.nome, e.vendedor_nome)'] }[agrupar];
  if (!g) throw new Error(`agrupamento inválido: ${agrupar}`);
  const where = ["e.situacao <> 'cancelada'", 'e.data_rota BETWEEN ? AND ?'];
  const args = [inicio, fim];
  if (filtros.vendedorId) { where.push('e.vendedor_id = ?'); args.push(filtros.vendedorId); }
  if (filtros.supervisorId) { where.push('e.supervisor_id = ?'); args.push(filtros.supervisorId); }
  return {
    sql: `SELECT ${g[0]} AS chave, MIN(${g[1]}) AS rotulo, COUNT(*) AS rotas,
                 SUM(e.paradas_planejadas) AS paradas_planejadas, SUM(e.paradas_atendidas) AS paradas_atendidas
            FROM vw_rotas_execucao e LEFT JOIN usuarios s ON s.id = e.supervisor_id
           WHERE ${where.join(' AND ')}
           GROUP BY 1 ORDER BY rotulo`,
    args,
  };
}
