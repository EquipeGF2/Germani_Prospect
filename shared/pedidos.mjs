// Acompanhamento de pedidos: leitura e contas das abas (Pedidos · Por representante · Bonificação · Alertas), da ficha e dos alertas.
// A tela lê os pedidos do escopo numa consulta só; filtros e abas são calculados no navegador. docs/03 §14
// Só clientes da base. A filial de um grupo da base (prospect_id NULL) aparece apenas na visão do grupo.
import { veTodasEquipes } from './perfis.mjs';

/** Pedidos que o usuário enxerga: os da carteira dele (ou da equipe) e os que ele mesmo fez, inclusive para cliente de outra lista. */
function escopoPedidos(usuario) {
  if (veTodasEquipes(usuario)) return { where: '1 = 1', args: [] };
  if (usuario.perfil === 'supervisor') {
    return { where: '(dono_supervisor_id = ? OR dono_id = ? OR rep_supervisor_id = ? OR rep_id = ?)', args: [usuario.id, usuario.id, usuario.id, usuario.id] };
  }
  return { where: '(dono_id = ? OR rep_id = ?)', args: [usuario.id, usuario.id] };
}

export function consultaPedidos({ usuario, prospectId = null, limite = 5000 }) {
  const e = escopoPedidos(usuario);
  return {
    sql: `SELECT v.*, p.cidade, p.uf, p.tipologia_gtm, p.onda, p.rota, sup.nome AS supervisor_nome
            FROM vw_pedidos v JOIN prospects p ON p.id = v.prospect_id LEFT JOIN usuarios sup ON sup.id = v.dono_supervisor_id
           WHERE ${e.where} ${prospectId ? 'AND v.prospect_id = ?' : ''} ORDER BY CAST(v.numero AS INTEGER) DESC LIMIT ?`,
    args: [...e.args, ...(prospectId ? [prospectId] : []), limite],
  };
}

/** O grupo do cliente (raiz do CNPJ), empresa por empresa: inclui as filiais que não estão na base. */
export function consultaPedidosGrupo({ prospectId }) {
  return {
    sql: `SELECT g.prospect_id, g.cpf_cnpj, g.razao_social, SUM(g.valida) AS validos, SUM(CASE WHEN g.valida = 1 THEN g.valor_pedido ELSE 0 END) AS venda, SUM(g.saldo) AS saldo,
                 SUM(CASE WHEN g.tipo = 'investimento' AND g.fase <> 'cancelado' THEN g.valor_pedido ELSE 0 END) AS investimento
            FROM vw_pedidos g WHERE length(g.cpf_cnpj) = 14 AND g.raiz = (SELECT cnpj_raiz FROM prospects WHERE id = ?) GROUP BY g.cpf_cnpj`,
    args: [prospectId],
  };
}

/** Em carteira das filiais fora da base, por raiz: entra na conta do limite do grupo. */
export function consultaSaldoFiliais() {
  return { sql: 'SELECT raiz, SUM(saldo) AS saldo FROM vw_pedidos WHERE prospect_id IS NULL AND length(cpf_cnpj) = 14 AND saldo > 0 GROUP BY raiz', args: [] };
}

const num = (v) => Number(v ?? 0);
const vazio = () => ({ qtd: 0, valor: 0 });
const somar = (t, v) => { t.qtd += 1; t.valor += num(v); };

/** Os seis números: venda válida, faturado, em carteira, digitado, desistência e investimento. */
export function resumirPedidos(pedidos) {
  const r = { venda: vazio(), faturado: 0, saldo: 0, digitado: vazio(), cancelado: vazio(), investimento: vazio() };
  for (const p of pedidos) {
    if (p.tipo === 'investimento') { if (p.fase !== 'cancelado' && p.fase !== 'digitado') somar(r.investimento, p.valor_pedido); continue; }
    if (p.tipo !== 'venda') continue;
    if (num(p.valida)) { somar(r.venda, p.valor_pedido); r.faturado += num(p.valor_faturado); r.saldo += num(p.saldo); }
    else if (p.fase === 'digitado') somar(r.digitado, p.valor_pedido);
    else somar(r.cancelado, p.valor_pedido);
  }
  return r;
}

