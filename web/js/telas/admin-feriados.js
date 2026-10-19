// Feriados: nacionais, estaduais e municipais. Todos os cadastrados saem dos dias úteis da campanha (Início).
import { bancoAdmin } from '../db.js';
import { ABRANGENCIAS, excluirFeriado, incluirFeriado, listarFeriados, validarFeriado } from '../../shared/feriados.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, aviso, comEspera, formatar, tabela } from '../ui.js';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const ano = Number(ctx.parametros.get('ano')) || Number(hojeSaoPaulo().slice(0, 4));
  const lista = await listarFeriados(db, { ano });

  const data = h('input', { type: 'date', id: 'feriado-data', min: `${ano}-01-01`, max: `${ano}-12-31` });
  const descricao = h('input', { id: 'feriado-descricao', maxlength: 80, placeholder: 'Ex.: Aniversário de Santa Cruz do Sul' });
  // nacionais são automáticos: o cadastro é só de estaduais e municipais (ou um nacional novo, fora da lista)
  const abrangencia = h('select', { id: 'feriado-abrangencia', onchange: () => ajustar() }, ['estadual', 'municipal', 'nacional'].map((v) => h('option', { value: v }, ABRANGENCIAS[v])));
  const recorrente = h('input', { type: 'checkbox', id: 'feriado-recorrente', checked: true });
  const uf = h('input', { id: 'feriado-uf', maxlength: 2, placeholder: 'RS', style: 'text-transform:uppercase' });
  const cidade = h('input', { id: 'feriado-cidade', placeholder: 'Cidade' });
  const campoUf = h('div', { class: 'campo' }, h('label', { for: 'feriado-uf' }, 'UF'), uf);
  const campoCidade = h('div', { class: 'campo' }, h('label', { for: 'feriado-cidade' }, 'Cidade'), cidade);
  const erros = h('div');
  function ajustar() {
    campoUf.classList.toggle('oculto', abrangencia.value === 'nacional');
    campoCidade.classList.toggle('oculto', abrangencia.value !== 'municipal');
  }
  ajustar();
  const botao = h('button', { type: 'submit' }, 'Incluir feriado');

  async function incluir(ev) {
    ev.preventDefault();
    const dados = { data: data.value, descricao: descricao.value, abrangencia: abrangencia.value, uf: uf.value, cidade: cidade.value, recorrente: recorrente.checked };
    const { erros: lista } = validarFeriado(dados);
    montar(erros, lista.length ? mensagem(lista.join('; '), 'erro') : null);
    if (lista.length) return;
    const ok = await comEspera(botao, async () => { await incluirFeriado(db, { ...dados, executadoPor: ctx.usuario.login }); return true; });
    if (ok) { aviso('Feriado incluído.'); render(conteudo, ctx); }
  }

  const local = (f) => (f.abrangencia === 'nacional' ? 'Brasil' : f.abrangencia === 'estadual' ? f.uf : `${f.cidade}/${f.uf}`);
  montar(conteudo,
    h('h1', {}, 'Feriados'),
    h('p', { class: 'ajuda' }, 'Os dias úteis da campanha (Início) contam de segunda a sexta, menos estes feriados. Os nacionais são calculados automaticamente para todos os anos (inclusive a Sexta-feira Santa). Cadastre aqui os estaduais e municipais que valem para a operação — marcando "repete todo ano", não é preciso cadastrar de novo no ano seguinte.'),
    h('div', { class: 'visoes' }, [ano - 1, ano, ano + 1].map((a) => h('a', { href: `#/admin/feriados?ano=${a}`, class: a === ano ? 'ativa' : '' }, String(a)))),
    h('form', { class: 'cartao', onsubmit: incluir },
      h('h2', {}, `Incluir feriado em ${ano}`),
      h('div', { class: 'linha-campos' },
        h('div', { class: 'campo' }, h('label', { for: 'feriado-data' }, 'Data'), data),
        h('div', { class: 'campo' }, h('label', { for: 'feriado-descricao' }, 'Descrição'), descricao),
        h('div', { class: 'campo' }, h('label', { for: 'feriado-abrangencia' }, 'Abrangência'), abrangencia),
        campoUf, campoCidade),
      h('label', { class: 'marcador', for: 'feriado-recorrente', style: 'margin:0 0 12px' }, recorrente, ' Repete todo ano (mesmo dia e mês)'),
      erros,
      h('div', { class: 'acoes', style: 'margin-top:0' }, botao)),
    lista.length ? tabela([
      { titulo: 'Data', valor: (f) => h('b', {}, formatar.data(f.data)) },
      { titulo: 'Dia', valor: (f) => DIAS[new Date(`${f.data}T12:00:00Z`).getUTCDay()] },
      { titulo: 'Feriado', campo: 'descricao' },
      { titulo: 'Abrangência', valor: (f) => h('span', { class: 'selo' }, ABRANGENCIAS[f.abrangencia]) },
      { titulo: 'Origem', valor: (f) => (f.automatico ? h('span', { class: 'selo ok' }, 'automático') : Number(f.recorrente) ? h('span', { class: 'selo' }, 'todo ano') : `só em ${ano}`) },
      { titulo: 'Local', valor: local },
      { titulo: '', valor: (f) => {
        if (f.automatico) return '';
        const b = h('button', { class: 'secundario pequeno', 'aria-label': `Excluir ${f.descricao}`, onclick: async () => {
          if (!confirm(Number(f.recorrente) ? `Excluir "${f.descricao}" de todos os anos?` : `Excluir o feriado "${f.descricao}" de ${formatar.data(f.data)}?`)) return;
          const ok = await comEspera(b, async () => { await excluirFeriado(db, { id: f.id }); return true; });
          if (ok) { aviso('Feriado excluído.'); render(conteudo, ctx); }
        } }, 'Excluir');
        return b;
      } },
    ], lista) : mensagem(`Nenhum feriado cadastrado em ${ano}.`, 'info'));
}
