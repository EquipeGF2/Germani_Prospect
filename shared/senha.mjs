// Hash de senha com PBKDF2-SHA256 via Web Crypto — funciona igual no Node 22+ e no navegador.
// Formato gravado em usuarios.senha_hash:  pbkdf2$<iteracoes>$<sal base64>$<hash base64>
const ITERACOES = 210000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(senha, sal, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, chave, 256);
}

/** Mínimo de caracteres da senha de login (decisão do dono, 2026-11-06). O administrador segue com 8, pelo cofre (shared/cofre.mjs). */
export const SENHA_MINIMA = 6;

export async function gerarHashSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) throw new Error(`senha deve ter ao menos ${SENHA_MINIMA} caracteres`);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(await derivar(senha, sal, ITERACOES))}`;
}

export async function conferirSenha(senha, hashGravado) {
  const [alg, it, sal, hash] = String(hashGravado ?? '').split('$');
  if (alg !== 'pbkdf2' || !it || !sal || !hash) return false;
  const calculado = b64(await derivar(senha, deB64(sal), Number(it)));
  if (calculado.length !== hash.length) return false;
  let dif = 0;
  for (let i = 0; i < hash.length; i++) dif |= calculado.charCodeAt(i) ^ hash.charCodeAt(i);
  return dif === 0;
}