const nomeRep = (p) => (p.rep_codigo == null ? 'Sem representante' : `${p.rep_codigo} · ${p.rep_nome ?? 'sem cadastro'}`);
export const rotuloRepresentante = nomeRep;

/**
 * Por representante, sempre por quem fez o pedido: o cliente fica com o dono da carteira e a venda vai para quem realizou.
 * O valor nunca duplica (cada pedido tem um só representante); os clientes podem repetir entre representantes.
 */
export function porRepresentante(pedidos) {
  const reps = new Map();
  for (const p of pedidos) {
    const chave = String(p.rep_codigo ?? '');
    if (!reps.has(chave)) reps.set(chave, { codigo: p.rep_codigo, nome: p.rep_nome, rotulo: nomeRep(p), clientes: new Map(), validos: 0, venda: 0, faturado: 0, saldo: 0, digitado: 0, desistencia: 0, investimento: 0, propria: 0, outra: 0 });
    const r = reps.get(chave);
    if (p.tipo === 'investimento') { if (p.fase !== 'cancelado' && p.fase !== 'digitado') r.investimento += num(p.valor_pedido); continue; }
    if (p.tipo !== 'venda') continue;
    if (!num(p.valida)) { if (p.fase === 'digitado') r.digitado += num(p.valor_pedido); else r.desistencia += num(p.valor_pedido); continue; }
    r.validos += 1; r.venda += num(p.valor_pedido); r.faturado += num(p.valor_faturado); r.saldo += num(p.saldo);
    if (p.relacao === 'propria') r.propria += num(p.valor_pedido);
    else r.outra += num(p.valor_pedido);
    if (!r.clientes.has(p.cpf_cnpj)) r.clientes.set(p.cpf_cnpj, { documento: p.cpf_cnpj, codigo: p.codigo_cliente, razao: p.razao_social, relacao: p.relacao, dono: p.dono_id != null ? `${p.dono_codigo ?? ''} · ${p.dono_nome ?? ''}` : null, pedidos: 0, venda: 0 });
    const c = r.clientes.get(p.cpf_cnpj);
    c.pedidos += 1; c.venda += num(p.valor_pedido);
  }
  return [...reps.values()].map((r) => ({ ...r, clientes: [...r.clientes.values()].sort((a, b) => b.venda - a.venda) })).sort((a, b) => b.venda - a.venda || b.investimento - a.investimento);
}

/** Clientes com venda válida distintos no conjunto (os representantes podem repetir o mesmo cliente). */
export const clientesDistintos = (pedidos) => new Set(pedidos.filter((p) => num(p.valida)).map((p) => p.cpf_cnpj)).size;

/** Clientes vendidos por mais de um representante, com a parte de cada um. */
export function clientesVariosRepresentantes(pedidos) {
  const clientes = new Map();
  for (const p of pedidos) {
    if (!num(p.valida)) continue;
    if (!clientes.has(p.cpf_cnpj)) clientes.set(p.cpf_cnpj, { documento: p.cpf_cnpj, codigo: p.codigo_cliente, razao: p.razao_social, reps: new Map(), venda: 0 });
    const c = clientes.get(p.cpf_cnpj);
    const k = String(p.rep_codigo ?? '');
    if (!c.reps.has(k)) c.reps.set(k, { rotulo: nomeRep(p), pedidos: 0, venda: 0 });
    c.reps.get(k).pedidos += 1; c.reps.get(k).venda += num(p.valor_pedido); c.venda += num(p.valor_pedido);
  }
  return [...clientes.values()].filter((c) => c.reps.size > 1).map((c) => ({ ...c,
    reps: [...c.reps.values()].sort((a, b) => b.venda - a.venda).map((r) => ({ ...r, parte: c.venda ? (r.venda / c.venda) * 100 : 0 })) })).sort((a, b) => b.venda - a.venda);
}

