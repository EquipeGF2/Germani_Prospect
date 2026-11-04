// Rejeitados: clientes da base que saíram da prospecção — baixados, expurgados (já eram clientes) e sem interesse, do cliente
// ou do representante. Tela de gerente e administrador, com hierarquia de níveis, motivos e exportação por tipo. docs/03 §16
// Lê os rejeitados uma vez e o resumo da carteira (Na base, já em cache); níveis, cards e exportação só redesenham no navegador.
import { colunasUsuario, juntaUsuario, NIVEIS } from './explorar.mjs';

export const TIPOS_REJEICAO = Object.freeze(['baixado', 'expurgado', 'cliente', 'representante']);
export const NOME_TIPO_REJEICAO = Object.freeze({ baixado: 'Baixados', expurgado: 'Expurgados', cliente: 'Sem interesse do cliente', representante: 'Sem interesse do representante' });
/** Nome curto do tipo na lista e no selo (os mesmos rótulos das colunas da hierarquia). */
export const SELO_TIPO_REJEICAO = Object.freeze({ baixado: 'Baixado', expurgado: 'Expurgado', cliente: 'Sem int. cliente', representante: 'Sem int. repr.' });

// tipo, motivo e data da rejeição, calculados no banco (iguais na leitura da tela e na da exportação)
const TIPO = `CASE WHEN x.status_atual = 'invalido' THEN 'baixado' WHEN x.status_atual = 'expurgado' THEN 'expurgado'
                WHEN COALESCE(m.origem, 'cliente') = 'representante' THEN 'representante' ELSE 'cliente' END`;
const MOTIVO = `CASE x.status_atual WHEN 'invalido' THEN 'CNPJ baixado' WHEN 'expurgado' THEN COALESCE(e.motivo, 'Já é cliente')
                  ELSE COALESCE(m.descricao, 'Não informado') END`;
const DATA = `CASE x.status_atual WHEN 'invalido' THEN x.dt_baixa WHEN 'expurgado' THEN e.data_expurgo ELSE x.dt_ultimo_contato END`;
const DE_REJEITADOS = `FROM prospects x
            LEFT JOIN motivos_sem_interesse m ON m.id = x.motivo_sem_interesse_id
            LEFT JOIN expurgos e ON e.id = (SELECT MAX(id) FROM expurgos WHERE prospect_id = x.id AND acao = 'expurgar')
            ${juntaUsuario}
           WHERE x.status_atual IN ('sem_interesse', 'invalido', 'expurgado')`;

/**
 * Contagem dos rejeitados pelas chaves dos níveis, tipo, motivo e mês: é o que a tela lê (poucas linhas, sem os dados de
 * cada cliente). Chaves no mesmo formato do resumo da carteira (vazio = ''), para os níveis valerem nos dois.
 */
export function consultaResumoRejeitados() {
  return {
    sql: `SELECT tipo, motivo, substr(data, 1, 7) || '-01' AS data, vendedor_id, onda, tipologia_gtm, cidade_busca, uf, rota, COUNT(*) AS qtd,
                 MAX(cidade) AS cidade, MAX(vendedor_nome) AS vendedor_nome, MAX(vendedor_codigo) AS vendedor_codigo, MAX(supervisor_id) AS supervisor_id, MAX(supervisor_nome) AS supervisor_nome
            FROM (SELECT ${TIPO} AS tipo, ${MOTIVO} AS motivo, ${DATA} AS data, x.vendedor_id, COALESCE(x.onda, '') AS onda, COALESCE(x.tipologia_gtm, '') AS tipologia_gtm,
                         COALESCE(x.cidade_busca, '') AS cidade_busca, COALESCE(x.uf, '') AS uf, COALESCE(x.rota, '') AS rota, COALESCE(x.cidade, '') AS cidade, ${colunasUsuario}
                    ${DE_REJEITADOS})
           GROUP BY tipo, motivo, substr(data, 1, 7), vendedor_id, onda, tipologia_gtm, cidade_busca, uf, rota`,
    args: [],
  };
}

