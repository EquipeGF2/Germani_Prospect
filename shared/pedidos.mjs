// Explorar pedidos: leitura, árvore, filtros, busca e alertas, além das contas da ficha.
// A tela lê os pedidos do escopo numa consulta só; a árvore é calculada no navegador. docs/03 §14
// Só clientes da base. A filial de um grupo da base (prospect_id NULL) aparece apenas na visão do grupo.
import { veTodasEquipes } from './perfis.mjs';
import { normalizarBusca } from './texto.mjs';

/** Pedidos que o usuário enxerga: os da carteira dele (ou da equipe) e os que ele mesmo fez, inclusive para cliente de outra lista. */
function escopoPedidos(usuario) {
  if (veTodasEquipes(usuario)) return { where: '1 = 1', args: [] };
  if (usuario.perfil === 'supervisor') {
    return { where: '(dono_supervisor_id = ? OR dono_id = ? OR rep_supervisor_id = ? OR rep_id = ?)', args: [usuario.id, usuario.id, usuario.id, usuario.id] };
  }
  return { where: '(dono_id = ? OR rep_id = ?)', args: [usuario.id, usuario.id] };
}

/**
 * Pedidos do escopo. `incluirFiliais`: também os de filial fora da base com a raiz de um cliente da base (Ver por Grupo).
 * A filial não tem carteira própria: fica com o dono da empresa da base naquele grupo, para o escopo e o nível Dono da carteira.
 */
export function consultaPedidos({ usuario, prospectId = null, limite = 5000, incluirFiliais = false }) {
  const e = escopoPedidos(usuario);
  return {
    sql: `SELECT * FROM (
            SELECT v.id, v.numero, v.importacao_id, v.data_situacao, v.data_primeira, v.cpf_cnpj, v.prospect_id, v.codigo_cliente, v.razao_social,
                   v.transacao_codigo, v.transacao_descricao, v.tipo, v.situacao_codigo, v.situacao_descricao, v.fase,
                   v.rep_codigo, v.rep_id, v.rep_nome, v.rep_supervisor_id, v.valor_pedido, v.valor_faturado, v.valida, v.saldo, v.status_atual, v.raiz,
                   COALESCE(v.limite_credito, g.limite_credito) AS limite_credito, COALESCE(v.limite_credito_origem, g.limite_credito_origem) AS limite_credito_origem,
                   COALESCE(v.dono_id, g.vendedor_id) AS dono_id, COALESCE(v.dono_nome, gd.nome) AS dono_nome, COALESCE(v.dono_codigo, gd.codigo_erp) AS dono_codigo,
                   COALESCE(v.dono_supervisor_id, gd.supervisor_id) AS dono_supervisor_id,
                   CASE WHEN v.prospect_id IS NOT NULL THEN v.relacao WHEN v.rep_id = g.vendedor_id THEN 'propria' ELSE 'outra' END AS relacao,
                   p.cidade, p.uf, COALESCE(p.tipologia_gtm, g.tipologia_gtm) AS tipologia_gtm, COALESCE(p.onda, g.onda) AS onda, p.rota, sup.nome AS supervisor_nome
              FROM vw_pedidos v
              LEFT JOIN prospects p ON p.id = v.prospect_id
              LEFT JOIN prospects g ON v.prospect_id IS NULL AND length(v.cpf_cnpj) = 14 AND g.id = (SELECT MIN(x.id) FROM prospects x WHERE x.cnpj_raiz = v.raiz)
              LEFT JOIN usuarios gd ON gd.id = g.vendedor_id
              LEFT JOIN usuarios sup ON sup.id = COALESCE(v.dono_supervisor_id, gd.supervisor_id)
             WHERE v.prospect_id IS NOT NULL ${incluirFiliais ? 'OR g.id IS NOT NULL' : ''})
           WHERE ${e.where} ${prospectId ? 'AND prospect_id = ?' : ''} ORDER BY CAST(numero AS INTEGER) DESC LIMIT ?`,
    args: [...e.args, ...(prospectId ? [prospectId] : []), limite],
  };
}

/** O grupo do cliente (raiz do CNPJ), empresa por empresa: inclui as filiais que não estão na base. */
export function consultaPedidosGrupo({ prospectId }) {
  return {
    sql: `SELECT g.prospect_id, g.cpf_cnpj, g.razao_social, SUM(g.valida) AS validos, SUM(CASE WHEN g.valida = 1 THEN g.valor_pedido ELSE 0 END) AS venda, SUM(g.saldo) AS saldo,
                 SUM(CASE WHEN g.tipo = 'investimento' AND g.fase <> 'cancelado' THEN g.valor_pedido ELSE 0 END) AS investimento
            FROM vw_pedidos g
           WHERE g.cpf_cnpj >= (SELECT cnpj_raiz FROM prospects WHERE id = ?) AND g.cpf_cnpj < (SELECT cnpj_raiz || '~' FROM prospects WHERE id = ?)
             AND length(g.cpf_cnpj) = 14 GROUP BY g.cpf_cnpj`,   // pelo começo do CNPJ, que tem índice: lê só o grupo, não todos os pedidos
    args: [prospectId, prospectId],
  };
}

