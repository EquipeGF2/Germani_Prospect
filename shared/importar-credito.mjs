// Relatório de cadastro do ERP (cadastro + crédito num arquivo só) → Aguardando pedido. docs/05-importacao.md §3
// Layout real do ERP: Cliente · CPF / CNPJ · Razão Social · Cond. Pgto · Descrição · Forma Pgto · Descrição · (vazia) ·
//                     Créd. Cliente · Créd. Grupo · Dt. Cadastro   ("Descrição" repetida: vale a da coluna seguinte).
// Também aceita o layout antigo (CNPJ · Cód interno · … · Forma de pagamento · Prazo de pagamento · Limite …).
// Regras:
//   * limite efetivo = Créd. Cliente; se estiver vazio, vale o Créd. Grupo — o mesmo valor para todas as empresas da
//     mesma raiz de CNPJ (limite global do grupo, não somado);
//   * 9.999.999 = sem limite · 0 = sem crédito (a forma continua a do ERP; boleto com 0 é avisado);
//   * condição e forma de pagamento ficam gravadas como vieram do ERP. A FORMA vem só da Forma Pgto; o PRAZO sai da
//     descrição da condição, limpo ("14/21/28 DD BOLETO" → "14/21/28"; à vista/antecipado → prazo 1) e o código da
//     condição é o prazo médio ("21B" → 21); forma_pagamento (antecipado · à vista · boleto · depósito e Pix) é só o filtro rápido;
//   * CPF (pessoa física) e CNPJ fora da base são ignorados — o relatório não cadastra prospects novos;
//   * cliente ainda sem cadastro (não contactado, em prospecção, aguardando cadastro, sem interesse): o relatório
//     registra também o CADASTRO (Dt. Cadastro + código do cliente) e em seguida a liberação de crédito;
//   * venda realizada: ignorada (status não muda) · baixado: rejeitada · mesmo crédito já registrado: ignorada.
import { analisarCnpj, raizCnpj } from './cnpj.mjs';
import { analisarData } from './datas.mjs';
import { chaveCabecalho, limparTexto, normalizarBusca, somenteDigitos } from './texto.mjs';
import { linhaVazia } from './importacao-base.mjs';
import { gravarEmLotes } from './gravacao.mjs';
import { lerValor } from './financeiro.mjs';

// `apos`: coluna sem título próprio ("Descrição" repetida) — é a coluna logo depois da indicada.
export const COLUNAS_CREDITO = Object.freeze([
  { campo: 'cnpj', cabecalho: 'CNPJ', alternativas: ['CPF / CNPJ', 'CPF/CNPJ', 'CNPJ / CPF'], obrigatoria: true },
  { campo: 'codigo', cabecalho: 'Cód interno', alternativas: ['Cliente', 'Código interno', 'Cod. interno', 'Código', 'Cód cliente'] },
  { campo: 'razao', cabecalho: 'Razão social' },
  { campo: 'cond', cabecalho: 'Cond. Pgto', alternativas: ['Condição de pagamento', 'Cond Pgto', 'Condição'] },
  { campo: 'cond_desc', cabecalho: 'Descrição da condição (o prazo sai daqui)', apos: 'cond' },
  { campo: 'forma', cabecalho: 'Forma de pagamento', alternativas: ['Forma Pgto', 'Forma'], obrigatoria: true },
  { campo: 'forma_desc', cabecalho: 'Descrição da forma', apos: 'forma' },
  { campo: 'prazo', cabecalho: 'Prazo em dias (só arquivo sem Cond. Pgto)', alternativas: ['Prazo de pagamento', 'Prazo'] },
  { campo: 'limite_cnpj', cabecalho: 'Limite de crédito CNPJ', alternativas: ['Créd. Cliente', 'Crédito cliente', 'Limite CNPJ'] },
  { campo: 'limite_grupo', cabecalho: 'Limite de crédito grupo', alternativas: ['Créd. Grupo', 'Crédito grupo', 'Limite grupo'] },
  { campo: 'data_cadastro', cabecalho: 'Data de cadastro', alternativas: ['Dt. Cadastro', 'Data cadastro', 'Dt cadastro'], obrigatoria: true },
]);

/** Forma de pagamento do ERP (descrição, sem acento) → filtro rápido. O que não estiver aqui é escolhido na tela. */
export const FORMAS_PADRAO = Object.freeze({
  ANTECIPADO: 'antecipado', ANTECIPADA: 'antecipado', 'PAGAMENTO ANTECIPADO': 'antecipado', 'DEPOSITO ANTECIPADO': 'antecipado',
  'A VISTA': 'a_vista', AVISTA: 'a_vista', 'A-VISTA': 'a_vista', 'E-COMMERCE': 'a_vista', ECOMMERCE: 'a_vista',
  BONIFICACAO: 'a_vista', 'CONFISSAO DIVIDA FUNCIONARIOS': 'a_vista',
  BOLETO: 'boleto', 'BOLETO BANCARIO': 'boleto', BOLETOS: 'boleto', 'CONVENIO ALIMENTACAO': 'boleto',
  'DEPOSITO E PIX': 'deposito', DEPOSITO: 'deposito', PIX: 'deposito', 'DEPOSITO BANCARIO': 'deposito',
});

