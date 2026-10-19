// Roteador por hash (#/caminho). Cada tela exporta render(container, contexto).
import { modoDemonstracao, temTokenAdmin } from './db.js';
import { sair, usuarioAtual } from './sessao.js';
import { h, montar, mensagem } from './ui.js';
import { atualizarCasca, iniciarCasca } from './menu.js';

const ROTAS = [
  { caminho: '/entrar', tela: () => import('./telas/entrar.js'), publica: true },
  { caminho: '/inicio', tela: () => import('./telas/inicio.js') },
  { caminho: '/carteira', tela: () => import('./telas/carteira.js') },
  { caminho: '/ficha', tela: () => import('./telas/ficha.js') },
  { caminho: '/registrar', tela: () => import('./telas/registrar.js'), perfis: ['administrador', 'gerente', 'supervisor', 'vendedor'] },
  { caminho: '/lote', tela: () => import('./telas/lote.js'), perfis: ['administrador', 'gerente', 'supervisor', 'vendedor'] },
  { caminho: '/financeiro', tela: () => import('./telas/financeiro.js'), perfis: ['financeiro', 'administrador'] },
  { caminho: '/financeiro/liberar', tela: () => import('./telas/financeiro-liberar.js'), perfis: ['financeiro', 'administrador'] },
  { caminho: '/admin/acesso', tela: () => import('./telas/admin-acesso.js'), perfis: ['administrador'], semToken: true },
  { caminho: '/admin/importar/base', tela: () => import('./telas/admin-importar-base.js'), perfis: ['administrador'] },
  { caminho: '/admin/importar/tipos', tela: () => import('./telas/admin-importar-tipos.js'), perfis: ['administrador'] },
  { caminho: '/admin/importar/erp', tela: () => import('./telas/admin-importar-erp.js'), perfis: ['administrador'] },
  { caminho: '/admin/importar/credito', tela: () => import('./telas/admin-importar-credito.js'), perfis: ['administrador'] },
  { caminho: '/admin/importacoes', tela: () => import('./telas/admin-importacoes.js'), perfis: ['administrador'] },
  { caminho: '/admin/usuarios', tela: () => import('./telas/admin-usuarios.js'), perfis: ['administrador'] },
  { caminho: '/admin/parametros', tela: () => import('./telas/admin-parametros.js'), perfis: ['administrador'] },
  { caminho: '/admin/feriados', tela: () => import('./telas/admin-feriados.js'), perfis: ['administrador'] },
];

export const NOMES_PERFIL = { administrador: 'Administrador', gerente: 'Gerente comercial', supervisor: 'Supervisor', vendedor: 'Vendedor', financeiro: 'Analista financeiro' };

export function irPara(caminho) {
  location.hash = `#${caminho}`;
}

function papelDe(usuario) {
  return usuario.perfil === 'vendedor' ? (usuario.tipo_atuacao === 'vendedor' ? 'Vendedor' : 'Representante') : NOMES_PERFIL[usuario.perfil];
}

async function navegar() {
  const alvo = location.hash;
  const area = document.getElementById('conteudo');
  area.dataset.pronto = '';
  // cada navegação desenha no seu próprio contêiner: se uma tela anterior ainda estiver carregando,
  // ela termina num contêiner que já saiu da página e não sobrescreve a tela atual
  const conteudo = h('div', { class: 'tela' });
  area.replaceChildren(conteudo);
  const [caminho, consulta = ''] = (location.hash.replace(/^#/, '') || '/inicio').split('?');
  const usuario = usuarioAtual();
  atualizarCasca({ usuario, caminho, consulta, papel: usuario ? papelDe(usuario) : '', aoSair: () => { sair(); irPara('/entrar'); } });
  const rota = ROTAS.find((r) => r.caminho === caminho) ?? (usuario ? ROTAS.find((r) => r.caminho === '/inicio') : null);
  if (!rota || (!rota.publica && !usuario)) return irPara('/entrar');
  if (rota.perfis && !rota.perfis.includes(usuario.perfil)) {
    montar(conteudo, mensagem(rota.caminho.startsWith('/admin') ? 'Esta área é exclusiva do administrador.' : 'Seu perfil não tem acesso a esta tela.', 'erro'));
    area.dataset.pronto = alvo;
    return;
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
  if (area.firstChild !== conteudo) return;   // o usuário já foi para outra tela
  area.dataset.pronto = alvo;   // tela desenhada para este endereço (os testes de tela esperam por isso)
  window.scrollTo(0, 0);
}

if (modoDemonstracao()) document.getElementById('faixa-demo').hidden = false;
iniciarCasca();
addEventListener('hashchange', navegar);
navegar();
