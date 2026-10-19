// Painel do Início (dashboard de acompanhamento). docs/03 §10
// Uma consulta por agente de vendas (vendedor/representante dono da carteira); os totais geral e por
// supervisor são somas dessas linhas. Escopo:
//   administrador, gerente comercial, analista financeiro → tudo (com seletor de supervisor)
//   supervisor → só a própria equipe · vendedor/representante → só a própria carteira
// Contagens sobre a carteira válida (status.conta_carteira = 1: inválidos/baixados ficam fora).
//   crédito liberado = clientes que já tiveram crédito liberado (console ou relatório), mesmo que depois virem venda
//   % contactado = (total − não contactado) ÷ total · % conversão = venda realizada ÷ contactados

export const PERFIS_VISAO_TOTAL = Object.freeze(['administrador', 'gerente', 'financeiro']);
export const PARAMETROS_PAINEL = Object.freeze(['data_inicio_campanha', 'percentual_pipeline', 'valor_medio_cliente']);

export const vePainelCompleto = (usuario) => PERFIS_VISAO_TOTAL.includes(usuario?.perfil);

/** Linhas por agente de vendas, já no escopo do usuário. */
export function consultaPainel({ usuario }) {
  if (!usuario?.id || !usuario?.perfil) throw new Error('usuário obrigatório');
  const where = ['s.conta_carteira = 1'];
  const args = [];
  if (usuario.perfil === 'supervisor') { where.push('COALESCE(v.supervisor_id, v.id) = ?'); args.push(usuario.id); }
  else if (!vePainelCompleto(usuario)) { where.push('v.id = ?'); args.push(usuario.id); }
  return {
    sql: `SELECT v.id AS agente_id, v.nome AS agente_nome, v.perfil AS agente_perfil, v.tipo_atuacao,
                 COALESCE(v.supervisor_id, v.id) AS supervisor_id, COALESCE(sup.nome, v.nome) AS supervisor_nome,
                 COUNT(*)                                       AS total,
                 SUM(p.status_atual = 'nao_contactado')         AS nao_contactado,
                 SUM(p.status_atual = 'sem_interesse')          AS sem_interesse,
                 SUM(p.dt_liberacao_credito IS NOT NULL)        AS credito_liberado,
                 SUM(p.status_atual = 'venda_realizada')        AS venda_realizada
            FROM prospects p
            JOIN status s   ON s.codigo = p.status_atual
            JOIN usuarios v ON v.id = p.vendedor_id
            LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
           WHERE ${where.join(' AND ')}
           GROUP BY v.id
           ORDER BY v.nome`,
    args,
  };
}

const CAMPOS = ['total', 'nao_contactado', 'sem_interesse', 'credito_liberado', 'venda_realizada'];

/** Soma linhas de agentes e calcula os percentuais. */
export function somarPainel(linhas) {
  const t = Object.fromEntries(CAMPOS.map((c) => [c, linhas.reduce((s, l) => s + Number(l[c] ?? 0), 0)]));
  return { ...t, ...percentuais(t), agentes: linhas.length,
    vendedores: linhas.filter((l) => l.tipo_atuacao === 'vendedor').length,
    representantes: linhas.filter((l) => l.tipo_atuacao !== 'vendedor').length };
}

export function percentuais({ total, nao_contactado, venda_realizada }) {
  const contactados = Number(total) - Number(nao_contactado);
  return {
    contactados,
    pct_contactado: Number(total) ? (contactados / Number(total)) * 100 : 0,
    pct_conversao: contactados ? (Number(venda_realizada) / contactados) * 100 : 0,
  };
}

/** Supervisores presentes nas linhas (para o seletor), em ordem alfabética. */
export function supervisoresDoPainel(linhas) {
  const m = new Map();
  for (const l of linhas) m.set(Number(l.supervisor_id), l.supervisor_nome);
  return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

/** Potencial do pipeline de abertura e valor de conversão. */
export function valoresPainel({ total, venda_realizada }, { percentual_pipeline, valor_medio_cliente }) {
  const pct = Number(percentual_pipeline);
  const valor = Number(valor_medio_cliente);
  return { pipeline: (Number(total) * pct * valor) / 100, conversao: Number(venda_realizada) * valor };
}

/** Dias úteis de inicio a fim (inclusive): segunda a sexta, menos as datas em `feriados` (Set de AAAA-MM-DD). */
export function diasUteis(inicio, fim, feriados = new Set()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim ?? '') || inicio > fim) return 0;
  let n = 0;
  for (let d = new Date(`${inicio}T00:00:00Z`), f = new Date(`${fim}T00:00:00Z`); d <= f; d.setUTCDate(d.getUTCDate() + 1)) {
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6 && !feriados.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

export async function lerParametrosPainel(db) {
  const r = await db.execute({ sql: `SELECT chave, valor FROM parametros WHERE chave IN (${PARAMETROS_PAINEL.map(() => '?').join(',')})`, args: [...PARAMETROS_PAINEL] });
  return Object.fromEntries(r.rows.map((x) => [x.chave, x.valor]));
}

/** Dias úteis da campanha até `hoje`, com os feriados do banco. */
export async function diasUteisCampanha(db, { inicio, hoje }) {
  const r = await db.execute({ sql: 'SELECT DISTINCT data FROM feriados WHERE data BETWEEN ? AND ?', args: [inicio, hoje] });
  return diasUteis(inicio, hoje, new Set(r.rows.map((x) => x.data)));
}
