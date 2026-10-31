import { bancoAdmin } from '../db.js';
import { linhasDaImportacao, listarImportacoes, NOMES_IMPORTACAO } from '../../shared/administracao.mjs';
import { apagarArquivoPedidos, conferirExclusao, listarArquivosPedidos } from '../../shared/importar-pedidos.mjs';
import { h, montar, tabela, selo, formatar, baixarCsv, comEspera, aviso, mensagem } from '../ui.js';
import { cartoes, moeda, tabelaPedidos } from './_pedidos.js';

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const id = ctx.parametros.get('id');
  if (id) return detalhe(conteudo, db, Number(id));
  const apagar = ctx.parametros.get('apagar');
  if (apagar) return confirmarExclusao(conteudo, db, Number(apagar), ctx);
  const lista = await listarImportacoes(db);
  const arquivos = await listarArquivosPedidos(db);
  const blocoArquivos = arquivos.length ? h('div', { class: 'cartao', id: 'arquivos-pedidos' }, h('h2', {}, 'Arquivos de pedidos'),
    tabelaPedidos([
      { titulo: 'Data', valor: (a) => formatar.data(a.data_referencia), classe: 'num' }, { titulo: 'Arquivo', campo: 'arquivo_nome' }, { titulo: 'Importado por', campo: 'executado_por' },
      { titulo: 'Linhas', valor: (a) => formatar.numero(a.linhas_lidas), classe: 'num' }, { titulo: 'Clientes afetados', valor: (a) => formatar.numero(a.apagada_em ? a.apagados_clientes : a.clientes_afetados), classe: 'num' },
      { titulo: 'Situação', valor: (a) => (a.apagada_em ? selo(`Apagada em ${formatar.dataHora(a.apagada_em)} por ${a.apagada_por}`, 'erro') : selo(a.situacao, a.situacao)), classe: 'cen' },
      { titulo: 'Ação', valor: (a) => (a.apagada_em ? '—' : a.pode_apagar ? h('a', { class: 'botao secundario pequeno', dados: { apagar: a.id }, href: `#/admin/importacoes?apagar=${a.id}` }, 'Apagar') : h('button', { class: 'secundario pequeno', disabled: true }, 'Apague o mais novo antes')), classe: 'cen' }], arquivos),
    h('p', { class: 'ajuda', style: 'margin:12px 0 0' }, 'Apaga-se do mais novo para o mais antigo, porque um arquivo posterior pode ter mudado a situação dos mesmos pedidos.')) : null;
  montar(conteudo, h('h1', {}, 'Importações'), blocoArquivos,
    tabela([
      { titulo: 'Nº', campo: 'id', classe: 'num' },
      { titulo: 'Tipo', valor: (i) => NOMES_IMPORTACAO[i.tipo] ?? i.tipo },
      { titulo: 'Arquivo', campo: 'arquivo_nome' },
      { titulo: 'Quando / quem', valor: (i) => `${formatar.dataHora(i.iniciado_em)} · ${i.executado_por}` },
      { titulo: 'Situação', valor: (i) => selo(i.situacao, i.situacao) },
      { titulo: 'Lidas', valor: (i) => formatar.numero(i.linhas_lidas), classe: 'num' },
      { titulo: 'Aceitas', valor: (i) => formatar.numero(i.linhas_aceitas), classe: 'num' },
      { titulo: 'Rejeitadas', valor: (i) => formatar.numero(i.linhas_rejeitadas), classe: 'num' },
      { titulo: 'Ignoradas', valor: (i) => formatar.numero(i.linhas_ignoradas), classe: 'num' },
      { titulo: '', valor: (i) => h('a', { href: `#/admin/importacoes?id=${i.id}` }, 'Ver linhas') },
    ], lista, { vazio: 'Nenhuma importação ainda.' }));
}

async function detalhe(conteudo, db, id) {
  const imp = (await listarImportacoes(db, { limite: 1000 })).find((i) => Number(i.id) === id);
  const filtro = h('select', { 'aria-label': 'Resultado' }, ['', 'aceita', 'rejeitada', 'ignorada'].map((v) => h('option', { value: v }, v || 'Todas as linhas')));
  const area = h('div');
  const colunas = [
    { titulo: 'Linha', campo: 'numero_linha', classe: 'num' },
    { titulo: 'Resultado', valor: (l) => selo(l.resultado, l.resultado), texto: (l) => l.resultado },
    { titulo: 'CNPJ', valor: (l) => formatar.cnpj(l.cnpj), texto: (l) => l.cnpj ?? '' },
    { titulo: 'Mensagens', campo: 'mensagens' },
  ];
  let linhas = [];
  async function carregar() {
    linhas = await linhasDaImportacao(db, { importacaoId: id, resultado: filtro.value || null });
    montar(area, tabela(colunas, linhas.slice(0, 500)), linhas.length > 500 ? h('p', { class: 'ajuda' }, `Mostrando 500 de ${linhas.length} — baixe o CSV para ver tudo.`) : null);
  }
  filtro.addEventListener('change', carregar);
  const bCsv = h('button', { class: 'secundario pequeno', onclick: () => comEspera(bCsv, async () => baixarCsv(`importacao-${id}.csv`, colunas, linhas)) }, 'Baixar CSV');
  montar(conteudo,
    h('p', {}, h('a', { href: '#/admin/importacoes' }, '← Importações')),
    h('h1', {}, `Importação nº ${id}${imp ? ' · ' + (NOMES_IMPORTACAO[imp.tipo] ?? imp.tipo) : ''}`),
    imp ? h('p', { class: 'ajuda' }, `${imp.arquivo_nome} · ${formatar.dataHora(imp.iniciado_em)} · ${imp.executado_por} · ${imp.linhas_lidas} lidas = ${imp.linhas_aceitas} aceitas + ${imp.linhas_rejeitadas} rejeitadas + ${imp.linhas_ignoradas} ignoradas`) : null,
    h('div', { class: 'acoes', style: 'margin:0 0 12px' }, filtro, bCsv), area);
  await carregar();
}

