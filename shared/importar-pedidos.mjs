// Importação de pedidos do ERP (relatório do Senior). docs/03 §14 · docs/05 §6
// Cada linha é uma foto do pedido na data do arquivo. Só grava o que mudou desde o arquivo anterior, sempre vinculado ao arquivo.
// Só entram os pedidos dos CNPJs da base. Filial de um grupo da base (mesma raiz) entra só na visão do grupo; CPF e o resto são ignorados.
// O status do cliente muda só no banco (trigger de pedido_aplicacoes); a simulação calcula aqui a mesma regra, para mostrar antes.
import { analisarCnpj } from './cnpj.mjs';
import { analisarData } from './datas.mjs';
import { chaveCabecalho, limparTexto, somenteDigitos } from './texto.mjs';
import { linhaVazia } from './importacao-base.mjs';
import { gravarEmLotes } from './gravacao.mjs';
import { lerValor } from './financeiro.mjs';

/** campo → cabeçalhos aceitos (comparados sem acento, sem pontuação). */
const COLUNAS = Object.freeze({
  cliente: ['Cliente'], razao: ['Razão Social'], documento: ['CPF / CNPJ', 'CNPJ'], valorPedido: ['Vlr. Pedido'], valorFaturado: ['Vlr. Faturado'],
  numero: ['Pedido'], situacao: ['Sit.'], situacaoDescricao: ['Situação'], transacao: ['Transação'], transacaoDescricao: ['Desc. Trans.'], rep: ['Rep.'],
  data: ['Dt. Emissão', 'Data', 'Data Emissão', 'Dt Pedido', 'Data do Pedido'],
});
const OPCIONAIS = ['data'];

export const FASES = Object.freeze({
  digitado: 'Digitado, fora da carteira', carteira: 'Em carteira', parcial: 'Faturado em parte', faturado: 'Faturado', cancelado: 'Cancelado',
});
export const TIPOS_TRANSACAO = Object.freeze({ venda: 'Venda', investimento: 'Investimento', ignorar: 'Não considerar' });
const FASES_VALIDAS = ['carteira', 'parcial', 'faturado'];

/** Número ou texto do Excel → texto, sem o ".0" (112.0 → "112"). */
const codigo = (v) => limparTexto(v)?.replace(/\.0+$/, '') ?? null;

export function localizarColunas(cabecalho) {
  const chaves = (cabecalho ?? []).map(chaveCabecalho);
  const colunas = {};
  const faltando = [];
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = nomes.map(chaveCabecalho).map((n) => chaves.indexOf(n)).find((x) => x >= 0);
    if (i != null) colunas[campo] = i;
    else if (!OPCIONAIS.includes(campo)) faltando.push(nomes[0]);
  }
  if (faltando.length) throw new Error(`este arquivo não é o relatório de pedidos: faltam as colunas ${faltando.join(', ')}. Colunas do arquivo: ${(cabecalho ?? []).filter(Boolean).join(' | ')}`);
  return colunas;
}

