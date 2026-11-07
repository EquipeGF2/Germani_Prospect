// Listas por equipe (Importações › Exportar): um PDF da Lista por representante, numa pasta por supervisor, num ZIP só.
// Mesmo layout do Gerar PDF da Lista (web/js/relatorio.js); ordem cidade › bairro › segmento, com uma faixa por cidade. docs/03 §17
import { normalizarBusca, removerAcentos } from './texto.mjs';

/** Quem entra: os válidos (sem baixados e expurgados, como a grade do Explorar carteira) ou só a Lista principal. */
export const ABRANGENCIAS = Object.freeze({
  validos: { nome: 'Clientes válidos', condicao: "status_atual NOT IN ('invalido', 'expurgado')" },
  lista: { nome: 'Só a Lista principal', condicao: 'na_lista = 1' },
});

const COLUNAS = ['cnpj', 'razao_social', 'nome_fantasia', 'endereco', 'bairro', 'cidade', 'uf', 'telefone', 'onda', 'tipologia_gtm',
  'status_atual', 'status_nome', 'sem_interesse_origem', 'tentativas', 'dt_primeiro_contato', 'dias_corridos',
  'vendedor_id', 'vendedor_codigo', 'vendedor_nome', 'supervisor_id', 'supervisor_nome'];

/** Contagem por supervisor, representante e onda (para os filtros e o número no botão). */
export function consultaContagemListas({ abrangencia = 'validos' } = {}) {
  const { condicao } = ABRANGENCIAS[abrangencia] ?? ABRANGENCIAS.validos;
  return {
    sql: `SELECT supervisor_id, supervisor_nome, vendedor_id, onda, COUNT(*) AS qtd FROM vw_prospects
           WHERE ${condicao} AND vendedor_id IS NOT NULL GROUP BY supervisor_id, supervisor_nome, vendedor_id, onda`,
    args: [],
  };
}

/** Clientes das listas, já na ordem do PDF: supervisor › representante › cidade › bairro › segmento › razão social. */
export function consultaListasEquipe({ abrangencia = 'validos', onda = null, supervisorId = null } = {}) {
  const { condicao } = ABRANGENCIAS[abrangencia] ?? ABRANGENCIAS.validos;
  const where = [condicao, 'vendedor_id IS NOT NULL'];
  const args = [];
  if (onda) { where.push('onda = ?'); args.push(String(onda)); }
  if (supervisorId) { where.push('supervisor_id = ?'); args.push(Number(supervisorId)); }
  return {
    sql: `SELECT ${COLUNAS.join(', ')} FROM vw_prospects WHERE ${where.join(' AND ')}
           ORDER BY supervisor_nome, vendedor_nome, vendedor_id, cidade_busca, uf, bairro_busca, tipologia_gtm, razao_social, id`,
    args,
  };
}

/** Nome de arquivo ou pasta sem acento nem caractere proibido. */
export function nomeSeguro(texto) {
  return removerAcentos(String(texto ?? '')).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'sem nome';
}

const cidadeUf = (l) => (l.cidade ? `${l.cidade}/${l.uf ?? ''}` : '(sem cidade)');
const chaveTexto = (x) => normalizarBusca(x ?? '') ?? '';
/** Ordem dos PDFs de clientes: cidade › bairro › segmento › razão social (sem acento, sem diferenciar maiúsculas). */
export const compararParaPdf = (a, b) => chaveTexto(cidadeUf(a)).localeCompare(chaveTexto(cidadeUf(b)), 'pt-BR')
  || chaveTexto(a.bairro).localeCompare(chaveTexto(b.bairro), 'pt-BR') || chaveTexto(a.tipologia_gtm).localeCompare(chaveTexto(b.tipologia_gtm), 'pt-BR')
  || chaveTexto(a.razao_social).localeCompare(chaveTexto(b.razao_social), 'pt-BR');

/**
 * Blocos de um PDF de clientes, sempre na ordem cidade › bairro › segmento (docs/03 §9): sem grupos, uma faixa por cidade;
 * com os grupos da tela (`grupos`: [{ grupo, linhas }], ex.: agrupado por rota), cada grupo fica e as linhas seguem essa ordem.
 */
export function blocosParaPdf(linhas, grupos = null) {
  if (grupos) return grupos.map((g) => ({ grupo: g.grupo, linhas: [...g.linhas].sort(compararParaPdf) }));
  const cidades = new Map();
  for (const l of [...linhas].sort(compararParaPdf)) {
    const c = cidadeUf(l);
    if (!cidades.has(c)) cidades.set(c, []);
    cidades.get(c).push(l);
  }
  return [...cidades.entries()].map(([grupo, ls]) => ({ grupo, linhas: ls }));
}

/**
 * Agrupa as linhas (na ordem de consultaListasEquipe) em uma lista por representante, com uma faixa por cidade.
 * Cada lista: { supervisor, representante, codigo, pasta, arquivo, total, porStatus: Map, blocos: [{ grupo, linhas }] }.
 * A ordem dentro da cidade é bairro › segmento › razão social (sem acento, sem diferenciar maiúsculas).
 */
export function montarListasEquipe(linhas) {
  const listas = new Map();
  for (const l of linhas) {
    const chave = String(l.vendedor_id);
    if (!listas.has(chave)) {
      const supervisor = l.supervisor_nome ?? '(sem supervisor)';
      const nome = [l.vendedor_codigo, l.vendedor_nome].filter((x) => x != null && x !== '').join(' - ') || '(sem nome)';
      listas.set(chave, { supervisor, representante: l.vendedor_nome ?? '(sem nome)', codigo: l.vendedor_codigo ?? null,
        pasta: nomeSeguro(supervisor), arquivo: `${nomeSeguro(nome)}.pdf`, total: 0, porStatus: new Map(), cidades: new Map() });
    }
    const lista = listas.get(chave);
    const cidade = cidadeUf(l);
    if (!lista.cidades.has(cidade)) lista.cidades.set(cidade, []);
    lista.cidades.get(cidade).push(l);
    lista.total += 1;
    lista.porStatus.set(l.status_atual, (lista.porStatus.get(l.status_atual) ?? 0) + 1);
  }
  return [...listas.values()].map(({ cidades, ...lista }) => ({
    ...lista,
    blocos: blocosParaPdf([...cidades.values()].flat()),
  })).sort((a, b) => a.pasta.localeCompare(b.pasta, 'pt-BR') || a.arquivo.localeCompare(b.arquivo, 'pt-BR', { numeric: true }));
}
