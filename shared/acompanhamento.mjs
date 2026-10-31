// Acompanhamento: onde está cada cliente da base, do cadastro ao pedido faturado, e o crédito liberado × os pedidos. docs/03 §6.1
// A tela lê os clientes em processo numa consulta só e usa os pedidos já lidos; etapas, árvore e grid são calculadas no navegador.
// Só clientes da base. A etapa segue o PRIMEIRO pedido válido; do segundo em diante, só estatística.
import { veTodasEquipes } from './perfis.mjs';
import { normalizarBusca } from './texto.mjs';
import { STATUS_ENCERRADOS } from './status.mjs';

/** Ordem do processo. `antes`, `sem_cadastro` e `encerrados` ficam fora do fluxo; os "cadastros realizados" são a soma das outras quatro. */
export const ETAPAS = Object.freeze(['antes', 'sem_cadastro', 'analise', 'pedido', 'carteira', 'faturado']);
export const ETAPAS_FLUXO = Object.freeze(['analise', 'pedido', 'carteira', 'faturado']);
export const NOME_ETAPA = Object.freeze({ cadastro: 'Cadastros realizados', antes: 'Aguardando cadastro', sem_cadastro: 'Pedido sem cadastro', analise: 'Análise financeira', pedido: 'Aguardando pedido',
  carteira: 'Pedido em carteira', faturado: 'Pedido faturado', encerrados: 'Encerrados' });
const STATUS_ATIVOS = Object.freeze(['aguardando_cadastro', 'analise_financeira', 'aguardando_pedido', 'aguardando_pedido_valido', 'venda_realizada']);
const ETAPA_DO_STATUS = Object.freeze({ aguardando_cadastro: 'antes', analise_financeira: 'analise', aguardando_pedido: 'pedido', aguardando_pedido_valido: 'pedido' });
/** 9.999.999 no relatório do ERP = sem limite (docs/03 §8.1). */
const SEM_LIMITE = 9999999;

const num = (v) => Number(v ?? 0);
const dias = (de, ate) => (de && ate ? Math.round((Date.parse(ate) - Date.parse(de)) / 86400000) : null);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const nomeRepresentante = (c) => [c.vendedor_codigo, c.vendedor_nome].filter(Boolean).join(' · ') || 'sem representante';

const NOMES_FORMA = { antecipado: 'Antecipado', a_vista: 'À vista', boleto: 'Boleto', deposito: 'Depósito e Pix' };
/** Forma liberada: como veio do ERP; sem ela, a do console do analista. */
export const formaLiberada = (c) => c.forma_pgto_descricao ?? NOMES_FORMA[c.forma_pagamento] ?? null;
/** Prazo liberado: "14/21/28 dias" · "à vista" · "antecipado"; sem dados do ERP, os dias informados. */
export function prazoLiberado(c) {
  const parcelas = c.prazo_parcelas;
  if (parcelas && /^\d/.test(parcelas)) return `${parcelas} dias`;
  if (parcelas) return parcelas === 'A VISTA' ? 'à vista' : 'antecipado';
  return c.prazo_pagamento_dias != null ? `${c.prazo_pagamento_dias} dia(s)` : null;
}

/** Etapa que um link antigo pede por status (`?status=`). */
export const etapaDoStatus = (status) => (STATUS_ENCERRADOS.includes(status) ? 'encerrados' : status === 'venda_realizada' ? 'faturado' : ETAPA_DO_STATUS[status] ?? 'cadastro');