/** Só o que depende do arquivo: valida cada linha e lista os códigos encontrados. Não lê o banco. */
export function lerLinhasPedidos(linhas, { dataPadrao = null, hoje = null } = {}) {
  const [cabecalho = [], ...corpo] = linhas;
  const col = localizarColunas(cabecalho);
  const resultados = [];
  const vistos = new Set();
  let vazias = 0;
  corpo.forEach((linha, i) => {
    if (linhaVazia(linha)) { vazias++; return; }
    const bruto = Object.fromEntries(cabecalho.map((t, j) => [String(t ?? `col${j + 1}`), linha[j] ?? null]));
    const r = { numeroLinha: i + 2, bruto, erros: [], avisos: [], resultado: 'aceita' };
    resultados.push(r);
    const rejeitar = (m) => { r.erros.push(m); r.resultado = 'rejeitada'; };
    const dig = somenteDigitos(linha[col.documento]);
    if (dig && dig.length <= 11 && /^[\d.\-/\s]+$/.test(String(linha[col.documento]))) {
      r.documento = dig.padStart(11, '0');
      r.cpf = true;
    } else {
      const { cnpj, erro } = analisarCnpj(linha[col.documento]);
      r.documento = cnpj;
      if (erro) return rejeitar(`${erro}: "${linha[col.documento] ?? ''}"`);
    }
    r.cnpj = r.documento;
    r.numero = codigo(linha[col.numero]);
    if (!r.numero) return rejeitar('número do pedido vazio');
    if (vistos.has(r.numero)) return rejeitar(`pedido ${r.numero} repetido no arquivo`);
    vistos.add(r.numero);
    r.valorPedido = lerValor(linha[col.valorPedido]);
    r.valorFaturado = lerValor(linha[col.valorFaturado]) ?? 0;
    if (r.valorPedido == null || Number.isNaN(r.valorPedido) || r.valorPedido < 0) return rejeitar(`valor do pedido inválido: "${linha[col.valorPedido] ?? ''}"`);
    if (Number.isNaN(r.valorFaturado) || r.valorFaturado < 0) return rejeitar(`valor faturado inválido: "${linha[col.valorFaturado] ?? ''}"`);
    if (r.valorFaturado > r.valorPedido + 0.005) r.avisos.push('faturado maior que o pedido');
    r.situacao = codigo(linha[col.situacao]);
    r.transacao = codigo(linha[col.transacao]);
    if (!r.situacao) return rejeitar('situação vazia');
    if (!r.transacao) return rejeitar('transação vazia');
    r.situacaoDescricao = limparTexto(linha[col.situacaoDescricao]) ?? r.situacao;
    r.transacaoDescricao = limparTexto(linha[col.transacaoDescricao]) ?? r.transacao;
    r.cliente = codigo(linha[col.cliente]);
    r.razao = limparTexto(linha[col.razao]);
    r.rep = codigo(linha[col.rep]);
    const d = col.data !== undefined && linha[col.data] != null && linha[col.data] !== '' ? analisarData(linha[col.data]) : { data: dataPadrao, erro: null };
    if (d.erro || !d.data) return rejeitar(`data: ${d.erro ?? 'informe a data do arquivo'}`);
    if (hoje && d.data > hoje) return rejeitar(`data no futuro: ${d.data}`);
    r.data = d.data;
  });
  return { resultados, vazias, temColunaData: col.data !== undefined };
}

/** Códigos do arquivo sem classificação: a importação para e pergunta, em vez de adivinhar. */
export function codigosNovos(resultados, { transacoes, situacoes }) {
  const novos = { transacoes: new Map(), situacoes: new Map() };
  for (const r of resultados) {
    if (r.resultado !== 'aceita') continue;
    if (!transacoes.has(r.transacao)) novos.transacoes.set(r.transacao, r.transacaoDescricao);
    if (!situacoes.has(r.situacao)) novos.situacoes.set(r.situacao, r.situacaoDescricao);
  }
  return { transacoes: [...novos.transacoes].map(([codigo, descricao]) => ({ codigo, descricao })), situacoes: [...novos.situacoes].map(([codigo, descricao]) => ({ codigo, descricao })) };
}

export async function lerClassificacao(db) {
  const [t, s] = await Promise.all([db.execute('SELECT codigo, descricao, conta_como FROM pedido_transacoes ORDER BY codigo'),
    db.execute('SELECT codigo, descricao, conta_como, ordem FROM pedido_situacoes ORDER BY ordem, codigo')]);
  return { transacoes: new Map(t.rows.map((r) => [String(r.codigo), r])), situacoes: new Map(s.rows.map((r) => [String(r.codigo), r])) };
}

/** Grava a classificação escolhida na tela. listas: [{ codigo, descricao, conta_como }]. */
export async function salvarClassificacao(db, { transacoes = [], situacoes = [] }) {
  const comandos = [
    ...transacoes.map((c) => ({ sql: `INSERT INTO pedido_transacoes (codigo, descricao, conta_como) VALUES (?, ?, ?)
                                       ON CONFLICT (codigo) DO UPDATE SET descricao = excluded.descricao, conta_como = excluded.conta_como`, args: [c.codigo, c.descricao, c.conta_como] })),
    ...situacoes.map((c) => ({ sql: `INSERT INTO pedido_situacoes (codigo, descricao, conta_como) VALUES (?, ?, ?)
                                      ON CONFLICT (codigo) DO UPDATE SET descricao = excluded.descricao, conta_como = excluded.conta_como`, args: [c.codigo, c.descricao, c.conta_como] })),
  ];
  if (comandos.length) await db.batch(comandos, 'write');
}

const classificar = (mapa, transacao, situacao) => {
  const tipo = mapa.transacoes.get(String(transacao))?.conta_como ?? 'ignorar';
  const fase = mapa.situacoes.get(String(situacao))?.conta_como ?? 'cancelado';
  return { tipo, fase, valida: tipo === 'venda' && FASES_VALIDAS.includes(fase) };
};

