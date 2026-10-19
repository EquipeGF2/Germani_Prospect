import { bancoApp } from '../db.js';
import { consultaCarteira } from '../../shared/carteira.mjs';
import { h, montar, mensagem, numeros } from '../ui.js';

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const status = (await db.execute(consultaCarteira({ usuario, visao: 'status' }))).rows;
  const soma = (f, campo = 'prospects') => status.filter(f).reduce((s, x) => s + Number(x[campo] ?? 0), 0);
  const lista = soma((s) => Number(s.na_lista));
  const acompanhamento = soma((s) => !Number(s.na_lista) && s.status_atual !== 'invalido');
  const retornos = soma(() => true, 'retornos_pendentes');
  const vencidos = soma(() => true, 'prazos_cadastro_vencidos');

  const atalhos = [
    ['#/carteira', 'Lista principal', `${lista} prospect(s) não contactado(s) ou em prospecção`],
    ['#/carteira?aba=acompanhamento', 'Acompanhamento', `${acompanhamento} cliente(s) em cadastro, análise, pedido, venda ou sem interesse`],
  ];
  if (retornos) atalhos.push(['#/carteira?somenteRetornos=1', 'Retornos', `${retornos} retorno(s) vencido(s) ou para hoje`]);
  if (usuario.perfil === 'administrador') atalhos.push(['#/admin', 'Administração', 'Importações, usuários e parâmetros']);
  montar(conteudo,
    h('h1', {}, `Olá, ${usuario.nome.split(' ')[0]}`),
    numeros([['na lista principal', lista], ['no acompanhamento', acompanhamento], ['retornos pendentes', retornos, retornos ? 'alerta' : ''],
      ['prazos de cadastro vencidos', vencidos, vencidos ? 'erro' : '']]),
    status.length && !lista && !acompanhamento ? mensagem('Sua carteira ainda está vazia. A base de prospects é importada pelo administrador.', 'info') : null,
    h('div', { class: 'grade' }, atalhos.map(([href, t, d]) => h('a', { class: 'atalho', href }, h('b', {}, t), h('small', {}, d)))),
    usuario.perfil === 'financeiro' ? mensagem('Em construção: console de análise financeira (parte 4 do app).', 'info') : null,
    mensagem('Em construção: painel de indicadores e rotas (parte 5 do app).', 'info'));
}