/** Valor do ERP a partir do qual o crédito é "sem limite". */
export const SEM_LIMITE = 9999999;

/**
 * Prazo da condição de pagamento do ERP. O prazo sai da DESCRIÇÃO, limpo ("14/21/28 DD BOLETO" → "14/21/28";
 * "A VISTA" → "A VISTA" e "ANTECIPADO" → "ANTECIPADO", ambos prazo 1); o CÓDIGO traz o prazo médio ("21B" → 21).
 * Sem número no código, o médio é a média dos dias da descrição. A forma de pagamento nunca sai daqui.
 * @returns {{ parcelas: string|null, medio: number }}
 */
export function analisarCondicao(codigo, descricao) {
  const desc = normalizarBusca(descricao ?? '');
  const m = /^\s*(\d+(?:\s*\/\s*\d+)*)/.exec(desc);
  if (!m) {
    const parcelas = /\bVISTA\b/.test(desc) ? 'A VISTA' : /\bANTECIPAD/.test(desc) ? 'ANTECIPADO' : null;
    if (parcelas) return { parcelas, medio: 1 };
  }
  const dias = m ? m[1].split('/').map(Number) : [];
  const doCodigo = /^\s*(\d+)/.exec(String(codigo ?? ''));
  const medio = doCodigo ? Number(doCodigo[1]) : dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : 0;
  return { parcelas: dias.length ? dias.join('/') : null, medio };
}

/**
 * Localiza as colunas: `escolhidas` (campo → índice da coluna, ou título; null = não tem) ou título padrão/alternativo.
 * As colunas `apos` (descrição repetida) são a seguinte à indicada, quando o título dela é "Descrição".
 */
export function mapearColunasCredito(cabecalho, escolhidas = {}) {
  const chaves = cabecalho.map((t) => chaveCabecalho(t));
  const indices = {};
  const faltando = [];
  for (const c of COLUNAS_CREDITO) {
    let i;
    const e = escolhidas[c.campo];
    if (typeof e === 'number') i = e >= 0 && e < cabecalho.length ? e : undefined;
    else if (e !== undefined) i = e ? chaves.indexOf(chaveCabecalho(e)) : -1;
    else if (c.apos) i = indices[c.apos] !== undefined && chaves[indices[c.apos] + 1] === chaveCabecalho('Descrição') ? indices[c.apos] + 1 : undefined;
    else i = [c.cabecalho, ...(c.alternativas ?? [])].map((n) => chaves.indexOf(chaveCabecalho(n))).find((x) => x >= 0);
    if (i === undefined || i < 0) { if (c.obrigatoria) faltando.push(c.cabecalho); } else indices[c.campo] = i;
  }
  return { indices, faltando };
}

const texto = (linha, i) => (i === undefined ? null : limparTexto(linha[i])?.replace(/\.0+$/, '') ?? null);
/** Valor da forma usado no mapeamento: a descrição ("Boleto"), ou o próprio valor quando não há descrição. */
const valorForma = (linha, indices) => texto(linha, indices.forma_desc) ?? texto(linha, indices.forma) ?? '';

