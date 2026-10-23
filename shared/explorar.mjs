// Explorar carteira: árvore de níveis livres (supervisor, representante, cidade, segmento, onda, rota, subrota) sobre o
// resumo pronto do banco (resumo_carteira, migração 0012) — a tela lê alguns milhares de linhas uma vez e monta todos os
// níveis no navegador, em qualquer ordem, sem voltar ao banco a cada clique e sem ler a carteira inteira.
// Escopo: gestão vê tudo (supervisor com "vê todas as equipes" também); supervisor só a equipe; vendedor só a carteira.
// docs/03 §12
import { veTodasEquipes } from './perfis.mjs';

const colunasUsuario = `v.nome AS vendedor_nome, v.tipo_atuacao, v.perfil AS vendedor_perfil, v.codigo_erp AS vendedor_codigo,
       COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END) AS supervisor_id,
       COALESCE(sup.nome, v.nome) AS supervisor_nome, COALESCE(sup.codigo_erp, v.codigo_erp) AS supervisor_codigo`;
const juntaUsuario = `JOIN usuarios v ON v.id = x.vendedor_id
       LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)`;

function escopo(usuario) {
  if (veTodasEquipes(usuario)) return { where: '', args: [] };
  if (usuario.perfil === 'supervisor') return { where: 'AND COALESCE(v.supervisor_id, v.id) = ?', args: [usuario.id] };
  return { where: 'AND v.id = ?', args: [usuario.id] };
}

/** Linhas do resumo no escopo do usuário (inválidos ficam: aparecem como status; a base do funil os exclui). */
export function consultaResumo({ usuario }) {
  if (!usuario?.id || !usuario?.perfil) throw new Error('usuário obrigatório');
  const e = escopo(usuario);
  return {
    sql: `SELECT x.vendedor_id, x.cidade_busca, x.uf, x.cidade, x.tipologia_gtm, x.onda, x.rota, x.subrota, x.status_atual,
                 x.qtd, x.atendidos, x.cadastrados, x.credito, x.si_representante, ${colunasUsuario}
            FROM resumo_carteira x ${juntaUsuario}
           WHERE x.qtd > 0 ${e.where}`,
    args: e.args,
  };
}

/** Pedidos (quantidade e valor) agrupados pelas mesmas chaves do resumo — só as linhas de pedido, nunca a carteira. */
export function consultaPedidosResumo({ usuario }) {
  const e = escopo(usuario);
  return {
    sql: `SELECT x.vendedor_id, COALESCE(x.cidade_busca, '') AS cidade_busca, COALESCE(x.uf, '') AS uf, COALESCE(x.tipologia_gtm, '') AS tipologia_gtm,
                 COALESCE(x.onda, '') AS onda, COALESCE(x.rota, '') AS rota, COALESCE(x.subrota, '') AS subrota, x.status_atual,
                 COUNT(*) AS qtd, COALESCE(SUM(e.valor), 0) AS valor, ${colunasUsuario}
            FROM eventos_erp e JOIN prospects x ON x.id = e.prospect_id ${juntaUsuario}
           WHERE e.tipo = 'pedido' ${e.where}
           GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`,
    args: e.args,
  };
}

/** Níveis possíveis. `chave` agrupa; `rotulo` mostra; `filtro` vira o filtro da Lista principal. */
export const NIVEIS = Object.freeze({
  supervisor: { nome: 'Supervisor', chave: (l) => String(l.supervisor_id ?? ''), rotulo: (l) => l.supervisor_nome ?? '—',
    filtro: (l) => ({ supervisorId: l.supervisor_id }) },
  representante: { nome: 'Representante', chave: (l) => String(l.vendedor_id), rotulo: (l) => l.vendedor_nome ?? '—',
    filtro: (l) => ({ vendedorId: l.vendedor_id }) },
  cidade: { nome: 'Cidade', chave: (l) => `${l.cidade_busca}|${l.uf}`, rotulo: (l) => (l.cidade_busca ? `${l.cidade ?? l.cidade_busca}${l.uf ? '/' + l.uf : ''}` : 'sem cidade'),
    filtro: (l) => (l.cidade_busca ? { cidadeBusca: l.cidade_busca, uf: l.uf || null } : {}) },
  segmento: { nome: 'Segmento', chave: (l) => l.tipologia_gtm, rotulo: (l) => l.tipologia_gtm || 'sem segmento', filtro: (l) => (l.tipologia_gtm ? { segmento: l.tipologia_gtm } : {}) },
  onda: { nome: 'Onda', chave: (l) => l.onda, rotulo: (l) => (l.onda ? `Onda ${l.onda}` : 'sem onda'), filtro: (l) => (l.onda ? { onda: l.onda } : {}) },
  rota: { nome: 'Rota', chave: (l) => l.rota, rotulo: (l) => l.rota || 'sem rota', filtro: (l) => (l.rota ? { rota: l.rota } : {}) },
  subrota: { nome: 'Subrota', chave: (l) => `${l.rota}|${l.subrota}`, rotulo: (l) => (l.subrota ? `${l.rota || '—'} / ${l.subrota}` : 'sem subrota'),
    filtro: (l) => (l.subrota ? { rota: l.rota || null, subrota: l.subrota } : {}) },
});

