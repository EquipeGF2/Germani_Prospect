// Cofre de administração (ADR-0006): guarda a chave de administração do Turso cifrada com a senha do usuário.
// AES-GCM 256 com chave derivada por PBKDF2-SHA256 (sal próprio, diferente do hash de login). Web Crypto: Node 22+ e navegador.
// Formato (texto JSON): { v: 1, it, sal, iv, dados } — tudo em base64.
const ITERACOES = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Senha de quem tem cofre: ao menos 8 caracteres (decisão do dono — ADR-0006). O hash de login é legível pelo token do
 * app, então a força da senha do administrador é o que protege o cofre: recomendável usar letras e números.
 */
export function validarSenhaCofre(senha) {
  if (String(senha ?? '').length < 8) throw new Error('senha de administrador: ao menos 8 caracteres');
}

async function chave(senha, sal, iteracoes, usos) {
  const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, base,
    { name: 'AES-GCM', length: 256 }, false, usos);
}

export async function fecharCofre(segredo, senha) {
  if (!segredo) throw new Error('nada para guardar no cofre');
  validarSenhaCofre(senha);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await chave(senha, sal, ITERACOES, ['encrypt']);
  const dados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(segredo));
  return JSON.stringify({ v: 1, it: ITERACOES, sal: b64(sal), iv: b64(iv), dados: b64(dados) });
}

/** Devolve o segredo, ou null se a senha não abrir o cofre (ou o cofre estiver corrompido). */
export async function abrirCofre(cofre, senha) {
  try {
    const c = JSON.parse(cofre);
    if (c?.v !== 1) return null;
    const k = await chave(senha, deB64(c.sal), Number(c.it), ['decrypt']);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(c.iv) }, k, deB64(c.dados)));
  } catch {
    return null;
  }
}
