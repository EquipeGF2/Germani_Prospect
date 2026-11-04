// Excel dos pedidos (Explorar pedidos e aba Exportar): um pedido por linha, com cliente, quem vendeu, situação e valores.
import { rotuloRepresentante } from '../../shared/pedidos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { formatar } from '../ui.js';
import { baixarXlsx } from '../planilhas.js';
import { documento, valor } from './_pedidos.js';

const NOME_TIPO = { venda: 'Venda', investimento: 'Bonificação', ignorar: 'Não considerado' };
const NA_LISTA = { propria: 'Sim', outra: 'Não' };
const COLUNAS = [
  { titulo: 'Pedido', valor: (p) => p.numero, largura: 12 }, { titulo: 'Data', valor: (p) => formatar.data(p.data_situacao), largura: 12 },
  { titulo: 'Código', valor: (p) => p.codigo_cliente ?? '', largura: 10 }, { titulo: 'Razão social', valor: (p) => p.razao_social, largura: 40 },
  { titulo: 'CNPJ', valor: (p) => documento(p.cpf_cnpj), largura: 20 }, { titulo: 'Representante do pedido', valor: rotuloRepresentante, largura: 30 },
  { titulo: 'Representante da carteira', valor: (p) => [p.dono_codigo, p.dono_nome].filter(Boolean).join(' - '), largura: 30 },
  { titulo: 'Venda na própria carteira?', valor: (p) => (p.prospect_id === null ? 'Filial do grupo' : NA_LISTA[p.relacao] ?? ''), largura: 26 },
  { titulo: 'Tipo', valor: (p) => NOME_TIPO[p.tipo] ?? p.tipo, largura: 14 }, { titulo: 'Situação', valor: (p) => p.situacao_descricao ?? '', largura: 18 },
  { titulo: 'Pedido (R$)', valor: (p) => valor(p.valor_pedido), largura: 14 }, { titulo: 'Faturado (R$)', valor: (p) => valor(p.valor_faturado), largura: 14 },
];

/** Baixa os pedidos em Excel (a lista já filtrada por quem chama). */
export const baixarPedidos = (pedidos) => baixarXlsx(`pedidos-${hojeSaoPaulo()}.xlsx`, COLUNAS, pedidos, { aba: 'Pedidos' });