/** Clientes da carteira do usuário: os em processo e, à parte (só ao pedir), os encerrados. A última liberação traz forma e prazo como vieram do ERP. */
export function consultaAcompanhamento({ usuario, encerrados = false }) {
  const where = [`v.status_atual IN (${(encerrados ? STATUS_ENCERRADOS : STATUS_ATIVOS).map(() => '?').join(', ')})`];
  const args = [...(encerrados ? STATUS_ENCERRADOS : STATUS_ATIVOS)];
  if (!veTodasEquipes(usuario)) {
    where.push(usuario.perfil === 'supervisor' ? 'v.supervisor_id = ?' : 'v.vendedor_id = ?');
    args.push(usuario.id);
  }
  const daLiberacao = (coluna) => `(SELECT l.${coluna} FROM liberacoes_credito l WHERE l.prospect_id = v.id ORDER BY l.id DESC LIMIT 1) AS ${coluna}`;
  return {
    sql: `SELECT v.id, v.cnpj, v.cnpj_raiz, v.razao_social, v.nome_fantasia, v.codigo_cliente_erp, v.status_atual, v.status_nome, v.status_cor, v.status_descricao,
                 v.vendedor_id, v.vendedor_nome, v.vendedor_codigo, v.supervisor_id, v.supervisor_nome, v.cidade, v.uf, v.bairro, v.endereco, v.telefone, v.tipologia_gtm, v.onda,
                 v.dt_atendido, v.dt_pedido, v.prazo_cadastro_ate, v.prazo_cadastro_vencido, v.dt_cadastro_erp, v.analise_financeira_ate, v.analise_financeira_vencida, v.dt_liberacao_credito,
                 v.forma_pagamento, v.prazo_pagamento_dias, v.limite_credito, v.limite_credito_origem, v.data_proxima_acao, v.retorno_pendente, v.dt_ultimo_contato, v.dt_primeiro_contato,
                 v.dias_corridos, v.tentativas, v.motivo_sem_interesse, v.dt_baixa, ${daLiberacao('forma_pgto_descricao')}, ${daLiberacao('prazo_parcelas')}
            FROM vw_prospects v WHERE ${where.join(' AND ')}`,
    args,
  };
}

/** Pedidos de venda válidos, do primeiro ao último: pela primeira vez que apareceram num arquivo e, no empate, pelo número. */
export function ordenarPedidosValidos(pedidos) {
  return pedidos.filter((p) => p.tipo === 'venda' && num(p.valida))
    .sort((a, b) => String(a.data_primeira ?? '').localeCompare(String(b.data_primeira ?? '')) || Number(a.numero) - Number(b.numero))
    .map((p, i) => ({ ...p, ordem: i + 1 }));
}

/** Etapa do cliente. Venda realizada: a do primeiro pedido válido; em carteira, até ele começar a faturar. */
export function etapaDoCliente(cliente, primeiro) {
  if (STATUS_ENCERRADOS.includes(cliente.status_atual)) return 'encerrados';
  // o pedido chegou antes do relatório de cadastro: os pedidos ficam guardados e o cliente entra no fluxo quando o relatório for importado
  if (['venda_realizada', 'aguardando_pedido_valido'].includes(cliente.status_atual) && !cliente.dt_cadastro_erp) return 'sem_cadastro';
  if (cliente.status_atual !== 'venda_realizada') return ETAPA_DO_STATUS[cliente.status_atual] ?? 'antes';
  return primeiro && ['parcial', 'faturado'].includes(primeiro.fase) ? 'faturado' : 'carteira';
}

/**
 * Junta clientes e pedidos. Pedido de quem não é cliente lido aqui (fora da base ou de outra carteira) não entra.
 * `etapaGrupo`: em Ver por Grupo, o grupo conta uma vez, na etapa mais avançada de suas empresas.
 */
export function montarClientes({ clientes, encerrados = [], pedidos }) {
  const porCliente = new Map();
  for (const p of pedidos) {
    if (p.prospect_id == null) continue;
    const id = Number(p.prospect_id);
    if (!porCliente.has(id)) porCliente.set(id, []);
    porCliente.get(id).push(p);
  }
  const ativos = clientes.map((c) => {
    const validos = ordenarPedidosValidos(porCliente.get(Number(c.id)) ?? []);
    return { ...c, pedidos: validos, primeiro: validos[0] ?? null, etapa: etapaDoCliente(c, validos[0]) };
  });
  const maisAvancada = new Map();
  for (const c of ativos) {
    const atual = maisAvancada.get(c.cnpj_raiz);
    if (atual == null || ETAPAS.indexOf(c.etapa) > ETAPAS.indexOf(atual)) maisAvancada.set(c.cnpj_raiz, c.etapa);
  }
  return [...ativos.map((c) => ({ ...c, etapaGrupo: maisAvancada.get(c.cnpj_raiz) })),
    ...encerrados.map((c) => ({ ...c, pedidos: [], primeiro: null, etapa: 'encerrados', etapaGrupo: 'encerrados' }))];
}