/** Investimento em bonificação por cliente: conta à parte, a venda não muda. "digitado" fica como previsão; desistência fica fora. */
export function bonificacaoPorCliente(pedidos) {
  const clientes = new Map();
  const venda = new Map();
  for (const p of pedidos) if (num(p.valida)) venda.set(p.cpf_cnpj, (venda.get(p.cpf_cnpj) ?? 0) + num(p.valor_pedido));
  for (const p of pedidos) {
    if (p.tipo !== 'investimento' || p.fase === 'cancelado' || p.fase === 'digitado') continue;
    if (!clientes.has(p.cpf_cnpj)) clientes.set(p.cpf_cnpj, { documento: p.cpf_cnpj, codigo: p.codigo_cliente, razao: p.razao_social, prospectId: p.prospect_id, rep: nomeRep(p), pedidos: [], investimento: 0, venda: venda.get(p.cpf_cnpj) ?? 0 });
    const c = clientes.get(p.cpf_cnpj);
    c.pedidos.push(p.numero); c.investimento += num(p.valor_pedido);
  }
  return [...clientes.values()].map((c) => ({ ...c, pct: c.venda ? (c.investimento / c.venda) * 100 : null })).sort((a, b) => b.investimento - a.investimento);
}

/** Alertas do conjunto. Venda por outro representante não é alerta: é informação (aba Por representante). */
export function alertasPedidos(pedidos, { hoje, prazoPedidoValido = 10, desistencias = 5, diasAberto = 30, entradas = new Map(), saldoFiliais = new Map() } = {}) {
  const alertas = [];
  const diasDesde = (d) => (d ? Math.floor((Date.parse(hoje) - Date.parse(d)) / 86400000) : null);
  const clientes = new Map();
  for (const p of pedidos) { if (!clientes.has(p.cpf_cnpj)) clientes.set(p.cpf_cnpj, []); clientes.get(p.cpf_cnpj).push(p); }
  const titulo = (p) => `${p.codigo_cliente ?? '—'} - ${p.razao_social ?? p.cpf_cnpj}`;
  for (const lista of clientes.values()) {
    const p = lista[0];
    if (p.status_atual === 'aguardando_pedido_valido') {
      const dias = diasDesde(entradas.get(Number(p.prospect_id)) ?? p.data_situacao);
      if (dias > prazoPedidoValido) alertas.push({ tipo: 'pedido_valido', rotulo: 'Ag. pedido válido', cliente: titulo(p), prospectId: p.prospect_id, detalhe: `${dias} dias sem pedido válido (prazo: ${prazoPedidoValido})`, quem: 'Supervisor' });
    }
    if (lista.some((x) => x.tipo === 'investimento' && !['cancelado', 'digitado'].includes(x.fase)) && !lista.some((x) => x.tipo === 'venda')) {
      alertas.push({ tipo: 'bonificacao', rotulo: 'Bonificação sem venda', cliente: titulo(p), prospectId: p.prospect_id, detalhe: 'Em regra, não há bonificação sem pedido de venda', quem: 'Supervisor' });
    }
    const qtdDesistencia = lista.filter((x) => x.tipo === 'venda' && x.fase === 'cancelado').length;
    if (qtdDesistencia >= desistencias) alertas.push({ tipo: 'desistencia', rotulo: 'Muita desistência', cliente: titulo(p), prospectId: p.prospect_id, detalhe: `${qtdDesistencia} de ${lista.length} pedidos`, quem: 'Supervisor' });
    for (const x of lista) {
      const dias = diasDesde(x.data_situacao);
      if (num(x.valida) && x.fase === 'carteira' && dias > diasAberto) alertas.push({ tipo: 'aberto', rotulo: 'Aberto há muito tempo', cliente: titulo(p), prospectId: p.prospect_id, detalhe: `Pedido ${x.numero} em carteira há ${dias} dias`, quem: 'Supervisor' });
    }
  }
  // limite do grupo: só o que está em aberto (sem os títulos a receber, é uma visão parcial)
  const grupos = new Map();
  for (const p of pedidos) {
    if (!num(p.saldo) || p.prospect_id == null) continue;
    if (!grupos.has(p.raiz)) grupos.set(p.raiz, { saldo: num(saldoFiliais.get(p.raiz)), razao: p.razao_social, limite: null, prospectId: p.prospect_id });
    const g = grupos.get(p.raiz);
    g.saldo += num(p.saldo);
    if (p.limite_credito != null && p.limite_credito_origem === 'grupo') g.limite = num(p.limite_credito);
  }
  for (const [raiz, g] of grupos) {
    if (g.limite != null && g.limite > 0 && g.limite < 9999999 && g.saldo > g.limite) alertas.push({ tipo: 'limite', rotulo: 'Limite do grupo', cliente: `Raiz ${raiz} - ${g.razao}`, prospectId: g.prospectId, detalhe: `R$ ${g.saldo.toFixed(2).replace('.', ',')} em carteira, limite de R$ ${g.limite.toFixed(2).replace('.', ',')}`, quem: 'Financeiro' });
  }
  const semCodigo = new Set(pedidos.filter((p) => p.rep_codigo != null && p.rep_id == null).map((p) => String(p.rep_codigo)));
  for (const c of [...semCodigo].sort((a, b) => Number(a) - Number(b))) alertas.push({ tipo: 'sem_codigo', rotulo: 'Rep. sem código', cliente: `Representante ${c}`, prospectId: null, detalhe: 'Código do arquivo fora do cadastro de representantes', quem: 'Administrador' });
  return alertas;
}