/** Os pedidos só mudam com um arquivo importado ou apagado: esta consulta, de poucas linhas, diz se o que já foi lido ainda vale. */
export const consultaVersaoPedidos = () => ({ sql: 'SELECT COALESCE(MAX(importacao_id), 0) AS ultima, COUNT(apagada_em) AS apagadas FROM pedido_importacoes', args: [] });
/** A mesma consulta, marcada com a versão dos arquivos: arquivo novo vira outra chave no cache, e a tela lê de novo. */
export const comVersaoPedidos = (consulta, { ultima = 0, apagadas = 0 } = {}) => ({ ...consulta, sql: `${consulta.sql} /* arquivos ${ultima}.${apagadas} */` });

/** Em carteira das filiais fora da base, por raiz: entra na conta do limite do grupo. */
export function consultaSaldoFiliais() {
  return { sql: 'SELECT raiz, SUM(saldo) AS saldo FROM vw_pedidos WHERE prospect_id IS NULL AND length(cpf_cnpj) = 14 AND saldo > 0 GROUP BY raiz', args: [] };
}

const num = (v) => Number(v ?? 0);

/**
 * Separa uma lista pela raiz do CNPJ (8 primeiros dígitos). Grupo = 2 ou mais empresas diferentes da mesma raiz, ou pedido de filial
 * fora da base (prospect_id nulo), que só existe por causa do grupo; o resto fica solto.
 * Só agrupa para mostrar: status, atendimento e crédito continuam de cada empresa.
 */
export function agruparPorRaiz(linhas, documentoDe) {
  const raizes = new Map();
  for (const l of linhas) {
    const r = String(documentoDe(l)).slice(0, 8);
    if (!raizes.has(r)) raizes.set(r, { raiz: r, linhas: [], empresas: new Set(), filial: false });
    const g = raizes.get(r);
    g.linhas.push(l); g.empresas.add(documentoDe(l));
    if (l.prospect_id === null) g.filial = true;
  }
  const todos = [...raizes.values()];
  const ehGrupo = (g) => g.empresas.size > 1 || g.filial;
  return { grupos: todos.filter(ehGrupo), soltas: todos.filter((g) => !ehGrupo(g)).flatMap((g) => g.linhas) };
}
const nomeEmpresas = (n) => `${n} ${n === 1 ? 'empresa' : 'empresas'}`;
/** Rótulo da linha do grupo: "Grupo X · 2 empresas". */
export const rotuloGrupo = (g) => `Grupo ${g.linhas[0].razao_social} · ${nomeEmpresas(g.empresas.size)}`;
/** Empresas de cada raiz no conjunto: a chave do cliente é a raiz quando ela forma grupo. */
function empresasPorRaiz(pedidos) {
  const m = new Map();
  for (const p of pedidos) {
    const r = String(p.cpf_cnpj).slice(0, 8);
    if (!m.has(r)) m.set(r, { empresas: new Set(), filial: false });
    m.get(r).empresas.add(p.cpf_cnpj);
    if (p.prospect_id === null) m.get(r).filial = true;
  }
  return m;
}
function clienteDe(p, porGrupo, raizes) {
  const r = String(p.cpf_cnpj).slice(0, 8);
  const g = raizes?.get(r);
  if (!porGrupo || !g || (g.empresas.size < 2 && !g.filial)) return { chave: p.cpf_cnpj, documento: p.cpf_cnpj, codigo: p.codigo_cliente, razao: p.razao_social };
  return { chave: r, documento: r, codigo: null, razao: `Grupo ${p.razao_social} · ${nomeEmpresas(g.empresas.size)}` };
}

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
export function porRepresentante(pedidos, { porGrupo = false } = {}) {
  const reps = new Map();
  const raizes = empresasPorRaiz(pedidos);
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
    const cli = clienteDe(p, porGrupo, raizes);
    if (!r.clientes.has(cli.chave)) r.clientes.set(cli.chave, { ...cli, relacao: p.relacao, dono: p.dono_id != null ? `${p.dono_codigo ?? ''} · ${p.dono_nome ?? ''}` : null, pedidos: 0, venda: 0 });
    const c = r.clientes.get(cli.chave);
    c.pedidos += 1; c.venda += num(p.valor_pedido);
    if (p.relacao === 'propria') c.relacao = 'propria';   // grupo: basta uma empresa na lista dele
  }
  return [...reps.values()].map((r) => ({ ...r, clientes: [...r.clientes.values()].sort((a, b) => b.venda - a.venda) })).sort((a, b) => b.venda - a.venda || b.investimento - a.investimento);
}

/** Clientes com venda válida distintos no conjunto (os representantes podem repetir o mesmo cliente). */
export const clientesDistintos = (pedidos, { porGrupo = false } = {}) => new Set(pedidos.filter((p) => num(p.valida)).map((p) => (porGrupo ? String(p.cpf_cnpj).slice(0, 8) : p.cpf_cnpj))).size;