const etapaVista = (c, porGrupo) => (porGrupo ? c.etapaGrupo : c.etapa);
const chaveCliente = (c, porGrupo) => (porGrupo ? c.cnpj_raiz : c.id);
/** Pedidos que contam: só o primeiro de cada cliente ou todos os válidos. */
export const pedidosQueContam = (c, soPrimeiro) => (soPrimeiro ? (c.primeiro ? [c.primeiro] : []) : c.pedidos);

/** Números do fluxo num conjunto: clientes por etapa e, em carteira e faturado, valor e pedidos. Sem os encerrados. */
export function contarFluxo(clientes, { porGrupo = false, soPrimeiro = true } = {}) {
  const conjuntos = Object.fromEntries([...ETAPAS, 'encerrados'].map((e) => [e, new Set()]));
  const vencidas = new Set(); const naoValidos = new Set();
  const valor = { carteira: 0, faturado: 0 }; const qtdPedidos = { carteira: 0, faturado: 0 };
  for (const c of clientes) {
    const e = etapaVista(c, porGrupo);
    conjuntos[e].add(chaveCliente(c, porGrupo));
    if (c.etapa === 'analise' && num(c.analise_financeira_vencida)) vencidas.add(chaveCliente(c, porGrupo));
    if (c.etapa === 'pedido' && c.status_atual === 'aguardando_pedido_valido') naoValidos.add(chaveCliente(c, porGrupo));
    if (c.etapa === 'carteira' || c.etapa === 'faturado') {
      for (const p of pedidosQueContam(c, soPrimeiro)) { valor[c.etapa] += num(p.valor_pedido); qtdPedidos[c.etapa] += 1; }
    }
  }
  const n = Object.fromEntries(Object.entries(conjuntos).map(([k, s]) => [k, s.size]));
  return { ...n, cadastro: ETAPAS_FLUXO.reduce((t, e) => t + n[e], 0), vencidas: vencidas.size, naoValidos: naoValidos.size, valor, qtdPedidos };
}

/**
 * Crédito × pedidos em carteira, por cliente. O limite do CNPJ compara com o cliente; o limite do grupo (global da raiz)
 * compara com a raiz inteira, e em Todos os pedidos soma também as filiais fora da base (`saldoFiliais`).
 * situacao: dentro | acima | sem_limite (9.999.999 ou sem limite informado).
 */
export function compararCredito(clientes, { soPrimeiro = true, saldoFiliais = new Map() } = {}) {
  const comSaldo = [];
  const naRaiz = new Map();
  for (const c of clientes) {
    if (c.etapa === 'encerrados') continue;
    const pedidos = pedidosQueContam(c, soPrimeiro).filter((p) => num(p.saldo) > 0);
    if (!pedidos.length) continue;
    const saldo = pedidos.reduce((t, p) => t + num(p.saldo), 0);
    comSaldo.push({ cliente: c, pedidos, saldo });
    naRaiz.set(c.cnpj_raiz, (naRaiz.get(c.cnpj_raiz) ?? 0) + saldo);
  }
  return comSaldo.map((l) => {
    const c = l.cliente;
    const doGrupo = c.limite_credito_origem === 'grupo';
    const base = doGrupo ? naRaiz.get(c.cnpj_raiz) + (soPrimeiro ? 0 : num(saldoFiliais.get(c.cnpj_raiz))) : l.saldo;
    const limite = c.limite_credito == null ? null : num(c.limite_credito);
    const semLimite = limite == null || limite >= SEM_LIMITE;
    return { ...l, base, limite: semLimite ? null : limite, doGrupo, uso: semLimite || limite === 0 ? null : (base / limite) * 100,
      situacao: semLimite ? 'sem_limite' : base > limite ? 'acima' : 'dentro' };
  });
}

/** Cards do crédito. Em Ver por Grupo, o grupo conta uma vez, pela pior situação. */
export function contarCredito(comparados, { porGrupo = false } = {}) {
  const PIOR = ['sem_limite', 'dentro', 'acima'];
  const porChave = new Map();
  let saldo = 0;
  for (const l of comparados) {
    const k = chaveCliente(l.cliente, porGrupo);
    const atual = porChave.get(k);
    if (atual == null || PIOR.indexOf(l.situacao) > PIOR.indexOf(atual)) porChave.set(k, l.situacao);
    saldo += l.saldo;
  }
  const qtd = (s) => [...porChave.values()].filter((x) => x === s).length;
  return { todos: porChave.size, dentro: qtd('dentro'), acima: qtd('acima'), sem_limite: qtd('sem_limite'), saldo };
}

