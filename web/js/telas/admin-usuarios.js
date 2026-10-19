import { bancoAdmin } from '../db.js';
import { criarUsuarioSistema, definirAtivo, definirTipoAtuacao, listarUsuarios, redefinirSenha } from '../../shared/usuarios.mjs';
import { normalizarBusca } from '../../shared/texto.mjs';
import { h, montar, tabela, aviso, comEspera, selo, numeros } from '../ui.js';
import { NOMES_PERFIL } from '../app.js';

const SITUACAO = { sem_acesso: ['sem acesso', 'alerta'], provisoria: ['senha provisória', 'ok'], ok: ['ativo', 'ok'] };

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const quem = ctx.usuario.login;
  const todos = await listarUsuarios(db);
  const senhaArea = h('div');
  const busca = h('input', { placeholder: 'Buscar por nome, login ou código', 'aria-label': 'Buscar' });
  const filtroPerfil = h('select', { 'aria-label': 'Perfil' }, h('option', { value: '' }, 'Todos os perfis'),
    Object.entries(NOMES_PERFIL).map(([v, t]) => h('option', { value: v }, t)));
  const filtroSituacao = h('select', { 'aria-label': 'Situação' }, h('option', { value: '' }, 'Qualquer situação'),
    h('option', { value: 'sem_acesso' }, 'Sem acesso liberado'), h('option', { value: 'sem_tipo' }, 'Vendedor sem tipo'));
  const listaArea = h('div');

  function mostrarSenha(login, senha) {
    montar(senhaArea, h('div', { class: 'cartao', style: 'border-color:var(--destaque)' },
      h('h3', {}, `Senha provisória de ${login}`),
      h('p', {}, h('span', { class: 'senha-gerada' }, senha)),
      h('p', { class: 'ajuda' }, 'Anote e entregue por um canal privado. Ela não será mostrada de novo.'),
      h('button', { class: 'secundario pequeno', onclick: () => montar(senhaArea) }, 'Já anotei')));
    senhaArea.scrollIntoView({ behavior: 'smooth' });
  }

  function desenhar() {
    const termo = normalizarBusca(busca.value);
    const lista = todos.filter((u) => (!filtroPerfil.value || u.perfil === filtroPerfil.value)
      && (filtroSituacao.value !== 'sem_acesso' || u.situacao_senha === 'sem_acesso')
      && (filtroSituacao.value !== 'sem_tipo' || (u.perfil === 'vendedor' && !u.tipo_atuacao))
      && (!termo || normalizarBusca(`${u.nome} ${u.login} ${u.codigo_erp ?? ''}`).includes(termo)));
    montar(listaArea, tabela([
      { titulo: 'Nome', valor: (u) => h('div', {}, h('b', {}, u.nome), h('div', { class: 'ajuda', style: 'margin:0' }, `login ${u.login}${u.codigo_erp ? ' · cód. ' + u.codigo_erp : ''}`)) },
      { titulo: 'Perfil', valor: (u) => NOMES_PERFIL[u.perfil] },
      { titulo: 'Forma de trabalho', valor: (u) => {
        if (u.perfil !== 'vendedor') return '—';
        const s = h('select', { 'aria-label': `tipo de ${u.login}`, onchange: async () => {
          const ok = await comEspera(null, async () => { await definirTipoAtuacao(db, { usuarioId: u.id, tipo: s.value, executadoPor: quem }); return true; });
          if (ok) { u.tipo_atuacao = s.value; aviso(`${u.nome}: ${s.value}`); }
        } }, h('option', { value: '', disabled: true, selected: !u.tipo_atuacao }, '— definir —'),
        ['representante', 'vendedor'].map((t) => h('option', { value: t, selected: u.tipo_atuacao === t }, t === 'vendedor' ? 'Vendedor (com rota)' : 'Representante (sem rota)')));
        return s;
      } },
      { titulo: 'Supervisor', valor: (u) => u.supervisor_nome ?? '' },
      { titulo: 'Prospects', campo: 'prospects', classe: 'num' },
      { titulo: 'Acesso', valor: (u) => Number(u.ativo) ? selo(...SITUACAO[u.situacao_senha]) : selo('desativado', 'erro') },
      { titulo: 'Ações', valor: (u) => {
        const bSenha = h('button', { class: 'pequeno', onclick: async () => {
          const r = await comEspera(bSenha, () => redefinirSenha(db, { usuarioId: u.id, executadoPor: quem }));
          if (r) { u.situacao_senha = 'provisoria'; mostrarSenha(r.login, r.senha); desenhar(); }
        } }, u.situacao_senha === 'sem_acesso' ? 'Liberar acesso' : 'Nova senha');
        const bAtivo = h('button', { class: 'pequeno secundario', onclick: async () => {
          if (u.id === ctx.usuario.id) return aviso('Você não pode desativar o próprio usuário.', 'erro');
          const ok = await comEspera(bAtivo, async () => { await definirAtivo(db, { usuarioId: u.id, ativo: !Number(u.ativo), executadoPor: quem }); return true; });
          if (ok) { u.ativo = Number(u.ativo) ? 0 : 1; desenhar(); }
        } }, Number(u.ativo) ? 'Desativar' : 'Ativar');
        return h('div', { class: 'acoes', style: 'margin:0' }, bSenha, bAtivo);
      } },
    ], lista, { vazio: 'Nenhum usuário com esse filtro.' }));
  }

  const perfilNovo = h('select', { id: 'novo-perfil' }, h('option', { value: 'financeiro' }, 'Analista financeiro'), h('option', { value: 'administrador' }, 'Administrador'));
  const loginNovo = h('input', { id: 'novo-login', autocapitalize: 'none' });
  const nomeNovo = h('input', { id: 'novo-nome' });
  const bCriar = h('button', { type: 'submit' }, 'Criar usuário');
  const formNovo = h('form', { class: 'cartao', onsubmit: async (ev) => {
    ev.preventDefault();
    const r = await comEspera(bCriar, () => criarUsuarioSistema(db, { perfil: perfilNovo.value, login: loginNovo.value, nome: nomeNovo.value, executadoPor: quem }));
    if (r) { mostrarSenha(r.login, r.senha); todos.splice(0, todos.length, ...(await listarUsuarios(db))); formNovo.reset(); desenhar(); }
  } },
  h('h2', {}, 'Novo administrador ou analista financeiro'),
  h('p', { class: 'ajuda' }, 'Supervisores e vendedores são criados pela importação da base (código do ERP).'),
  h('div', { class: 'linha-campos' },
    h('div', {}, h('label', { for: 'novo-perfil' }, 'Perfil'), perfilNovo),
    h('div', {}, h('label', { for: 'novo-login' }, 'Login'), loginNovo),
    h('div', {}, h('label', { for: 'novo-nome' }, 'Nome'), nomeNovo),
    h('div', {}, bCriar)));

  [busca, filtroPerfil, filtroSituacao].forEach((c) => c.addEventListener('input', desenhar));
  montar(conteudo,
    h('h1', {}, 'Usuários'),
    numeros([['usuários', todos.length], ['sem acesso liberado', todos.filter((u) => u.situacao_senha === 'sem_acesso').length, 'alerta'],
      ['vendedores sem tipo', todos.filter((u) => u.perfil === 'vendedor' && !u.tipo_atuacao).length, 'alerta']]),
    senhaArea,
    h('div', { class: 'linha-campos', style: 'margin-bottom:12px' }, busca, filtroPerfil, filtroSituacao),
    listaArea,
    formNovo);
  desenhar();
}
