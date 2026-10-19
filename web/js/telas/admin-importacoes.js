import { bancoAdmin } from '../db.js';
import { linhasDaImportacao, listarImportacoes, NOMES_IMPORTACAO } from '../../shared/administracao.mjs';
import { h, montar, tabela, selo, formatar, baixarCsv, comEspera } from '../ui.js';

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const id = ctx.parametros.get('id');
  if (id) return detalhe(conteudo, db, Number(id));
  const lista = await listarImportacoes(db);
  montar(conteudo, h('h1', {}, 'Importações'),
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
