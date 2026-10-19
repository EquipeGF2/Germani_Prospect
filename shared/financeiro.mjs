// Análise financeira → Aguardando pedido. docs/03-regras-negocio.md §8
// Duas possibilidades (ambas gravam em liberacoes_credito e no histórico de movimentação):
//   * CONSOLE do analista (este módulo): forma de pagamento, prazo em dias, restrição sim/não e limite;
//   * RELATÓRIO DE CRÉDITO do ERP: shared/importar-credito.mjs.
// A liberação sempre ocorre. O banco confere tudo de novo (trg_liberacoes_validar).

export const FORMAS_PAGAMENTO = Object.freeze({ antecipado: 'Antecipado', a_vista: 'À vista', boleto: 'Boleto' });

/** "15.000,00" | "15000.5" | 15000 → número; vazio → null; inválido → NaN */
export function lerValor(v) {
  if (v == null || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/R\$\s*/i, '').replace(/\s/g, '');
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}

function exigirAnalista(usuario) {
  if (!['financeiro', 'administrador'].includes(usuario?.perfil)) throw new Error('somente o analista financeiro ou o administrador libera crédito');
}

/** Fila do console: clientes em análise, mais antigos primeiro, com dias em análise e prazo vencido. */
export function consultaFilaAnalise({ usuario, filtros = {}, incluirLiberados = false }) {
  exigirAnalista(usuario);
  const where = [incluirLiberados ? "status_atual IN ('analise_financeira','aguardando_pedido')" : "status_atual = 'analise_financeira'"];
  const args = [];
  if (filtros.supervisorId) { where.push('supervisor_id = ?'); args.push(filtros.supervisorId); }
  if (filtros.vendedorId) { where.push('vendedor_id = ?'); args.push(filtros.vendedorId); }
  if (filtros.cidadeBusca) { where.push('cidade_busca = ?'); args.push(filtros.cidadeBusca); }
  return {
    sql: `SELECT id, cnpj, razao_social, nome_fantasia, cidade, uf, telefone, vendedor_nome, supervisor_nome,
                 codigo_cliente_erp, dt_cadastro_erp, analise_financeira_ate, analise_financeira_vencida,
                 CAST(julianday(date('now','-3 hours')) - julianday(dt_cadastro_erp) AS INTEGER) AS dias_em_analise,
                 status_atual, status_nome, forma_pagamento, prazo_pagamento_dias, limite_credito, limite_credito_origem,
                 com_restricao_credito, dt_liberacao_credito, dias_corridos
            FROM vw_prospects WHERE ${where.join(' AND ')}
           ORDER BY status_atual = 'aguardando_pedido', dt_cadastro_erp, razao_social`,
    args,
  };
}

/** Valida o formulário do console (mesmas regras do banco). */
export function validarLiberacao({ formaPagamento, prazoDias, comRestricao, limiteCredito, dataLiberacao }) {
  const erros = [];
  const limite = lerValor(limiteCredito);
  const prazo = prazoDias == null || String(prazoDias).trim() === '' ? 0 : Number(prazoDias);
  if (!FORMAS_PAGAMENTO[formaPagamento]) erros.push('informe a forma de pagamento: antecipado, à vista ou boleto');
  if (!Number.isInteger(prazo) || prazo < 0) erros.push('prazo de pagamento: quantidade de dias (inteiro ≥ 0)');
  if (typeof comRestricao !== 'boolean') erros.push('informe se a liberação tem restrição de crédito');
  if (limite === null || Number.isNaN(limite) || limite < 0) erros.push('informe o limite de crédito (R$)');
  else if (formaPagamento === 'boleto' && limite === 0) erros.push('boleto exige limite maior que zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLiberacao ?? '')) erros.push('data da liberação obrigatória');
  return { erros, limite, prazo };
}

/** Comando de liberação pelo console (OK do analista). */
export function comandoLiberarCredito({ usuario, prospectId, formaPagamento, prazoDias, comRestricao, limiteCredito, dataLiberacao, observacao = null }) {
  exigirAnalista(usuario);
  const { erros, limite, prazo } = validarLiberacao({ formaPagamento, prazoDias, comRestricao, limiteCredito, dataLiberacao });
  if (erros.length) throw new Error(erros.join('; '));
  return {
    sql: `INSERT INTO liberacoes_credito (prospect_id, origem, usuario_id, data_liberacao, forma_pagamento, prazo_pagamento_dias,
                                          limite_credito, limite_origem, com_restricao, observacao)
          VALUES (?, 'console', ?, ?, ?, ?, ?, 'informado', ?, ?)`,
    args: [prospectId, usuario.id, dataLiberacao, formaPagamento, prazo, limite, comRestricao ? 1 : 0, observacao?.trim() || null],
  };
}