/** Níveis que o usuário pode usar: supervisor não tem o nível Supervisor; vendedor não tem Supervisor nem Representante. */
export function niveisPossiveis(usuario) {
  const todos = Object.keys(NIVEIS);
  if (veTodasEquipes(usuario)) return todos;
  if (usuario.perfil === 'supervisor') return todos.filter((n) => n !== 'supervisor');
  return todos.filter((n) => n !== 'supervisor' && n !== 'representante');
}

export const STATUS_ORDEM = ['nao_contactado', 'em_prospeccao', 'aguardando_cadastro', 'analise_financeira', 'aguardando_pedido', 'venda_realizada', 'sem_interesse', 'invalido'];

/** Soma linhas do resumo (e os pedidos) num bloco de indicadores. `parametros`: percentual_pipeline, valor_medio_cliente. */
export function somarResumo(linhas, pedidos = [], parametros = {}) {
  const st = Object.fromEntries(STATUS_ORDEM.map((s) => [s, 0]));
  let qtd = 0; let atendidos = 0; let cadastrados = 0; let credito = 0; let siRepresentante = 0;
  for (const l of linhas) {
    const n = Number(l.qtd);
    qtd += n; st[l.status_atual] = (st[l.status_atual] ?? 0) + n;
    atendidos += Number(l.atendidos); cadastrados += Number(l.cadastrados); credito += Number(l.credito);
    siRepresentante += Number(l.si_representante ?? 0);   // migração 0015: dos sem interesse, os do representante
  }
  let qtdPedidos = 0; let valorPedidos = 0;
  for (const p of pedidos) { if (p.status_atual === 'invalido') continue; qtdPedidos += Number(p.qtd); valorPedidos += Number(p.valor); }
  const base = qtd - st.invalido;                                     // carteira válida (inválidos fora, como no Início)
  const contactados = base - st.nao_contactado;
  const emAberto = st.nao_contactado + st.em_prospeccao;
  const pct = Number(parametros.percentual_pipeline ?? 0);
  const valorMedio = Number(parametros.valor_medio_cliente ?? 0);
  return {
    qtd, base, status: st, contactados, atendidos, cadastrados, credito, vendas: st.venda_realizada, semInteresse: st.sem_interesse,
    siRepresentante, siCliente: st.sem_interesse - siRepresentante,
    emAndamento: st.aguardando_cadastro + st.analise_financeira, aguardandoPedido: st.aguardando_pedido,
    qtdPedidos, valorPedidos, emAberto, potencial: (emAberto * pct * valorMedio) / 100,
    cobertura: base ? (contactados / base) * 100 : null, conversao: contactados ? (st.venda_realizada / contactados) * 100 : null,
  };
}

/**
 * Árvore visível: linhas na ordem de exibição, cada uma { caminho, profundidade, nivel, rotulo, aberto, temFilhos, ind, filtros }.
 * `niveis`: códigos de NIVEIS em ordem; `abertos`: Set de caminhos abertos ('' = raiz); `tipo`: '' | 'representante' | 'vendedor'.
 * Mostra TODOS os itens de cada nível aberto (sem "e outros"), do maior para o menor.
 */