/** Rejeitados com todos os dados cadastrais, o tipo, o motivo, a observação do registro e a data: só na exportação. */
export function consultaRejeitados() {
  return {
    sql: `SELECT x.id, x.codigo_cliente_erp, x.razao_social, x.nome_fantasia, x.cnpj, x.endereco, x.bairro, x.cep, x.telefone, COALESCE(x.cidade, '') AS cidade,
                 COALESCE(x.cidade_busca, '') AS cidade_busca, COALESCE(x.uf, '') AS uf, COALESCE(x.onda, '') AS onda, COALESCE(x.tipologia_gtm, '') AS tipologia_gtm,
                 COALESCE(x.rota, '') AS rota, COALESCE(x.subrota, '') AS subrota, x.vendedor_id, x.status_atual, x.tentativas, x.dt_primeiro_contato,
                 ${TIPO} AS tipo, ${MOTIVO} AS motivo, ${DATA} AS data,
                 CASE WHEN x.status_atual = 'sem_interesse' THEN (SELECT c.observacao FROM contatos c WHERE c.prospect_id = x.id AND c.resultado = 'sem_interesse' ORDER BY c.id DESC LIMIT 1) END AS observacao,
                 ${colunasUsuario}
            ${DE_REJEITADOS}`,
    args: [],
  };
}

/** Linha lida (detalhe ou contagem) pronta para as contas: `qtd` = clientes que ela representa. */
export const prepararRejeitado = (l) => ({ ...l, data: l.data ?? null, qtd: Number(l.qtd ?? 1) });

/** O cliente (ou a contagem) está na linha escolhida da hierarquia? `caminho` = '/nivel=chave/...'. */
export function naLinha(caminho, l) {
  return String(caminho ?? '').split('/').filter(Boolean).every((parte) => {
    const i = parte.indexOf('=');
    const def = NIVEIS_REJEITADOS[parte.slice(0, i)];
    return !def || def.chave(l) === parte.slice(i + 1);
  });
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Níveis da hierarquia: os do Explorar carteira (valem também no resumo, para o Na base) e o mês da rejeição. */
export const NIVEIS_REJEITADOS = Object.freeze({
  supervisor: NIVEIS.supervisor, representante: NIVEIS.representante, onda: NIVEIS.onda, segmento: NIVEIS.segmento, cidade: NIVEIS.cidade, rota: NIVEIS.rota,
  mes: { nome: 'Mês da rejeição', chave: (l) => String(l.data ?? '').slice(0, 7), rotulo: (l) => (l.data ? `${MESES[Number(l.data.slice(5, 7)) - 1]}/${l.data.slice(0, 4)}` : 'sem data'), soRejeitados: true },
});

/** Contagens de um conjunto de rejeitados: um número por tipo e o total. */
export function contarRejeitados(clientes) {
  const c = { baixado: 0, expurgado: 0, cliente: 0, representante: 0, total: 0 };
  for (const l of clientes) { const q = Number(l.qtd ?? 1); c[l.tipo] += q; c.total += q; }
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
    const total = (lista) => lista.reduce((t, l) => t + Number(l.qtd ?? 1), 0);
    [...grupos.entries()].sort((a, b) => total(b[1].lista) - total(a[1].lista) || def.rotulo(a[1].exemplo).localeCompare(def.rotulo(b[1].exemplo), 'pt-BR'))
      .forEach(([k, g]) => visitar(`${caminho}/${codigo}=${k}`, profundidade + 1, g.lista, rowsBase && !def.soRejeitados ? rowsBase.filter((r) => def.chave(r) === k) : null, def.rotulo(g.exemplo), codigo));
  };
  visitar('', 0, clientes, base, rotuloRaiz, null);
  return saida;
}

/** Motivos de um tipo de sem interesse, do mais frequente ao menos. */
export function contarMotivos(clientes, tipo) {
  const m = new Map();
  for (const l of clientes) if (l.tipo === tipo) m.set(l.motivo, (m.get(l.motivo) ?? 0) + Number(l.qtd ?? 1));
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
