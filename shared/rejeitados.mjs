// Rejeitados: clientes da base que saíram da prospecção — baixados, expurgados (já eram clientes) e sem interesse, do cliente
// ou do representante. Tela de gerente e administrador, com hierarquia de níveis, motivos e exportação por tipo. docs/03 §16
// Lê os rejeitados uma vez e o resumo da carteira (Na base, já em cache); níveis, cards e exportação só redesenham no navegador.
import { colunasUsuario, juntaUsuario, NIVEIS } from './explorar.mjs';

export const TIPOS_REJEICAO = Object.freeze(['baixado', 'expurgado', 'cliente', 'representante']);
export const NOME_TIPO_REJEICAO = Object.freeze({ baixado: 'Baixados', expurgado: 'Expurgados', cliente: 'Sem interesse do cliente', representante: 'Sem interesse do representante' });
/** Nome curto do tipo na lista e no selo (os mesmos rótulos das colunas da hierarquia). */
export const SELO_TIPO_REJEICAO = Object.freeze({ baixado: 'Baixado', expurgado: 'Expurgado', cliente: 'Sem int. cliente', representante: 'Sem int. repr.' });

/** Rejeitados com o tipo, o motivo e a data da rejeição. Chaves no mesmo formato do resumo (vazio = ''), para os níveis valerem nos dois. */
export function consultaRejeitados() {
  return {
    sql: `SELECT x.id, x.codigo_cliente_erp, x.razao_social, x.cnpj, x.telefone, COALESCE(x.cidade, '') AS cidade, COALESCE(x.cidade_busca, '') AS cidade_busca,
                 COALESCE(x.uf, '') AS uf, COALESCE(x.onda, '') AS onda, COALESCE(x.tipologia_gtm, '') AS tipologia_gtm, COALESCE(x.rota, '') AS rota,
                 COALESCE(x.subrota, '') AS subrota, x.vendedor_id, x.status_atual, m.descricao AS motivo_sem_interesse, m.origem,
                 x.dt_ultimo_contato, x.dt_baixa, e.data_expurgo, e.motivo AS motivo_expurgo, ${colunasUsuario}
            FROM prospects x
            LEFT JOIN motivos_sem_interesse m ON m.id = x.motivo_sem_interesse_id
            LEFT JOIN expurgos e ON e.id = (SELECT MAX(id) FROM expurgos WHERE prospect_id = x.id AND acao = 'expurgar')
            ${juntaUsuario}
           WHERE x.status_atual IN ('sem_interesse', 'invalido', 'expurgado')`,
    args: [],
  };
}

