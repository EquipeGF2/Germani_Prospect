// Relatório de crédito do ERP → Análise financeira concluída (Aguardando pedido). docs/05-importacao.md §3
// Layout: CNPJ · Cód interno · Razão social · Forma de pagamento · Prazo de pagamento · Limite de crédito CNPJ ·
//         Limite de crédito grupo · Data de cadastro.
// Regras:
//   * limite efetivo = limite do CNPJ; se o do CNPJ estiver vazio, vale o do grupo;
//   * forma de pagamento: antecipado · à vista · boleto (valores do arquivo mapeados na tela); prazo = dias;
//   * cliente ainda sem cadastro (não contactado, em prospecção, aguardando cadastro, sem interesse): o relatório
//     registra também o CADASTRO (data de cadastro + cód. interno) e em seguida a liberação de crédito;
//   * venda realizada: ignorada (status não muda) · baixado: rejeitada · mesmo crédito já registrado: ignorada.
import { analisarCnpj } from './cnpj.mjs';
import { analisarData } from './datas.mjs';
import { chaveCabecalho, limparTexto, normalizarBusca } from './texto.mjs';
import { linhaVazia } from './importacao-base.mjs';
import { gravarEmLotes } from './gravacao.mjs';
import { lerValor } from './financeiro.mjs';

export const COLUNAS_CREDITO = Object.freeze([
  { campo: 'cnpj', cabecalho: 'CNPJ', obrigatoria: true },
  { campo: 'codigo', cabecalho: 'Cód interno', alternativas: ['Código interno', 'Cod. interno', 'Código', 'Cód cliente'] },
  { campo: 'razao', cabecalho: 'Razão social' },
  { campo: 'forma', cabecalho: 'Forma de pagamento', obrigatoria: true },
  { campo: 'prazo', cabecalho: 'Prazo de pagamento', alternativas: ['Prazo'] },
  { campo: 'limite_cnpj', cabecalho: 'Limite de crédito CNPJ', alternativas: ['Limite CNPJ'] },
  { campo: 'limite_grupo', cabecalho: 'Limite de crédito grupo', alternativas: ['Limite grupo'] },
  { campo: 'data_cadastro', cabecalho: 'Data de cadastro', alternativas: ['Data cadastro', 'Dt cadastro'], obrigatoria: true },
]);

/** Valores do arquivo → forma de pagamento (comparados sem acento). O que não estiver aqui é escolhido na tela. */
export const FORMAS_PADRAO = Object.freeze({
  ANTECIPADO: 'antecipado', ANTECIPADA: 'antecipado', 'PAGAMENTO ANTECIPADO': 'antecipado', 'DEPOSITO ANTECIPADO': 'antecipado',
  'A VISTA': 'a_vista', AVISTA: 'a_vista', 'A-VISTA': 'a_vista',
  BOLETO: 'boleto', 'BOLETO BANCARIO': 'boleto', BOLETOS: 'boleto',
});

/** Localiza as colunas: `escolhidas` (campo → título escolhido na tela) ou título padrão/alternativo. */
export function mapearColunasCredito(cabecalho, escolhidas = {}) {
  const chaves = cabecalho.map((t) => chaveCabecalho(t));
  const indices = {};
  const faltando = [];
  for (const c of COLUNAS_CREDITO) {
    const nomes = escolhidas[c.campo] !== undefined ? [escolhidas[c.campo]] : [c.cabecalho, ...(c.alternativas ?? [])];
    const i = nomes.filter(Boolean).map((n) => chaves.indexOf(chaveCabecalho(n))).find((x) => x >= 0);
    if (i === undefined) { if (c.obrigatoria) faltando.push(c.cabecalho); } else indices[c.campo] = i;
  }
  return { indices, faltando };
}

/** Valores distintos de "Forma de pagamento" (para o mapeamento na tela). */
export function contarFormas(linhas, indices) {
  const g = new Map();
  for (const l of linhas.slice(1)) {
    if (linhaVazia(l)) continue;
    const valor = limparTexto(l[indices.forma]) ?? '';
    const chave = normalizarBusca(valor);
    const x = g.get(chave) ?? { valor, chave, quantidade: 0, sugerida: FORMAS_PADRAO[chave] ?? '' };
    x.quantidade++;
    g.set(chave, x);
  }
  return [...g.values()].sort((a, b) => b.quantidade - a.quantidade);
}