/** Status do cliente depois do arquivo — a mesma regra do trigger trg_pedido_aplicacoes_aplicar (teste confere as duas). */
export function statusDepois(statusAtual, pedidos) {
  if (statusAtual === 'invalido' || statusAtual === 'expurgado') return statusAtual;
  if (pedidos.some((p) => p.valida)) return 'venda_realizada';
  if (pedidos.some((p) => p.tipo === 'venda')) return 'aguardando_pedido_valido';
  return statusAtual;
}

/**
 * Cruza o arquivo com a base: destino de cada linha, efeito em cada cliente e os totais. Não grava nada.
 * @returns { resultados, resumo, totais, clientes, movimentos, pontos, sumiram, classificacao }
 */
export async function simularPedidos(db, { linhas, dataPadrao, hoje, classificacao = null }) {
  const { resultados, vazias } = lerLinhasPedidos(linhas, { dataPadrao, hoje });
  const mapa = classificacao ?? await lerClassificacao(db);
  const [base, atuais, usuarios, parametros] = await Promise.all([
    db.execute('SELECT id, cnpj, cnpj_raiz, status_atual, vendedor_id, codigo_cliente_erp FROM prospects'),
    db.execute(`SELECT numero, prospect_id, transacao_codigo, situacao_codigo, rep_codigo, valor_pedido, valor_faturado, tipo, fase, valida FROM vw_pedidos`),
    db.execute("SELECT id, codigo_erp, nome, perfil FROM usuarios WHERE codigo_erp IS NOT NULL AND perfil IN ('vendedor','supervisor') ORDER BY perfil = 'vendedor'"),
    db.execute("SELECT valor FROM parametros WHERE chave = 'alerta_desistencias_cliente'"),
  ]);
  const prospects = new Map(base.rows.map((p) => [String(p.cnpj), p]));
  const raizes = new Set(base.rows.map((p) => String(p.cnpj_raiz)));
  const anteriores = new Map(atuais.rows.map((p) => [String(p.numero), p]));
  const reps = new Map(usuarios.rows.map((u) => [String(u.codigo_erp), u]));   // vendedor por último: prevalece sobre o supervisor de mesmo código
  // pedidos atuais por cliente: o que já estava na base, com o arquivo por cima
  const porCliente = new Map();
  const pedidosDe = (id) => { if (!porCliente.has(id)) porCliente.set(id, new Map()); return porCliente.get(id); };
  for (const p of atuais.rows) if (p.prospect_id != null) pedidosDe(Number(p.prospect_id)).set(String(p.numero), { tipo: p.tipo, fase: p.fase, valida: Number(p.valida) === 1 });

  const afetados = new Set();
  const clientes = new Map();
  const naoEncontrados = new Set();
  const totais = { venda: { qtd: 0, valor: 0, faturado: 0 }, digitado: { qtd: 0, valor: 0 }, cancelado: { qtd: 0, valor: 0 }, investimento: { qtd: 0, valor: 0 }, ignorado: { qtd: 0, valor: 0 }, grupo: { qtd: 0, valor: 0 }, saldo: 0 };
  const foraDaBase = { linhas: 0, valor: 0, documentos: new Set() };
  const reconhecidos = new Set();
  for (const r of resultados) {
    if (r.resultado !== 'aceita') continue;
    const p = r.cpf ? null : prospects.get(r.documento) ?? null;
    if (p?.status_atual === 'invalido') { r.erros.push('CNPJ baixado: impossibilitado de faturamento'); r.resultado = 'rejeitada'; continue; }
    // só interessa quem está na base: CPF e CNPJ de fora são ignorados e entram só na contagem
    r.filial = !r.cpf && !p && raizes.has(r.documento.slice(0, 8));
    if (!p && !r.filial) {
      r.erros.push(r.cpf ? 'CPF: fora da base' : 'CNPJ fora da base');
      r.resultado = 'ignorada';
      foraDaBase.linhas++; foraDaBase.valor += r.valorPedido; foraDaBase.documentos.add(r.documento);
      continue;
    }
    r.prospectId = p ? Number(p.id) : null;
    const c = classificar(mapa, r.transacao, r.situacao);
    Object.assign(r, c);
    reconhecidos.add(r.numero);
    // destino da linha
    if (r.filial) r.avisos.push('filial de grupo da base, com outro CNPJ: só entra na visão do grupo');
    else if (p.status_atual === 'expurgado') r.avisos.push('cliente expurgado: o pedido só fica registrado');
    if (!r.filial && r.rep && !reps.has(r.rep)) { r.avisos.push(`representante ${r.rep} sem código no cadastro`); naoEncontrados.add(r.rep); }
    if (p?.codigo_cliente_erp && r.cliente && String(p.codigo_cliente_erp) !== r.cliente) r.avisos.push(`código do cliente diferente do cadastro (${p.codigo_cliente_erp})`);
    // totais do arquivo: só os clientes da base; a filial fica à parte, na visão do grupo
    if (r.filial) { totais.grupo.qtd++; totais.grupo.valor += r.valorPedido; }
    else if (c.tipo === 'investimento') { totais.investimento.qtd++; totais.investimento.valor += r.valorPedido; }
    else if (c.tipo === 'ignorar') { totais.ignorado.qtd++; totais.ignorado.valor += r.valorPedido; }
    else if (c.valida) { totais.venda.qtd++; totais.venda.valor += r.valorPedido; totais.venda.faturado += r.valorFaturado; totais.saldo += Math.max(r.valorPedido - r.valorFaturado, 0); }
    else if (c.fase === 'digitado') { totais.digitado.qtd++; totais.digitado.valor += r.valorPedido; }
    else { totais.cancelado.qtd++; totais.cancelado.valor += r.valorPedido; }
    // resumo por cliente do arquivo (tela de vínculo)
    if (!clientes.has(r.documento)) clientes.set(r.documento, { documento: r.documento, razao: r.razao, cliente: r.cliente, prospectId: r.prospectId, statusAtual: p?.status_atual ?? null,
      filial: r.filial, validos: 0, digitados: 0, desistencias: 0, venda: 0, investimento: 0, reps: new Set() });
    const k = clientes.get(r.documento);
    if (r.rep) k.reps.add(r.rep);
    if (c.tipo === 'investimento') k.investimento += r.valorPedido;
    else if (c.valida) { k.validos++; k.venda += r.valorPedido; }
    else if (c.tipo === 'venda' && c.fase === 'digitado') k.digitados++;
    else if (c.tipo === 'venda') k.desistencias++;
    // nada mudou desde o arquivo anterior: não grava
    const a = anteriores.get(r.numero);
    const igual = a && String(a.transacao_codigo) === r.transacao && String(a.situacao_codigo) === r.situacao && String(a.rep_codigo ?? '') === String(r.rep ?? '')
      && Math.abs(Number(a.valor_pedido) - r.valorPedido) < 0.005 && Math.abs(Number(a.valor_faturado) - r.valorFaturado) < 0.005
      && (a.prospect_id == null ? null : Number(a.prospect_id)) === r.prospectId;
    if (igual) { r.erros.push('pedido sem mudança desde o arquivo anterior'); r.resultado = 'ignorada'; continue; }
    r.mudou = a ? `${a.situacao_codigo} → ${r.situacao}` : null;
    if (r.prospectId != null) {
      afetados.add(r.prospectId);
      pedidosDe(r.prospectId).set(r.numero, c);
      // pedido que mudou de cliente (CNPJ corrigido no ERP): reavalia também o cliente anterior
      if (a?.prospect_id != null && Number(a.prospect_id) !== r.prospectId) { pedidosDe(Number(a.prospect_id)).delete(r.numero); afetados.add(Number(a.prospect_id)); }
    }
  }
  // depois do filtro: código novo de quem está fora da base não trava a importação
  const novos = codigosNovos(resultados, mapa);
  // efeito em cada cliente da base
  const statusPorId = new Map(base.rows.map((p) => [Number(p.id), String(p.status_atual)]));
  const movimentos = new Map();
  for (const id of afetados) {
    const antes = statusPorId.get(id);
    const depois = statusDepois(antes, [...pedidosDe(id).values()]);
    if (antes === depois) continue;
    const chave = `${antes}→${depois}`;
    movimentos.set(chave, { antes, depois, clientes: (movimentos.get(chave)?.clientes ?? 0) + 1 });
  }
  // pedidos em aberto que vieram antes e não vieram agora: não assume cancelamento (o relatório pode ter outro filtro)
  const sumiram = atuais.rows.filter((p) => p.prospect_id != null && !reconhecidos.has(String(p.numero)) && ['digitado', 'carteira', 'parcial'].includes(p.fase)).length;

  const lista = [...clientes.values()].map((c) => ({ ...c, reps: [...c.reps].sort((a, b) => Number(a) - Number(b)) })).sort((a, b) => b.venda - a.venda);
  const nomeRep = (cod) => reps.get(String(cod))?.nome ?? null;
  const limiteDesistencia = Number(parametros.rows[0]?.valor ?? 5);
  const pontos = {
    variosRepresentantes: lista.filter((c) => !c.filial && c.reps.length > 1).length,
    semCodigo: [...naoEncontrados].sort((a, b) => Number(a) - Number(b)),
    soBonificacao: lista.filter((c) => !c.filial && c.investimento > 0 && !c.validos && !c.digitados && !c.desistencias),
    muitaDesistencia: lista.filter((c) => !c.filial && c.desistencias >= limiteDesistencia),
    filiais: lista.filter((c) => c.filial),
    foraDaBase: { linhas: foraDaBase.linhas, valor: foraDaBase.valor, clientes: foraDaBase.documentos.size },
  };
  const contar = () => ({
    linhasLidas: resultados.length, linhasVazias: vazias,
    aceitas: resultados.filter((r) => r.resultado === 'aceita').length,
    rejeitadas: resultados.filter((r) => r.resultado === 'rejeitada').length,
    ignoradas: resultados.filter((r) => r.resultado === 'ignorada').length,
  });
  return { resultados, resumo: contar(), totais, clientes: lista, movimentos: [...movimentos.values()], pontos, sumiram, novos, afetados: [...afetados], nomeRep, classificacao: mapa };
}

