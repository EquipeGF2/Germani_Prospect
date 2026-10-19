// Painel do Início (dashboard de acompanhamento). docs/03 §10
// Uma consulta por agente de vendas (vendedor/representante dono da carteira); os totais geral e por
// supervisor são somas dessas linhas. Escopo:
//   administrador, gerente comercial, analista financeiro → tudo (com seletor de supervisor)
//   supervisor → só a própria equipe · vendedor/representante → só a própria carteira
// Contagens sobre a carteira válida (status.conta_carteira = 1: inválidos/baixados ficam fora).
//   funil cumulativo: contactados ⊇ atendidos ⊇ cadastrados ⊇ crédito liberado ⊇ venda (quem chegou à etapa ou além)
//   % contactado = contactados ÷ total · % conversão = venda realizada ÷ contactados
//   valor dos pedidos = soma real do valor dos pedidos importados do ERP (eventos_erp.valor, migração 0004)
// Filtro de período (resolverPeriodo): sem período = posição atual; com período = eventos com data no período.
import { datasDeFeriado } from './feriados.mjs';

export const PERFIS_VISAO_TOTAL = Object.freeze(['administrador', 'gerente', 'financeiro']);
export const PARAMETROS_PAINEL = Object.freeze(['data_inicio_campanha', 'percentual_pipeline', 'valor_medio_cliente']);

export const vePainelCompleto = (usuario) => PERFIS_VISAO_TOTAL.includes(usuario?.perfil);

// Etapas do funil, cumulativas ("chegou pelo menos até aqui"), para o funil nunca crescer de uma etapa para a outra.
const ETAPA = {
  venda: "p.status_atual = 'venda_realizada'",
  credito: "(p.dt_liberacao_credito IS NOT NULL OR p.status_atual = 'venda_realizada')",
  cadastro: "(p.dt_cadastro_erp IS NOT NULL OR p.dt_liberacao_credito IS NOT NULL OR p.status_atual = 'venda_realizada')",
  atendido: "(p.dt_atendido IS NOT NULL OR p.dt_cadastro_erp IS NOT NULL OR p.dt_liberacao_credito IS NOT NULL OR p.status_atual = 'venda_realizada')",
};
// No período: o evento da etapa (ou de uma etapa posterior) caiu no período — também cumulativo.
const NO_PERIODO = {
  venda: ["CASE WHEN p.status_atual = 'venda_realizada' THEN p.dt_pedido END"],
  credito: ['p.dt_liberacao_credito'],
  cadastro: ['p.dt_cadastro_erp'],
  atendido: ['p.dt_atendido'],
};
const CUMULATIVO = { venda: ['venda'], credito: ['credito', 'venda'], cadastro: ['cadastro', 'credito', 'venda'], atendido: ['atendido', 'cadastro', 'credito', 'venda'] };

/**
 * Linhas por agente de vendas, já no escopo do usuário.
 * Sem período = posição atual (foto da carteira hoje). Com `periodo` { inicio, fim } = o que aconteceu no período:
 * contactado = algum registro no período (ou avanço de etapa); atendidos ⊇ cadastrados ⊇ crédito ⊇ vendas pela data do evento
 * (cumulativo: quem avançou para uma etapa posterior no período conta nas anteriores); sem interesse = encerrado no período.
 * Total e não contactado continuam sendo a posição atual da carteira.
 */
export function consultaPainel({ usuario, periodo = null }) {
  if (!usuario?.id || !usuario?.perfil) throw new Error('usuário obrigatório');
  const where = ['s.conta_carteira = 1'];
  const escopo = [];
  if (usuario.perfil === 'supervisor') { where.push('COALESCE(v.supervisor_id, v.id) = ?'); escopo.push(usuario.id); }
  else if (!vePainelCompleto(usuario)) { where.push('v.id = ?'); escopo.push(usuario.id); }
  const args = [];
  let colunas;
  if (periodo) {
    const entre = (expr) => { args.push(periodo.inicio, periodo.fim); return `${expr} BETWEEN ? AND ?`; };
    const etapa = (k) => `(${CUMULATIVO[k].flatMap((e) => NO_PERIODO[e]).map(entre).join(' OR ')})`;
    // a ordem de montagem segue a ordem das colunas no SELECT (os "?" são posicionais)
    const contactado = `SUM(EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = p.id AND ${entre('c.data_contato')}) OR ${etapa('atendido')})`;
    colunas = [contactado, `SUM(${etapa('atendido')})`, `SUM(${etapa('cadastro')})`, `SUM(${etapa('credito')})`, `SUM(${etapa('venda')})`,
      `SUM(p.status_atual = 'sem_interesse' AND ${entre('p.dt_ultimo_contato')})`];
    const pedidos = (agregado) => `SUM((SELECT ${agregado} FROM eventos_erp e WHERE e.prospect_id = p.id AND e.tipo = 'pedido' AND ${entre('e.data_evento')}))`;
    colunas.push(pedidos('COUNT(*)'), pedidos('SUM(e.valor)'));
  } else {
    colunas = ["SUM(p.status_atual <> 'nao_contactado')", `SUM(${ETAPA.atendido})`, `SUM(${ETAPA.cadastro})`, `SUM(${ETAPA.credito})`,
      `SUM(${ETAPA.venda})`, "SUM(p.status_atual = 'sem_interesse')"];
    const pedidos = (agregado) => `SUM((SELECT ${agregado} FROM eventos_erp e WHERE e.prospect_id = p.id AND e.tipo = 'pedido'))`;
    colunas.push(pedidos('COUNT(*)'), pedidos('SUM(e.valor)'));
  }
  const [contactados, atendidos, cadastrados, credito, venda, sem, qtdPedidos, valorPedidos] = colunas;
  return {
    sql: `SELECT v.id AS agente_id, v.nome AS agente_nome, v.perfil AS agente_perfil, v.tipo_atuacao,
                 COALESCE(v.supervisor_id, v.id) AS supervisor_id, COALESCE(sup.nome, v.nome) AS supervisor_nome,
                 COUNT(*)                                AS total,
                 SUM(p.status_atual = 'nao_contactado')  AS nao_contactado,
                 ${contactados} AS contactados,
                 ${atendidos} AS atendidos,
                 ${cadastrados} AS cadastrados,
                 ${credito} AS credito_liberado,
                 ${venda} AS venda_realizada,
                 ${sem} AS sem_interesse,
                 COALESCE(${qtdPedidos}, 0) AS qtd_pedidos,
                 COALESCE(${valorPedidos}, 0) AS valor_pedidos
            FROM prospects p
            JOIN status s   ON s.codigo = p.status_atual
            JOIN usuarios v ON v.id = p.vendedor_id
            LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
           WHERE ${where.join(' AND ')}
           GROUP BY v.id
           ORDER BY v.nome`,
    args: [...args, ...escopo],
  };
}

