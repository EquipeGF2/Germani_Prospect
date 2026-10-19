// Console do analista financeiro. docs/03-regras-negocio.md §8
// Fila: clientes em "Análise financeira" (o arquivo de cadastro do ERP foi importado).
// O analista informa o limite de crédito liberado e a condição (a prazo / à vista) → "Aguardando pedido".
// O banco confere tudo de novo (trg_liberacoes_validar) e grava o movimento no histórico.

export const CONDICOES = Object.freeze({ a_prazo: 'Liberado a prazo', a_vista: 'Liberado à vista' });

function exigirAnalista(usuario) {
  if (!['financeiro', 'administrador'].includes(usuario?.perfil)) throw new Error('somente o analista financeiro ou o administrador libera crédito');
}

/** Fila do console: mais antigos primeiro, com dias em análise e prazo vencido. */
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
                 status_atual, status_nome, limite_credito, condicao_pagamento, dt_liberacao_credito, dias_corridos
            FROM vw_prospects WHERE ${where.join(' AND ')}
           ORDER BY status_atual = 'aguardando_pedido', dt_cadastro_erp, razao_social`,
    args,
  };
}

/** Valida o formulário de liberação (mesmas regras do banco). */
export function validarLiberacao({ limiteCredito, condicaoPagamento, dataLiberacao }) {
  const erros = [];
  const valor = typeof limiteCredito === 'string' ? Number(limiteCredito.replace(/\./g, '').replace(',', '.')) : Number(limiteCredito);
  if (!Number.isFinite(valor) || valor <= 0) erros.push('informe o limite de crédito liberado (maior que zero)');
  if (!CONDICOES[condicaoPagamento]) erros.push('informe se foi liberado a prazo ou à vista');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLiberacao ?? '')) erros.push('data da liberação obrigatória');
  return { erros, valor };
}

/** Comando de liberação (OK do analista). */
export function comandoLiberarCredito({ usuario, prospectId, limiteCredito, condicaoPagamento, dataLiberacao, observacao = null }) {
  exigirAnalista(usuario);
  const { erros, valor } = validarLiberacao({ limiteCredito, condicaoPagamento, dataLiberacao });
  if (erros.length) throw new Error(erros.join('; '));
  return {
    sql: `INSERT INTO liberacoes_credito (prospect_id, usuario_id, data_liberacao, limite_credito, condicao_pagamento, observacao)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [prospectId, usuario.id, dataLiberacao, valor, condicaoPagamento, observacao?.trim() || null],
  };
}
