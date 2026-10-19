// Normalização de texto — usada na importação, na busca e nos relatórios.
// Regra: "A", "Á", "Â", "Ã", "à" são o mesmo caractere para busca e comparação.
// Os dados originais são guardados para exibição; as colunas *_busca guardam a forma normalizada.

const ESPECIAIS = { 'º': 'O', 'ª': 'A', '°': 'O', 'ß': 'SS', 'Æ': 'AE', 'æ': 'AE', 'Ø': 'O', 'ø': 'O' };

/** Remove acentos e caracteres especiais equivalentes, sem alterar maiúsculas/minúsculas. */
export function removerAcentos(valor) {
  if (valor == null) return '';
  return String(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ºª°ßÆæØø]/g, (c) => ESPECIAIS[c] ?? c);
}

/** Texto limpo para exibição: sem espaços duplicados, sem espaços nas pontas. Vazio → null. */
export function limparTexto(valor) {
  if (valor == null) return null;
  const t = String(valor).replace(/[ \s]+/g, ' ').trim();
  return t === '' ? null : t;
}

/** Forma normalizada para busca: MAIÚSCULAS, sem acento, espaços simples. */
export function normalizarBusca(valor) {
  return removerAcentos(limparTexto(valor) ?? '').toUpperCase();
}

/** Chave de cabeçalho de planilha: só letras e números ("DT 1º.contato" → "DT1OCONTATO"). */
export function chaveCabecalho(valor) {
  return normalizarBusca(valor).replace(/[^A-Z0-9]/g, '');
}

/** Só dígitos (telefone, CEP). Vazio → null. */
export function somenteDigitos(valor) {
  if (valor == null) return null;
  const d = String(valor).replace(/\D/g, '');
  return d === '' ? null : d;
}

const STOPWORDS = new Set(
  'A O AS OS DE DA DO DAS DOS E EM NO NA NOS NAS UM UMA UNS UMAS POR PARA COM SEM QUE SE NAO JA MAIS MUITO POIS PELO PELA AO AOS ELE ELA ELES ELAS TEM TER FOI SER ESTA ESTE ISSO ISTO'.split(' ')
);

/** Palavras-chave de uma observação (para ranking de motivos de recusa). */
export function palavrasChave(valor) {
  const palavras = normalizarBusca(valor).split(/[^A-Z0-9]+/).filter((p) => p.length >= 3 && !STOPWORDS.has(p));
  return [...new Set(palavras)];
}
