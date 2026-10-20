// Perfis de acesso (Administração → Usuários → Perfis): incluir/editar perfil e marcar as telas que ele acessa.
// O tipo-base decide o escopo dos dados e as regras do banco; só as telas compatíveis com o tipo-base podem ser marcadas.
import { bancoAdmin } from '../db.js';
import { listarPerfis, salvarPerfil, TELAS, telasPossiveis, telasPadrao, TIPOS_BASE } from '../../shared/perfis.mjs';
import { h, montar, mensagem, aviso, comEspera, selo } from '../ui.js';

const ESCOPO = {
  administrador: 'tudo, sem restrição', gerente: 'todos os dados (não libera crédito)', supervisor: 'só a equipe dele',
  vendedor: 'só a própria carteira', financeiro: 'só a análise de crédito',
};

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const quem = ctx.usuario.login;
  let perfis = await listarPerfis(db);
  const area = h('div');
  const lista = h('div');

  function formulario(perfil = null) {
    const fixo = perfil?.sistema && perfil.base === 'administrador';
    const nome = h('input', { id: 'perfil-nome', value: perfil?.nome ?? '', maxlength: 60, disabled: fixo });
    const base = h('select', { id: 'perfil-base', disabled: Boolean(perfil?.sistema) },
      Object.entries(TIPOS_BASE).map(([v, t]) => h('option', { value: v, selected: v === (perfil?.base ?? 'vendedor') }, t)));
    const marcadas = new Set(perfil ? perfil.telas : telasPadrao(base.value));
    const grade = h('div', { class: 'grade-telas' });
    const ajudaEscopo = h('p', { class: 'ajuda' });
    function desenharTelas() {
      const possiveis = telasPossiveis(base.value);
      montar(ajudaEscopo, `Dados que este perfil vê: ${ESCOPO[base.value]}.`);
      const grupos = [...new Set(TELAS.map((t) => t.grupo))];
      montar(grade, grupos.map((g) => h('fieldset', { class: 'grupo-telas' }, h('legend', {}, g),
        TELAS.filter((t) => t.grupo === g).map((t) => {
          const pode = possiveis.includes(t.codigo);
          return h('label', { class: `marcador ${pode ? '' : 'indisponivel'}`, title: pode ? '' : `Não serve para ${TIPOS_BASE[base.value]}` },
            h('input', { type: 'checkbox', value: t.codigo, dados: { tela: t.codigo }, checked: fixo || (pode && marcadas.has(t.codigo)), disabled: fixo || !pode,
              onchange: (ev) => { if (ev.target.checked) marcadas.add(t.codigo); else marcadas.delete(t.codigo); } }),
            ' ', t.rotulo);
        }))));
    }
    base.addEventListener('change', () => { marcadas.clear(); telasPadrao(base.value).forEach((t) => marcadas.add(t)); desenharTelas(); });
    desenharTelas();
    const erros = h('div');
    const bSalvar = h('button', { type: 'submit', disabled: fixo }, perfil ? 'Salvar perfil' : 'Incluir perfil');
    montar(area, h('form', { class: 'cartao', id: 'form-perfil', onsubmit: async (ev) => {
      ev.preventDefault();
      const telas = [...marcadas].filter((t) => telasPossiveis(base.value).includes(t));
      const id = await comEspera(bSalvar, () => salvarPerfil(db, { id: perfil?.id ?? null, nome: nome.value, base: base.value, telas, executadoPor: quem }));
      if (!id) return;
      aviso(perfil ? 'Perfil salvo.' : 'Perfil incluído.');
      perfis = await listarPerfis(db);
      montar(area);
      desenharLista();
    } },
    h('h2', { style: 'margin-top:0' }, perfil ? `Editar perfil: ${perfil.nome}` : 'Novo perfil'),
    fixo ? mensagem('O perfil Administrador tem sempre todas as telas (sem restrição).', 'info') : null,
    h('div', { class: 'linha-campos' },
      h('div', {}, h('label', { for: 'perfil-nome' }, 'Nome do perfil'), nome),
      h('div', {}, h('label', { for: 'perfil-base' }, 'Tipo-base (escopo dos dados)'), base)),
    ajudaEscopo,
    h('label', {}, 'Telas que o perfil acessa'), grade, erros,
    h('div', { class: 'acoes' }, bSalvar, h('button', { type: 'button', class: 'secundario', onclick: () => montar(area) }, 'Cancelar'))));
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function desenharLista() {
    const rotulos = Object.fromEntries(TELAS.map((t) => [t.codigo, t.rotulo]));
    montar(lista, h('div', { class: 'lista-perfis' }, perfis.map((p) => h('div', { class: 'cartao perfil', dados: { perfil: p.nome } },
      h('div', { class: 'cartao-prospect-topo' }, h('b', {}, p.nome), p.sistema ? selo('do sistema') : selo('criado', 'ok')),
      h('div', { class: 'ajuda', style: 'margin:4px 0' }, `${TIPOS_BASE[p.base]} · dados: ${ESCOPO[p.base]} · ${p.usuarios} usuário(s)`),
      h('div', { class: 'telas-perfil' }, (p.sistema && p.base === 'administrador' ? ['todas as telas'] : p.telas.map((t) => rotulos[t] ?? t)).map((t) => h('span', { class: 'selo' }, t))),
      h('div', { class: 'acoes', style: 'margin:8px 0 0' }, h('button', { class: 'pequeno secundario', onclick: () => formulario(p) }, 'Editar'))))));
  }

  desenharLista();
  montar(conteudo,
    h('a', { href: '#/admin/usuarios', class: 'voltar' }, '‹ Voltar aos usuários'),
    h('div', { class: 'cabecalho-pagina', style: 'margin-top:8px' },
      h('div', {}, h('h1', {}, 'Perfis e telas de acesso'),
        h('p', {}, 'O tipo-base define quais dados o perfil vê; as telas marcadas definem o que aparece no menu. Atribua o perfil a cada usuário na tela Usuários.')),
      h('button', { id: 'novo-perfil-botao', onclick: () => formulario() }, 'Novo perfil')),
    area, lista);
}