const texto = (v, vazio) => (v == null || v === '' ? vazio : String(v));
/** Níveis possíveis. `chave` agrupa; `rotulo` mostra. Representante = dono da carteira. */
export const NIVEIS_ACOMP = Object.freeze({
  supervisor: { nome: 'Supervisor', chave: (c) => texto(c.supervisor_id, ''), rotulo: (c) => texto(c.supervisor_nome, 'sem supervisor') },
  representante: { nome: 'Representante', chave: (c) => texto(c.vendedor_id, ''), rotulo: nomeRepresentante },
  cliente: { nome: 'Cliente', chave: (c) => c.cnpj, rotulo: (c) => `${texto(c.codigo_cliente_erp, '—')} - ${texto(c.razao_social, '')}` },
  cidade: { nome: 'Cidade', chave: (c) => `${texto(c.cidade, '')}|${texto(c.uf, '')}`, rotulo: (c) => (c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : 'sem cidade') },
  segmento: { nome: 'Segmento', chave: (c) => texto(c.tipologia_gtm, ''), rotulo: (c) => texto(c.tipologia_gtm, 'sem segmento') },
  onda: { nome: 'Onda', chave: (c) => texto(c.onda, ''), rotulo: (c) => (c.onda ? `Onda ${c.onda}` : 'sem onda') },
  grupo: { nome: 'Grupo', chave: (c) => texto(c.cnpj_raiz, ''), rotulo: (c) => `${texto(c.razao_social, '')} · raiz ${texto(c.cnpj_raiz, '')}` },
  mes: { nome: 'Mês do cadastro', chave: (c) => String(c.dt_cadastro_erp ?? '').slice(0, 7), rotulo: (c) => (c.dt_cadastro_erp ? `${MESES[Number(c.dt_cadastro_erp.slice(5, 7)) - 1]}/${c.dt_cadastro_erp.slice(0, 4)}` : 'sem cadastro') },
});

/** Quem não vê todas as equipes não tem Supervisor; o representante também não tem o nível Representante. */
export function niveisAcompPossiveis(usuario) {
  return Object.keys(NIVEIS_ACOMP).filter((n) => (n !== 'supervisor' || veTodasEquipes(usuario)) && (n !== 'representante' || usuario.perfil !== 'vendedor'));
}