/** Entrada em Aguardando pedido válido e o motivo (digitado · cancelado) por cliente: o efeito mais recente de cada arquivo. */
export function consultaMotivosPedidoValido() {
  return { sql: `SELECT a.prospect_id, a.motivo_invalido, a.data_evento FROM pedido_aplicacoes a
                  WHERE a.status_novo = 'aguardando_pedido_valido'
                    AND NOT EXISTS (SELECT 1 FROM pedido_aplicacoes n WHERE n.prospect_id = a.prospect_id AND n.id > a.id)`, args: [] };
}

// ---------- Análise: árvore de níveis livres, como o Explorar carteira, sobre os pedidos já lidos (nada volta ao banco) ----------
const texto = (v, vazio) => (v == null || v === '' ? vazio : String(v));
const NOME_TIPO = { venda: 'Venda', investimento: 'Bonificação', ignorar: 'Não considerado' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Níveis possíveis. `chave` agrupa; `rotulo` mostra. */
export const NIVEIS_PEDIDOS = Object.freeze({
  supervisor: { nome: 'Supervisor', chave: (p) => texto(p.dono_supervisor_id, ''), rotulo: (p) => texto(p.supervisor_nome, 'sem supervisor') },
  representante: { nome: 'Quem vendeu', chave: (p) => texto(p.rep_codigo, ''), rotulo: nomeRep },
  carteira: { nome: 'Dono da carteira', chave: (p) => texto(p.dono_id, ''), rotulo: (p) => [p.dono_codigo, p.dono_nome].filter(Boolean).join(' · ') || 'sem dono' },
  lista: { nome: 'Na lista?', chave: (p) => p.relacao, rotulo: (p) => (p.relacao === 'propria' ? 'Na lista de quem vendeu' : 'Fora da lista de quem vendeu') },
  cidade: { nome: 'Cidade', chave: (p) => `${texto(p.cidade, '')}|${texto(p.uf, '')}`, rotulo: (p) => (p.cidade ? `${p.cidade}${p.uf ? '/' + p.uf : ''}` : 'sem cidade') },
  segmento: { nome: 'Segmento', chave: (p) => texto(p.tipologia_gtm, ''), rotulo: (p) => texto(p.tipologia_gtm, 'sem segmento') },
  onda: { nome: 'Onda', chave: (p) => texto(p.onda, ''), rotulo: (p) => (p.onda ? `Onda ${p.onda}` : 'sem onda') },
  grupo: { nome: 'Grupo', chave: (p) => texto(p.raiz, ''), rotulo: (p) => `${texto(p.razao_social, '')} · raiz ${texto(p.raiz, '')}` },
  cliente: { nome: 'Cliente', chave: (p) => p.cpf_cnpj, rotulo: (p) => `${texto(p.codigo_cliente, '—')} - ${texto(p.razao_social, '')}` },
  tipo: { nome: 'Tipo', chave: (p) => p.tipo, rotulo: (p) => NOME_TIPO[p.tipo] ?? p.tipo },
  situacao: { nome: 'Situação', chave: (p) => p.situacao_codigo, rotulo: (p) => texto(p.situacao_descricao, p.situacao_codigo) },
  mes: { nome: 'Mês', chave: (p) => String(p.data_primeira ?? '').slice(0, 7), rotulo: (p) => (p.data_primeira ? `${MESES[Number(p.data_primeira.slice(5, 7)) - 1]}/${p.data_primeira.slice(0, 4)}` : 'sem data') },
});

/** Níveis que o usuário pode usar: quem não vê todas as equipes não tem o nível Supervisor. */
export const niveisPedidosPossiveis = (usuario) => Object.keys(NIVEIS_PEDIDOS).filter((n) => n !== 'supervisor' || veTodasEquipes(usuario));

/** Indicadores de um ramo: os seis valores, clientes distintos com venda e ticket médio. */
export function indicadoresRamo(pedidos) {
  const r = resumirPedidos(pedidos);
  const clientes = clientesDistintos(pedidos);
  return { ...r, clientes, ticket: r.venda.qtd ? r.venda.valor / r.venda.qtd : 0, pctFaturado: r.venda.valor ? (r.faturado / r.venda.valor) * 100 : null };
}

/**
 * Árvore visível: linhas na ordem de exibição, cada uma { caminho, profundidade, nivel, rotulo, aberto, temFilhos, ind, pedidos }.
 * Mostra todos os itens de cada nível aberto, do maior valor de venda para o menor.
 */
export function montarArvorePedidos({ pedidos, niveis, abertos, rotuloRaiz = 'Todos os pedidos' }) {
  const saida = [];
  const visitar = (caminho, profundidade, rows, rotulo, nivel) => {
    const temFilhos = profundidade < niveis.length;
    const aberto = temFilhos && abertos.has(caminho);
    const ind = indicadoresRamo(rows);
    saida.push({ caminho, profundidade, nivel, rotulo, aberto, temFilhos, ind, pedidos: rows });
    if (!aberto) return;
    const def = NIVEIS_PEDIDOS[niveis[profundidade]];
    const grupos = new Map();
    for (const p of rows) {
      const k = def.chave(p);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    const ordem = [...grupos.entries()].map(([k, g]) => ({ k, g, i: indicadoresRamo(g), rot: def.rotulo(g[0]) }))
      .sort((a, b) => b.i.venda.valor - a.i.venda.valor || b.i.investimento.valor - a.i.investimento.valor || a.rot.localeCompare(b.rot, 'pt-BR'));
    for (const o of ordem) visitar(`${caminho}/${niveis[profundidade]}=${o.k}`, profundidade + 1, o.g, o.rot, niveis[profundidade]);
  };
  visitar('', 0, pedidos, rotuloRaiz, null);
  return saida;
}

