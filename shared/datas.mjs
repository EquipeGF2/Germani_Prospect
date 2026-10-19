// Datas de negócio: AAAA-MM-DD no banco, dd/mm/aaaa na tela.
// "Hoje" é o dia em America/Sao_Paulo. A data do contato é a do aparelho (regra de negócio).

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function montar(a, m, d) {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Excel serial (dias desde 1899-12-30) → AAAA-MM-DD */
export function serialExcelParaIso(serial) {
  const ms = Math.round(Number(serial) * 86400000) + Date.UTC(1899, 11, 30);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Converte valores de planilha em data ISO.
 * Aceita Date, serial do Excel, AAAA-MM-DD, dd/mm/aaaa, dd/mm/aa.
 * Retorna { data, erro }. Vazio → { data: null, erro: null }.
 */
export function analisarData(valor) {
  if (valor == null || valor === '') return { data: null, erro: null };
  if (valor instanceof Date) {
    if (isNaN(valor)) return { data: null, erro: 'data inválida' };
    return { data: valor.toISOString().slice(0, 10), erro: null };
  }
  const s = String(valor).trim();
  if (s === '') return { data: null, erro: null };
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return { data: serialExcelParaIso(n), erro: null };
    return { data: null, erro: `data inválida: "${s}"` };
  }
  let m = s.slice(0, 10).match(RE_ISO);
  if (m) {
    const d = montar(+m[1], +m[2], +m[3]);
    return d ? { data: d, erro: null } : { data: null, erro: `data inválida: "${s}"` };
  }
  m = s.match(RE_BR);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = montar(ano, +m[2], +m[1]);
    return d ? { data: d, erro: null } : { data: null, erro: `data inválida: "${s}"` };
  }
  return { data: null, erro: `data em formato não reconhecido: "${s}"` };
}

/** Dia atual em São Paulo (AAAA-MM-DD). */
export function hojeSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export function somarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function diasEntre(isoInicio, isoFim) {
  return Math.round((Date.parse(isoFim) - Date.parse(isoInicio)) / 86400000);
}

export function formatarDataBr(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