/** Árvore visível, na ordem de exibição: { caminho, profundidade, nivel, rotulo, aberto, temFilhos, clientes }. Do maior para o menor. */
export function montarArvoreAcomp({ clientes, niveis, abertos, rotuloRaiz = 'Todos os clientes' }) {
  const saida = [];
  const visitar = (caminho, profundidade, rows, rotulo, nivel) => {
    const temFilhos = profundidade < niveis.length;
    const aberto = temFilhos && abertos.has(caminho);
    saida.push({ caminho, profundidade, nivel, rotulo, aberto, temFilhos, clientes: rows });
    if (!aberto) return;
    const def = NIVEIS_ACOMP[niveis[profundidade]];
    const grupos = new Map();
    for (const c of rows) { const k = def.chave(c); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
    const ordem = [...grupos.entries()].map(([k, g]) => ({ k, g, rot: def.rotulo(g[0]) })).sort((a, b) => b.g.length - a.g.length || a.rot.localeCompare(b.rot, 'pt-BR'));
    for (const o of ordem) visitar(`${caminho}/${niveis[profundidade]}=${o.k}`, profundidade + 1, o.g, o.rot, niveis[profundidade]);
  };
  visitar('', 0, clientes, rotuloRaiz, null);
  return saida;
}

/** Linhas da grid numa etapa: uma por cliente; em carteira e faturado, uma por pedido. Quem está há mais tempo vem primeiro. */
export function linhasDaEtapa(clientes, { etapa, porGrupo = false, soPrimeiro = true, hoje }) {
  const naEtapa = etapa === 'cadastro' ? clientes.filter((c) => ETAPAS_FLUXO.includes(etapaVista(c, porGrupo))) : clientes.filter((c) => etapaVista(c, porGrupo) === etapa);
  const linhas = [];
  for (const c of naEtapa) {
    if (etapa === 'carteira' || etapa === 'faturado') {
      const pedidos = pedidosQueContam(c, soPrimeiro);
      if (pedidos.length) { for (const p of pedidos) linhas.push({ cliente: c, pedido: p, dias: diasDaLinha(c, p, etapa, hoje) }); continue; }
    }
    linhas.push({ cliente: c, pedido: null, dias: diasDaLinha(c, null, etapa, hoje) });
  }
  return linhas.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
}

/** Dias da coluna da etapa. Faturado: do cadastro à data em que o primeiro pedido apareceu faturado; os outros pedidos não têm. */
function diasDaLinha(c, p, etapa, hoje) {
  if (etapa === 'cadastro') return dias(c.dt_cadastro_erp, hoje);
  if (etapa === 'antes') return dias(c.dt_atendido, hoje);
  if (etapa === 'sem_cadastro') return dias(c.primeiro?.data_primeira ?? c.dt_pedido, hoje);
  if (etapa === 'analise') return dias(c.dt_cadastro_erp, hoje);
  if (etapa === 'pedido') return dias(c.dt_liberacao_credito ?? c.dt_cadastro_erp, hoje);
  if (etapa === 'carteira') return p ? dias(p.data_primeira, hoje) : null;
  if (etapa === 'faturado') return p?.ordem === 1 ? dias(c.dt_cadastro_erp, p.data_situacao) : null;
  return null;
}

/** Grid em cascata: linhas e cabeçalhos { caminho, profundidade, rotulo, qtd, aberto }. Em Ver por Grupo, as empresas da mesma raiz ficam num cabeçalho do grupo. */
export function cascata(linhas, { niveis = [], fechados = new Set(), porGrupo = false, clienteDe = (l) => l.cliente } = {}) {
  const saida = [];
  const empurrar = (rows, caminho, profundidade) => {
    if (profundidade < niveis.length) {
      const def = NIVEIS_ACOMP[niveis[profundidade]];
      const grupos = new Map();
      for (const l of rows) { const k = def.chave(clienteDe(l)); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); }
      const ordem = [...grupos.entries()].map(([k, g]) => ({ k, g, rot: def.rotulo(clienteDe(g[0])) })).sort((a, b) => a.rot.localeCompare(b.rot, 'pt-BR'));
      for (const o of ordem) {
        const c = `${caminho}/${niveis[profundidade]}=${o.k}`;
        saida.push({ cabecalho: true, caminho: c, profundidade, rotulo: o.rot, qtd: o.g.length, aberto: !fechados.has(c) });
        if (!fechados.has(c)) empurrar(o.g, c, profundidade + 1);
      }
      return;
    }
    if (porGrupo) {
      const raizes = new Map();
      for (const l of rows) { const r = clienteDe(l).cnpj_raiz; if (!raizes.has(r)) raizes.set(r, []); raizes.get(r).push(l); }
      const soltas = [];
      for (const [r, g] of raizes) {
        const empresas = new Set(g.map((l) => clienteDe(l).cnpj));
        if (empresas.size < 2) { soltas.push(...g); continue; }
        const c = `${caminho}/raiz=${r}`;
        saida.push({ cabecalho: true, caminho: c, profundidade, rotulo: `Grupo ${clienteDe(g[0]).razao_social} · ${empresas.size} empresas`, qtd: g.length, aberto: !fechados.has(c) });
        if (!fechados.has(c)) for (const l of g) saida.push({ linha: l, profundidade: profundidade + 1 });
      }
      for (const l of soltas) saida.push({ linha: l, profundidade });
      return;
    }
    for (const l of rows) saida.push({ linha: l, profundidade });
  };
  empurrar(linhas, '', 0);
  return saida;
}

/** Busca da grid: cliente, CNPJ, código, representante ou pedido, sem acento. */
export function buscarAcomp(linhas, busca, { clienteDe = (l) => l.cliente } = {}) {
  const termo = normalizarBusca(busca);
  if (!termo) return linhas;
  return linhas.filter((l) => { const c = clienteDe(l);
    return normalizarBusca(`${c.razao_social} ${c.cnpj} ${c.codigo_cliente_erp} ${nomeRepresentante(c)} ${(l.pedidos ?? (l.pedido ? [l.pedido] : [])).map((p) => `${p.numero} ${p.rep_nome ?? ''}`).join(' ')}`).includes(termo); });
}
