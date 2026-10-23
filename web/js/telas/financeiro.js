// Console de crédito (analista financeiro / administrador). docs/03 §8.2
// Fila de Análise financeira (mais antigos primeiro) e liberados aguardando pedido (para correção).
import { bancoApp } from '../db.js';
import { consultaFilaAnalise, FORMAS_PAGAMENTO } from '../../shared/financeiro.mjs';
import { normalizarBusca } from '../../shared/texto.mjs';
import { h, montar, mensagem, formatar, cartoesFiltro, tabela, selo } from '../ui.js';

// os cards são o filtro: em análise · fora do prazo (em análise vencidos) · liberados aguardando pedido
const ABAS = ['analise', 'vencidos', 'liberados'];

export function descreverCredito(p) {
  const forma = p.forma_filtro ?? p.forma_pagamento;
  if (!forma) return '';
  const partes = [FORMAS_PAGAMENTO[forma] ?? forma];
  if (Number(p.prazo_pagamento_dias)) partes.push(`${p.prazo_pagamento_dias} dias`);
  if (p.limite_credito != null) partes.push(`${formatar.moeda(p.limite_credito)}${p.limite_credito_origem === 'grupo' ? ' (grupo)' : ''}`);
  if (Number(p.com_restricao_credito)) partes.push('com restrição');
  return partes.join(' · ');
}

export async function render(conteudo, { usuario, parametros }) {
  const db = await bancoApp();
  const aba = ABAS.includes(parametros.get('aba')) ? parametros.get('aba') : 'analise';
  const busca = parametros.get('busca') ?? '';
  const todos = (await db.execute(consultaFilaAnalise({ usuario, incluirLiberados: true }))).rows;
  const emAnalise = todos.filter((p) => p.status_atual === 'analise_financeira');
  const liberados = todos.filter((p) => p.status_atual === 'aguardando_pedido')
    .sort((a, b) => String(b.dt_liberacao_credito).localeCompare(String(a.dt_liberacao_credito)));   // mais recentes primeiro
  const vencidos = emAnalise.filter((p) => Number(p.analise_financeira_vencida)).length;
  const termo = normalizarBusca(busca);
  const termoCnpj = termo.replace(/[.\-\/\s]/g, '');
  const daAba = { analise: emAnalise, vencidos: emAnalise.filter((p) => Number(p.analise_financeira_vencida)), liberados }[aba];
  const linhas = daAba.filter((p) => !termo
    || normalizarBusca(`${p.razao_social} ${p.nome_fantasia ?? ''} ${p.cidade ?? ''} ${p.vendedor_nome}`).includes(termo)
    || (termoCnpj && String(p.cnpj).startsWith(termoCnpj)) || String(p.codigo_cliente_erp ?? '') === busca.trim());

  const campo = h('input', { type: 'search', id: 'busca-fin', value: busca, placeholder: 'Cliente, CNPJ, cód. ERP, cidade ou vendedor', 'aria-label': 'Buscar cliente' });
  const endereco = (muda) => {
    const q = new URLSearchParams({ aba, busca, ...muda });
    if (q.get('aba') === 'analise') q.delete('aba');
    if (!q.get('busca')) q.delete('busca');
    const s = q.toString();
    return `#/financeiro${s ? '?' + s : ''}`;
  };

  const colunas = [
    { titulo: 'Cliente', valor: (p) => h('div', {}, h('a', { href: `#/ficha?id=${p.id}` }, h('b', {}, p.razao_social)),
      h('div', { class: 'ajuda', style: 'margin:2px 0 0' }, `${formatar.cnpj(p.cnpj)}${p.codigo_cliente_erp ? ' · cód. ' + p.codigo_cliente_erp : ''} · ${p.cidade ?? ''}${p.uf ? '/' + p.uf : ''}`)) },
    { titulo: 'Carteira', valor: (p) => h('div', {}, p.vendedor_nome, h('div', { class: 'ajuda', style: 'margin:0' }, p.supervisor_nome ?? '')) },
    { titulo: 'Cadastro ERP', valor: (p) => formatar.data(p.dt_cadastro_erp) },
  ];
  if (aba !== 'liberados') {
    colunas.push(
      { titulo: 'Dias em análise', classe: 'num', valor: (p) => (Number(p.analise_financeira_vencida)
        ? selo(`${p.dias_em_analise} · vencido`, 'erro') : selo(String(p.dias_em_analise ?? 0), 'ok')) },
      { titulo: 'Prazo', valor: (p) => formatar.data(p.analise_financeira_ate) },
      { titulo: '', valor: (p) => h('a', { class: 'botao pequeno', href: `#/financeiro/liberar?id=${p.id}` }, 'Liberar crédito') });
  } else {
    colunas.push(
      { titulo: 'Liberado em', valor: (p) => formatar.data(p.dt_liberacao_credito) },
      { titulo: 'Condição', valor: (p) => descreverCredito(p) },
      { titulo: '', valor: (p) => h('a', { class: 'botao secundario pequeno', href: `#/financeiro/liberar?id=${p.id}` }, 'Corrigir') });
  }

  montar(conteudo,
    h('h1', {}, 'Console de crédito'),
    h('p', { class: 'ajuda' }, 'Clientes cadastrados no ERP aguardando o OK do financeiro. A liberação sempre ocorre: informe a condição (antecipado, à vista ou boleto), o prazo, o limite e se há restrição. O cliente passa para Aguardando pedido. O relatório de crédito do ERP faz o mesmo em lote.'),
    // cards (que são o filtro) e busca numa linha só; a lista fica com o destaque
    h('div', { class: 'barra-console' },
      cartoesFiltro([
        { chave: 'analise', rotulo: 'em análise', valor: emAnalise.length, tipo: emAnalise.length ? 'alerta' : '', ativo: aba === 'analise', href: endereco({ aba: 'analise' }) },
        { chave: 'vencidos', rotulo: 'fora do prazo', valor: vencidos, tipo: vencidos ? 'erro' : '', ativo: aba === 'vencidos', href: endereco({ aba: 'vencidos' }) },
        { chave: 'liberados', rotulo: 'liberados aguardando pedido', valor: liberados.length, tipo: 'ok', ativo: aba === 'liberados', href: endereco({ aba: 'liberados' }) }]),
      h('form', { class: 'barra-busca', onsubmit: (ev) => { ev.preventDefault(); location.hash = endereco({ busca: campo.value.trim() }); } },
        campo, h('button', { type: 'submit' }, 'Buscar'))),
    linhas.length ? tabela(colunas, linhas)
      : mensagem(busca ? `Nada encontrado para "${busca}".` : { analise: 'Nenhum cliente aguardando análise.', vencidos: 'Nenhum cliente fora do prazo.', liberados: 'Nenhum cliente liberado aguardando pedido.' }[aba], 'info'));
}
