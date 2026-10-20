// Grava itens em lotes transacionais (Node e navegador — só usa db.batch). Se um lote falhar (ex.: trigger recusou uma linha),
// o lote é refeito item a item para isolar a linha com problema — as demais seguem gravadas.
// `aoProgredir(feitos, total)`: chamado a cada lote (a tela mostra o andamento).
export async function gravarEmLotes(db, itens, montar, { tamanho = 50, aoProgredir = null } = {}) {
  const resultados = new Array(itens.length);
  for (let ini = 0; ini < itens.length; ini += tamanho) {
    aoProgredir?.(ini, itens.length);
    const fatia = itens.slice(ini, ini + tamanho);
    try {
      await db.batch(fatia.flatMap(montar), 'write');
      fatia.forEach((_, i) => (resultados[ini + i] = { ok: true }));
    } catch (e) {
      // falta de permissão no banco vale para todas as linhas: para tudo com uma mensagem clara (sem tentar linha a linha)
      if (semPermissao(e)) throw new Error(`o banco recusou por falta de permissão (${mensagemErro(e)}). A chave de administração precisa ser renovada: rode no GitHub Actions → Criar administrador e entre de novo.`);
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
  aoProgredir?.(itens.length, itens.length);
  return resultados;
}

export const semPermissao = (e) => /SQLITE_AUTH|not authorized/i.test(String(e?.message ?? e));

/** Mensagem legível do erro do libSQL (remove prefixos "SQLITE_CONSTRAINT: SQLite error:"). */
export function mensagemErro(e) {
  return String(e?.message ?? e).replace(/^(SQLITE_\w+:\s*)?(SQLite error:\s*)?/, '');
}