const STATUS_SEM_CADASTRO = ['nao_contactado', 'em_prospeccao', 'aguardando_cadastro', 'sem_interesse'];
const NOME_STATUS = { nao_contactado: 'Não contactado', em_prospeccao: 'Em prospecção', aguardando_cadastro: 'Aguardando cadastro', sem_interesse: 'Sem interesse' };

export async function importarCredito(db, { linhas, colunas = {}, mapaFormas = null, hoje, arquivoNome, arquivoSha256, executadoPor, simular = false }) {
  const [cabecalho = [], ...corpo] = linhas;
  const { indices, faltando } = mapearColunasCredito(cabecalho, colunas);
  if (faltando.length) throw new Error(`colunas obrigatórias ausentes: ${faltando.join(', ')}`);
  const formas = mapaFormas ?? FORMAS_PADRAO;

  const prospects = new Map((await db.execute(`
    SELECT p.id, p.cnpj, p.status_atual, p.razao_social, p.dt_cadastro_erp,
           l.forma_pagamento, l.prazo_pagamento_dias, l.limite_credito, l.limite_origem
      FROM prospects p
      LEFT JOIN liberacoes_credito l ON l.id = (SELECT max(id) FROM liberacoes_credito WHERE prospect_id = p.id)`)).rows
    .map((r) => [r.cnpj, r]));

  let vazias = 0;
  const vistos = new Map();
  const resultados = [];
  corpo.forEach((linha, i) => {
    if (linhaVazia(linha)) { vazias++; return; }
    const numeroLinha = i + 2;
    const bruto = Object.fromEntries(cabecalho.map((t, j) => [String(t ?? `col${j + 1}`), linha[j] ?? null]));
    const r = { numeroLinha, bruto, erros: [], avisos: [], resultado: 'aceita' };
    resultados.push(r);
    const rejeitar = (m) => { r.erros.push(m); r.resultado = 'rejeitada'; };
    const ignorar = (m) => { r.erros.push(m); r.resultado = 'ignorada'; };

    const { cnpj, erro } = analisarCnpj(linha[indices.cnpj]);
    r.cnpj = cnpj;
    if (erro) return rejeitar(`${erro}: "${linha[indices.cnpj] ?? ''}"`);
    if (vistos.has(cnpj)) return rejeitar(`CNPJ repetido no arquivo (linha ${vistos.get(cnpj)})`);
    vistos.set(cnpj, numeroLinha);

    const valorForma = limparTexto(linha[indices.forma]) ?? '';
    const forma = formas[normalizarBusca(valorForma)];
    if (!forma) return rejeitar(`forma de pagamento não mapeada: "${valorForma}"`);

    const textoPrazo = limparTexto(indices.prazo === undefined ? null : linha[indices.prazo]);
    const prazo = textoPrazo === null ? 0 : Number(String(textoPrazo).replace(/\D+$/, '').replace(',', '.'));
    if (!Number.isInteger(prazo) || prazo < 0) return rejeitar(`prazo de pagamento inválido: "${textoPrazo}" (informe só a quantidade de dias)`);
    if (forma === 'boleto' && prazo === 0) r.avisos.push('boleto sem prazo de pagamento');

    const limCnpj = indices.limite_cnpj === undefined ? null : lerValor(linha[indices.limite_cnpj]);
    const limGrupo = indices.limite_grupo === undefined ? null : lerValor(linha[indices.limite_grupo]);
    if (Number.isNaN(limCnpj) || (limCnpj ?? 0) < 0) return rejeitar(`limite de crédito CNPJ inválido: "${linha[indices.limite_cnpj]}"`);
    if (Number.isNaN(limGrupo) || (limGrupo ?? 0) < 0) return rejeitar(`limite de crédito grupo inválido: "${linha[indices.limite_grupo]}"`);
    let limite; let origem;
    if (limCnpj !== null) { limite = limCnpj; origem = 'cnpj'; }
    else if (limGrupo !== null) { limite = limGrupo; origem = 'grupo'; r.avisos.push('limite do CNPJ vazio — usado o limite do grupo'); }
    else if (forma === 'boleto') return rejeitar('boleto sem limite (CNPJ e grupo vazios)');
    else { limite = 0; origem = 'informado'; r.avisos.push('sem limite informado (CNPJ e grupo vazios) — limite 0'); }
    if (forma === 'boleto' && limite === 0) return rejeitar('boleto exige limite maior que zero');

    const d = analisarData(linha[indices.data_cadastro]);
    if (d.erro || !d.data) return rejeitar(`data de cadastro: ${d.erro ?? 'vazia'}`);
    if (d.data > hoje) return rejeitar(`data de cadastro no futuro: ${d.data}`);
    const codigo = indices.codigo === undefined ? null : limparTexto(linha[indices.codigo])?.replace(/\.0+$/, '') ?? null;

    const p = prospects.get(cnpj);
    if (!p) return ignorar('CNPJ não está na base de prospects');
    if (p.status_atual === 'invalido') return rejeitar('CNPJ baixado: impossibilitado de faturamento');
    if (p.status_atual === 'venda_realizada') return ignorar('venda já realizada — o crédito não altera o status');
    if (p.forma_pagamento === forma && Number(p.prazo_pagamento_dias) === prazo && Number(p.limite_credito) === limite && p.limite_origem === origem) {
      return ignorar('crédito já registrado com os mesmos dados');
    }
    const razao = indices.razao === undefined ? null : limparTexto(linha[indices.razao]);
    if (razao && normalizarBusca(razao) !== normalizarBusca(p.razao_social)) r.avisos.push(`razão social diferente da base: "${razao}"`);
    const registraCadastro = STATUS_SEM_CADASTRO.includes(p.status_atual);
    if (registraCadastro) r.avisos.push(`cadastro registrado pelo relatório (${NOME_STATUS[p.status_atual]} → Análise financeira)`);
    r.credito = { prospectId: Number(p.id), forma, prazo, limCnpj, limGrupo, limite, origem, dataCadastro: d.data, codigo, registraCadastro,
      dataLiberacao: p.dt_cadastro_erp && p.dt_cadastro_erp > hoje ? p.dt_cadastro_erp : hoje };
  });

  const contar = () => ({
    linhasLidas: resultados.length,
    linhasVazias: vazias,
    aceitas: resultados.filter((r) => r.resultado === 'aceita').length,
    rejeitadas: resultados.filter((r) => r.resultado === 'rejeitada').length,
    ignoradas: resultados.filter((r) => r.resultado === 'ignorada').length,
    cadastrosRegistrados: resultados.filter((r) => r.resultado === 'aceita' && r.credito.registraCadastro).length,
  });
  if (simular) return { resumo: contar(), resultados, importacaoId: null };

  const imp = await db.execute({
    sql: `INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por, observacao) VALUES ('credito_erp', ?, ?, ?, ?) RETURNING id`,
    args: [arquivoNome, arquivoSha256, executadoPor, JSON.stringify({ colunas, formas: mapaFormas ? Object.keys(mapaFormas) : 'padrão', vazias })],
  });
  const importacaoId = Number(imp.rows[0].id);
  try {
    const aGravar = resultados.filter((r) => r.resultado === 'aceita');
    const g = await gravarEmLotes(db, aGravar, (r) => {
      const c = r.credito;
      const stmts = [];
      if (c.registraCadastro) {
        stmts.push({ sql: "INSERT OR IGNORE INTO eventos_erp (prospect_id, tipo, data_evento, documento, importacao_id) VALUES (?, 'cadastro', ?, ?, ?)",
          args: [c.prospectId, c.dataCadastro, c.codigo, importacaoId] });
      }
      stmts.push({
        sql: `INSERT INTO liberacoes_credito (prospect_id, origem, importacao_id, data_liberacao, forma_pagamento, prazo_pagamento_dias,
                                              limite_cnpj, limite_grupo, limite_credito, limite_origem)
              VALUES (?, 'importacao', ?, max(?, COALESCE((SELECT dt_cadastro_erp FROM prospects WHERE id = ?), ?)), ?, ?, ?, ?, ?, ?)`,
        args: [c.prospectId, importacaoId, c.dataLiberacao, c.prospectId, c.dataLiberacao, c.forma, c.prazo, c.limCnpj, c.limGrupo, c.limite, c.origem],
      });
      return stmts;
    });
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
