// Casca do app: menu lateral (recolher/expandir; gaveta no celular) e barra superior com o caminho da página.
// Ícones em SVG desenhados aqui mesmo (sem biblioteca externa).
import { h, montar } from './ui.js';
import { podeTela } from '../shared/perfis.mjs';

const CHAVE_RECOLHIDO = 'germani.menuRecolhido';
const SVG = 'http://www.w3.org/2000/svg';

const ICONES = {
  inicio: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  lista: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  explorar: 'M4 4h6v4H4zM14 10h6v4h-6zM14 18h6v3h-6zM7 8v10h7M7 12h7',
  acompanhamento: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  feriados: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 15h.01M12 15h.01M16 15h.01',
  base: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  tipos: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  erp: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  credito: 'M2 5h20v14H2zM2 10h20M6 15h4',
  financeiro: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  importacoes: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  usuarios: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  parametros: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  recolher: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  expandir: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sair: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  buscar: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
};

export function icone(nome) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONES[nome]);
  svg.append(p);
  return svg;
}

// Grupos do menu. Cada item aparece se o perfil do usuário tem a tela (shared/perfis.mjs); grupo vazio some.
const GRUPOS = [
  { titulo: 'Prospecção', itens: [
    { caminho: '/explorar', rotulo: 'Explorar carteira', icone: 'explorar', tela: 'explorar' },
    { caminho: '/carteira', rotulo: 'Lista principal', icone: 'lista', tela: 'lista' },
    { caminho: '/carteira?aba=acompanhamento', rotulo: 'Acompanhamento', icone: 'acompanhamento', tela: 'acompanhamento' },
    { caminho: '/pedidos', rotulo: 'Explorar pedidos', icone: 'erp', tela: 'pedidos' },
  ] },
  { titulo: 'Financeiro', itens: [
    { caminho: '/financeiro', rotulo: 'Console de crédito', icone: 'financeiro', tela: 'credito' },
  ] },
  { titulo: 'Administração', itens: [
    // importações na ordem do processo: base → cadastro e crédito → pedidos. Representantes e vendedores são
    // cadastrados em Usuários (a importação por arquivo segue em #/admin/importar/tipos, fora do menu)
    { caminho: '/admin/importar/base', rotulo: 'Base de prospects', icone: 'base', tela: 'admin_base' },
    { caminho: '/admin/importar/credito', rotulo: 'Cadastro e crédito (ERP)', icone: 'credito', tela: 'admin_credito' },
    { caminho: '/admin/importar/erp', rotulo: 'Pedidos · Baixados (ERP)', icone: 'erp', tela: 'admin_erp' },
    { caminho: '/admin/grupos', rotulo: 'Grupos de CNPJ', icone: 'base', tela: 'admin_grupos' },
    { caminho: '/admin/importacoes', rotulo: 'Importações', icone: 'importacoes', tela: 'admin_importacoes' },
    { caminho: '/admin/usuarios', rotulo: 'Usuários', icone: 'usuarios', tela: 'admin_usuarios' },
    { caminho: '/admin/parametros', rotulo: 'Parâmetros', icone: 'parametros', tela: 'admin_parametros' },
    { caminho: '/admin/feriados', rotulo: 'Feriados', icone: 'feriados', tela: 'admin_feriados' },
    { caminho: '/admin/erros', rotulo: 'Erros do app', icone: 'importacoes', tela: 'admin_parametros' },
  ] },
];

// Telas sem item próprio no menu: qual item fica marcado e o nome que aparece no caminho
const TELAS_INTERNAS = {
  '/ficha': ['/carteira', 'Ficha do cliente'],
  '/registrar': ['/carteira', 'Registrar atendimento'],
  '/lote': ['/carteira', 'Sem interesse em lote'],
  '/admin/importar/pedidos': ['/admin/importar/erp', 'Importar pedidos'],
  '/financeiro/liberar': ['/financeiro', 'Liberar crédito'],
  '/admin/acesso': ['', 'Confirmar senha'],
  '/admin/perfis': ['/admin/usuarios', 'Perfis'],
};

