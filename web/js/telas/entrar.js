import { entrar } from '../sessao.js';
import { h, montar, comEspera } from '../ui.js';

export async function render(conteudo, { irPara }) {
  const login = h('input', { id: 'login', autocomplete: 'username', autocapitalize: 'none', required: true });
  const senha = h('input', { id: 'senha', type: 'password', autocomplete: 'current-password', required: true });
  const botao = h('button', { type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'cartao login', onsubmit: async (ev) => {
    ev.preventDefault();
    const u = await comEspera(botao, () => entrar(login.value, senha.value));
    if (u) irPara(u.perfil === 'financeiro' ? '/financeiro' : '/inicio');
  } },
  h('img', { class: 'logo-entrada', src: 'logo-germani.jpg', alt: 'GERMANI' }),
  h('h1', {}, 'Entrar'),
  h('p', { class: 'ajuda' }, 'Use o login e a senha recebidos do administrador.'),
  h('div', { class: 'campo' }, h('label', { for: 'login' }, 'Login'), login),
  h('div', { class: 'campo' }, h('label', { for: 'senha' }, 'Senha'), senha),
  botao);
  montar(conteudo, form);
  login.focus();
}
