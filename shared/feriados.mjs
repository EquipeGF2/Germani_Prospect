// Cadastro de feriados (Administração → Feriados). Todos os cadastrados saem dos dias úteis da campanha.
import { limparTexto } from './texto.mjs';

export const ABRANGENCIAS = Object.freeze({ nacional: 'Nacional', estadual: 'Estadual', municipal: 'Municipal' });

export async function listarFeriados(db, { ano } = {}) {
  const r = ano
    ? await db.execute({ sql: "SELECT * FROM feriados WHERE substr(data, 1, 4) = ? ORDER BY data, abrangencia", args: [String(ano)] })
    : await db.execute('SELECT * FROM feriados ORDER BY data, abrangencia');
  return r.rows;
}

export function validarFeriado({ data, descricao, abrangencia, uf, cidade }) {
  const erros = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data ?? '')) erros.push('informe a data');
  if (!limparTexto(descricao)) erros.push('informe a descrição');
  if (!ABRANGENCIAS[abrangencia]) erros.push('informe a abrangência');
  const u = limparTexto(uf)?.toUpperCase() ?? null;
  const c = limparTexto(cidade);
  if (abrangencia !== 'nacional' && !/^[A-Z]{2}$/.test(u ?? '')) erros.push('informe a UF (2 letras)');
  if (abrangencia === 'municipal' && !c) erros.push('informe a cidade');
  return { erros, uf: abrangencia === 'nacional' ? null : u, cidade: abrangencia === 'municipal' ? c : null };
}

export async function incluirFeriado(db, { data, descricao, abrangencia, uf, cidade, executadoPor }) {
  const v = validarFeriado({ data, descricao, abrangencia, uf, cidade });
  if (v.erros.length) throw new Error(v.erros.join('; '));
  try {
    await db.execute({
      sql: 'INSERT INTO feriados (data, descricao, abrangencia, uf, cidade, criado_por) VALUES (?, ?, ?, ?, ?, ?)',
      args: [data, limparTexto(descricao), abrangencia, v.uf, v.cidade, executadoPor ?? null],
    });
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new Error('feriado já cadastrado para essa data e abrangência');
    throw e;
  }
}

export async function excluirFeriado(db, { id }) {
  await db.execute({ sql: 'DELETE FROM feriados WHERE id = ?', args: [id] });
}