/** Uma linha da consulta com tipo, motivo e data prontos. */
export function prepararRejeitado(l) {
  const tipo = l.status_atual === 'invalido' ? 'baixado' : l.status_atual === 'expurgado' ? 'expurgado' : l.origem === 'representante' ? 'representante' : 'cliente';
  const motivo = tipo === 'baixado' ? 'CNPJ baixado' : tipo === 'expurgado' ? (l.motivo_expurgo ?? 'Já é cliente') : (l.motivo_sem_interesse ?? 'Não informado');
  const data = tipo === 'baixado' ? l.dt_baixa : tipo === 'expurgado' ? l.data_expurgo : l.dt_ultimo_contato;
  return { ...l, tipo, motivo, data: data ?? null, qtd: 1 };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Níveis da hierarquia: os do Explorar carteira (valem também no resumo, para o Na base) e o mês da rejeição. */
export const NIVEIS_REJEITADOS = Object.freeze({
  supervisor: NIVEIS.supervisor, representante: NIVEIS.representante, onda: NIVEIS.onda, segmento: NIVEIS.segmento, cidade: NIVEIS.cidade, rota: NIVEIS.rota,
  mes: { nome: 'Mês da rejeição', chave: (l) => String(l.data ?? '').slice(0, 7), rotulo: (l) => (l.data ? `${MESES[Number(l.data.slice(5, 7)) - 1]}/${l.data.slice(0, 4)}` : 'sem data'), soRejeitados: true },
});

/** Contagens de um conjunto de rejeitados: um número por tipo e o total. */
export function contarRejeitados(clientes) {
  const c = { baixado: 0, expurgado: 0, cliente: 0, representante: 0, total: clientes.length };
  for (const l of clientes) c[l.tipo] += 1;
  return c;
}

/**
 * Árvore visível, como no Explorar carteira: { caminho, profundidade, nivel, rotulo, aberto, temFilhos, clientes, cont, naBase }.
 * `base`: linhas do resumo da carteira (qtd por chave). Na base = prospects do ramo; null quando o ramo passa pelo mês (o resumo não tem data).
 */
export function montarArvoreRejeitados({ clientes, base = [], niveis, abertos, rotuloRaiz = 'Todos os clientes' }) {
  const saida = [];
  const somaBase = (rows) => rows.reduce((t, l) => t + Number(l.qtd), 0);
  const visitar = (caminho, profundidade, lista, rowsBase, rotulo, nivel) => {
    const temFilhos = profundidade < niveis.length;
    const aberto = temFilhos && abertos.has(caminho);
    saida.push({ caminho, profundidade, nivel, rotulo, aberto, temFilhos, clientes: lista, cont: contarRejeitados(lista), naBase: rowsBase ? somaBase(rowsBase) : null });
    if (!aberto) return;
    const codigo = niveis[profundidade];
    const def = NIVEIS_REJEITADOS[codigo];
    const grupos = new Map();
    for (const l of lista) {
      const k = def.chave(l);
      if (!grupos.has(k)) grupos.set(k, { lista: [], exemplo: l });
      grupos.get(k).lista.push(l);
    }
    [...grupos.entries()].sort((a, b) => b[1].lista.length - a[1].lista.length || def.rotulo(a[1].exemplo).localeCompare(def.rotulo(b[1].exemplo), 'pt-BR'))
      .forEach(([k, g]) => visitar(`${caminho}/${codigo}=${k}`, profundidade + 1, g.lista, rowsBase && !def.soRejeitados ? rowsBase.filter((r) => def.chave(r) === k) : null, def.rotulo(g.exemplo), codigo));
  };
  visitar('', 0, clientes, base, rotuloRaiz, null);
  return saida;
}

/** Motivos de um tipo de sem interesse, do mais frequente ao menos. */
export function contarMotivos(clientes, tipo) {
  const m = new Map();
  for (const l of clientes) if (l.tipo === tipo) m.set(l.motivo, (m.get(l.motivo) ?? 0) + 1);
  return [...m.entries()].map(([motivo, qtd]) => ({ motivo, qtd })).sort((a, b) => b.qtd - a.qtd || a.motivo.localeCompare(b.motivo, 'pt-BR'));
}

/** Busca por razão social, CNPJ, cidade, código ou representante, sem acento. */
export function buscarRejeitados(clientes, texto) {
  const tira = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = tira(texto).trim();
  if (!q) return clientes;
  const digitos = q.replace(/\D/g, '');
  return clientes.filter((l) => tira(`${l.razao_social} ${l.cidade} ${l.codigo_cliente_erp ?? ''} ${l.vendedor_nome ?? ''} ${l.vendedor_codigo ?? ''} ${l.motivo}`).includes(q)
    || (digitos.length >= 3 && String(l.cnpj ?? '').includes(digitos)));
}

/** Os rejeitados dos tipos marcados, para a exportação (ordem: tipo, representante, razão social). */
export function paraExportar(clientes, tipos) {
  const ordem = (t) => TIPOS_REJEICAO.indexOf(t);
  return clientes.filter((l) => tipos.includes(l.tipo))
    .sort((a, b) => ordem(a.tipo) - ordem(b.tipo) || String(a.vendedor_nome ?? '').localeCompare(String(b.vendedor_nome ?? ''), 'pt-BR') || String(a.razao_social).localeCompare(String(b.razao_social), 'pt-BR'));
}
