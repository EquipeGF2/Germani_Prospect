// Roteador por hash (#/caminho). Cada tela exporta render(container, contexto).
import { modoDemonstracao, temTokenAdmin } from './db.js';
import { sair, usuarioAtual } from './sessao.js';
import { h, montar, mensagem } from './ui.js';

const ROTAS = [
  { caminho: '/entrar', tela: () => import('./telas/entrar.js'), publica: true },
  { caminho: '/inicio', tela: () => import('./telas/inicio.js') },
  { caminho: '/carteira', tela: () => import('./telas/carteira.js') },
  { caminho: '/ficha', tela: () => import('./telas/ficha.js') },
  { caminho: '/registrar', tela: () => import('./telas/registrar.js'), perfis: ['administrador', 'supervisor', 'vendedor'] },
  { caminho: '/lote', tela: () => import('./telas/lote.js'), perfis: ['administrador', 'supervisor', 'vendedor'] },
  { caminho: '/admin', tela: () => import('./telas/admin-inicio.js'), perfis: ['administrador'] },
  { caminho: '/admin/acesso', tela: () => import('./telas/admin-acesso.js'), perfis: ['administrador'], semToken: true },
  { caminho: '/admin/importar/base', tela: () => import('./telas/admin-importar-base.js'), perfis: ['administrador'] },
  { caminho: '/admin/importar/tipos', tela: () => import('./telas/admin-importar-tipos.js'), perfis: ['administrador'] },
  { caminho: '/admin/importar/erp', tela: () => import('./telas/admin-importar-erp.js'), perfis: ['administrador'] },
  { caminho: '/admin/importar/credito', tela: () => import('./telas/admin-importar-credito.js'), perfis: ['administrador'] },
  { caminho: '/admin/importacoes', tela: () => import('./telas/admin-importacoes.js'), perfis: ['administrador'] },
  { caminho: '/admin/usuarios', tela: () => import('./telas/admin-usuarios.js'), perfis: ['administrador'] },
  { caminho: '/admin/parametros', tela: () => import('./telas/admin-parametros.js'), perfis: ['administrador'] },
];

export const NOMES_PERFIL = { administrador: 'Administrador', supervisor: 'Supervisor', vendedor: 'Vendedor', financeiro: 'Analista financeiro' };

export function irPara(caminho) {
  location.hash = `#${caminho}`;
}

function atualizarTopo(usuario) {
  const alvo = document.getElementById('usuario-topo');
  if (!usuario) { montar(alvo); return; }
  const papel = usuario.perfil === 'vendedor' ? (usuario.tipo_atuacao === 'vendedor' ? 'Vendedor' : 'Representante') : NOMES_PERFIL[usuario.perfil];
  montar(alvo,
    h('span', {}, `${usuario.nome} · ${papel}`),
    h('button', { class: 'secundario pequeno', onclick: () => { sair(); irPara('/entrar'); } }, 'Sair'));
}

async function navegar() {
  const conteudo = document.getElementById('conteudo');
  const [caminho, consulta = ''] = (location.hash.replace(/^#/, '') || '/inicio').split('?');
  const usuario = usuarioAtual();
  atualizarTopo(usuario);
  const rota = ROTAS.find((r) => r.caminho === caminho) ?? (usuario ? ROTAS.find((r) => r.caminho === '/inicio') : null);
  if (!rota || (!rota.publica && !usuario)) return irPara('/entrar');
  if (rota.perfis && !rota.perfis.includes(usuario.perfil)) {
    return montar(conteudo, mensagem(rota.caminho.startsWith('/admin') ? 'Esta área é exclusiva do administrador.' : 'Seu perfil não tem acesso a esta tela.', 'erro'));
  }
  if (rota.caminho.startsWith('/admin') && !rota.semToken && !temTokenAdmin()) {
    return irPara(`/admin/acesso?volta=${encodeURIComponent(caminho)}`);
  }
  montar(conteudo, h('p', { class: 'carregando' }, 'Carregando…'));
  try {
    const modulo = await rota.tela();
    await modulo.render(conteudo, { usuario, parametros: new URLSearchParams(consulta), irPara });
  } catch (e) {
    console.error(e);
    montar(conteudo, mensagem(`Erro ao abrir a tela: ${e.message}`, 'erro'));
  }
  window.scrollTo(0, 0);
}

if (modoDemonstracao()) document.getElementById('faixa-demo').hidden = false;
addEventListener('hashchange', navegar);
navegar();
