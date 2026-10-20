// Roteador por hash (#/caminho). Cada tela exporta render(container, contexto).
import { modoDemonstracao, temTokenAdmin } from './db.js';
import { sair, usuarioAtual } from './sessao.js';
import { h, montar, mensagem } from './ui.js';
import { atualizarCasca, iniciarCasca } from './menu.js';
import { podeTela } from '../shared/perfis.mjs';

// `telas`: códigos de shared/perfis.mjs — basta o perfil do usuário ter um deles (função = depende do endereço)
const ROTAS = [
  { caminho: '/entrar', tela: () => import('./telas/entrar.js'), publica: true },
  { caminho: '/inicio', tela: () => import('./telas/inicio.js'), telas: ['inicio'] },
  { caminho: '/explorar', tela: () => import('./telas/explorar.js'), telas: ['explorar'] },
  { caminho: '/carteira', tela: () => import('./telas/carteira.js'), telas: (q) => [q.get('aba') === 'acompanhamento' ? 'acompanhamento' : 'lista'] },
  { caminho: '/ficha', tela: () => import('./telas/ficha.js'), telas: ['lista', 'acompanhamento', 'credito'] },
  { caminho: '/registrar', tela: () => import('./telas/registrar.js'), telas: ['registrar'] },
  { caminho: '/lote', tela: () => import('./telas/lote.js'), telas: ['registrar'] },
  { caminho: '/financeiro', tela: () => import('./telas/financeiro.js'), telas: ['credito'] },
  { caminho: '/financeiro/liberar', tela: () => import('./telas/financeiro-liberar.js'), telas: ['credito'] },
  { caminho: '/admin/acesso', tela: () => import('./telas/admin-acesso.js'), perfis: ['administrador'], semToken: true },
  { caminho: '/admin/importar/base', tela: () => import('./telas/admin-importar-base.js'), telas: ['admin_base'] },
  { caminho: '/admin/importar/tipos', tela: () => import('./telas/admin-importar-tipos.js'), telas: ['admin_tipos'] },
  { caminho: '/admin/importar/erp', tela: () => import('./telas/admin-importar-erp.js'), telas: ['admin_erp'] },
  { caminho: '/admin/importar/credito', tela: () => import('./telas/admin-importar-credito.js'), telas: ['admin_credito'] },
  { caminho: '/admin/importacoes', tela: () => import('./telas/admin-importacoes.js'), telas: ['admin_importacoes'] },
  { caminho: '/admin/usuarios', tela: () => import('./telas/admin-usuarios.js'), telas: ['admin_usuarios'] },
  { caminho: '/admin/perfis', tela: () => import('./telas/admin-perfis.js'), telas: ['admin_usuarios'] },
  { caminho: '/admin/parametros', tela: () => import('./telas/admin-parametros.js'), telas: ['admin_parametros'] },
  { caminho: '/admin/feriados', tela: () => import('./telas/admin-feriados.js'), telas: ['admin_feriados'] },
];
// primeira tela permitida (destino quando o perfil não tem o Início)
const ENTRADAS = [['inicio', '/inicio'], ['lista', '/carteira'], ['acompanhamento', '/carteira?aba=acompanhamento'], ['credito', '/financeiro'],
  ['admin_usuarios', '/admin/usuarios'], ['admin_base', '/admin/importar/base']];
export function telaInicial(usuario) {
  return ENTRADAS.find(([t]) => podeTela(usuario, t))?.[1] ?? '/inicio';
}

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
  const telasRota = typeof rota.telas === 'function' ? rota.telas(new URLSearchParams(consulta)) : rota.telas;
  const liberada = (!rota.perfis || rota.perfis.includes(usuario?.perfil)) && (!telasRota || telasRota.some((t) => podeTela(usuario, t)));
  if (!rota.publica && !liberada) {
    // sem o Início no perfil: vai para a primeira tela permitida
    if (rota.caminho === '/inicio' && telaInicial(usuario) !== '/inicio') return irPara(telaInicial(usuario));
    montar(conteudo, mensagem(rota.caminho.startsWith('/admin') && usuario.perfil !== 'administrador'
      ? 'Esta área é exclusiva do administrador.' : 'Seu perfil não tem acesso a esta tela.', 'erro'));
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
// Logotipo da empresa (web/logo-germani.jpg): se o arquivo existir, aparece no menu e na tela de entrada;
// sem ele, fica a marca em texto.
const LOGO = 'logo-germani.jpg';
const sondaLogo = new Image();
sondaLogo.onload = () => document.documentElement.classList.add('com-logo');
sondaLogo.src = LOGO;

navegar();
