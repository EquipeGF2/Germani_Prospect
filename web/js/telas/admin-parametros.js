import { bancoAdmin } from '../db.js';
import { alterarParametro, listarParametros } from '../../shared/administracao.mjs';
import { h, montar, tabela, aviso, comEspera, formatar } from '../ui.js';
import { consultaOndasDaBase, lerOndas, valorOndas } from '../../shared/ondas.mjs';

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const [lista, ondas] = await Promise.all([listarParametros(db), db.execute(consultaOndasDaBase()).then((r) => r.rows)]);
  const n0 = (x) => formatar.numero(Number(x) || 0);

  // Ondas liberadas (0024): uma caixa por onda da base, com quantos prospects ainda estão na lista de cada uma
  function campoOndas(p) {
    const liberadas = lerOndas(p.valor);
    const caixas = ondas.map((o) => h('input', { type: 'checkbox', value: String(o.onda), checked: !liberadas || liberadas.includes(String(o.onda)) }));
    const marcarTodas = (v) => caixas.forEach((c) => { c.checked = v; });
    const botao = h('button', { class: 'pequeno', id: 'salvar-ondas', onclick: async () => {
      const valor = valorOndas(caixas.filter((c) => c.checked).map((c) => c.value), ondas.map((o) => String(o.onda)));
      const ok = await comEspera(botao, async () => { await alterarParametro(db, { chave: p.chave, valor, executadoPor: ctx.usuario.login }); return true; });
      if (ok) { aviso('Ondas liberadas salvas.'); render(conteudo, ctx); }
    } }, 'Salvar');
    return h('div', { class: 'ondas-param', id: 'ondas-liberadas' },
      h('p', { class: 'ajuda', style: 'margin:0 0 6px' }, liberadas ? `Liberadas: ${liberadas.map((o) => (o ? `Onda ${o}` : 'Sem onda')).join(', ') || 'nenhuma'}.` : 'Todas as ondas liberadas.'),
      ondas.length ? h('div', { class: 'ondas-lista' }, ondas.map((o, i) => h('label', { class: 'ped-opcao' }, caixas[i],
        h('span', {}, h('b', {}, o.onda ? `Onda ${o.onda}` : 'Sem onda'), h('small', { class: 'ajuda', style: 'display:block' }, `${n0(o.na_lista)} na lista · ${n0(o.qtd)} na base`)))))
        : h('p', { class: 'ajuda' }, 'Nenhuma onda na base ainda.'),
      h('div', { class: 'acoes', style: 'margin:8px 0 0' }, h('button', { type: 'button', class: 'secundario pequeno', onclick: () => marcarTodas(true) }, 'Marcar todas'),
        h('button', { type: 'button', class: 'secundario pequeno', onclick: () => marcarTodas(false) }, 'Desmarcar todas'), botao));
  }
  montar(conteudo,
    h('h1', {}, 'Parâmetros'),
    h('p', { class: 'ajuda' }, 'A alteração vale para os próximos movimentos (não é retroativa) e fica registrada na auditoria.'),
    lista.find((p) => p.chave === 'ondas_liberadas') ? h('section', { class: 'cartao' }, h('h2', { style: 'margin:0 0 4px' }, 'Ondas liberadas'),
      h('p', { class: 'ajuda', style: 'margin:0 0 8px' }, 'Liberação escalonada: marque as ondas que o representante/vendedor vê na Lista principal e no Explorar carteira. Quem já foi atendido aparece sempre. Supervisor e gestão veem todas.'),
      campoOndas(lista.find((p) => p.chave === 'ondas_liberadas'))) : null,
    tabela([
      { titulo: 'Parâmetro', valor: (p) => h('div', {}, h('b', {}, p.descricao), h('div', { class: 'ajuda' }, p.chave)) },
      { titulo: 'Valor', valor: (p) => {
        const campo = p.chave.startsWith('data_')
          ? h('input', { type: 'date', value: p.valor, style: 'max-width:180px', 'aria-label': p.chave })
          : p.tipo === 'texto'   // ex.: e-mails em cópia dos avisos da gerência
            ? h('input', { type: 'text', value: p.valor, style: 'min-width:260px', placeholder: 'email@empresa.com; outro@empresa.com', 'aria-label': p.chave })
          : h('input', { type: 'number', min: '0', step: '1', value: p.valor, style: 'max-width:130px', 'aria-label': p.chave });
        const botao = h('button', { class: 'pequeno', onclick: async () => {
          const ok = await comEspera(botao, async () => { await alterarParametro(db, { chave: p.chave, valor: campo.value, executadoPor: ctx.usuario.login }); return true; });
          if (ok) { aviso('Parâmetro salvo.'); render(conteudo, ctx); }
        } }, 'Salvar');
        return h('div', { class: 'acoes', style: 'margin:0' }, campo, botao);
      } },
      { titulo: 'Última alteração', valor: (p) => `${formatar.dataHora(p.alterado_em)}${p.alterado_por ? ' · ' + p.alterado_por : ''}` },
    ], lista.filter((p) => p.chave !== 'ondas_liberadas')));
}
