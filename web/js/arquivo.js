// Leitura do arquivo escolhido na tela (mesma lógica dos scripts: shared/planilha.mjs).
import { lerPlanilhaDeBytes, sha256Hex } from '../shared/planilha.mjs';
import { bibliotecasPlanilha } from './planilhas.js';

export async function lerArquivo(arquivo) {
  if (!arquivo) throw new Error('escolha um arquivo');
  const [bytes, libs] = await Promise.all([arquivo.arrayBuffer().then((b) => new Uint8Array(b)), bibliotecasPlanilha()]);
  const planilha = await lerPlanilhaDeBytes(bytes, arquivo.name, libs);
  return { ...planilha, nome: arquivo.name, sha256: await sha256Hex(bytes), tamanho: bytes.length };
}