/** Valores distintos de forma de pagamento (para o mapeamento na tela). */
export function contarFormas(linhas, indices) {
  const g = new Map();
  for (const l of linhas.slice(1)) {
    if (linhaVazia(l)) continue;
    const valor = valorForma(l, indices);
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
           l.forma_pagamento, l.prazo_pagamento_dias, l.limite_credito, l.limite_origem, l.cond_pgto_codigo, l.forma_pgto_codigo
      FROM prospects p
      LEFT JOIN liberacoes_credito l ON l.id = (SELECT max(id) FROM liberacoes_credito WHERE prospect_id = p.id)`)).rows
    .map((r) => [r.cnpj, r]));
  const inicioCampanha = (await db.execute("SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'")).rows[0]?.valor ?? null;

  // títulos únicos para o registro da linha (cabeçalho do ERP tem coluna sem título e "Descrição" repetida)
  const titulos = [];
  Array.from(cabecalho, (t, j) => { const base = limparTexto(t) ?? `col${j + 1}`; let n = base; for (let k = 2; titulos.includes(n); k++) n = `${base} (${k})`; titulos.push(n); });
  let vazias = 0;
  const vistos = new Map();
  const resultados = [];
  const grupos = new Map(); // raiz → { valores do Créd. Grupo usados, próprias, do grupo }
  corpo.forEach((linha, i) => {
    if (linhaVazia(linha)) { vazias++; return; }
    const numeroLinha = i + 2;
    const bruto = Object.fromEntries(titulos.map((t, j) => [t, linha[j] ?? null]));
    const r = { numeroLinha, bruto, erros: [], avisos: [], resultado: 'aceita' };
    // data de cadastro como veio no arquivo (vai para o relatório de aceitas/rejeitadas; inválida fica como texto)
    const dc = analisarData(linha[indices.data_cadastro]);
    r.dataCadastro = dc.data ?? (limparTexto(linha[indices.data_cadastro]) || null);
    resultados.push(r);
    const rejeitar = (m) => { r.erros.push(m); r.resultado = 'rejeitada'; };
    const ignorar = (m) => { r.erros.push(m); r.resultado = 'ignorada'; };

    const digitos = somenteDigitos(String(linha[indices.cnpj] ?? '').replace(/\.0+$/, ''));
    if (digitos && /^[\d.\-\/\s]+$/.test(String(linha[indices.cnpj]).trim()) && digitos.length <= 11) {
      r.cpf = true;
      return ignorar('CPF (pessoa física) — não está na base de prospects');
    }
    const { cnpj, erro } = analisarCnpj(linha[indices.cnpj]);
    r.cnpj = cnpj;
    if (erro) return rejeitar(`${erro}: "${linha[indices.cnpj] ?? ''}"`);
    if (vistos.has(cnpj)) return rejeitar(`CNPJ repetido no arquivo (linha ${vistos.get(cnpj)})`);
    vistos.set(cnpj, numeroLinha);
    r.naBase = prospects.has(cnpj);

    const condCodigo = texto(linha, indices.cond);
    const condDesc = texto(linha, indices.cond_desc);
    const formaCodigo = texto(linha, indices.forma);
    const formaDesc = texto(linha, indices.forma_desc);
    const valor = valorForma(linha, indices);
    const formaBase = formas[normalizarBusca(valor)];
    if (!formaBase) return rejeitar(`forma de pagamento não mapeada: "${valor}"`);
    if (indices.cond !== undefined && !condCodigo) r.avisos.push('sem condição de pagamento no ERP');

    let prazoMedio; let parcelas = null;
    if (condDesc || condCodigo) ({ parcelas, medio: prazoMedio } = analisarCondicao(condCodigo, condDesc));
    else {
      const textoPrazo = texto(linha, indices.prazo);
      prazoMedio = textoPrazo === null ? 0 : Number(String(textoPrazo).replace(/\D+$/, '').replace(',', '.'));
      if (!Number.isInteger(prazoMedio) || prazoMedio < 0) return rejeitar(`prazo de pagamento inválido: "${textoPrazo}" (informe só a quantidade de dias)`);
    }

    const limCnpj = indices.limite_cnpj === undefined ? null : lerValor(linha[indices.limite_cnpj]);
    const limGrupo = indices.limite_grupo === undefined ? null : lerValor(linha[indices.limite_grupo]);
    if (Number.isNaN(limCnpj) || (limCnpj ?? 0) < 0) return rejeitar(`limite de crédito do cliente inválido: "${linha[indices.limite_cnpj]}"`);
    if (Number.isNaN(limGrupo) || (limGrupo ?? 0) < 0) return rejeitar(`limite de crédito do grupo inválido: "${linha[indices.limite_grupo]}"`);
    let limite; let origem;
    const raiz = raizCnpj(cnpj);
    const g = grupos.get(raiz) ?? { valores: new Set(), proprias: 0, doGrupo: 0, linhas: [] };
    grupos.set(raiz, g);
    g.linhas.push(r);
    if (limCnpj !== null) { limite = limCnpj; origem = 'cnpj'; g.proprias++; }
    else if (limGrupo !== null) { limite = limGrupo; origem = 'grupo'; g.doGrupo++; g.valores.add(limGrupo); r.avisos.push('crédito do cliente vazio — vale o limite do grupo (raiz do CNPJ)'); }
    else { limite = 0; origem = 'informado'; r.avisos.push('sem crédito informado (cliente e grupo vazios) — limite 0'); }
    const semLimite = limite >= SEM_LIMITE ? 1 : 0;

    // a forma vem só da Forma Pgto do ERP (o crédito e a condição não a mudam)
    const forma = formaBase;
    const prazo = prazoMedio;
    if (limite === 0 && forma === 'boleto') r.avisos.push('boleto sem crédito no ERP (limite 0)');

    const d = dc;
    if (d.erro || !d.data) return rejeitar(`data de cadastro: ${d.erro ?? 'vazia'}`);
    if (d.data > hoje) return rejeitar(`data de cadastro no futuro: ${d.data}`);
    const codigo = texto(linha, indices.codigo);

    const p = prospects.get(cnpj);
    if (!p) return ignorar('CNPJ não está na base de prospects');
    if (p.status_atual === 'invalido') return rejeitar('CNPJ baixado: impossibilitado de faturamento');
    if (p.status_atual === 'venda_realizada') return ignorar('venda já realizada — o crédito não altera o status');
    if (p.status_atual === 'aguardando_pedido_valido') return ignorar('já teve pedido, aguardando pedido válido — o crédito não altera o status');
    if (p.forma_pagamento === forma && Number(p.prazo_pagamento_dias) === prazo && Number(p.limite_credito) === limite && p.limite_origem === origem
        && (p.cond_pgto_codigo ?? null) === condCodigo && (p.forma_pgto_codigo ?? null) === formaCodigo) {
      return ignorar('crédito já registrado com os mesmos dados');
    }
    const razao = indices.razao === undefined ? null : limparTexto(linha[indices.razao]);
    if (razao && normalizarBusca(razao) !== normalizarBusca(p.razao_social)) r.avisos.push(`razão social diferente da base: "${razao}"`);
    if (inicioCampanha && d.data < inicioCampanha) { r.antesCampanha = true; r.avisos.push(`cadastro anterior ao início da campanha (${d.data}) — já era cliente`); }
    const registraCadastro = STATUS_SEM_CADASTRO.includes(p.status_atual);
    if (registraCadastro) r.avisos.push(`cadastro registrado pelo relatório (${NOME_STATUS[p.status_atual]} → Análise financeira)`);
    r.credito = { prospectId: Number(p.id), forma, prazo, prazoMedio, parcelas, limCnpj, limGrupo, limite, origem, semLimite, dataCadastro: d.data, codigo, registraCadastro,
      condCodigo, condDesc, formaCodigo, formaDesc, observacao: condCodigo || condDesc ? `ERP: cond. ${[condCodigo, condDesc].filter(Boolean).join(' ')}` : null,
      dataLiberacao: p.dt_cadastro_erp && p.dt_cadastro_erp > hoje ? p.dt_cadastro_erp : hoje };
  });

  // grupo (raiz do CNPJ): o Créd. Grupo é um valor global, igual em todas as empresas — valores diferentes são avisados
  let gruposDivergentes = 0; let gruposMistos = 0; let grupos2 = 0;
  for (const g of grupos.values()) {
    if (g.linhas.length >= 2) grupos2++;
    if (g.proprias && g.doGrupo) gruposMistos++;
    if (g.valores.size > 1) {
      gruposDivergentes++;
      const vs = [...g.valores].sort((a, b) => a - b).join(' · ');
      g.linhas.forEach((r) => r.avisos.push(`Créd. Grupo diferente entre empresas da mesma raiz (${vs}) — confira no ERP`));
    }
  }

  const contar = () => ({
    linhasLidas: resultados.length,
    linhasVazias: vazias,
    aceitas: resultados.filter((r) => r.resultado === 'aceita').length,
    rejeitadas: resultados.filter((r) => r.resultado === 'rejeitada').length,
    ignoradas: resultados.filter((r) => r.resultado === 'ignorada').length,
    cadastrosRegistrados: resultados.filter((r) => r.resultado === 'aceita' && r.credito.registraCadastro).length,
    naBase: resultados.filter((r) => r.naBase).length,
    foraBase: resultados.filter((r) => r.naBase === false).length,
    cpf: resultados.filter((r) => r.cpf).length,
    limiteCliente: resultados.filter((r) => r.credito?.origem === 'cnpj' && !r.credito.semLimite && r.credito.limite > 0).length,
    limiteGrupo: resultados.filter((r) => r.credito?.origem === 'grupo' && !r.credito.semLimite && r.credito.limite > 0).length,
    semLimite: resultados.filter((r) => r.credito?.semLimite).length,
    semCredito: resultados.filter((r) => r.credito && r.credito.limite === 0).length,
    antesCampanha: resultados.filter((r) => r.resultado === 'aceita' && r.antesCampanha).length,
    grupos: grupos2, gruposMistos, gruposDivergentes,
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
                                              limite_cnpj, limite_grupo, limite_credito, limite_origem, observacao,
                                              cond_pgto_codigo, cond_pgto_descricao, forma_pgto_codigo, forma_pgto_descricao, prazo_medio_dias, sem_limite, prazo_parcelas)
              VALUES (?, 'importacao', ?, max(?, COALESCE((SELECT dt_cadastro_erp FROM prospects WHERE id = ?), ?)), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [c.prospectId, importacaoId, c.dataLiberacao, c.prospectId, c.dataLiberacao, c.forma, c.prazo, c.limCnpj, c.limGrupo, c.limite, c.origem, c.observacao,
          c.condCodigo, c.condDesc, c.formaCodigo, c.formaDesc, c.prazoMedio, c.semLimite, c.parcelas],
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