function itemAtivo(caminho, consulta) {
  if (caminho === '/carteira') return new URLSearchParams(consulta).get('aba') === 'acompanhamento' ? '/carteira?aba=acompanhamento' : '/carteira';
  return TELAS_INTERNAS[caminho]?.[0] ?? caminho;
}

const recolhido = () => { try { return localStorage.getItem(CHAVE_RECOLHIDO) === '1'; } catch { return false; } };
const noCelular = () => matchMedia('(max-width: 900px)').matches;

function aplicarRecolhido(valor) {
  document.getElementById('casca').classList.toggle('recolhido', valor);
  try { localStorage.setItem(CHAVE_RECOLHIDO, valor ? '1' : '0'); } catch { /* preferência só nesta visita */ }
}

function fecharGaveta() { document.getElementById('casca').classList.remove('gaveta-aberta'); }

/** Liga os botões fixos da casca (uma vez). */
export function iniciarCasca() {
  aplicarRecolhido(recolhido());
  document.getElementById('botao-menu').addEventListener('click', () => {
    const casca = document.getElementById('casca');
    if (noCelular()) casca.classList.toggle('gaveta-aberta');
    else {
      casca.classList.add('animando');
      aplicarRecolhido(!casca.classList.contains('recolhido'));
      setTimeout(() => casca.classList.remove('animando'), 250);
    }
  });
  document.getElementById('fundo-gaveta').addEventListener('click', fecharGaveta);
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fecharGaveta(); });
}

/** Redesenha menu, rodapé do menu e caminho da página a cada navegação. */
export function atualizarCasca({ usuario, caminho, consulta, papel, aoSair }) {
  const casca = document.getElementById('casca');
  casca.classList.toggle('sem-menu', !usuario);
  fecharGaveta();
  const menu = document.getElementById('menu');
  const caminhoTopo = document.getElementById('caminho-topo');
  if (!usuario) { montar(menu); montar(caminhoTopo); montar(document.getElementById('usuario-lateral')); return; }

  const ativo = itemAtivo(caminho, consulta);
  let grupoAtivo = null;
  let itemDoTopo = null;
  const visiveis = GRUPOS.map((g) => ({ ...g, itens: g.itens.filter((i) => podeTela(usuario, i.tela)) })).filter((g) => g.itens.length);
  montar(menu, visiveis.map((g) => h('div', { class: 'menu-grupo' },
    h('div', { class: 'menu-titulo' }, g.titulo),
    g.itens.map((i) => {
      const marcado = i.caminho === ativo;
      if (marcado) { grupoAtivo = g.titulo; itemDoTopo = i.rotulo; }
      return h('a', { href: `#${i.caminho}`, class: marcado ? 'ativo' : '', title: i.rotulo, 'aria-current': marcado ? 'page' : null },
        icone(i.icone), h('span', { class: 'menu-rotulo' }, i.rotulo));
    }))));

  const interna = TELAS_INTERNAS[caminho]?.[1];
  montar(caminhoTopo, [grupoAtivo, itemDoTopo, interna].filter(Boolean).flatMap((t, k, l) =>
    [h('span', { class: k === l.length - 1 ? 'atual' : '' }, t), k < l.length - 1 ? h('span', { class: 'separador' }, '/') : null]));

  const iniciais = usuario.nome.split(/\s+/).filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  montar(document.getElementById('usuario-lateral'),
    h('div', { class: 'usuario-cartao', title: `${usuario.nome} · ${papel}` },
      h('span', { class: 'avatar' }, iniciais),
      h('span', { class: 'usuario-texto' }, h('b', {}, usuario.nome), h('small', {}, papel))),
    h('button', { class: 'menu-sair', title: 'Sair', onclick: aoSair }, icone('sair'), h('span', { class: 'menu-rotulo' }, 'Sair')));
}
