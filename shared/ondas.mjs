// Ondas liberadas (migração 0024): liberação escalonada da base para o representante/vendedor. docs/03 §1.1
// Supervisor, gerente, financeiro e administrador veem todas as ondas. O que já saiu da lista (atendido, cadastro, pedido…)
// aparece sempre: a restrição vale só para quem ainda está para ser procurado.

const VALOR = "COALESCE((SELECT valor FROM parametros WHERE chave = 'ondas_liberadas'), 'todas')";

/** Condição SQL das ondas que o usuário vê, ou null quando não há restrição para ele. `status` e `onda` = colunas da consulta. */
export function condicaoOndas(usuario, { status = 'status_atual', onda = 'onda' } = {}) {
  if (usuario?.perfil !== 'vendedor') return null;
  return `(${status} NOT IN ('nao_contactado', 'em_prospeccao') OR ${VALOR} = 'todas'
           OR COALESCE(${onda}, '') IN (SELECT value FROM json_each(CASE WHEN ${VALOR} = 'todas' THEN '[]' ELSE ${VALOR} END)))`;
}

/** Valor do parâmetro a partir das ondas escolhidas: todas marcadas (ou nenhuma onda na base) = 'todas'. */
export function valorOndas(escolhidas, existentes) {
  const marcadas = [...new Set(escolhidas.map(String))];
  if (!existentes.length || existentes.every((o) => marcadas.includes(String(o)))) return 'todas';
  return JSON.stringify(marcadas.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })));
}

/** Ondas liberadas pelo valor do parâmetro: null = todas. */
export function lerOndas(valor) {
  if (!valor || valor === 'todas') return null;
  try { const v = JSON.parse(valor); return Array.isArray(v) ? v.map(String) : null; } catch { return null; }
}

/** Ondas da base com quantos prospects ainda estão na lista (a tela de Parâmetros mostra o que cada uma libera). */
export function consultaOndasDaBase() {
  return { sql: `SELECT COALESCE(onda, '') AS onda, COUNT(*) AS qtd, SUM(status_atual IN ('nao_contactado', 'em_prospeccao')) AS na_lista
                   FROM prospects GROUP BY 1 ORDER BY CAST(COALESCE(onda, '') AS INTEGER), 1`, args: [] };
}
