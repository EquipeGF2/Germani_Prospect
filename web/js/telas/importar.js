// Importações: uma tela só, com uma aba por arquivo, na ordem do processo, mais Exportar e Histórico. Cada aba já sabe o
// tipo do arquivo (não há como importar baixados como cadastro). As abas de importação são só no computador, pela escolha
// de arquivo; Exportar vale também para o gerente. docs/03 §17
import { podeTela } from '../../shared/perfis.mjs';
import { temTokenAdmin } from '../db.js';
import { h, montar, mensagem } from '../ui.js';

/** Abas, na ordem do processo. `tela`: permissão; `n`: número da etapa (importações); `arquivo`: só no computador. */
export const ABAS_IMPORTACAO = Object.freeze([
  { id: 'base', n: 1, nome: 'Base de prospects', tela: 'admin_base', arquivo: true, modulo: () => import('./admin-importar-base.js') },
  { id: 'grupos', n: 2, nome: 'Grupos de CNPJ', tela: 'admin_grupos', arquivo: true, modulo: () => import('./admin-grupos.js') },
  { id: 'credito', n: 3, nome: 'Cadastro e crédito', tela: 'admin_credito', arquivo: true, modulo: () => import('./admin-importar-credito.js') },
  { id: 'pedidos', n: 4, nome: 'Pedidos', tela: 'admin_erp', arquivo: true, modulo: () => import('./admin-importar-pedidos.js') },
  { id: 'baixados', n: 5, nome: 'Baixados', tela: 'admin_erp', arquivo: true, modulo: () => import('./admin-importar-erp.js') },
  { id: 'exportar', nome: 'Exportar', tela: 'exportar', modulo: () => import('./exportar.js') },
  { id: 'historico', nome: 'Histórico', tela: 'admin_importacoes', modulo: () => import('./admin-importacoes.js') },
]);

export const abasDoUsuario = (usuario) => ABAS_IMPORTACAO.filter((a) => podeTela(usuario, a.tela));
const noCelular = () => matchMedia('(max-width: 900px)').matches;

export async function render(conteudo, ctx) {
  const abas = abasDoUsuario(ctx.usuario);
  const aba = abas.find((a) => a.id === ctx.parametros?.get('aba')) ?? abas[0];
  const nav = h('nav', { class: 'imp-abas', 'aria-label': 'Abas da tela' }, abas.map((a) => h('a', { href: `#/importacoes?aba=${a.id}`, class: a === aba ? 'ativa' : '', dados: { aba: a.id }, 'aria-current': a === aba ? 'page' : null },
    a.n ? h('span', { class: 'n' }, String(a.n)) : null, a.nome)));
  const corpo = h('div', { class: 'imp-aba', id: `aba-${aba.id}` });
  const soExporta = abas.every((a) => !a.arquivo);
  montar(conteudo, h('h1', {}, soExporta ? 'Exportar dados' : 'Importações'),
    h('p', { class: 'ajuda', style: 'margin:0 0 12px' }, soExporta ? 'Bases do sistema em Excel.' : 'Tudo o que entra e sai do sistema numa tela só. As abas numeradas seguem a ordem do processo; cada uma já sabe o tipo do arquivo.'),
    soExporta ? null : nav, corpo);
  if (aba.arquivo && noCelular()) return montar(corpo, mensagem('A importação é feita no computador, onde dá para escolher o arquivo. No celular, use as abas Exportar e Histórico.', 'info'));
  // as abas de importação gravam com a chave de administração (ADR-0006): sem ela, confirma a senha e volta para a aba
  if (aba.tela.startsWith('admin_') && !temTokenAdmin()) return ctx.irPara(`/admin/acesso?volta=${encodeURIComponent(`/importacoes?aba=${aba.id}`)}`);
  const modulo = await aba.modulo();
  await modulo.render(corpo, { ...ctx, embutido: true });
  // Cadastro e crédito: o arquivo só de cadastro (sem crédito, leva à Análise financeira) fica recolhido embaixo
  if (aba.id === 'credito') {
    const area = h('div');
    corpo.append(h('details', { class: 'cartao imp-extra', id: 'so-cadastro' }, h('summary', {}, 'Arquivo só de cadastro, sem crédito (o cliente vai para Análise financeira)'), area));
    await (await import('./admin-importar-erp.js')).render(area, { ...ctx, embutido: true, tipoFixo: 'cadastro' });
  }
}
