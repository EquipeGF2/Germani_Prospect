// Grava itens em lotes transacionais. Se um lote falhar (ex.: trigger recusou uma linha),
// o lote é refeito item a item para isolar a linha com problema — as demais seguem gravadas.
export async function gravarEmLotes(db, itens, montar, { tamanho = 50 } = {}) {
  const resultados = new Array(itens.length);
  for (let ini = 0; ini < itens.length; ini += tamanho) {
    const fatia = itens.slice(ini, ini + tamanho);
    try {
      await db.batch(fatia.flatMap(montar), 'write');
      fatia.forEach((_, i) => (resultados[ini + i] = { ok: true }));
    } catch {
      for (let i = 0; i < fatia.length; i++) {
        try {
          await db.batch(montar(fatia[i]), 'write');
          resultados[ini + i] = { ok: true };
        } catch (e) {
          resultados[ini + i] = { ok: false, erro: mensagemErro(e) };
        }
      }
    }
  }
  return resultados;
}

/** Mensagem legível do erro do libSQL (remove prefixos "SQLITE_CONSTRAINT: SQLite error:"). */
export function mensagemErro(e) {
  return String(e?.message ?? e).replace(/^(SQLITE_\w+:\s*)?(SQLite error:\s*)?/, '');
}
