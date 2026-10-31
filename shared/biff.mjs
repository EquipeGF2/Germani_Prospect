// Leitor do Excel antigo (BIFF2, .xls) que o relatório de pedidos do Senior exporta. Sem dependência: só o que esse formato
// usa (texto, número e inteiro numa aba). Outras versões de .xls são recusadas com o que fazer. docs/05 §6
const BOF_BIFF2 = 0x0009;
const FIM = 0x000a;
const REG = { INTEIRO: 0x0002, NUMERO: 0x0003, TEXTO: 0x0004 };

/** @returns any[][] linhas da aba (linhas[0] é o cabeçalho); célula vazia = null */
export function lerBiff2(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recusar = () => new Error('versão de .xls não suportada: abra no Excel e salve como .xlsx ou exporte em CSV');
  if (bytes.length < 4 || d.getUint16(0, true) !== BOF_BIFF2) throw recusar();
  const texto = new TextDecoder('windows-1252');
  const linhas = [];
  const guardar = (l, c, v) => { (linhas[l] ??= [])[c] = v; };
  for (let pos = 0; pos + 4 <= bytes.length;) {
    const op = d.getUint16(pos, true);
    const tam = d.getUint16(pos + 2, true);
    const ini = pos + 4;
    pos = ini + tam;
    if (pos > bytes.length) throw new Error('arquivo .xls cortado ou corrompido');
    if (op === FIM) break;
    if (op !== REG.INTEIRO && op !== REG.NUMERO && op !== REG.TEXTO) continue;
    const l = d.getUint16(ini, true);
    const c = d.getUint16(ini + 2, true);
    if (op === REG.INTEIRO) guardar(l, c, d.getUint16(ini + 7, true));
    else if (op === REG.NUMERO) guardar(l, c, d.getFloat64(ini + 7, true));
    else guardar(l, c, texto.decode(bytes.subarray(ini + 8, ini + 8 + bytes[ini + 7])));
  }
  return Array.from(linhas, (l) => Array.from(l ?? [], (v) => v ?? null));
}
