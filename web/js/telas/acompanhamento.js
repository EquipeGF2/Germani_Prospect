// Acompanhamento: onde está cada cliente da base, do cadastro ao pedido faturado, e o crédito liberado × os pedidos. docs/03 §6.1
// Hierarquia de níveis como no Explorar carteira, sem listas de filtro. Lê os clientes em processo uma vez (em cache) e usa os pedidos já lidos;
// etapas, árvore, cascata e busca só redesenham no navegador. Os encerrados só são lidos ao clicar neles.
import { bancoApp, lerComCache } from '../db.js';
import { buscarAcomp, cascata, compararCredito, consultaAcompanhamento, contarCredito, contarFluxo, etapaDoStatus, ETAPAS_FLUXO, formaLiberada, linhasDaEtapa, montarArvoreAcomp, montarClientes, NIVEIS_ACOMP, niveisAcompPossiveis, NOME_ETAPA, nomeRepresentante, prazoLiberado } from '../../shared/acompanhamento.mjs';
import { consultaPedidos, consultaSaldoFiliais, rotuloRepresentante } from '../../shared/pedidos.mjs';
import { consultaResumo } from '../../shared/explorar.mjs';
import { podeTela, veTodasEquipes } from '../../shared/perfis.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { STATUS_ENCERRADOS } from '../../shared/status.mjs';
import { h, montar, formatar, selo, baixarCsv, comEspera } from '../ui.js';
import { gerarPdfLista } from '../relatorio.js';
import { nomeStatus, seloStatus } from './_carteira.js';
import { blocoNiveis, chaveVerPor, documento, lerPedidos, lerVerPor, moeda, razaoSocial, seloSituacao, valor } from './_pedidos.js';

const CHAVE_NIVEIS = 'germani.acompNiveis';
const CHAVE_PEDIDOS = 'germani.acompPedidos';
const LIMITE_GRID = 500;
const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const lerGuardado = (chave) => { try { return localStorage.getItem(chave); } catch { return null; } };
const guardar = (chave, v) => { try { localStorage.setItem(chave, v); } catch { /* só nesta visita */ } };
const SITUACAO_CREDITO = { dentro: ['Dentro do limite', 'ok'], acima: ['Acima do limite', 'erro'], sem_limite: ['Sem limite', ''] };
const NOME_CREDITO = { todos: 'Com pedido em carteira', dentro: 'Dentro do limite', acima: 'Acima do limite', sem_limite: 'Sem limite' };

function lerNiveis(possiveis, padrao) {
  try {
    const salvo = JSON.parse(lerGuardado(CHAVE_NIVEIS) ?? 'null');
    if (Array.isArray(salvo)) { const ok = salvo.filter((n) => possiveis.includes(n)); if (ok.length) return ok; }
  } catch { /* padrão */ }
  return padrao.filter((n) => possiveis.includes(n));
}

