// Feriados (Administração → Feriados). Saem dos dias úteis da campanha:
//   * NACIONAIS — calculados para qualquer ano (datas fixas + Sexta-feira Santa pela Páscoa): nada a cadastrar;
//   * cadastrados — estaduais/municipais; "repete todo ano" vale o mesmo dia e mês em todos os anos.
import { limparTexto } from './texto.mjs';

const FIXOS = [['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'], ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'], ['11-15', 'Proclamação da República'], ['11-20', 'Dia da Consciência Negra'], ['12-25', 'Natal']];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) → AAAA-MM-DD. */
export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados nacionais de um ano (Dia da Consciência Negra é nacional desde 2024 — Lei 14.759/2023). */
export function feriadosNacionais(ano) {
  const p = new Date(`${pascoa(ano)}T12:00:00Z`);
  p.setUTCDate(p.getUTCDate() - 2);
  return [...FIXOS.filter(([md]) => md !== '11-20' || ano >= 2024).map(([md, descricao]) => ({ data: `${ano}-${md}`, descricao })),
    { data: p.toISOString().slice(0, 10), descricao: 'Sexta-feira Santa' }].sort((x, y) => x.data.localeCompare(y.data));
}

/** Todas as datas de feriado entre inicio e fim: nacionais calculados + cadastrados + os que repetem todo ano. */
export async function datasDeFeriado(db, { inicio, fim }) {
  const datas = new Set();
  const anos = [];
  for (let a = Number(inicio.slice(0, 4)); a <= Number(fim.slice(0, 4)); a++) anos.push(a);
  for (const a of anos) for (const f of feriadosNacionais(a)) if (f.data >= inicio && f.data <= fim) datas.add(f.data);
  const r = await db.execute({ sql: 'SELECT data, recorrente FROM feriados WHERE data BETWEEN ? AND ? OR recorrente = 1', args: [inicio, fim] });
  for (const f of r.rows) {
    if (!Number(f.recorrente)) { datas.add(f.data); continue; }
    for (const a of anos) { const d = `${a}${String(f.data).slice(4)}`; if (d >= inicio && d <= fim) datas.add(d); }
  }
  return datas;
}

export const ABRANGENCIAS = Object.freeze({ nacional: 'Nacional', estadual: 'Estadual', municipal: 'Municipal' });

/** Feriados de um ano para a tela: nacionais (automáticos) + cadastrados no ano + os que repetem todo ano. */
export async function listarFeriados(db, { ano }) {
  const r = await db.execute({ sql: 'SELECT * FROM feriados WHERE substr(data, 1, 4) = ? OR recorrente = 1', args: [String(ano)] });
  const cadastrados = r.rows.map((f) => ({ ...f, data: Number(f.recorrente) ? `${ano}${String(f.data).slice(4)}` : f.data, automatico: false }));
  const nacionais = feriadosNacionais(ano).map((f) => ({ ...f, abrangencia: 'nacional', uf: null, cidade: null, recorrente: 1, automatico: true }));
  return [...nacionais, ...cadastrados].sort((x, y) => x.data.localeCompare(y.data) || Number(y.automatico) - Number(x.automatico));
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

export async function incluirFeriado(db, { data, descricao, abrangencia, uf, cidade, recorrente = false, executadoPor }) {
  const v = validarFeriado({ data, descricao, abrangencia, uf, cidade });
  if (abrangencia === 'nacional' && feriadosNacionais(Number(String(data).slice(0, 4))).some((f) => f.data === data)) {
    v.erros.push('este feriado nacional já é calculado automaticamente');
  }
  if (v.erros.length) throw new Error(v.erros.join('; '));
  try {
    await db.execute({
      sql: 'INSERT INTO feriados (data, descricao, abrangencia, uf, cidade, recorrente, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [data, limparTexto(descricao), abrangencia, v.uf, v.cidade, recorrente ? 1 : 0, executadoPor ?? null],
    });
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new Error('feriado já cadastrado para essa data e abrangência');
    throw e;
  }
}

export async function excluirFeriado(db, { id }) {
  await db.execute({ sql: 'DELETE FROM feriados WHERE id = ?', args: [id] });
}
