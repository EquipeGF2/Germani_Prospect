// Abas comuns da administração.
import { h } from '../ui.js';

const ABAS = [
  ['/admin', 'Início'],
  ['/admin/importar/base', 'Base de prospects'],
  ['/admin/importar/tipos', 'Representantes / vendedores'],
  ['/admin/importar/erp', 'Cadastro · Pedidos · Baixados'],
  ['/admin/importar/credito', 'Relatório de crédito'],
  ['/admin/importacoes', 'Importações'],
  ['/admin/usuarios', 'Usuários'],
  ['/admin/parametros', 'Parâmetros'],
];

export function abasAdmin(atual) {
  return h('nav', { class: 'abas' }, ABAS.map(([c, t]) => h('a', { href: `#${c}`, class: c === atual ? 'ativa' : '' }, t)));
}
