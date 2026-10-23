import { bancoAdmin } from '../db.js';
import { alterarParametro, listarCarteirasAtivas, listarParametros } from '../../shared/administracao.mjs';
import { h, montar, tabela, aviso, comEspera, formatar } from '../ui.js';

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const [lista, carteiras] = await Promise.all([listarParametros(db), listarCarteirasAtivas(db)]);
  montar(conteudo,
    h('h1', {}, 'Parâmetros'),
    h('p', { class: 'ajuda' }, 'A alteração vale para os próximos movimentos (não é retroativa) e fica registrada na auditoria.'),
    tabela([
      { titulo: 'Parâmetro', valor: (p) => h('div', {}, h('b', {}, p.descricao), h('div', { class: 'ajuda' }, p.chave)) },
      { titulo: 'Valor', valor: (p) => {
        const campo = p.chave === 'vendedor_ecommerce_id'
          ? h('select', { 'aria-label': p.chave, style: 'max-width:280px' }, h('option', { value: '0', selected: p.valor === '0' }, '— desligado —'),
            carteiras.map((c) => h('option', { value: String(c.id), selected: String(c.id) === p.valor }, `${c.nome}${c.codigo_erp ? ' · ' + c.codigo_erp : ''}`)))
          : p.chave.startsWith('data_')
            ? h('input', { type: 'date', value: p.valor, style: 'max-width:180px', 'aria-label': p.chave })
            : h('input', { type: 'number', min: '0', step: '1', value: p.valor, style: 'max-width:130px', 'aria-label': p.chave });
        const botao = h('button', { class: 'pequeno', onclick: async () => {
          const ok = await comEspera(botao, async () => { await alterarParametro(db, { chave: p.chave, valor: campo.value, executadoPor: ctx.usuario.login }); return true; });
          if (ok) { aviso('Parâmetro salvo.'); render(conteudo, ctx); }
        } }, 'Salvar');
        return h('div', { class: 'acoes', style: 'margin:0' }, campo, botao);
      } },
      { titulo: 'Última alteração', valor: (p) => `${formatar.dataHora(p.alterado_em)}${p.alterado_por ? ' · ' + p.alterado_por : ''}` },
    ], lista));
}
