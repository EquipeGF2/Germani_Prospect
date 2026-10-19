import { definirTokenAdmin, modoDemonstracao } from '../db.js';
import { h, montar, comEspera, mensagem } from '../ui.js';

export async function render(conteudo, { parametros, irPara }) {
  const volta = parametros.get('volta') || '/inicio';
  if (modoDemonstracao()) return irPara(volta);
  const token = h('input', { id: 'token', type: 'password', autocomplete: 'off', required: true });
  const botao = h('button', { type: 'submit' }, 'Liberar administração');
  montar(conteudo, h('form', { class: 'cartao login', onsubmit: async (ev) => {
    ev.preventDefault();
    const ok = await comEspera(botao, async () => { await definirTokenAdmin(token.value); return true; });
    if (ok) irPara(volta);
  } },
  h('h1', {}, 'Acesso de administração'),
  h('p', { class: 'ajuda' }, 'Cole o token de administração do Turso. Ele fica guardado só nesta aba e some ao fechá-la — nunca vai para o site nem para o repositório.'),
  h('div', { class: 'campo' }, h('label', { for: 'token' }, 'Token de administração'), token),
  botao,
  mensagem('Como gerar o token: docs/06-operacao.md, seção "Token de administração".', 'info')));
  token.focus();
}