/** Funil (base → venda) a partir de uma linha somada. */
export function funilPainel(t) {
  return [['Base de prospects', t.total], ['Contactados', t.contactados], ['Atendidos', t.atendidos],
    ['Cadastrados no ERP', t.cadastrados], ['Crédito liberado', t.credito_liberado], ['Venda realizada', t.venda_realizada]]
    .map(([rotulo, valor], i, l) => ({ rotulo, valor: Number(valor),
      pctBase: Number(t.total) ? (Number(valor) / Number(t.total)) * 100 : 0,                          // % sobre a base de prospects
      taxa: i && Number(l[i - 1][1]) ? (Number(valor) / Number(l[i - 1][1])) * 100 : null }));          // passagem da etapa anterior
}

export const PERIODOS = Object.freeze({
  atual: 'Posição atual',
  campanha: 'Desde o início',
  hoje: 'Hoje',
  semana: 'Esta semana',
  mes: 'Este mês',
  dias30: 'Últimos 30 dias',
  personalizado: 'Personalizado',
});

/** Converte a escolha do filtro em { inicio, fim } (AAAA-MM-DD) ou null para a posição atual. */
export function resolverPeriodo(chave, { hoje, inicioCampanha, de, ate }) {
  const d = new Date(`${hoje}T12:00:00Z`);
  const iso = (x) => x.toISOString().slice(0, 10);
  switch (chave) {
    case 'campanha': return { inicio: inicioCampanha, fim: hoje };
    case 'hoje': return { inicio: hoje, fim: hoje };
    case 'semana': { const seg = new Date(d); seg.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return { inicio: iso(seg), fim: hoje }; }
    case 'mes': return { inicio: `${hoje.slice(0, 7)}-01`, fim: hoje };
    case 'dias30': { const i = new Date(d); i.setUTCDate(d.getUTCDate() - 29); return { inicio: iso(i), fim: hoje }; }
    case 'personalizado': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(de ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate ?? '')) return null;
      return de <= ate ? { inicio: de, fim: ate } : { inicio: ate, fim: de };
    }
    default: return null;
  }
}

const CAMPOS = ['total', 'nao_contactado', 'contactados', 'atendidos', 'cadastrados', 'sem_interesse', 'credito_liberado', 'venda_realizada',
  'qtd_pedidos', 'valor_pedidos'];

/** Soma linhas de agentes e calcula os percentuais. */
export function somarPainel(linhas) {
  const t = Object.fromEntries(CAMPOS.map((c) => [c, linhas.reduce((s, l) => s + Number(l[c] ?? 0), 0)]));
  return { ...t, ...percentuais(t), agentes: linhas.length,
    vendedores: linhas.filter((l) => l.tipo_atuacao === 'vendedor').length,
    representantes: linhas.filter((l) => l.tipo_atuacao !== 'vendedor').length };
}

export function percentuais({ total, nao_contactado, contactados: c, venda_realizada }) {
  const contactados = c == null ? Number(total) - Number(nao_contactado) : Number(c);
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

/** Dias úteis da campanha até `hoje` (ou dentro do período, limitado ao início da campanha e a hoje), com os feriados do banco. */
export async function diasUteisCampanha(db, { inicio, hoje, periodo = null }) {
  const de = periodo && periodo.inicio > inicio ? periodo.inicio : inicio;
  const ate = periodo && periodo.fim < hoje ? periodo.fim : hoje;
  return diasUteis(de, ate, de <= ate ? await datasDeFeriado(db, { inicio: de, fim: ate }) : new Set());
}