/** Alertas do conjunto. Venda por outro representante não é alerta: é informação (nível Quem vendeu). */
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
export function indicadoresRamo(pedidos, { porGrupo = false } = {}) {
  const r = resumirPedidos(pedidos);
  const clientes = clientesDistintos(pedidos, { porGrupo });
  const naLista = (rel) => pedidos.filter((p) => num(p.valida) && p.relacao === rel).reduce((t, p) => t + num(p.valor_pedido), 0);
  return { ...r, clientes, ticket: r.venda.qtd ? r.venda.valor / r.venda.qtd : 0, pctFaturado: r.venda.valor ? (r.faturado / r.venda.valor) * 100 : null,
    pctInvestimento: r.venda.valor ? (r.investimento.valor / r.venda.valor) * 100 : null, propria: naLista('propria'), outra: naLista('outra') };
}

/**
 * Árvore visível: linhas na ordem de exibição, cada uma { caminho, profundidade, nivel, rotulo, aberto, temFilhos, ind, pedidos }.
 * Mostra todos os itens de cada nível aberto, do maior valor de venda para o menor.
 */
export function montarArvorePedidos({ pedidos, niveis, abertos, rotuloRaiz = 'Todos os pedidos', porGrupo = false }) {
  const saida = [];
  // Ver por Grupo: no nível Cliente, as empresas da mesma raiz ficam dentro de uma linha do grupo; empresa sem grupo fica direto
  const separarGrupo = porGrupo && !niveis.includes('grupo');
  const ind = (rows) => indicadoresRamo(rows, { porGrupo });
  const ordenar = (lista) => lista.sort((a, b) => b.i.venda.valor - a.i.venda.valor || b.i.investimento.valor - a.i.investimento.valor || a.rot.localeCompare(b.rot, 'pt-BR'));
  const visitar = (caminho, profundidade, rows, rotulo, nivel, { dentroDoGrupo = false, ehGrupo = false } = {}) => {
    const temFilhos = ehGrupo || profundidade < niveis.length + (dentroDoGrupo ? 1 : 0);
    const aberto = temFilhos && abertos.has(caminho);
    saida.push({ caminho, profundidade, nivel, rotulo, aberto, temFilhos, ehGrupo, ind: ind(rows), pedidos: rows });
    if (!aberto) return;
    const codNivel = niveis[profundidade - (dentroDoGrupo || ehGrupo ? 1 : 0)];
    const def = NIVEIS_PEDIDOS[codNivel];
    const dentro = dentroDoGrupo || ehGrupo;
    if (separarGrupo && codNivel === 'cliente' && !ehGrupo) {
      const { grupos, soltas } = agruparPorRaiz(rows, (p) => p.cpf_cnpj);
      const itens = [...grupos.map((g) => ({ g: g.linhas, k: `grupo=${g.raiz}`, rot: rotuloGrupo(g), n: 'grupo', eh: true, i: ind(g.linhas) }))];
      const porDoc = new Map();
      for (const p of soltas) { if (!porDoc.has(p.cpf_cnpj)) porDoc.set(p.cpf_cnpj, []); porDoc.get(p.cpf_cnpj).push(p); }
      for (const [doc, l] of porDoc) itens.push({ g: l, k: `cliente=${doc}`, rot: def.rotulo(l[0]), n: 'cliente', eh: false, i: ind(l) });
      for (const o of ordenar(itens)) visitar(`${caminho}/${o.k}`, profundidade + 1, o.g, o.rot, o.n, { ehGrupo: o.eh, dentroDoGrupo: dentroDoGrupo });
      return;
    }
    const grupos = new Map();
    for (const p of rows) {
      const k = def.chave(p);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    const ordem = ordenar([...grupos.entries()].map(([k, g]) => ({ k, g, i: ind(g), rot: def.rotulo(g[0]) })));
    for (const o of ordem) visitar(`${caminho}/${codNivel}=${o.k}`, profundidade + 1, o.g, o.rot, codNivel, { dentroDoGrupo: dentro });
  };
  visitar('', 0, pedidos, rotuloRaiz, null);
  return saida;
}

// ---------- filtro do tipo do pedido; o resto é a hierarquia da árvore ----------
/** @param tipo 'ambos' | 'venda' | 'investimento' */
export const filtrarPedidos = (pedidos, { tipo = 'ambos' } = {}) => (tipo === 'ambos' ? pedidos : pedidos.filter((p) => p.tipo === tipo));

/** Busca da lista de pedidos: pedido, razão social, CNPJ, código ou representante, sem acento. */
export const buscarPedidos = (pedidos, busca) => (!normalizarBusca(busca) ? pedidos
  : pedidos.filter((p) => normalizarBusca(`${p.numero} ${p.razao_social} ${p.cpf_cnpj} ${p.codigo_cliente} ${p.rep_codigo} ${p.rep_nome}`).includes(normalizarBusca(busca))));
