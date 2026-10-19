// CNPJ numérico e alfanumérico (IN RFB 2.229/2024, vigente desde julho/2026).
// Formato: 12 posições [0-9A-Z] (raiz 8 + ordem 4) + 2 dígitos verificadores numéricos.
// Cálculo do DV: valor de cada caractere = código ASCII − 48 ('0'..'9' → 0..9, 'A' → 17 … 'Z' → 42),
// pesos 2..9 da direita para a esquerda, módulo 11 (resto < 2 → DV 0, senão 11 − resto).

/**
 * Normaliza para 14 caracteres maiúsculos sem pontuação.
 * Valores puramente numéricos com menos de 14 dígitos (perda de zero à esquerda no Excel) são completados.
 * Retorna null se não for possível obter 14 posições.
 */
export function normalizarCnpj(valor) {
  if (valor == null) return null;
  let s = String(valor).trim().toUpperCase();
  // Número vindo do Excel como 1.2345678000195E+13 ou 12345678000195.0
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, '');
  else if (/^\d(\.\d+)?E\+\d+$/.test(s)) s = BigInt(Math.round(Number(s))).toString();
  s = s.replace(/[.\-\/\s]/g, '');
  if (!/^[0-9A-Z]+$/.test(s)) return null;
  if (/^\d+$/.test(s) && s.length < 14) s = s.padStart(14, '0');
  return s.length === 14 ? s : null;
}

function dv(base) {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Calcula os dois dígitos verificadores para as 12 primeiras posições. */
export function calcularDv(base12) {
  const d1 = dv(base12);
  const d2 = dv(base12 + d1);
  return `${d1}${d2}`;
}

/** Valida um CNPJ já normalizado (14 posições). */
export function cnpjValido(cnpj) {
  if (typeof cnpj !== 'string' || !/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // 00000000000000, 11111111111111…
  return calcularDv(cnpj.slice(0, 12)) === cnpj.slice(12);
}

/** Normaliza e valida. Retorna { cnpj, erro }. */
export function analisarCnpj(valor) {
  const cnpj = normalizarCnpj(valor);
  if (!cnpj) return { cnpj: null, erro: 'CNPJ vazio ou com formato inválido' };
  if (!cnpjValido(cnpj)) return { cnpj, erro: 'CNPJ com dígito verificador inválido' };
  return { cnpj, erro: null };
}

/** 12.ABC.345/01DE-35 */
export function formatarCnpj(cnpj) {
  if (!cnpj || cnpj.length !== 14) return cnpj ?? '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export const raizCnpj = (cnpj) => (cnpj ? cnpj.slice(0, 8) : null);