/** Conferência antes de apagar os dados de um arquivo de pedidos. A regra está no banco (0022). */
async function confirmarExclusao(conteudo, db, id, ctx) {
  const arquivo = (await listarArquivosPedidos(db)).find((a) => Number(a.id) === id);
  const voltar = h('p', {}, h('a', { href: '#/admin/importacoes' }, '← Importações'));
  if (!arquivo || !arquivo.pode_apagar) return montar(conteudo, voltar, mensagem('Este arquivo não pode ser apagado: só o arquivo de pedidos mais novo, ainda não apagado.', 'erro'));
  const c = await conferirExclusao(db, id);
  const confirma = h('input', { id: 'confirma-arquivo', placeholder: arquivo.arquivo_nome, 'aria-label': 'Nome do arquivo para confirmar', oninput: () => { bApagar.disabled = confirma.value.trim() !== arquivo.arquivo_nome; } });
  const bApagar = h('button', { id: 'apagar-arquivo', disabled: true, onclick: async () => {
    const ok = await comEspera(bApagar, async () => { await apagarArquivoPedidos(db, { importacaoId: id, usuarioId: ctx.usuario.id }); return true; });
    if (!ok) return;
    aviso('Os dados do arquivo foram apagados.');
    location.hash = '#/admin/importacoes';
  } }, 'Apagar os dados deste arquivo');
  montar(conteudo, voltar, h('h1', {}, 'Apagar os dados de um arquivo importado'),
    h('p', { class: 'ajuda' }, `${arquivo.arquivo_nome} · importado em ${formatar.dataHora(arquivo.iniciado_em)} por ${arquivo.executado_por}. Apagar um arquivo tira só o que ele trouxe.`),
    cartoes([['Pedidos a apagar', formatar.numero(c.total.qtd), 'do que o arquivo gravou'], ['Venda válida', moeda(c.venda.valor), `${formatar.numero(c.venda.qtd)} pedidos`, 'destaque'], ['Digitado', moeda(c.digitado.valor), `${formatar.numero(c.digitado.qtd)} pedidos`],
      ['Desistência', moeda(c.cancelado.valor), `${formatar.numero(c.cancelado.qtd)} pedidos`], ['Investimento', moeda(c.investimento.valor), `${formatar.numero(c.investimento.qtd)} pedidos`, 'investimento']]),
    h('div', { class: 'cartao' }, h('h2', {}, 'O que acontece com cada coisa'),
      tabelaPedidos([{ titulo: 'O quê', campo: 'o' }, { titulo: 'Resultado', valor: (l) => selo(l.r, l.t), classe: 'cen' }, { titulo: 'Detalhe', campo: 'd' }], [
        { o: 'Pedidos e situações deste arquivo', r: 'Apagados', t: 'erro', d: 'Somem da ficha, das listas e do Acompanhamento de pedidos' },
        { o: 'Linhas brutas do arquivo', r: 'Apagadas', t: 'erro', d: 'Os dados da planilha guardados na importação também saem' },
        { o: 'Histórico gerado pelo arquivo', r: 'Apagado', t: 'erro', d: 'Os movimentos da importação do pedido saem da linha do tempo' },
        { o: 'Status do cliente', r: 'Volta ao anterior', t: 'alerta', d: 'Considera os atendimentos registrados depois da importação' },
        { o: 'Painéis e indicadores', r: 'Recalculados', t: 'alerta', d: 'Início, Explorar e resumo da carteira voltam a bater na mesma hora' },
        { o: 'Atendimentos do representante', r: 'Mantidos', t: 'ok', d: 'O que ele registrou no app não vem do arquivo' },
        { o: 'Cadastro, crédito e baixados', r: 'Mantidos', t: 'ok', d: 'Vieram de outros arquivos' },
        { o: 'Registro da exclusão', r: 'Permanece', t: '', d: 'Arquivo, quantidades, quem importou, quem apagou e quando' }])),
    h('div', { class: 'ped-confirma' }, h('label', { for: 'confirma-arquivo' }, 'Não dá para desfazer. Para confirmar, digite o nome do arquivo:'),
      h('div', { class: 'linha-campos' }, confirma, bApagar)));
}
