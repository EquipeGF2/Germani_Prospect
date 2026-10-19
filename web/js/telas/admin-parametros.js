import { bancoAdmin } from '../db.js';
import { alterarParametro, listarParametros } from '../../shared/administracao.mjs';
import { h, montar, tabela, aviso, comEspera, formatar } from '../ui.js';

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const lista = await listarParametros(db);
  montar(conteudo,
    h('h1', {}, 'Parâmetros'),
    h('p', { class: 'ajuda' }, 'A alteração vale para os próximos movimentos (não é retroativa) e fica registrada na auditoria.'),
    tabela([
      { titulo: 'Parâmetro', valor: (p) => h('div', {}, h('b', {}, p.descricao), h('div', { class: 'ajuda' }, p.chave)) },
      { titulo: 'Valor', valor: (p) => {
        const campo = h('input', { type: 'number', min: '0', step: '1', value: p.valor, style: 'max-width:110px', 'aria-label': p.chave });
        const botao = h('button', { class: 'pequeno', onclick: async () => {
          const ok = await comEspera(botao, async () => { await alterarParametro(db, { chave: p.chave, valor: campo.value, executadoPor: ctx.usuario.login }); return true; });
          if (ok) { aviso('Parâmetro salvo.'); render(conteudo, ctx); }
        } }, 'Salvar');
        return h('div', { class: 'acoes', style: 'margin:0' }, campo, botao);
      } },
      { titulo: 'Última alteração', valor: (p) => `${formatar.dataHora(p.alterado_em)}${p.alterado_por ? ' · ' + p.alterado_por : ''}` },
    ], lista));
}