export async function render(conteudo, { usuario, parametros }) {
  const db = await bancoApp();
  const [clientes, pedidos, filiais, resumo] = (await Promise.all([lerComCache(db, consultaAcompanhamento({ usuario }), 300),
    lerPedidos(db, consultaPedidos({ usuario, limite: 50000 })), lerPedidos(db, consultaSaldoFiliais()), lerComCache(db, consultaResumo({ usuario }), 300)])).map((r) => r.rows);
  const hoje = hojeSaoPaulo();
  const saldoFiliais = new Map(filiais.map((f) => [f.raiz, Number(f.saldo)]));
  const totalEncerrados = resumo.filter((l) => STATUS_ENCERRADOS.includes(l.status_atual)).reduce((t, l) => t + Number(l.qtd), 0);
  const possiveis = niveisAcompPossiveis(usuario);
  const raiz = veTodasEquipes(usuario) ? 'Todos os clientes' : usuario.perfil === 'supervisor' ? 'Clientes da minha equipe' : 'Meus clientes';
  const podeRegistrar = usuario.perfil !== 'financeiro';
  const registrarPermitido = (c) => podeRegistrar && !['venda_realizada', 'invalido', 'expurgado'].includes(c.status_atual)
    && (usuario.perfil !== 'supervisor' || !usuario.ve_todos || Number(c.supervisor_id) === usuario.id || Number(c.vendedor_id) === usuario.id);

  const estado = { visao: 'fluxo', porGrupo: lerVerPor() === 'grupo', soPrimeiro: lerGuardado(CHAVE_PEDIDOS) !== 'todos', etapa: etapaDoStatus(parametros?.get('status')), credito: 'todos',
    niveis: lerNiveis(possiveis, ['supervisor', 'representante']), abertos: new Set(['']), sel: '', editarNiveis: false, busca: parametros?.get('busca') ?? '', fechados: new Set(), encerrados: null, lendo: false };
  const campoBusca = h('input', { type: 'search', id: 'busca-acomp', value: estado.busca, 'aria-label': 'Buscar na lista', placeholder: 'Cliente, CNPJ, pedido ou representante',
    oninput: () => { estado.busca = campoBusca.value; desenhar(); campoBusca.focus(); } });

  const area = h('div', { id: 'acompanhamento', class: 'ped-exp acf-exp' });
  const slotChaves = h('div', { class: 'acf-chaves' });
  const nome = (n) => NIVEIS_ACOMP[n].nome;
  const mudarNiveis = (n) => { estado.niveis = n; estado.abertos = new Set(['']); estado.sel = ''; estado.fechados = new Set(); guardar(CHAVE_NIVEIS, JSON.stringify(n)); desenhar(); };
  const todos = () => montarClientes({ clientes, encerrados: estado.encerrados ?? [], pedidos });

  async function abrirEtapa(e) {
    estado.etapa = e; estado.fechados = new Set();
    if (e === 'encerrados' && !estado.encerrados && !estado.lendo) {
      estado.lendo = true; desenhar();
      estado.encerrados = (await lerComCache(db, consultaAcompanhamento({ usuario, encerrados: true }), 300)).rows;
      estado.lendo = false;
    }
    desenhar();
  }

  function desenharChaves() {
    const chave = (rotulo, opcoes, atual, aoMudar) => h('div', { class: 'ped-chave', role: 'group', 'aria-label': rotulo }, opcoes.map(([v, t, id]) =>
      h('button', { type: 'button', id, class: v === atual ? 'ativa' : '', 'aria-pressed': v === atual ? 'true' : 'false', onclick: () => { aoMudar(v); desenharChaves(); desenhar(); } }, t)));
    montar(slotChaves,
      chave('Visão', [['fluxo', 'Fluxo', 'visao-fluxo'], ['credito', 'Crédito × Pedido', 'visao-credito']], estado.visao, (v) => { estado.visao = v; estado.fechados = new Set(); }),
      chave('Dados dos pedidos', [[true, 'Apenas o primeiro pedido', 'so-primeiro'], [false, 'Todos os pedidos', 'todos-pedidos']], estado.soPrimeiro, (v) => { estado.soPrimeiro = v; guardar(CHAVE_PEDIDOS, v ? 'primeiro' : 'todos'); }),
      chaveVerPor(estado.porGrupo ? 'grupo' : 'empresa', (v) => { estado.porGrupo = v === 'grupo'; estado.fechados = new Set(); desenhar(); }));
  }

  const cartao = (id, ativo, titulo, numero, detalhes, aoClicar) => h('button', { type: 'button', class: `acf-etapa${ativo ? ' ativa' : ''}`, id, 'aria-pressed': ativo ? 'true' : 'false', onclick: aoClicar },
    h('span', { class: 'tit' }, titulo), h('b', {}, n0(numero)), detalhes.map(([t, aviso]) => h('span', { class: aviso ? 'acf-aviso' : '' }, t || ' ')));

  function fluxo(n) {
    const parte = (q) => `${n.cadastro ? Math.round((q / n.cadastro) * 100) : 0}% dos cadastros`;
    const comPedidos = (q, e) => `${n.cadastro ? Math.round((q / n.cadastro) * 100) : 0}% · ${n0(n.qtdPedidos[e])} ${n.qtdPedidos[e] === 1 ? 'pedido' : 'pedidos'}`;
    const seta = () => h('span', { class: 'acf-seta', 'aria-hidden': 'true' }, '›');
    const aviso = n.sem_cadastro ? h('p', { class: 'mensagem alerta', id: 'aviso-sem-cadastro' }, `${n0(n.sem_cadastro)} ${n.sem_cadastro === 1 ? 'cliente tem pedido' : 'clientes têm pedido'} sem registro de cadastro. Importe o `,
      podeTela(usuario, 'admin_credito') ? h('a', { href: '#/admin/importar/credito' }, 'relatório de cadastro e crédito') : 'relatório de cadastro e crédito',
      ': os pedidos já estão guardados, não precisam ser importados de novo, e o cliente entra no fluxo.') : null;
    const ir = (e) => () => abrirEtapa(e);
    return [aviso, h('div', { class: 'acf-fluxo', id: 'acf-fluxo' },
      cartao('etapa-cadastro', estado.etapa === 'cadastro', NOME_ETAPA.cadastro, n.cadastro, [['entraram no fluxo'], ['']], ir('cadastro')), seta(),
      cartao('etapa-analise', estado.etapa === 'analise', NOME_ETAPA.analise, n.analise, [[parte(n.analise)], [n.vencidas ? `${n0(n.vencidas)} vencidas` : '', true]], ir('analise')), seta(),
      cartao('etapa-pedido', estado.etapa === 'pedido', NOME_ETAPA.pedido, n.pedido, [[parte(n.pedido)], [n.naoValidos ? `${n0(n.naoValidos)} pedido não válido` : '', true]], ir('pedido')), seta(),
      cartao('etapa-carteira', estado.etapa === 'carteira', NOME_ETAPA.carteira, n.carteira, [[comPedidos(n.carteira, 'carteira')], [moeda(n.valor.carteira)]], ir('carteira')), seta(),
      cartao('etapa-faturado', estado.etapa === 'faturado', NOME_ETAPA.faturado, n.faturado, [[comPedidos(n.faturado, 'faturado')], [moeda(n.valor.faturado)]], ir('faturado'))),
    h('div', { class: 'acf-fora' }, h('span', { class: 'ajuda' }, 'Fora do fluxo:'),
      h('button', { type: 'button', id: 'etapa-antes', class: `chip-situacao${estado.etapa === 'antes' ? ' ativa' : ''}`, onclick: ir('antes') }, `${NOME_ETAPA.antes} (${n0(n.antes)})`),
      h('button', { type: 'button', id: 'etapa-sem_cadastro', class: `chip-situacao${estado.etapa === 'sem_cadastro' ? ' ativa' : ''}`, hidden: !n.sem_cadastro && estado.etapa !== 'sem_cadastro', onclick: ir('sem_cadastro') }, `${NOME_ETAPA.sem_cadastro} (${n0(n.sem_cadastro)})`),
      h('button', { type: 'button', id: 'etapa-encerrados', class: `chip-situacao${estado.etapa === 'encerrados' ? ' ativa' : ''}`, onclick: ir('encerrados') }, `${NOME_ETAPA.encerrados} (${n0(estado.encerrados ? n.encerrados : totalEncerrados)})`))];
  }

  function credito(t) {
    const parte = (q) => `${t.todos ? Math.round((q / t.todos) * 100) : 0}% dos clientes`;
    const ir = (e) => () => { estado.credito = e; estado.fechados = new Set(); desenhar(); };
    return [h('div', { class: 'acf-fluxo', id: 'acf-credito' },
      cartao('credito-todos', estado.credito === 'todos', NOME_CREDITO.todos, t.todos, [['clientes comparados'], [moeda(t.saldo)]], ir('todos')),
      cartao('credito-dentro', estado.credito === 'dentro', NOME_CREDITO.dentro, t.dentro, [[parte(t.dentro)], ['pedido cabe no limite']], ir('dentro')),
      cartao('credito-acima', estado.credito === 'acima', NOME_CREDITO.acima, t.acima, [[parte(t.acima)], ['em carteira maior que o limite', true]], ir('acima')),
      cartao('credito-sem_limite', estado.credito === 'sem_limite', NOME_CREDITO.sem_limite, t.sem_limite, [[parte(t.sem_limite)], ['sem limite a comparar']], ir('sem_limite'))),
    h('p', { class: 'ajuda acf-nota' }, 'Compara o limite com os pedidos em carteira. Títulos faturados e não pagos também consomem o limite no ERP e não vêm nos relatórios. Forma e prazo do pedido entram quando o relatório trouxer esses dados.')];
  }

  function arvoreNaTela(arvore, escolhido) {
    const clicarLinha = (n) => {
      if (n.temFilhos && n.aberto && estado.sel === n.caminho) estado.abertos.delete(n.caminho);
      else { estado.sel = n.caminho; estado.fechados = new Set(); if (n.temFilhos) estado.abertos.add(n.caminho); }
      desenhar();
    };
    const emFluxo = estado.visao === 'fluxo';
    const opcoes = { porGrupo: estado.porGrupo, soPrimeiro: estado.soPrimeiro };
    const celulas = (n) => {
      if (emFluxo) { const x = contarFluxo(n.clientes, opcoes); return [x.cadastro, ...ETAPAS_FLUXO.map((e) => x[e])].map(n0); }
      const x = contarCredito(compararCredito(n.clientes, { ...opcoes, saldoFiliais }), opcoes);
      return [n0(x.todos), n0(x.dentro), n0(x.acima), n0(x.sem_limite), valor(x.saldo)];
    };
    const titulos = emFluxo ? ['Cadastros', 'Análise financeira', 'Aguardando pedido', 'Em carteira', 'Faturado'] : ['Com pedido', 'Dentro do limite', 'Acima do limite', 'Sem limite', 'Em carteira (R$)'];
    return h('section', { class: 'cartao exp-arvore', 'aria-label': 'Hierarquia' }, h('div', { class: 'rolagem' },
      h('div', { class: 'exp-linha cab' }, ['Hierarquia', ...titulos].map((t, i) => h('span', { class: i ? 'num' : '' }, t))),
      arvore.map((n) => h('div', { class: `exp-linha${n.caminho === escolhido.caminho ? ' escolhida' : ''}${n.profundidade ? '' : ' raiz'}`, dados: { caminho: n.caminho }, onclick: () => clicarLinha(n) },
        h('span', { class: 'ramo', style: `padding-left:${n.profundidade * 24}px` },
          n.temFilhos ? h('button', { type: 'button', class: 'abre', 'aria-expanded': n.aberto ? 'true' : 'false', 'aria-label': `${n.aberto ? 'Recolher' : 'Reexibir'} ${n.rotulo}`,
            onclick: (ev) => { ev.stopPropagation(); if (n.aberto) estado.abertos.delete(n.caminho); else estado.abertos.add(n.caminho); desenhar(); } }, n.aberto ? '▼' : '▶') : h('span', { class: 'abre vazio' }),
          h('button', { type: 'button', class: 'nome', title: n.rotulo }, n.rotulo)),
        celulas(n).map((v) => h('span', { class: 'num' }, v))))));
  }

  // ---------- grid: colunas de cada etapa, em cascata ----------
  const colunaCliente = { titulo: 'Razão social', valor: (l) => razaoSocial({ codigo: l.cliente.codigo_cliente_erp, razao: l.cliente.razao_social, doc: l.cliente.cnpj, prospectId: l.cliente.id }), classe: 'rz' };
  const colunaDono = { titulo: 'Representante', valor: (l) => nomeRepresentante(l.cliente) };
  const colunaVendeu = { titulo: 'Quem vendeu', valor: (l) => (l.pedido ? rotuloRepresentante(l.pedido) : nomeRepresentante(l.cliente)) };
  const data = (titulo, f) => ({ titulo, valor: (l) => formatar.data(f(l)) || '—', classe: 'cen' });
  const qtdDias = (titulo) => ({ titulo, valor: (l) => (l.dias == null ? '—' : n0(l.dias)), classe: 'cen' });
  const proximaAcao = { titulo: 'Próxima ação', valor: (l) => (l.cliente.data_proxima_acao ? h('span', { class: Number(l.cliente.retorno_pendente) ? 'alerta-txt' : '' }, `Retorno ${formatar.data(l.cliente.data_proxima_acao)}`) : '—'), classe: 'cen' };
  const registrar = podeRegistrar ? { titulo: '', valor: (l) => (registrarPermitido(l.cliente) ? h('a', { href: `#/registrar?id=${l.cliente.id}`, class: 'registrar' }, 'Registrar') : null), classe: 'cen' } : null;
  const ordem = { titulo: 'Ordem', valor: (l) => (l.pedido ? `${l.pedido.ordem}º` : '—'), classe: 'cen' };
  const numero = { titulo: 'Pedido', valor: (l) => l.pedido?.numero ?? '—', classe: 'cen' };
  const COLUNAS = {
    cadastro: [colunaCliente, colunaDono, data('Cadastrado em', (l) => l.cliente.dt_cadastro_erp), { titulo: 'Etapa atual', valor: (l) => selo(NOME_ETAPA[l.cliente.etapa], ''), classe: 'cen' }, qtdDias('Dias no fluxo')],
    antes: [colunaCliente, colunaDono, data('Atendido em', (l) => l.cliente.dt_atendido), data('Prazo do cadastro', (l) => l.cliente.prazo_cadastro_ate), qtdDias('Dias aguardando'),
      { titulo: 'Situação', valor: (l) => (Number(l.cliente.prazo_cadastro_vencido) ? selo('Vencido', 'erro') : selo('No prazo', 'ok')), classe: 'cen' }, proximaAcao, registrar],
    sem_cadastro: [colunaCliente, colunaDono, data('Primeiro pedido em', (l) => l.cliente.primeiro?.data_primeira ?? l.cliente.dt_pedido), { titulo: 'Pedidos', valor: (l) => n0(l.cliente.pedidos.length), classe: 'cen' },
      { titulo: 'Valor (R$)', valor: (l) => valor(l.cliente.pedidos.reduce((t, p) => t + Number(p.valor_pedido), 0)), classe: 'cen' }, qtdDias('Dias sem cadastro'), { titulo: 'Situação', valor: () => selo('Falta o cadastro', 'alerta'), classe: 'cen' }],
    analise: [colunaCliente, colunaDono, data('Cadastrado em', (l) => l.cliente.dt_cadastro_erp), data('Prazo da análise', (l) => l.cliente.analise_financeira_ate), qtdDias('Dias na etapa'),
      { titulo: 'Situação', valor: (l) => (Number(l.cliente.analise_financeira_vencida) ? selo('Vencida', 'erro') : selo('No prazo', 'ok')), classe: 'cen' }, registrar],
    pedido: [colunaCliente, colunaDono, data('Liberado em', (l) => l.cliente.dt_liberacao_credito), { titulo: 'Forma e prazo', valor: (l) => [formaLiberada(l.cliente), prazoLiberado(l.cliente)].filter(Boolean).join(', ') || '—', classe: 'cen' },
      { titulo: 'Limite (R$)', valor: (l) => textoLimite(l.cliente.limite_credito), classe: 'cen' }, qtdDias('Dias na etapa'),
      { titulo: 'Situação', valor: (l) => (l.cliente.status_atual === 'aguardando_pedido_valido' ? selo('Pedido não válido', 'alerta') : selo('Sem pedido', '')), classe: 'cen' }, proximaAcao, registrar],
    carteira: [colunaCliente, colunaVendeu, numero, ordem, data('Data do pedido', (l) => l.pedido?.data_primeira), { titulo: 'Valor (R$)', valor: (l) => (l.pedido ? valor(l.pedido.valor_pedido) : '—'), classe: 'cen' }, qtdDias('Dias em carteira'),
      { titulo: 'Situação', valor: (l) => (l.pedido ? seloSituacao(l.pedido) : '—'), classe: 'cen' }],
    faturado: [colunaCliente, colunaVendeu, numero, ordem, data('Faturado em', (l) => l.pedido?.data_situacao), { titulo: 'Pedido (R$)', valor: (l) => (l.pedido ? valor(l.pedido.valor_pedido) : '—'), classe: 'cen' },
      { titulo: 'Faturado (R$)', valor: (l) => (l.pedido ? valor(l.pedido.valor_faturado) : '—'), classe: 'cen' }, qtdDias('Dias do cadastro ao faturamento'), { titulo: 'Situação', valor: (l) => (l.pedido ? seloSituacao(l.pedido) : '—'), classe: 'cen' }],
    encerrados: [colunaCliente, colunaDono, { titulo: 'Status', valor: (l) => seloStatus(l.cliente), classe: 'cen' }, data('Encerrado em', (l) => l.cliente.dt_baixa ?? l.cliente.dt_ultimo_contato), { titulo: 'Motivo', valor: (l) => l.cliente.motivo_sem_interesse ?? '—' }],
    credito: [colunaCliente, { titulo: 'Quem vendeu', valor: (l) => rotuloRepresentante(l.pedido) }, numero, ordem, { titulo: 'Limite (R$)', valor: (l) => textoLimite(l.comparado.limite), classe: 'cen' },
      { titulo: 'Em carteira (R$)', valor: (l) => valor(l.pedido?.saldo), classe: 'cen' }, { titulo: 'Uso do limite', valor: (l) => h('span', { class: l.comparado.situacao === 'acima' ? 'alerta-txt' : '' }, pct(l.comparado.uso)), classe: 'cen' },
      { titulo: 'Forma liberada', valor: (l) => formaLiberada(l.cliente) ?? '—', classe: 'cen' }, { titulo: 'Prazo liberado', valor: (l) => prazoLiberado(l.cliente) ?? '—', classe: 'cen' },
      { titulo: 'Situação', valor: (l) => selo(...SITUACAO_CREDITO[l.comparado.situacao]), classe: 'cen' }],
  };

  function linhasDaGrid(escolhido) {
    if (estado.visao === 'fluxo') return linhasDaEtapa(escolhido.clientes, { etapa: estado.etapa, porGrupo: estado.porGrupo, soPrimeiro: estado.soPrimeiro, hoje });
    const comparados = compararCredito(escolhido.clientes, { soPrimeiro: estado.soPrimeiro, saldoFiliais }).filter((l) => estado.credito === 'todos' || l.situacao === estado.credito);
    return comparados.flatMap((l) => l.pedidos.map((p) => ({ cliente: l.cliente, pedido: p, comparado: l }))).sort((a, b) => (b.comparado.uso ?? -1) - (a.comparado.uso ?? -1));
  }

  function grid(escolhido) {
    const emFluxo = estado.visao === 'fluxo';
    const colunas = COLUNAS[emFluxo ? estado.etapa : 'credito'].filter(Boolean);
    const lidas = buscarAcomp(linhasDaGrid(escolhido), estado.busca);
    // a cascata começa no nível seguinte ao da linha escolhida; Cliente é a própria linha da grid
    const niveisDaGrid = estado.niveis.slice(escolhido.profundidade).filter((n) => n !== 'cliente');
    const montada = cascata(lidas, { niveis: niveisDaGrid, fechados: estado.fechados, porGrupo: estado.porGrupo });
    const caminhos = () => cascata(lidas, { niveis: niveisDaGrid, porGrupo: estado.porGrupo }).filter((x) => x.cabecalho).map((x) => x.caminho);
    const titulo = `${emFluxo ? NOME_ETAPA[estado.etapa] : NOME_CREDITO[estado.credito]}${escolhido.caminho ? ` · ${escolhido.rotulo}` : ''}`;
    const unidade = lidas.some((l) => l.pedido) ? 'pedidos' : 'clientes';
    const alternar = (c) => { if (estado.fechados.has(c)) estado.fechados.delete(c); else estado.fechados.add(c); desenhar(); };
    const corpo = montada.slice(0, LIMITE_GRID).map((x) => (x.cabecalho
      ? h('tr', { class: 'ped-grupo', dados: { caminho: x.caminho } }, h('td', { colspan: String(colunas.length) }, h('button', { type: 'button', class: 'abre-grupo', style: `margin-left:${x.profundidade * 24}px`, 'aria-expanded': x.aberto ? 'true' : 'false',
        'aria-label': `${x.aberto ? 'Recolher' : 'Reexibir'} ${x.rotulo}`, onclick: () => alternar(x.caminho) }, `${x.aberto ? '▼' : '▶'} ${x.rotulo} · ${n0(x.qtd)}`)))
      : h('tr', {}, colunas.map((c, i) => h('td', { class: c.classe, style: i === 0 && x.profundidade ? `padding-left:${x.profundidade * 24 + 12}px` : null }, c.valor(x.linha))))));
    return h('div', { class: 'cartao' },
      h('div', { class: 'ped-lista-topo' }, h('h2', { id: 'titulo-acomp' }, `${titulo} (${n0(lidas.length)} ${unidade})`), campoBusca,
        h('button', { type: 'button', class: 'secundario pequeno', id: 'recolher-tudo', disabled: !caminhos().length, onclick: () => { estado.fechados = new Set(caminhos()); desenhar(); } }, 'Recolher tudo'),
        h('button', { type: 'button', class: 'secundario pequeno', id: 'reexibir-tudo', disabled: !estado.fechados.size, onclick: () => { estado.fechados = new Set(); desenhar(); } }, 'Reexibir tudo'),
        h('button', { type: 'button', class: 'secundario pequeno', id: 'imprimir-lista', disabled: !lidas.length, onclick: (ev) => imprimir(ev, lidas, titulo) }, 'Gerar PDF'),
        h('button', { type: 'button', class: 'secundario pequeno', id: 'csv-acomp', disabled: !lidas.length, onclick: () => baixarCsv(`acompanhamento-${hoje}.csv`, colunasCsv(colunas), lidas) }, 'Baixar CSV')),
      estado.lendo ? h('p', { class: 'ajuda' }, 'Lendo os encerrados…')
        : !lidas.length ? h('p', { class: 'ajuda', id: 'grid-vazia' }, estado.busca ? `Nada encontrado para "${estado.busca}".` : 'Nenhum cliente aqui.')
          : h('div', { class: 'tabela-wrap' }, h('table', { class: 'ped-tabela', id: 'grid-acomp' }, h('thead', {}, h('tr', {}, colunas.map((c) => h('th', {}, c.titulo)))), h('tbody', {}, corpo))),
      montada.length > LIMITE_GRID ? h('p', { class: 'ajuda', style: 'margin:12px 0 0' }, `Mostrando ${n0(LIMITE_GRID)} de ${n0(montada.length)} linhas. Clique numa linha da hierarquia para ver menos, ou baixe o CSV.`) : null);
  }

  // o CSV leva o texto de cada coluna, sem os elementos da tela
  const colunasCsv = (colunas) => colunas.filter((c) => c.titulo).map((c) => (c === colunaCliente
    ? [{ titulo: 'Código', texto: (l) => l.cliente.codigo_cliente_erp ?? '' }, { titulo: 'Razão social', texto: (l) => l.cliente.razao_social ?? '' }, { titulo: 'CNPJ', texto: (l) => documento(l.cliente.cnpj) }]
    : [{ titulo: c.titulo, texto: (l) => { const v = c.valor(l); return v instanceof Node ? v.textContent : v ?? ''; } }])).flat();

  async function imprimir(ev, lidas, titulo) {
    const botao = ev.currentTarget;
    const vistos = new Map();
    for (const l of lidas) vistos.set(l.cliente.id, l.cliente);
    const lista = [...vistos.values()];
    const linhaPdf = (p) => [p.razao_social ?? '', p.nome_fantasia && p.nome_fantasia !== p.razao_social ? p.nome_fantasia : '', formatar.cnpj(p.cnpj), p.endereco ?? '', p.bairro ?? '', p.cidade ? `${p.cidade}/${p.uf ?? ''}` : '', p.telefone ?? '', p.onda ?? '', p.tipologia_gtm ?? '',
      nomeStatus(p) ?? '', String(p.tentativas ?? 0), formatar.data(p.dt_primeiro_contato) || '—', p.dias_corridos != null ? String(p.dias_corridos) : '—'];
    await comEspera(botao, () => gerarPdfLista({ titulo: 'Acompanhamento', representante: usuario.perfil === 'vendedor' ? usuario.nome : 'Equipe', supervisor: '', emissao: formatar.data(hoje), resumo: [['Clientes', lista.length]],
      filtros: [titulo, estado.porGrupo ? 'Por grupo de CNPJ' : null, estado.busca ? `Busca: "${estado.busca}"` : null].filter(Boolean).join(' · '), blocos: [{ grupo: null, linhas: lista.map(linhaPdf) }], nomeArquivo: `acompanhamento-${hoje}.pdf` }));
  }

  function desenhar() {
    const base = todos();
    const arvore = montarArvoreAcomp({ clientes: base, niveis: estado.niveis, abertos: estado.abertos, rotuloRaiz: raiz });
    const escolhido = arvore.find((n) => n.caminho === estado.sel) ?? arvore[0];
    const etapas = arvore.filter((n) => estado.sel === n.caminho || estado.sel.startsWith(`${n.caminho}/`) || n.caminho === '').sort((a, b) => a.profundidade - b.profundidade);
    const migalhas = h('nav', { class: 'exp-caminho', 'aria-label': 'Linha escolhida' }, etapas.flatMap((n, i) => [
      h('button', { type: 'button', class: n.caminho === escolhido.caminho ? 'atual' : '', title: n.rotulo, onclick: () => { estado.sel = n.caminho; estado.fechados = new Set(); desenhar(); } }, n.profundidade ? `${nome(n.nivel)}: ${n.rotulo}` : n.rotulo),
      i < etapas.length - 1 ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null]));
    const opcoes = { porGrupo: estado.porGrupo, soPrimeiro: estado.soPrimeiro };
    const topo = estado.visao === 'fluxo' ? fluxo(contarFluxo(escolhido.clientes, opcoes))
      : credito(contarCredito(compararCredito(escolhido.clientes, { ...opcoes, saldoFiliais }), opcoes));
    montar(area, ...blocoNiveis({ estado, possiveis, nome, mudarNiveis, desenhar }), migalhas, ...topo, arvoreNaTela(arvore, escolhido), grid(escolhido));
  }

  desenharChaves();
  await abrirEtapa(estado.etapa);
  montar(conteudo, h('div', { class: 'exp-topo acf-topo' }, h('h1', {}, 'Acompanhamento'), slotChaves),
    h('p', { class: 'ajuda acf-frase' }, 'Onde está cada cliente da base, do cadastro identificado ao pedido faturado.'), area);
}

const textoLimite = (v) => {
  if (v == null || Number(v) >= 9999999) return 'Sem limite';
  return valor(v);
};
