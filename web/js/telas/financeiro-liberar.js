// OK do analista: forma de pagamento, prazo, limite e restrição → Aguardando pedido. docs/03 §8.2
// Em "Aguardando pedido" a mesma tela grava uma nova liberação (correção); nada é apagado.
import { bancoApp } from '../db.js';
import { consultaFicha } from '../../shared/carteira.mjs';
import { comandoLiberarCredito, FORMAS_PAGAMENTO, validarLiberacao } from '../../shared/financeiro.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { mensagemErro } from '../../shared/gravacao.mjs';
import { h, montar, mensagem, aviso, comEspera, formatar } from '../ui.js';
import { seloStatus } from './_carteira.js';
import { descreverCredito } from './financeiro.js';

const AJUDA_FORMA = { antecipado: 'pagamento antes do faturamento', a_vista: 'pagamento na entrega', boleto: 'a prazo — exige limite', deposito: 'depósito bancário ou Pix' };

function opcoes(nome, itens, aoMudar, classe = '') {
  return h('div', { class: `opcoes-resultado ${classe}`, role: 'radiogroup' }, itens.map(([valor, rotulo, detalhe]) => h('label', { class: 'opcao' },
    h('input', { type: 'radio', name: nome, value: valor, onchange: () => aoMudar(valor) }),
    h('span', {}, rotulo, detalhe ? h('small', { class: 'ajuda', style: 'display:block;margin:0' }, detalhe) : null))));
}

export async function render(conteudo, { usuario, parametros, irPara }) {
  const db = await bancoApp();
  const id = Number(parametros.get('id'));
  const p = id ? (await db.execute(consultaFicha({ usuario, prospectId: id }))).rows[0] : null;
  if (!p) return montar(conteudo, mensagem('Cliente não encontrado.', 'erro'));
  if (!['analise_financeira', 'aguardando_pedido'].includes(p.status_atual)) {
    return montar(conteudo, mensagem(`${p.status_nome}: só clientes em Análise financeira (ou Aguardando pedido, para correção) recebem liberação.`, 'info'),
      h('a', { href: '#/financeiro' }, '‹ Voltar ao console'));
  }
  const correcao = p.status_atual === 'aguardando_pedido';
  const hoje = hojeSaoPaulo();
  let forma = '';
  let restricao = null;
  const prazo = h('input', { type: 'number', id: 'prazo', min: 0, step: 1, inputmode: 'numeric', value: '0' });
  const limite = h('input', { id: 'limite', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off' });
  const data = h('input', { type: 'date', id: 'data-liberacao', value: hoje, max: hoje, min: p.dt_cadastro_erp ?? null });
  const observacao = h('textarea', { id: 'obs-liberacao', rows: 2, maxlength: 500, placeholder: 'Opcional' });
  const erros = h('div');
  const botao = h('button', { type: 'submit' }, correcao ? 'Gravar nova liberação' : 'Liberar crédito');

  async function gravar(ev) {
    ev.preventDefault();
    const dados = { formaPagamento: forma, prazoDias: prazo.value, comRestricao: restricao, limiteCredito: limite.value, dataLiberacao: data.value };
    const lista = validarLiberacao(dados).erros;
    if (data.value > hoje) lista.push('a data da liberação não pode ser futura');
    if (p.dt_cadastro_erp && data.value < p.dt_cadastro_erp) lista.push(`a data não pode ser anterior ao cadastro no ERP (${formatar.data(p.dt_cadastro_erp)})`);
    montar(erros, lista.length ? mensagem(lista.join('; '), 'erro') : null);
    if (lista.length) return;
    const ok = await comEspera(botao, async () => {
      try { await db.execute(comandoLiberarCredito({ usuario, prospectId: id, ...dados, observacao: observacao.value })); }
      catch (e) { throw new Error(mensagemErro(e)); }
      return true;
    });
    if (ok) { aviso(`Crédito liberado: ${p.razao_social} passou para Aguardando pedido.`); irPara('/financeiro'); }
  }

  montar(conteudo,
    h('a', { href: '#/financeiro', class: 'voltar' }, '‹ Voltar ao console'),
    h('h1', { style: 'margin-top:8px' }, correcao ? 'Corrigir liberação de crédito' : 'Liberar crédito'),
    h('div', { class: 'cartao' },
      h('div', { class: 'cartao-prospect-topo' }, h('a', { href: `#/ficha?id=${id}` }, h('b', {}, p.razao_social)), seloStatus(p)),
      h('div', { class: 'ajuda', style: 'margin:4px 0 0' },
        `${formatar.cnpj(p.cnpj)}${p.codigo_cliente_erp ? ' · cód. ' + p.codigo_cliente_erp : ''} · ${p.cidade ?? ''} · carteira ${p.vendedor_nome}`
        + ` · cadastro no ERP em ${formatar.data(p.dt_cadastro_erp)}`),
      correcao ? mensagem(`Liberação atual: ${descreverCredito(p)} (em ${formatar.data(p.dt_liberacao_credito)}). Gravar cria uma nova liberação; a anterior fica no histórico.`, 'info') : null),
    h('form', { class: 'cartao', onsubmit: gravar, oninput: () => montar(erros), onchange: () => montar(erros) },
      h('label', {}, 'Forma de pagamento *'),
      opcoes('forma', Object.entries(FORMAS_PAGAMENTO).map(([k, t]) => [k, t, AJUDA_FORMA[k]]), (v) => { forma = v; if (v !== 'boleto' && !Number(prazo.value)) prazo.value = '0'; }, 'em-linha'),
      h('div', { class: 'linha-campos' },
        h('div', { class: 'campo' }, h('label', { for: 'prazo' }, 'Prazo de pagamento (dias)'), prazo),
        h('div', { class: 'campo' }, h('label', { for: 'limite' }, 'Limite de crédito (R$) *'), limite),
        h('div', { class: 'campo' }, h('label', { for: 'data-liberacao' }, 'Data da liberação'), data)),
      h('label', {}, 'Restrição de crédito *'),
      opcoes('restricao', [['nao', 'Sem restrição'], ['sim', 'Com restrição']], (v) => { restricao = v === 'sim'; }),
      h('div', { class: 'campo' }, h('label', { for: 'obs-liberacao' }, 'Observação'), observacao),
      erros,
      h('div', { class: 'acoes' }, botao, h('a', { class: 'botao secundario', href: '#/financeiro' }, 'Cancelar'))));
}