export function montarArvore({ linhas, pedidos = [], niveis, abertos, tipo = '', parametros = {}, rotuloRaiz = 'Toda a base' }) {
  const doTipo = (l) => !tipo || (l.tipo_atuacao === 'vendedor' ? 'vendedor' : 'representante') === tipo;
  const L = linhas.filter(doTipo);
  const P = pedidos.filter(doTipo);
  const saida = [];
  const visitar = (caminho, profundidade, rows, peds, rotulo, nivel, filtros) => {
    const temFilhos = profundidade < niveis.length;
    const aberto = temFilhos && abertos.has(caminho);
    saida.push({ caminho, profundidade, nivel, rotulo, aberto, temFilhos, filtros, ind: somarResumo(rows, peds, parametros) });
    if (!aberto) return;
    const def = NIVEIS[niveis[profundidade]];
    const grupos = new Map();
    for (const l of rows) {
      const k = def.chave(l);
      if (!grupos.has(k)) grupos.set(k, { rows: [], peds: [], exemplo: l, qtd: 0 });
      const g = grupos.get(k); g.rows.push(l); g.qtd += Number(l.qtd);
    }
    for (const p of peds) grupos.get(def.chave(p))?.peds.push(p);
    [...grupos.entries()].sort((a, b) => b[1].qtd - a[1].qtd || def.rotulo(a[1].exemplo).localeCompare(def.rotulo(b[1].exemplo), 'pt-BR'))
      .forEach(([k, g]) => visitar(`${caminho}/${niveis[profundidade]}=${k}`, profundidade + 1, g.rows, g.peds, def.rotulo(g.exemplo), niveis[profundidade],
        { ...filtros, ...def.filtro(g.exemplo) }));
  };
  visitar('', 0, L, P, rotuloRaiz, null, {});
  return saida;
}

/**
 * Filtros em cascata da Lista principal e do Acompanhamento, sobre as mesmas linhas do resumo (consultaResumo, já em cache):
 * cada filtro mostra só as opções que existem com os OUTROS filtros escolhidos (cidade → só os representantes, supervisores,
 * segmentos e ondas dela; representante → só as cidades dele…), sem nenhuma leitura a mais no banco.
 */
export function opcoesEmCascata(linhas, filtros = {}) {
  const f = filtros;
  // as opções valem para a carteira toda (não só os status da aba): o Acompanhamento tem poucos clientes no começo da
  // campanha e não pode ficar sem equipe, cidade ou segmento para escolher. Só um status escolhido restringe.
  const naAba = (l) => !f.status || l.status_atual === f.status;
  const testes = {
    supervisor: (l) => !f.supervisorId || Number(l.supervisor_id) === Number(f.supervisorId),
    vendedor: (l) => !f.vendedorId || Number(l.vendedor_id) === Number(f.vendedorId),
    uf: (l) => !f.uf || l.uf === f.uf,
    cidade: (l) => !f.cidadeBusca || l.cidade_busca === f.cidadeBusca,
    segmento: (l) => !f.segmento || l.tipologia_gtm === f.segmento,
    onda: (l) => !f.onda || String(l.onda) === String(f.onda),
  };
  const fixos = (l) => naAba(l) && (!f.rota || l.rota === f.rota) && (!f.subrota || l.subrota === f.subrota);
  const base = linhas.filter((l) => Number(l.qtd) > 0 && fixos(l));
  // linhas que passam em todos os filtros, menos o da própria faceta
  const sem = (faceta) => base.filter((l) => Object.entries(testes).every(([k, t]) => k === faceta || t(l)));
  const unicos = (rows, chave, montar) => { const m = new Map(); for (const l of rows) { const k = chave(l); if (k !== '' && k != null && !m.has(k)) m.set(k, montar(l)); } return [...m.values()]; };
  const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  return {
    supervisores: unicos(sem('supervisor'), (l) => l.supervisor_id, (l) => ({ id: Number(l.supervisor_id), nome: l.supervisor_nome ?? '—', codigo_erp: l.supervisor_codigo ?? null })).sort(porNome),
    vendedores: unicos(sem('vendedor'), (l) => l.vendedor_id, (l) => ({ id: Number(l.vendedor_id), nome: l.vendedor_nome ?? '—', codigo_erp: l.vendedor_codigo ?? null,
      perfil: l.vendedor_perfil, tipo_atuacao: l.tipo_atuacao })).sort(porNome),
    ufs: unicos(sem('uf'), (l) => l.uf, (l) => l.uf).sort(),
    cidades: unicos(sem('cidade'), (l) => (l.cidade_busca ? `${l.cidade_busca}|${l.uf}` : ''), (l) => ({ cidade_busca: l.cidade_busca, uf: l.uf || null, cidade: l.cidade ?? l.cidade_busca }))
      .sort((a, b) => a.cidade_busca.localeCompare(b.cidade_busca, 'pt-BR') || String(a.uf).localeCompare(String(b.uf))),
    segmentos: unicos(sem('segmento'), (l) => l.tipologia_gtm, (l) => l.tipologia_gtm).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    ondas: unicos(sem('onda'), (l) => String(l.onda ?? ''), (l) => String(l.onda)).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
  };
}
