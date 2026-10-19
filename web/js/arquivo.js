// Leitura do arquivo escolhido na tela (mesma lógica dos scripts: shared/planilha.mjs).
import { lerPlanilhaDeBytes, sha256Hex } from '../shared/planilha.mjs';

export async function lerArquivo(arquivo) {
  if (!arquivo) throw new Error('escolha um arquivo');
  if (!window.ExcelJS || !window.JSZip) throw new Error('bibliotecas de planilha ainda carregando — tente de novo em instantes');
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const planilha = await lerPlanilhaDeBytes(bytes, arquivo.name, { ExcelJS: window.ExcelJS, JSZip: window.JSZip });
  return { ...planilha, nome: arquivo.name, sha256: await sha256Hex(bytes), tamanho: bytes.length };
}
