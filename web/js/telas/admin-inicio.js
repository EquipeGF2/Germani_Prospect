import { bancoAdmin, limparTokenAdmin, modoDemonstracao } from '../db.js';
import { h, montar, numeros, mensagem } from '../ui.js';

export async function render(conteudo, { irPara }) {
  const db = await bancoAdmin();
  const c = (await db.execute(`SELECT
      (SELECT count(*) FROM prospects) prospects,
      (SELECT count(*) FROM usuarios WHERE perfil IN ('vendedor','supervisor')) equipe,
      (SELECT count(*) FROM usuarios WHERE perfil IN ('vendedor','supervisor') AND senha_hash IS NULL) sem_acesso,
      (SELECT count(*) FROM usuarios WHERE perfil = 'vendedor' AND tipo_atuacao IS NULL) sem_tipo,
      (SELECT count(*) FROM importacoes) importacoes,
      (SELECT count(*) FROM movimentacoes) movimentos`)).rows[0];
  const passos = [
    ['#/admin/importar/base', '1 · Base de prospects', 'Carga inicial da planilha (uma vez)'],
    ['#/admin/importar/tipos', '2 · Representantes / vendedores', 'Quem tem rota (vendedor) e quem não tem'],
    ['#/admin/usuarios', '3 · Usuários e senhas', 'Liberar acesso da equipe, criar analista financeiro'],
    ['#/admin/importar/erp', '4 · Cadastro · Pedidos · Baixados', 'Arquivos do ERP (rotina)'],
    ['#/admin/importar/credito', '5 · Relatório de crédito', 'Forma, prazo e limite → Aguardando pedido'],
    ['#/admin/importacoes', 'Importações', 'Histórico e relatório linha a linha'],
    ['#/admin/parametros', 'Parâmetros', 'Prazos e alertas'],
  ];
  montar(conteudo,
    h('h1', {}, 'Administração'),
    numeros([['prospects na base', c.prospects], ['equipe (vend./sup.)', c.equipe], ['sem acesso liberado', c.sem_acesso, Number(c.sem_acesso) ? 'alerta' : ''],
      ['vendedores sem tipo', c.sem_tipo, Number(c.sem_tipo) ? 'alerta' : ''], ['importações', c.importacoes], ['movimentos no histórico', c.movimentos]]),
    h('div', { class: 'grade' }, passos.map(([href, t, d]) => h('a', { class: 'atalho', href }, h('b', {}, t), h('small', {}, d)))),
    modoDemonstracao() ? mensagem('Demonstração: baixe a planilha fictícia em "Base de prospects" para testar a carga.', 'info')
      : h('div', { class: 'acoes' }, h('button', { class: 'secundario', onclick: () => { limparTokenAdmin(); irPara('/admin/acesso'); } }, 'Encerrar acesso de administração nesta aba')));
}
