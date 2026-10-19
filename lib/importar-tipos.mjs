// Lista informada pelo administrador dizendo quem é representante e quem é vendedor
// (usada quando a planilha base não traz essa informação). Atualiza usuarios.tipo_atuacao pelo código.
// Mesmas garantias das outras importações: simulação, nenhuma linha some, cada linha registrada.
import { limparTexto, normalizarBusca, chaveCabecalho } from '../shared/texto.mjs';
import { linhaVazia } from '../shared/importacao-base.mjs';

/** Valores aceitos na coluna de tipo (comparados sem acento). */
const SINONIMOS = {
  REPRESENTANTE: 'representante', REP: 'representante', RCA: 'representante', 'REPRESENTANTE COMERCIAL': 'representante',
  VENDEDOR: 'vendedor', 'VENDEDOR INTERNO': 'vendedor', INTERNO: 'vendedor', VI: 'vendedor',
};

export function interpretarTipo(valor) {
  return SINONIMOS[normalizarBusca(valor)] ?? null;
}

function coluna(cabecalho, nome) {
  const i = cabecalho.findIndex((t) => chaveCabecalho(t) === chaveCabecalho(nome));
  if (i < 0) throw new Error(`coluna "${nome}" não encontrada. Colunas do arquivo: ${cabecalho.filter(Boolean).join(' | ')}`);
  return i;
}

export async function importarTipos(db, { linhas, colunas = { codigo: 'COD', tipo: 'TIPO' }, arquivoNome, arquivoSha256, executadoPor, simular = false }) {
  const [cabecalho = [], ...corpo] = linhas;
  const iCod = coluna(cabecalho, colunas.codigo);
  const iTipo = coluna(cabecalho, colunas.tipo);
  const vendedores = new Map((await db.execute("SELECT id, codigo_erp, nome, tipo_atuacao FROM usuarios WHERE perfil = 'vendedor'")).rows
    .map((u) => [String(u.codigo_erp), { id: Number(u.id), nome: u.nome, tipo: u.tipo_atuacao }]));

  let vazias = 0;
  const vistos = new Map();
  const resultados = [];
  corpo.forEach((linha, i) => {
    if (linhaVazia(linha)) { vazias++; return; }
    const r = { numeroLinha: i + 2, resultado: 'aceita', mensagens: [], bruto: Object.fromEntries(cabecalho.map((t, j) => [String(t ?? `col${j + 1}`), linha[j] ?? null])) };
    resultados.push(r);
    const codigo = limparTexto(linha[iCod])?.replace(/\.0+$/, '') ?? null;
    const tipo = interpretarTipo(linha[iTipo]);
    const u = codigo ? vendedores.get(codigo) : null;
    if (!codigo) { r.resultado = 'rejeitada'; r.mensagens.push('código vazio'); return; }
    if (!tipo) { r.resultado = 'rejeitada'; r.mensagens.push(`tipo não reconhecido: "${linha[iTipo] ?? ''}" (use REPRESENTANTE ou VENDEDOR)`); return; }
    if (!u) { r.resultado = 'rejeitada'; r.mensagens.push(`representante/vendedor ${codigo} não cadastrado (importe a base antes)`); return; }
    if (vistos.has(codigo) && vistos.get(codigo) !== tipo) { r.resultado = 'rejeitada'; r.mensagens.push(`código ${codigo} repetido com tipo diferente`); return; }
    if (u.tipo === tipo || vistos.has(codigo)) { r.resultado = 'ignorada'; r.mensagens.push(`já está como ${tipo}`); vistos.set(codigo, tipo); return; }
    vistos.set(codigo, tipo);
    if (u.tipo) r.mensagens.push(`alterado de ${u.tipo} para ${tipo}`);
    r.usuario = { id: u.id, tipo, anterior: u.tipo ?? null };
  });

  const resumo = {
    linhasLidas: resultados.length,
    linhasVazias: vazias,
    aceitas: resultados.filter((r) => r.resultado === 'aceita').length,
    rejeitadas: resultados.filter((r) => r.resultado === 'rejeitada').length,
    ignoradas: resultados.filter((r) => r.resultado === 'ignorada').length,
    semTipoDefinido: 0,
  };
  const aplicadas = new Set(resultados.filter((r) => r.usuario).map((r) => r.usuario.id));
  resumo.semTipoDefinido = [...vendedores.values()].filter((u) => !u.tipo && !aplicadas.has(u.id)).length;
  if (simular) return { resumo, resultados, importacaoId: null };

  const imp = await db.execute({
    sql: `INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por, observacao) VALUES ('tipo_atuacao', ?, ?, ?, ?) RETURNING id`,
    args: [arquivoNome, arquivoSha256, executadoPor, JSON.stringify({ colunas, vazias })],
  });
  const importacaoId = Number(imp.rows[0].id);
  const stmts = [];
  for (const r of resultados) {
    if (r.usuario) {
      stmts.push({ sql: `UPDATE usuarios SET tipo_atuacao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, args: [r.usuario.tipo, r.usuario.id] });
      stmts.push({ sql: `INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes) VALUES (?, 'tipo_atuacao', 'usuarios', ?, ?)`,
        args: [executadoPor, String(r.usuario.id), JSON.stringify({ de: r.usuario.anterior, para: r.usuario.tipo, importacao_id: importacaoId })] });
    }
    stmts.push({ sql: 'INSERT INTO importacao_linhas (importacao_id, numero_linha, cnpj, resultado, mensagens, dados_brutos) VALUES (?, ?, NULL, ?, ?, ?)',
      args: [importacaoId, r.numeroLinha, r.resultado, JSON.stringify(r.mensagens), JSON.stringify(r.bruto, (_, v) => v ?? null)] });
  }
  stmts.push({
    sql: `UPDATE importacoes SET situacao = 'concluida', concluido_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            linhas_lidas = ?, linhas_aceitas = ?, linhas_rejeitadas = ?, linhas_ignoradas = ? WHERE id = ?`,
    args: [resumo.linhasLidas, resumo.aceitas, resumo.rejeitadas, resumo.ignoradas, importacaoId],
  });
  await db.batch(stmts, 'write'); // tudo ou nada
  return { resumo, resultados, importacaoId };
}
