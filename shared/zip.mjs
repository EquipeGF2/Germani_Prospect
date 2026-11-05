// ZIP sem compressão (método "store"): junta vários arquivos, com pastas, num download só. Sem dependência (navegador e Node).
// PDF já é comprimido por dentro; guardar sem comprimir mantém o arquivo leve de gerar.

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Data e hora no formato do DOS (o que o ZIP guarda). */
function dataDos(d) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    data: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Monta o ZIP. `arquivos`: [{ caminho: 'Pasta/arquivo.pdf', dados: Uint8Array }]. Nomes em UTF-8 (bit 11).
 * @returns Uint8Array
 */
export function montarZip(arquivos, agora = new Date()) {
  const texto = new TextEncoder();
  const { hora, data } = dataDos(agora);
  const partes = [];
  const central = [];
  let posicao = 0;
  for (const { caminho, dados } of arquivos) {
    const nome = texto.encode(caminho);
    const crc = crc32(dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, hora, true); local.setUint16(12, data, true); local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true); local.setUint32(22, dados.length, true); local.setUint16(26, nome.length, true); local.setUint16(28, 0, true);
    const cab = new DataView(new ArrayBuffer(46));
    cab.setUint32(0, 0x02014B50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 20, true); cab.setUint16(8, 0x0800, true); cab.setUint16(10, 0, true);
    cab.setUint16(12, hora, true); cab.setUint16(14, data, true); cab.setUint32(16, crc, true);
    cab.setUint32(20, dados.length, true); cab.setUint32(24, dados.length, true); cab.setUint16(28, nome.length, true);
    cab.setUint32(42, posicao, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);
    central.push(new Uint8Array(cab.buffer), nome);
    posicao += 30 + nome.length + dados.length;
  }
  const tamanhoCentral = central.reduce((t, p) => t + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054B50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true); fim.setUint32(16, posicao, true);
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((t, p) => t + p.length, 0));
  let i = 0;
  for (const p of todas) { saida.set(p, i); i += p.length; }
  return saida;
}
