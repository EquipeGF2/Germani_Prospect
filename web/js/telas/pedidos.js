// Explorar pedidos: o que foi vendido, numa tela só, como o Explorar carteira: filtros em cascata e árvore do total até o pedido.
// Lê os pedidos do escopo uma vez; filtrar, abrir ramos e trocar os níveis não voltam ao banco. docs/03 §14
import { bancoApp } from '../db.js';
import { alertasPedidos, consultaMotivosPedidoValido, consultaPedidos, consultaSaldoFiliais } from '../../shared/pedidos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, selo } from '../ui.js';
import { renderAnalise } from './_pedidos-analise.js';
import { chaveVerPor, lerVerPor, tabelaPedidos } from './_pedidos.js';

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const [pedidos, motivos, filiais, valores] = (await Promise.all([db.execute(consultaPedidos({ usuario, incluirFiliais: true })), db.execute(consultaMotivosPedidoValido()), db.execute(consultaSaldoFiliais()),
    db.execute("SELECT chave, valor FROM parametros WHERE chave IN ('prazo_pedido_valido_dias','alerta_desistencias_cliente','dias_alerta_pedido_aberto')")])).map((r) => r.rows);
  const p = Object.fromEntries(valores.map((v) => [v.chave, Number(v.valor)]));
  // alertas olham só os clientes da base: a filial entra pelo saldo, na conta do limite do grupo
  const alertas = alertasPedidos(pedidos.filter((x) => x.prospect_id !== null), { hoje: hojeSaoPaulo(), prazoPedidoValido: p.prazo_pedido_valido_dias, desistencias: p.alerta_desistencias_cliente, diasAberto: p.dias_alerta_pedido_aberto,
    entradas: new Map(motivos.map((m) => [Number(m.prospect_id), m.data_evento])), saldoFiliais: new Map(filiais.map((f) => [f.raiz, Number(f.saldo)])) });

  let porGrupo = lerVerPor() === 'grupo';
  const area = h('div');
  const desenhar = () => renderAnalise(area, { pedidos, usuario, porGrupo });

  // alertas numa faixa: quem só quer analisar não é atrapalhado, quem precisa agir vê que há algo pendente
  const faixa = h('div');
  let alertasAbertos = false;
  function desenharFaixa() {
    montar(faixa, !alertas.length ? null : h('div', { class: 'ped-faixa-alertas' },
      h('button', { type: 'button', id: 'faixa-alertas', 'aria-expanded': alertasAbertos ? 'true' : 'false', onclick: () => { alertasAbertos = !alertasAbertos; desenharFaixa(); } },
        `${alertasAbertos ? '▼' : '▶'} ${alertas.length} ${alertas.length === 1 ? 'alerta' : 'alertas'} para olhar`),
      alertasAbertos ? [tabelaPedidos([{ titulo: 'Alerta', valor: (a) => selo(a.rotulo, a.tipo === 'bonificacao' ? 'investimento' : 'alerta'), classe: 'cen' },
        { titulo: 'Razão social', valor: (a) => (a.prospectId ? h('a', { href: `#/ficha?id=${a.prospectId}` }, a.cliente) : a.cliente) }, { titulo: 'O que aconteceu', campo: 'detalhe' }, { titulo: 'Quem age', campo: 'quem', classe: 'cen' }], alertas, { id: 'tabela-alertas' }),
      h('p', { class: 'ajuda', style: 'margin:10px 0 0' }, 'Prazos e limites ficam em Administração → Parâmetros. Venda para cliente de outro representante não é alerta: veja pelo nível Quem vendeu.')] : null));
  }
  desenharFaixa();
  desenhar();
  montar(conteudo, h('div', { class: 'exp-topo' }, h('h1', {}, 'Explorar pedidos'), chaveVerPor(porGrupo ? 'grupo' : 'empresa', (v) => { porGrupo = v === 'grupo'; desenhar(); })),
    h('p', { class: 'ajuda' }, 'Só os pedidos dos clientes da base. As filiais fora da base aparecem em Ver por Grupo.'), faixa, area);
}
