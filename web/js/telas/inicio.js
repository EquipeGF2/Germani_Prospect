import { h, montar, mensagem } from '../ui.js';

export async function render(conteudo, { usuario }) {
  const atalhos = [];
  if (usuario.perfil === 'administrador') atalhos.push(['#/admin', 'Administração', 'Importações, usuários e parâmetros']);
  montar(conteudo,
    h('h1', {}, `Olá, ${usuario.nome.split(' ')[0]}`),
    mensagem('Em construção: lista de prospects, acompanhamento, ficha com o histórico de movimentação e registro de atendimentos (parte 2 do app).', 'info'),
    atalhos.length ? h('div', { class: 'grade' }, atalhos.map(([href, t, d]) => h('a', { class: 'atalho', href }, h('b', {}, t), h('small', {}, d)))) : null);
}
