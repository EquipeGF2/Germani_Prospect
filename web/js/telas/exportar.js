// Exportar (aba da tela Importações): Rejeitados por tipo, a base de prospects e os pedidos, em Excel. Gerente e administrador.
// Cada exportação lê o banco só ao clicar. docs/03 §17
import { bancoApp, lerComCache } from '../db.js';
import { consultaExportarBase } from '../../shared/administracao.mjs';
import { consultaRejeitados, NOME_TIPO_REJEICAO, paraExportar, prepararRejeitado, TIPOS_REJEICAO } from '../../shared/rejeitados.mjs';
import { consultaPedidos, rotuloRepresentante } from '../../shared/pedidos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, formatar, comEspera, aviso } from '../ui.js';
import { baixarXlsx } from '../planilhas.js';
import { documento, lerPedidos, valor } from './_pedidos.js';

const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const representante = (codigo, nome) => [codigo, nome].filter(Boolean).join(' - ');
const NOME_TIPO_PEDIDO = { venda: 'Venda', investimento: 'Bonificação', ignorar: 'Não considerado' };

/** Colunas do Excel de rejeitados (também usadas pela tela Rejeitados para contar). */
export const COLUNAS_REJEITADOS = [
  { titulo: 'Tipo', valor: (l) => NOME_TIPO_REJEICAO[l.tipo], largura: 30 }, { titulo: 'Motivo', valor: (l) => l.motivo, largura: 40 }, { titulo: 'Data', valor: (l) => formatar.data(l.data), largura: 12 },
  { titulo: 'Código', valor: (l) => l.codigo_cliente_erp ?? '', largura: 10 }, { titulo: 'Razão social', valor: (l) => l.razao_social, largura: 40 }, { titulo: 'CNPJ', valor: (l) => documento(l.cnpj), largura: 20 },
  { titulo: 'Telefone', valor: (l) => l.telefone ?? '', largura: 16 }, { titulo: 'Cidade', valor: (l) => l.cidade, largura: 22 }, { titulo: 'UF', valor: (l) => l.uf, largura: 6 },
  { titulo: 'Onda', valor: (l) => l.onda, largura: 8 }, { titulo: 'Segmento', valor: (l) => l.tipologia_gtm, largura: 22 },
  { titulo: 'Representante', valor: (l) => representante(l.vendedor_codigo, l.vendedor_nome), largura: 30 }, { titulo: 'Supervisor', valor: (l) => l.supervisor_nome ?? '', largura: 24 },
];

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const clientes = (await lerComCache(db, consultaRejeitados(), 300)).rows.map(prepararRejeitado);
  const filtro = { tipos: new Set(TIPOS_REJEICAO), supervisor: '', representante: '', onda: '' };
  const unicos = (chave, rotulo) => [...new Map(clientes.filter((l) => l[chave] != null && l[chave] !== '').map((l) => [String(l[chave]), rotulo(l)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR', { numeric: true }));
  const selecao = (id, rotulo, chave, opcoes, todos) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo),
    h('select', { id, onchange: (ev) => { filtro[chave] = ev.target.value; desenharRejeitados(); } }, h('option', { value: '' }, todos), opcoes.map(([v, t]) => h('option', { value: v }, t))));
  const filtrados = () => paraExportar(clientes, [...filtro.tipos]).filter((l) => (!filtro.supervisor || String(l.supervisor_id) === filtro.supervisor)
    && (!filtro.representante || String(l.vendedor_id) === filtro.representante) && (!filtro.onda || l.onda === filtro.onda));

  // Rejeitados: um ou mais tipos, com supervisor, representante e onda
  const tiposRej = h('div', { class: 'rej-tipos' });
  const botaoRej = h('button', { type: 'button', id: 'exportar-rejeitados', onclick: () => comEspera(botaoRej, async () => {
    const lista = filtrados();
    await baixarXlsx(`rejeitados-${hojeSaoPaulo()}.xlsx`, COLUNAS_REJEITADOS, lista, { aba: 'Rejeitados' });
    aviso(`Rejeitados exportados: ${n0(lista.length)} clientes.`);
  }) });
  function desenharRejeitados() {
    const contar = (t) => clientes.filter((l) => l.tipo === t && (!filtro.supervisor || String(l.supervisor_id) === filtro.supervisor)
      && (!filtro.representante || String(l.vendedor_id) === filtro.representante) && (!filtro.onda || l.onda === filtro.onda)).length;
    montar(tiposRej, TIPOS_REJEICAO.map((t) => h('label', { class: 'ped-opcao' },
      h('input', { type: 'checkbox', dados: { tipo: t }, checked: filtro.tipos.has(t), onchange: (ev) => { if (ev.target.checked) filtro.tipos.add(t); else filtro.tipos.delete(t); desenharRejeitados(); } }),
      h('span', {}, `${NOME_TIPO_REJEICAO[t]} (${n0(contar(t))})`))));
    const total = filtrados().length;
    botaoRej.disabled = !total;
    botaoRej.textContent = `Exportar Excel · ${n0(total)} clientes`;
  }
  desenharRejeitados();

  // Base de prospects inteira, com status, representante e onda
  const botaoBase = h('button', { type: 'button', id: 'exportar-base', onclick: () => comEspera(botaoBase, async () => {
    const linhas = (await db.execute(consultaExportarBase())).rows;
    await baixarXlsx(`base-prospects-${hojeSaoPaulo()}.xlsx`, [
      { titulo: 'CNPJ', valor: (l) => formatar.cnpj(l.cnpj), largura: 22 }, { titulo: 'Razão social', valor: (l) => l.razao_social, largura: 48 },
      { titulo: 'Cidade', valor: (l) => l.cidade, largura: 28 }, { titulo: 'UF', valor: (l) => l.uf, largura: 6 }, { titulo: 'Onda', valor: (l) => l.onda ?? '', largura: 8 },
      { titulo: 'Segmento', valor: (l) => l.tipologia_gtm ?? '', largura: 22 }, { titulo: 'Status', valor: (l) => l.status_descricao ?? l.status_nome ?? '', largura: 30 },
      { titulo: 'Representante', valor: (l) => representante(l.vendedor_codigo, l.vendedor_nome), largura: 30 }, { titulo: 'Supervisor', valor: (l) => l.supervisor_nome ?? '', largura: 24 },
    ], linhas, { aba: 'Base de prospects' });
    aviso(`Base exportada: ${n0(linhas.length)} prospects.`);
  }) }, 'Exportar Excel');

  // Pedidos importados dos clientes da base
  const tipoPedido = h('select', { id: 'exportar-pedidos-tipo' }, [['', 'Venda e bonificação'], ['venda', 'Só venda'], ['investimento', 'Só bonificação']].map(([v, t]) => h('option', { value: v }, t)));
  const botaoPed = h('button', { type: 'button', id: 'exportar-pedidos', onclick: () => comEspera(botaoPed, async () => {
    const todos = (await lerPedidos(db, consultaPedidos({ usuario, limite: 50000 }))).rows.filter((p) => p.prospect_id !== null);
    const lista = todos.filter((p) => !tipoPedido.value || p.tipo === tipoPedido.value);
    await baixarXlsx(`pedidos-${hojeSaoPaulo()}.xlsx`, [
      { titulo: 'Pedido', valor: (p) => p.numero, largura: 12 }, { titulo: 'Data', valor: (p) => formatar.data(p.data_situacao), largura: 12 },
      { titulo: 'Código', valor: (p) => p.codigo_cliente ?? '', largura: 10 }, { titulo: 'Razão social', valor: (p) => p.razao_social, largura: 40 }, { titulo: 'CNPJ', valor: (p) => documento(p.cpf_cnpj), largura: 20 },
      { titulo: 'Representante', valor: rotuloRepresentante, largura: 30 }, { titulo: 'Tipo', valor: (p) => NOME_TIPO_PEDIDO[p.tipo] ?? p.tipo, largura: 14 },
      { titulo: 'Situação', valor: (p) => p.situacao_descricao ?? '', largura: 18 }, { titulo: 'Pedido (R$)', valor: (p) => valor(p.valor_pedido), largura: 14 }, { titulo: 'Faturado (R$)', valor: (p) => valor(p.valor_faturado), largura: 14 },
    ], lista, { aba: 'Pedidos' });
    aviso(`Pedidos exportados: ${n0(lista.length)}.`);
  }) }, 'Exportar Excel');

  montar(conteudo,
    h('section', { class: 'cartao exp-bloco', id: 'exportar-bloco-rejeitados' }, h('h2', {}, 'Rejeitados'),
      h('p', { class: 'ajuda' }, 'Clientes que saíram da prospecção, por tipo. Marque um ou mais.'), tiposRej,
      h('div', { class: 'exp-filtros' },
        selecao('exportar-supervisor', 'Supervisor', 'supervisor', unicos('supervisor_id', (l) => l.supervisor_nome ?? '—'), 'Todos'),
        selecao('exportar-representante', 'Representante', 'representante', unicos('vendedor_id', (l) => representante(l.vendedor_codigo, l.vendedor_nome)), 'Todos'),
        selecao('exportar-onda', 'Onda', 'onda', unicos('onda', (l) => `Onda ${l.onda}`), 'Todas'), botaoRej)),
    h('section', { class: 'cartao exp-bloco' }, h('div', {}, h('h2', {}, 'Base de prospects'), h('p', { class: 'ajuda' }, 'A base inteira, com o status atual, o representante e a onda de cada cliente.')), botaoBase),
    h('section', { class: 'cartao exp-bloco' }, h('div', {}, h('h2', {}, 'Pedidos'), h('p', { class: 'ajuda' }, 'Os pedidos importados dos clientes da base, com situação, valor e quem vendeu.')),
      h('div', { class: 'exp-filtros' }, h('div', { class: 'campo' }, h('label', { for: 'exportar-pedidos-tipo' }, 'Tipo'), tipoPedido), botaoPed)));
}
