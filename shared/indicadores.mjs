// Indicadores de prospecção (docs/03-regras-negocio.md §5).
// Duas leituras, ambas disponíveis como filtro de relatório/consulta:
//   * POSIÇÃO  — foto da carteira numa data (status de cada prospect naquele dia, via historico_status)
//   * ATIVIDADE — o que aconteceu dentro de um período (contatos, encerramentos, cadastros, pedidos)
//
// Tudo o que acontece na base conta aqui — inclusive prospects fora da lista de trabalho
// (Em negociação, Sem interesse, Cadastrado, Venda, Inválido). Painel por equipe = agrupar 'supervisor'.
// Fórmulas (posição):
//   carteira_valida  = total − inválidos
//   contactados      = status com conta_contactado = 1 (tudo exceto "Não contactado" e "Inválido")
//   pct_contactado   = contactados ÷ carteira_valida
//   pct_cadastro     = (cadastrados ERP + vendas) ÷ contactados
//   pct_conversao    = vendas ÷ contactados
// Agrupamento por vendedor/supervisor usa a carteira ATUAL (transferências não reescrevem o passado).
// Agrupamentos: geral · vendedor · supervisor · cidade · bairro · rota (rota: só vendedores, nunca representantes).

const AGRUPAMENTOS = {
  geral: { chave: "'geral'", rotulo: "'Total geral'" },
  vendedor: { chave: 'v.id', rotulo: 'v.nome' },
  supervisor: { chave: 'COALESCE(v.supervisor_id, v.id)', rotulo: 'COALESCE(sup.nome, v.nome)' },
  cidade: { chave: "COALESCE(p.cidade_busca, '') || '/' || COALESCE(p.uf, '')", rotulo: "COALESCE(p.cidade, '(sem cidade)') || '/' || COALESCE(p.uf, '')" },
  bairro: {
    chave: "COALESCE(p.cidade_busca, '') || '/' || COALESCE(p.uf, '') || '|' || COALESCE(p.bairro_busca, '')",
    rotulo: "COALESCE(p.bairro, '(sem bairro)') || ' — ' || COALESCE(p.cidade, '(sem cidade)') || '/' || COALESCE(p.uf, '')",
  },
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
    ? `(SELECT h.status_novo FROM historico_status h WHERE h.prospect_id = p.id AND h.data_evento <= ? ORDER BY h.id DESC LIMIT 1)`
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
       SUM(b.status = 'em_negociacao')                              AS em_negociacao,
       SUM(b.status = 'sem_interesse')                              AS sem_interesse,
       SUM(b.status = 'cadastrado_erp')                             AS cadastrados_erp,
       SUM(b.status = 'venda_realizada')                            AS vendas
  FROM base b JOIN status s ON s.codigo = b.status
 GROUP BY b.chave
 ORDER BY rotulo`;
  return { sql, args };
}

/** Indicadores de atividade entre `inicio` e `fim` (inclusive, AAAA-MM-DD). */
export function consultaAtividade({ agrupar = 'geral', inicio, fim, filtros } = {}) {
  if (!inicio || !fim) throw new Error('informe início e fim do período');
  const g = agrupamento(agrupar);
  const f = filtrosSql(filtros, g);
  const filtroWhere = f.where.length ? 'AND ' + f.where.join(' AND ') : '';
  const sql = `
WITH ev AS (
  SELECT c.prospect_id, 'contato' AS tipo, c.numero_tentativa AS n, c.resultado AS r FROM contatos c WHERE c.data_contato BETWEEN ?1 AND ?2
  UNION ALL
  SELECT h.prospect_id, 'encerrado_sem_interesse', NULL, NULL FROM historico_status h
   WHERE h.data_evento BETWEEN ?1 AND ?2 AND h.status_novo = 'sem_interesse' AND COALESCE(h.status_anterior, '') <> 'sem_interesse'
  UNION ALL
  SELECT e.prospect_id, e.tipo, NULL, NULL FROM eventos_erp e WHERE e.data_evento BETWEEN ?1 AND ?2
)
SELECT ${g.chave} AS chave, MIN(${g.rotulo}) AS rotulo,
       SUM(ev.tipo = 'contato')                                    AS contatos_registrados,
       SUM(ev.tipo = 'contato' AND ev.r = 'com_interesse')         AS contatos_com_interesse,
       COUNT(DISTINCT CASE WHEN ev.tipo = 'contato' THEN ev.prospect_id END) AS prospects_contactados,
       SUM(ev.tipo = 'contato' AND ev.n = 1)                        AS primeiros_contatos,
       SUM(ev.tipo = 'encerrado_sem_interesse')                     AS encerrados_sem_interesse,
       SUM(ev.tipo = 'cadastro')                                    AS cadastros_erp,
       SUM(ev.tipo = 'pedido')                                      AS pedidos,
       SUM(ev.tipo = 'baixa')                                       AS baixas
  FROM ev
  JOIN prospects p ON p.id = ev.prospect_id
  JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios sup ON sup.id = v.supervisor_id
 WHERE 1 = 1 ${filtroWhere}
 GROUP BY 1
 ORDER BY rotulo`;
  return { sql, args: [inicio, fim, ...f.args] };
}

const razao = (a, b) => (Number(b) > 0 ? Number(a) / Number(b) : null);

/** Percentuais a partir de uma linha de consultaPosicao (frações 0–1; null quando o denominador é zero). */
export function calcularPercentuais(l) {
  return {
    pct_contactado: razao(l.contactados, l.carteira_valida),
    pct_cadastro: razao(Number(l.cadastrados_erp) + Number(l.vendas), l.contactados),
    pct_conversao: razao(l.vendas, l.contactados),
  };
}
