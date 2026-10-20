// Reabre o cofre de administração (ADR-0006) pedindo só a senha do próprio administrador — nunca token.
// Aparece quando a sessão continua (outra aba, navegador reaberto) mas a chave aberta no login ficou na aba anterior.
import { bancoApp, guardarTokenAdmin, modoDemonstracao } from '../db.js';
import { abrirCofre } from '../../shared/cofre.mjs';
import { h, montar, comEspera } from '../ui.js';

export async function render(conteudo, { usuario, parametros, irPara }) {
  const volta = parametros.get('volta') || '/inicio';
  if (modoDemonstracao()) return irPara(volta);
  const senha = h('input', { id: 'senha-cofre', type: 'password', autocomplete: 'current-password', required: true });
  const botao = h('button', { type: 'submit' }, 'Continuar');
  montar(conteudo, h('form', { class: 'cartao login', onsubmit: async (ev) => {
    ev.preventDefault();
    const chave = await comEspera(botao, async () => {
      const db = await bancoApp();
      const r = await db.execute({ sql: 'SELECT cofre_admin FROM usuarios WHERE id = ? AND ativo = 1', args: [usuario.id] });
      const cofre = r.rows[0]?.cofre_admin;
      if (!cofre) throw new Error('Sua chave de administração ainda não foi gerada. Rode no GitHub: Actions → Criar administrador (com o seu login) e entre de novo.');
      const aberta = await abrirCofre(cofre, senha.value);
      if (!aberta) throw new Error('Senha incorreta.');
      return aberta;
    });
    if (!chave) return;
    guardarTokenAdmin(chave);
    irPara(volta);
  } },
  h('h1', {}, 'Confirme sua senha'),
  h('p', { class: 'ajuda' }, `Para abrir a administração nesta aba, digite a senha de ${usuario.login}.`),
  h('div', { class: 'campo' }, h('label', { for: 'senha-cofre' }, 'Senha'), senha),
  botao));
  senha.focus();
}
