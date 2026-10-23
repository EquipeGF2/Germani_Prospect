// Erros do app (0019): o que deu erro na tela dos usuários, com código, tela e versão — sem depender de print.
import { bancoAdmin } from '../db.js';
import { listarErrosApp } from '../../shared/administracao.mjs';
import { errosDoAparelho } from '../erros.js';
import { h, montar, tabela, formatar, baixarCsv } from '../ui.js';

const codigo = (detalhe) => /^código do erro: (\S+)/.exec(detalhe ?? '')?.[1] ?? '';
const aparelho = (ua) => (/Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'outro')
  + (/Edg\//.test(ua) ? ' · Edge' : /Chrome\//.test(ua) ? ' · Chrome' : /Safari\//.test(ua) ? ' · Safari' : /Firefox\//.test(ua) ? ' · Firefox' : '');

export async function render(conteudo) {
  const db = await bancoAdmin();
  const periodo = h('select', { 'aria-label': 'Período' }, [[1, 'Último dia'], [7, 'Últimos 7 dias'], [30, 'Últimos 30 dias']]
    .map(([v, t]) => h('option', { value: String(v), selected: v === 7 }, t)));
  const area = h('div');
  const colunas = [
    { titulo: 'Quando', valor: (e) => formatar.dataHora(e.registrado_em), texto: (e) => e.registrado_em },
    { titulo: 'Usuário', valor: (e) => e.login ?? '—', texto: (e) => e.login ?? '' },
    { titulo: 'Tela', campo: 'tela' },
    { titulo: 'Código', valor: (e) => codigo(e.detalhe), texto: (e) => codigo(e.detalhe) },
    { titulo: 'Erro', valor: (e) => `${e.tipo ? e.tipo + ': ' : ''}${e.mensagem}`, texto: (e) => `${e.tipo ?? ''}: ${e.mensagem}` },
    { titulo: 'Aparelho', valor: (e) => `${aparelho(e.navegador ?? '')}${Number(e.online) === 0 ? ' · sem internet' : ''}`, texto: (e) => e.navegador ?? '' },
    { titulo: 'Versão', campo: 'versao' },
  ];
  async function carregar() {
    const { lista, frequentes } = await listarErrosApp(db, { dias: Number(periodo.value) });
    montar(area,
      h('h2', {}, 'Mais frequentes'),
      tabela([
        { titulo: 'Erro', campo: 'mensagem' },
        { titulo: 'Vezes', valor: (f) => formatar.numero(f.vezes), classe: 'num' },
        { titulo: 'Usuários', valor: (f) => formatar.numero(f.usuarios), classe: 'num' },
        { titulo: 'Último', valor: (f) => formatar.dataHora(f.ultimo) },
      ], frequentes, { vazio: 'Nenhum erro registrado no período.' }),
      h('h2', {}, `Todos (${formatar.numero(lista.length)}${lista.length >= 300 ? ', os 300 mais recentes' : ''})`),
      h('div', { class: 'acoes', style: 'margin:0 0 12px' },
        h('button', { class: 'secundario pequeno', disabled: !lista.length, onclick: () => baixarCsv(`erros-app-${periodo.value}d.csv`,
          [...colunas, { titulo: 'Detalhe', campo: 'detalhe' }], lista) }, 'Baixar CSV')),
      tabela(colunas, lista, { vazio: 'Nenhum erro registrado no período.' }));
  }
  periodo.addEventListener('change', carregar);
  const locais = errosDoAparelho();
  montar(conteudo, h('h1', {}, 'Erros do app'),
    h('p', { class: 'ajuda' }, 'Cada erro que aparece na tela de um usuário fica registrado aqui, com o código que ele vê, a tela e a versão do site. Falha momentânea de internet na leitura já é repetida sozinha uma vez; tela aberta durante uma publicação nova recarrega sozinha.'),
    h('div', { class: 'linha-campos' }, h('div', {}, h('label', {}, 'Período'), periodo)),
    area,
    locais.length ? h('details', {}, h('summary', {}, `Erros guardados neste aparelho (${locais.length})`),
      tabela([{ titulo: 'Quando', valor: (e) => formatar.dataHora(e.quando) }, { titulo: 'Código', campo: 'codigo' }, { titulo: 'Tela', campo: 'tela' },
        { titulo: 'Erro', valor: (e) => `${e.tipo}: ${e.mensagem}` }], locais)) : null);
  await carregar();
}
