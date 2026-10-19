// Importação de arquivos do ERP Senior / Receita que geram eventos nos prospects:
//   cadastro → cliente cadastrado no ERP        (status "Cadastrado no ERP")
//   pedido   → pedido digitado = venda realizada (status final "Venda realizada")
//   baixa    → CNPJ baixado/inapto               (status "Inválido", prospect congelado)
// O layout desses arquivos ainda não foi enviado: as colunas são informadas na linha de comando.
// Linhas cujo CNPJ não é prospect (ex.: cliente antigo do ERP) ficam "ignoradas" — contadas, nunca somem.
import { analisarCnpj } from '../shared/cnpj.mjs';
import { analisarData } from '../shared/datas.mjs';
import { chaveCabecalho, limparTexto } from '../shared/texto.mjs';
import { linhaVazia } from '../shared/importacao-base.mjs';
import { gravarEmLotes } from './gravacao.mjs';

export const TIPOS_EVENTO = Object.freeze({ cadastro: 'cadastro_erp', pedido: 'pedido_erp', baixa: 'cnpj_baixado' });

function localizar(cabecalho, nome, obrigatoria) {
  if (!nome) return undefined;
  const i = cabecalho.findIndex((t) => chaveCabecalho(t) === chaveCabecalho(nome));
  if (i < 0 && obrigatoria) throw new Error(`coluna "${nome}" não encontrada. Colunas do arquivo: ${cabecalho.filter(Boolean).join(' | ')}`);
  return i < 0 ? undefined : i;
}

/**
 * @param tipo           'cadastro' | 'pedido' | 'baixa'
 * @param colunas        { cnpj, data, documento } — nomes das colunas no arquivo
 * @param dataPadrao     usada quando o arquivo não tem coluna de data (ex.: lista de baixados)
 */
export async function importarEventos(db, { tipo, linhas, colunas, dataPadrao, hoje, arquivoNome, arquivoSha256, executadoPor, simular = false }) {
  if (!TIPOS_EVENTO[tipo]) throw new Error(`tipo inválido: ${tipo} (use cadastro, pedido ou baixa)`);
  if (!colunas.data && !dataPadrao) throw new Error('informe a coluna de data ou uma data padrão');
  const [cabecalho = [], ...corpo] = linhas;
  const iCnpj = localizar(cabecalho, colunas.cnpj, true);
  const iData = localizar(cabecalho, colunas.data, true);
  const iDoc = localizar(cabecalho, colunas.documento, true);

  const prospects = new Map((await db.execute('SELECT id, cnpj, status_atual FROM prospects')).rows.map((r) => [r.cnpj, { id: Number(r.id), status: r.status_atual }]));
  const jaImportados = new Set((await db.execute({ sql: "SELECT prospect_id, COALESCE(documento,'') d FROM eventos_erp WHERE tipo = ?", args: [tipo] }))
    .rows.map((r) => `${r.prospect_id}|${r.d}`));

  let vazias = 0;
  const resultados = [];
  const vistos = new Set();
  corpo.forEach((linha, i) => {
    if (linhaVazia(linha)) { vazias++; return; }
    const numeroLinha = i + 2;
    const bruto = Object.fromEntries(cabecalho.map((t, j) => [String(t ?? `col${j + 1}`), linha[j] ?? null]));
    const r = { numeroLinha, bruto, erros: [], avisos: [], resultado: 'aceita' };
    resultados.push(r);
    const { cnpj, erro } = analisarCnpj(linha[iCnpj]);
    r.cnpj = cnpj;
    if (erro) { r.erros.push(`${erro}: "${linha[iCnpj] ?? ''}"`); r.resultado = 'rejeitada'; return; }
    const d = iData === undefined ? { data: dataPadrao, erro: null } : analisarData(linha[iData]);
    if (d.erro || !d.data) { r.erros.push(`data: ${d.erro ?? 'vazia'}`); r.resultado = 'rejeitada'; return; }
    if (d.data > hoje) { r.erros.push(`data no futuro: ${d.data}`); r.resultado = 'rejeitada'; return; }
    const documento = iDoc === undefined ? null : limparTexto(linha[iDoc])?.replace(/\.0+$/, '') ?? null;
    if (tipo === 'pedido' && !documento) { r.erros.push('número do pedido vazio'); r.resultado = 'rejeitada'; return; }
    const p = prospects.get(cnpj);
    if (!p) { r.erros.push('CNPJ não está na base de prospects'); r.resultado = 'ignorada'; return; }
    const chave = `${p.id}|${tipo === 'baixa' ? '' : documento ?? ''}`;
    if (jaImportados.has(chave) || vistos.has(chave)) { r.erros.push('evento já importado'); r.resultado = 'ignorada'; return; }
    if (tipo === 'baixa' && p.status === 'invalido') { r.erros.push('CNPJ já registrado como baixado'); r.resultado = 'ignorada'; return; }
    vistos.add(chave);
    r.evento = { prospectId: p.id, data: d.data, documento: tipo === 'baixa' ? null : documento };
  });

  const contar = () => ({
    linhasLidas: resultados.length,
    linhasVazias: vazias,
    aceitas: resultados.filter((r) => r.resultado === 'aceita').length,
    rejeitadas: resultados.filter((r) => r.resultado === 'rejeitada').length,
    ignoradas: resultados.filter((r) => r.resultado === 'ignorada').length,
  });
  if (simular) return { resumo: contar(), resultados, importacaoId: null };

  const imp = await db.execute({
    sql: `INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por, observacao) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [TIPOS_EVENTO[tipo], arquivoNome, arquivoSha256, executadoPor, JSON.stringify({ colunas, dataPadrao: dataPadrao ?? null, vazias })],
  });
  const importacaoId = Number(imp.rows[0].id);
  try {
    const aGravar = resultados.filter((r) => r.resultado === 'aceita');
    const g = await gravarEmLotes(db, aGravar, (r) => [{
      sql: 'INSERT INTO eventos_erp (prospect_id, tipo, data_evento, documento, importacao_id) VALUES (?, ?, ?, ?, ?)',
      args: [r.evento.prospectId, tipo, r.evento.data, r.evento.documento, importacaoId],
    }]);
    g.forEach((x, i) => { if (!x.ok) { aGravar[i].erros.push(`banco recusou: ${x.erro}`); aGravar[i].resultado = 'rejeitada'; } });

    const registros = resultados.map((r) => ({
      sql: 'INSERT INTO importacao_linhas (importacao_id, numero_linha, cnpj, resultado, mensagens, dados_brutos) VALUES (?, ?, ?, ?, ?, ?)',
      args: [importacaoId, r.numeroLinha, r.cnpj ?? null, r.resultado, JSON.stringify(r.resultado === 'aceita' ? r.avisos : r.erros),
        JSON.stringify(r.bruto, (_, v) => v ?? null)],
    }));
    for (let i = 0; i < registros.length; i += 200) await db.batch(registros.slice(i, i + 200), 'write');
    const resumo = contar();
    await db.execute({
      sql: `UPDATE importacoes SET situacao = 'concluida', concluido_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              linhas_lidas = ?, linhas_aceitas = ?, linhas_rejeitadas = ?, linhas_ignoradas = ? WHERE id = ?`,
      args: [resumo.linhasLidas, resumo.aceitas, resumo.rejeitadas, resumo.ignoradas, importacaoId],
    });
    return { resumo, resultados, importacaoId };
  } catch (e) {
    await db.execute({ sql: `UPDATE importacoes SET situacao = 'falhou', observacao = ? WHERE id = ?`, args: [String(e.message), importacaoId] });
    throw e;
  }
}