/** Grava o arquivo: importação, pedidos que mudaram, efeito em cada cliente e o relatório de todas as linhas. */
export async function gravarPedidos(db, { linhas, dataPadrao, hoje, arquivoNome, arquivoSha256, executadoPor, classificacao = null, aoProgredir = null }) {
  // a classificação escolhida na tela só vale a partir daqui: até a confirmação, nada é gravado
  if (classificacao) await salvarClassificacao(db, { transacoes: [...classificacao.transacoes.values()], situacoes: [...classificacao.situacoes.values()] });
  const sim = await simularPedidos(db, { linhas, dataPadrao, hoje, classificacao });
  if (sim.novos.transacoes.length || sim.novos.situacoes.length) throw new Error('classifique os códigos novos do ERP antes de gravar');
  const imp = await db.execute({
    sql: 'INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por, observacao) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: ['pedido_erp', arquivoNome, arquivoSha256, executadoPor, JSON.stringify({ dataPadrao, modelo: 'pedidos', vazias: sim.resumo.linhasVazias })],
  });
  const importacaoId = Number(imp.rows[0].id);
  await db.execute({ sql: 'INSERT INTO pedido_importacoes (importacao_id, data_referencia) VALUES (?, ?)', args: [importacaoId, dataPadrao] });
  try {
    const aGravar = sim.resultados.filter((r) => r.resultado === 'aceita');
    const g = await gravarEmLotes(db, aGravar, (r) => [{
      sql: `INSERT INTO pedidos_erp (numero, importacao_id, data_situacao, cpf_cnpj, prospect_id, codigo_cliente, razao_social, transacao_codigo, situacao_codigo, rep_codigo, valor_pedido, valor_faturado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [r.numero, importacaoId, r.data, r.documento, r.prospectId, r.cliente, r.razao, r.transacao, r.situacao, r.rep, r.valorPedido, r.valorFaturado],
    }], { aoProgredir });
    g.forEach((x, i) => { if (!x.ok) { aGravar[i].erros.push(`banco recusou: ${x.erro}`); aGravar[i].resultado = 'rejeitada'; } });
    // depois de todos os pedidos: o status olha o conjunto do cliente, não cada linha
    const gravados = new Set(aGravar.filter((r) => r.resultado === 'aceita').map((r) => r.prospectId).filter((id) => id != null));
    for (const id of sim.afetados) gravados.add(id);
    const aplicacoes = [...gravados].map((prospectId) => ({ sql: 'INSERT INTO pedido_aplicacoes (importacao_id, prospect_id, data_evento) VALUES (?, ?, ?)', args: [importacaoId, prospectId, dataPadrao] }));
    for (let i = 0; i < aplicacoes.length; i += 100) await db.batch(aplicacoes.slice(i, i + 100), 'write');
    const registros = sim.resultados.map((r) => ({
      sql: 'INSERT INTO importacao_linhas (importacao_id, numero_linha, cnpj, resultado, mensagens, dados_brutos) VALUES (?, ?, ?, ?, ?, ?)',
      args: [importacaoId, r.numeroLinha, r.documento ?? null, r.resultado, JSON.stringify(r.resultado === 'aceita' ? r.avisos : r.erros), JSON.stringify(r.bruto, (_, v) => v ?? null)],
    }));
    for (let i = 0; i < registros.length; i += 200) await db.batch(registros.slice(i, i + 200), 'write');
    const resumo = {
      linhasLidas: sim.resultados.length, linhasVazias: sim.resumo.linhasVazias,
      aceitas: sim.resultados.filter((r) => r.resultado === 'aceita').length,
      rejeitadas: sim.resultados.filter((r) => r.resultado === 'rejeitada').length,
      ignoradas: sim.resultados.filter((r) => r.resultado === 'ignorada').length,
    };
    await db.execute({
      sql: `UPDATE importacoes SET situacao = 'concluida', concluido_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              linhas_lidas = ?, linhas_aceitas = ?, linhas_rejeitadas = ?, linhas_ignoradas = ? WHERE id = ?`,
      args: [resumo.linhasLidas, resumo.aceitas, resumo.rejeitadas, resumo.ignoradas, importacaoId],
    });
    return { ...sim, resumo, importacaoId };
  } catch (e) {
    await db.execute({ sql: `UPDATE importacoes SET situacao = 'falhou', observacao = ? WHERE id = ?`, args: [String(e.message), importacaoId] });
    throw e;
  }
}

/** Arquivos de pedidos, do mais novo ao mais antigo. Só o mais novo ainda ativo pode ser apagado. */
export async function listarArquivosPedidos(db) {
  const r = await db.execute(`SELECT i.id, i.arquivo_nome, i.executado_por, i.iniciado_em, i.situacao, i.linhas_lidas, i.linhas_aceitas, pi.data_referencia, pi.apagada_em, pi.apagada_por,
                                     (SELECT COUNT(*) FROM pedido_aplicacoes a WHERE a.importacao_id = i.id AND a.status_novo <> a.status_anterior) AS clientes_afetados,
                                     e.qtd_pedidos AS apagados_pedidos, e.qtd_clientes AS apagados_clientes
                                FROM pedido_importacoes pi JOIN importacoes i ON i.id = pi.importacao_id
                                LEFT JOIN pedido_exclusoes e ON e.importacao_id = i.id
                               ORDER BY i.id DESC`);
  const maisNovo = r.rows.find((a) => !a.apagada_em)?.id;
  return r.rows.map((a) => ({ ...a, pode_apagar: !a.apagada_em && a.id === maisNovo }));
}

/** O que sairá com o arquivo: pedidos desta importação por classe. Totais vêm do que foi gravado, não da posição atual. */
export async function conferirExclusao(db, importacaoId) {
  const r = await db.execute({
    sql: `SELECT t.conta_como AS tipo, s.conta_como AS fase, COUNT(*) AS qtd, SUM(p.valor_pedido) AS valor
            FROM pedidos_erp p JOIN pedido_transacoes t ON t.codigo = p.transacao_codigo JOIN pedido_situacoes s ON s.codigo = p.situacao_codigo
           WHERE p.importacao_id = ? GROUP BY 1, 2`,
    args: [importacaoId],
  });
  const soma = (filtro) => r.rows.filter(filtro).reduce((acc, l) => ({ qtd: acc.qtd + Number(l.qtd), valor: acc.valor + Number(l.valor) }), { qtd: 0, valor: 0 });
  return {
    total: soma(() => true),
    venda: soma((l) => l.tipo === 'venda' && FASES_VALIDAS.includes(l.fase)),
    digitado: soma((l) => l.tipo === 'venda' && l.fase === 'digitado'),
    cancelado: soma((l) => l.tipo === 'venda' && l.fase === 'cancelado'),
    investimento: soma((l) => l.tipo === 'investimento'),
  };
}

/** Apaga os dados de um arquivo. A regra está no banco (trigger de pedido_exclusoes): administrador, do mais novo para o mais antigo. */
export async function apagarArquivoPedidos(db, { importacaoId, usuarioId }) {
  await db.execute({ sql: 'INSERT INTO pedido_exclusoes (importacao_id, usuario_id) VALUES (?, ?)', args: [importacaoId, usuarioId] });
}
