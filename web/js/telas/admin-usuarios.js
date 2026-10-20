import { bancoAdmin, tokenAdminAtual } from '../db.js';
import { criarUsuarioSistema, definirAtivo, definirTipoAtuacao, listarUsuarios, redefinirSenha } from '../../shared/usuarios.mjs';
import { normalizarBusca } from '../../shared/texto.mjs';
import { definirPerfilUsuario, listarPerfis, opcoesDePerfil, TIPOS_BASE } from '../../shared/perfis.mjs';
import { h, montar, tabela, aviso, comEspera, selo, cartoesFiltro } from '../ui.js';
import { NOMES_PERFIL } from '../app.js';

const SITUACAO = { sem_acesso: ['sem acesso', 'alerta'], provisoria: ['senha provisória', 'ok'], ok: ['ativo', 'ok'] };

// todos os perfis, agrupados por tipo; os que não servem para o usuário aparecem desabilitados, com o motivo.
// Vendedor: o perfil do sistema vira duas opções — Representante (sem rota) e Vendedor (com rota) — e a escolha grava o tipo.
const TIPOS_VENDEDOR = [['representante', 'Representante (sem rota)'], ['vendedor', 'Vendedor (com rota)']];
function opcoesAgrupadas(opcoes, atual, valor = (p) => p.id, vendedor = null) {
  return Object.entries(TIPOS_BASE).map(([base, nomeTipo]) => {
    const doTipo = opcoes.filter((o) => o.perfil.base === base);
    if (!doTipo.length) return null;
    return h('optgroup', { label: nomeTipo }, doTipo.map(({ perfil: p, disponivel, motivo }) => {
      if (vendedor && p.sistema && p.base === 'vendedor') {
        return TIPOS_VENDEDOR.map(([t, rotulo]) => h('option', { value: `tipo:${t}`, selected: p.id === atual && vendedor.tipo_atuacao === t }, rotulo));
      }
      return h('option', { value: valor(p), selected: p.id === atual, disabled: !disponivel, title: motivo }, disponivel ? p.nome : `${p.nome} — ${motivo}`);
    }));
  });
}

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const quem = ctx.usuario.login;
  const [todos, perfis] = await Promise.all([listarUsuarios(db), listarPerfis(db)]);
  const perfilSistema = (base) => perfis.find((p) => p.sistema && p.base === base);
  const senhaArea = h('div');
  const busca = h('input', { type: 'search', placeholder: 'Buscar por nome, login ou código', 'aria-label': 'Buscar' });
  const filtroPerfil = h('select', { 'aria-label': 'Perfil', id: 'filtro-perfil' }, h('option', { value: '' }, 'Todos os perfis'),
    Object.entries(NOMES_PERFIL).map(([v, t]) => h('option', { value: v }, t)));
  // situação: escolhida pelos cards (o próprio card é o filtro)
  const filtroSituacao = { value: '' };
  const cardsArea = h('div');
  const listaArea = h('div', { class: 'tabela-usuarios' });

  function mostrarSenha(login, senha) {
    montar(senhaArea, h('div', { class: 'cartao', style: 'border-color:var(--destaque)' },
      h('h3', {}, `Senha provisória de ${login}`),
      h('p', {}, h('span', { class: 'senha-gerada' }, senha)),
      h('p', { class: 'ajuda' }, 'Anote e entregue por um canal privado. Ela não será mostrada de novo.'),
      h('button', { class: 'secundario pequeno', onclick: () => montar(senhaArea) }, 'Já anotei')));
    senhaArea.scrollIntoView({ behavior: 'smooth' });
  }

  function desenharCards() {
    const escolher = (v) => () => { filtroSituacao.value = v; desenhar(); };
    montar(cardsArea, cartoesFiltro([
      { chave: 'todos', rotulo: 'usuários', valor: todos.length, ativo: !filtroSituacao.value, aoClicar: escolher('') },
      { chave: 'sem_acesso', rotulo: 'sem acesso liberado', valor: todos.filter((u) => u.situacao_senha === 'sem_acesso').length, tipo: 'alerta', ativo: filtroSituacao.value === 'sem_acesso', aoClicar: escolher('sem_acesso') },
      { chave: 'sem_tipo', rotulo: 'vendedores sem tipo', valor: todos.filter((u) => u.perfil === 'vendedor' && !u.tipo_atuacao).length, tipo: 'alerta', ativo: filtroSituacao.value === 'sem_tipo', aoClicar: escolher('sem_tipo') }]));
  }

  function desenhar() {
    desenharCards();
    const termo = normalizarBusca(busca.value);
    const lista = todos.filter((u) => (!filtroPerfil.value || u.perfil === filtroPerfil.value)
      && (filtroSituacao.value !== 'sem_acesso' || u.situacao_senha === 'sem_acesso')
      && (filtroSituacao.value !== 'sem_tipo' || (u.perfil === 'vendedor' && !u.tipo_atuacao))
      && (!termo || normalizarBusca(`${u.nome} ${u.login} ${u.codigo_erp ?? ''}`).includes(termo)));
    montar(listaArea, tabela([
      { titulo: 'Nome', valor: (u) => h('b', {}, u.nome) },
      { titulo: 'Login', valor: (u) => `${u.login}${u.codigo_erp && String(u.codigo_erp) !== u.login ? ' · cód. ' + u.codigo_erp : ''}` },
      { titulo: 'Perfil', valor: (u) => {
        // mesmo tipo-base: muda só as telas; administrador/gerente/financeiro trocam entre si (shared/perfis.mjs);
        // vendedor: Representante ou Vendedor é escolhido aqui mesmo (tipo de atuação)
        const atual = u.perfil_id ? Number(u.perfil_id) : perfilSistema(u.perfil)?.id;
        const ehVendedor = u.perfil === 'vendedor';
        const valorAtual = () => (ehVendedor && !u.perfil_id ? (u.tipo_atuacao ? `tipo:${u.tipo_atuacao}` : '') : String(atual));
        const s = h('select', { 'aria-label': `perfil de ${u.login}`, dados: { perfilUsuario: u.login }, onchange: async () => {
          if (s.value.startsWith('tipo:')) {
            const tipo = s.value.slice(5);
            const ok = await comEspera(null, async () => {
              if (u.perfil_id) await definirPerfilUsuario(db, { usuarioId: u.id, perfilId: null, executadoPor: quem, executadoPorId: ctx.usuario.id });
              await definirTipoAtuacao(db, { usuarioId: u.id, tipo, executadoPor: quem });
              return true;
            });
            if (!ok) { s.value = valorAtual(); return; }
            u.perfil_id = null; u.tipo_atuacao = tipo;
            aviso(`${u.nome}: ${TIPOS_VENDEDOR.find(([t]) => t === tipo)[1]}`);
            return desenhar();
          }
          const escolhido = perfis.find((p) => p.id === Number(s.value));
          const r = await comEspera(null, () => definirPerfilUsuario(db, { usuarioId: u.id, perfilId: escolhido.id, executadoPor: quem, executadoPorId: ctx.usuario.id }));
          if (!r) { s.value = valorAtual(); return; }
          const virouAdmin = r.mudouBase && r.base === 'administrador';
          u.perfil = r.base; u.perfil_id = r.perfilId;
          aviso(`${u.nome}: perfil ${escolhido.nome}${virouAdmin ? ' — defina a senha dele para liberar a administração' : ''}`);
          desenhar();
        } },
        ehVendedor && !u.perfil_id && !u.tipo_atuacao ? h('option', { value: '', disabled: true, selected: true }, '— representante ou vendedor? —') : null,
        opcoesAgrupadas(opcoesDePerfil(perfis, u, { proprio: u.id === ctx.usuario.id }), atual, undefined, ehVendedor ? u : null));
        return s;
      } },
      { titulo: 'Acesso', valor: (u) => Number(u.ativo) ? selo(...SITUACAO[u.situacao_senha]) : selo('desativado', 'erro') },
      { titulo: 'Ações', valor: (u) => {
        // o administrador define a senha de cada usuário (mín. 8); "Gerar" cria uma provisória aleatória
        const acoes = h('div', { class: 'acoes', style: 'margin:0' });
        const bSenha = h('button', { class: 'pequeno', dados: { senha: u.login }, onclick: () => {
          const campo = h('input', { type: 'password', class: 'campo-senha', autocomplete: 'new-password', placeholder: 'mín. 8 caracteres', 'aria-label': `nova senha de ${u.login}` });
          const bSalvar = h('button', { class: 'pequeno', type: 'submit' }, 'Salvar');
          const bGerar = h('button', { class: 'pequeno secundario', type: 'button', onclick: async () => {
            const r = await comEspera(bGerar, () => redefinirSenha(db, { usuarioId: u.id, executadoPor: quem, chaveAdmin: tokenAdminAtual() }));
            if (r) { u.situacao_senha = 'provisoria'; mostrarSenha(r.login, r.senha); desenhar(); }
          } }, 'Gerar');
          montar(acoes, h('form', { class: 'definir-senha', onsubmit: async (ev) => {
            ev.preventDefault();
            const r = await comEspera(bSalvar, () => redefinirSenha(db, { usuarioId: u.id, executadoPor: quem, senha: campo.value, chaveAdmin: tokenAdminAtual() }));
            if (r) { u.situacao_senha = 'ok'; aviso(`Senha de ${u.login} definida.`); desenhar(); }
          } }, campo, bSalvar, bGerar, h('button', { class: 'pequeno secundario', type: 'button', onclick: desenhar }, 'Cancelar')));
          campo.focus();
        } }, u.situacao_senha === 'sem_acesso' ? 'Liberar acesso' : 'Definir senha');
        const bAtivo = h('button', { class: 'pequeno secundario', onclick: async () => {
          if (u.id === ctx.usuario.id) return aviso('Você não pode desativar o próprio usuário.', 'erro');
          const ok = await comEspera(bAtivo, async () => { await definirAtivo(db, { usuarioId: u.id, ativo: !Number(u.ativo), executadoPor: quem }); return true; });
          if (ok) { u.ativo = Number(u.ativo) ? 0 : 1; desenhar(); }
        } }, Number(u.ativo) ? 'Desativar' : 'Ativar');
        montar(acoes, bSenha, bAtivo);
        return acoes;
      } },
    ], lista, { vazio: 'Nenhum usuário com esse filtro.' }));
  }

  // perfis que se criam aqui (os de supervisor e vendedor vêm da importação): valor "base" ou "base:id" (perfil criado)
  const perfilNovo = h('select', { id: 'novo-perfil' },
    opcoesAgrupadas(opcoesDePerfil(perfis, null), perfilSistema('financeiro')?.id, (p) => (p.sistema ? p.base : `${p.base}:${p.id}`)));
  const loginNovo = h('input', { id: 'novo-login', autocapitalize: 'none' });
  const nomeNovo = h('input', { id: 'novo-nome' });
  const senhaNova = h('input', { id: 'novo-senha', type: 'password', autocomplete: 'new-password', placeholder: 'vazio = gerar' });
  const bCriar = h('button', { type: 'submit' }, 'Criar usuário');
  const formNovo = h('form', { class: 'cartao linha-novo-usuario', onsubmit: async (ev) => {
    ev.preventDefault();
    const senha = senhaNova.value || null;
    const [base, perfilId] = perfilNovo.value.split(':');
    const r = await comEspera(bCriar, async () => {
      const novo = await criarUsuarioSistema(db, { perfil: base, login: loginNovo.value, nome: nomeNovo.value, executadoPor: quem, senha, chaveAdmin: tokenAdminAtual() });
      if (perfilId) await definirPerfilUsuario(db, { usuarioId: novo.id, perfilId: Number(perfilId), executadoPor: quem });
      return novo;
    });
    if (r) { if (senha) aviso(`Usuário ${r.login} criado com a senha definida.`); else mostrarSenha(r.login, r.senha); todos.splice(0, todos.length, ...(await listarUsuarios(db))); formNovo.reset(); desenhar(); }
  } },
  // linha única: título curto + campos + botão (supervisores e vendedores vêm da importação da base)
  h('b', { class: 'tit' }, 'Novo usuário'),
  h('div', {}, h('label', { for: 'novo-perfil' }, 'Perfil'), perfilNovo),
  h('div', {}, h('label', { for: 'novo-login' }, 'Login'), loginNovo),
  h('div', { class: 'nome' }, h('label', { for: 'novo-nome' }, 'Nome'), nomeNovo),
  h('div', {}, h('label', { for: 'novo-senha' }, 'Senha (mín. 8)'), senhaNova),
  bCriar,
  h('small', { class: 'ajuda' }, 'Supervisores e vendedores vêm da importação da base (código do ERP). Administrador: a senha abre o cofre de administração — prefira letras e números.'));

  [busca, filtroPerfil].forEach((c) => c.addEventListener('input', desenhar));
  montar(conteudo,
    h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, 'Usuários')),
      h('a', { class: 'botao secundario', href: '#/admin/perfis', id: 'botao-perfis' }, 'Perfis e telas de acesso')),
    // 1ª linha: cards (filtro) + busca + perfil · 2ª: cadastro de novo usuário · depois a lista
    h('div', { class: 'barra-console' }, cardsArea, h('div', { class: 'barra-busca' }, busca), filtroPerfil),
    formNovo,
    senhaArea,
    listaArea);
  desenhar();
}
