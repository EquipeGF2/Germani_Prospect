// Ficha do cliente: dados, situação, crédito e a linha do tempo (histórico de movimentação). docs/08
import { bancoApp } from '../db.js';
import { ajustarFicha, consultaCreditoErp, consultaFicha, consultaGrupoCnpj, consultaLinhaTempo } from '../../shared/carteira.mjs';
import { linkMapa, telefoneParaLink } from '../../shared/rotas.mjs';
import { consultaPedidos, consultaPedidosGrupo, porRepresentante, resumirPedidos, rotuloRepresentante } from '../../shared/pedidos.mjs';
import { h, montar, mensagem, formatar, tabela } from '../ui.js';
import { cartoes, moeda, valor, seloSituacao, tabelaPedidos } from './_pedidos.js';
import { seloStatus } from './_carteira.js';

const NOMES_FORMA = { antecipado: 'Antecipado', a_vista: 'À vista', boleto: 'Boleto', deposito: 'Depósito e Pix' };
const NOMES_ORIGEM = { contato: 'app', importacao: 'importação da base', erp: 'arquivo do ERP', financeiro: 'financeiro', transferencia: 'transferência', administracao: 'administração (Grupos de CNPJ)' };

/** Prazo do ERP: "14/21/28 dias · médio 21" · "à vista" · "antecipado"; sem dados do ERP, os dias informados. */
function textoPrazo(erp, p) {
  const parcelas = erp?.prazo_parcelas;
  if (parcelas && /^\d/.test(parcelas)) return `${parcelas} dias${parcelas.includes('/') ? ` · médio ${p.prazo_pagamento_dias}` : ''}`;
  if (parcelas) return parcelas === 'A VISTA' ? 'à vista' : 'antecipado';
  return p.prazo_pagamento_dias != null ? `${p.prazo_pagamento_dias} dia(s)` : null;
}

function dado(rotulo, valor) {
  if (valor == null || valor === '') return null;
  return h('div', { class: 'dado' }, h('span', {}, rotulo), h('b', {}, valor));
}

function linksContato(p) {
  const nacional = telefoneParaLink(p.telefone);
  const links = [];
  if (nacional) {
    links.push(h('a', { class: 'botao secundario', href: `tel:+${nacional}` }, 'Ligar'));
    links.push(h('a', { class: 'botao secundario', href: `https://wa.me/${nacional}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'));
  }
  const mapa = linkMapa(p);
  if (mapa) links.push(h('a', { class: 'botao secundario', href: mapa, target: '_blank', rel: 'noopener' }, 'Ver no mapa'));
  return links;
}

export async function render(conteudo, { usuario, parametros }) {
  const db = await bancoApp();
  const id = Number(parametros.get('id'));
  const linha = id ? (await db.execute(consultaFicha({ usuario, prospectId: id }))).rows[0] : null;
  if (!linha) return montar(conteudo, mensagem('Prospect não encontrado ou fora da sua carteira.', 'erro'));
  const p = ajustarFicha(usuario, linha);
  const [movimentos, [erp], grupo] = (await Promise.all([consultaLinhaTempo({ prospectId: id }), consultaCreditoErp({ prospectId: id }), consultaGrupoCnpj({ prospectId: id })]
    .map((c) => db.execute(c)))).map((r) => r.rows);
  // supervisor que vê todas as equipes registra só na própria equipe (regra do banco)
  const daEquipe = usuario.perfil !== 'supervisor' || !usuario.ve_todos || Number(p.supervisor_id) === usuario.id || Number(p.vendedor_id) === usuario.id;
  const podeRegistrar = usuario.perfil !== 'financeiro' && Number(p.aceita_contato) === 1 && daEquipe;
  const voltar = Number(p.na_lista) ? '#/carteira' : p.status_atual === 'venda_realizada' ? '#/pedidos' : '#/carteira?aba=acompanhamento';

  const situacao = h('div', { class: 'cartao' },
    h('div', { class: 'cartao-prospect-topo' }, h('h2', { style: 'margin:0' }, 'Situação'), seloStatus(p)),
    h('p', { style: 'margin:8px 0' }, p.status_descricao),
    h('div', { class: 'dados' },
      dado('Dias corridos (desde o 1º registro)', p.dias_corridos != null ? `${p.dias_corridos}` : 'sem registro ainda'),
      dado('Registros', formatar.numero(p.tentativas)),
      dado('1º registro', formatar.data(p.dt_primeiro_contato)),
      dado('Último registro', formatar.data(p.dt_ultimo_contato)),
      dado('Atendido em', formatar.data(p.dt_atendido)),
      dado('Pedido informado em', formatar.data(p.dt_pedido_informado)),
      dado('Próximo retorno', formatar.data(p.data_proxima_acao)),
      dado('Prazo para o cadastro', p.status_atual === 'aguardando_cadastro' ? formatar.data(p.prazo_cadastro_ate) : null),
      dado('Prazo da análise financeira', p.status_atual === 'analise_financeira' ? formatar.data(p.analise_financeira_ate) : null),
      dado(`Motivo (sem interesse${p.sem_interesse_origem ? ' do ' + p.sem_interesse_origem : ''})`, p.status_atual === 'sem_interesse' ? p.motivo_sem_interesse : null),
      dado('Cadastro no ERP', p.dt_cadastro_erp ? `${formatar.data(p.dt_cadastro_erp)}${p.codigo_cliente_erp ? ' · cód. ' + p.codigo_cliente_erp : ''}` : null),
      dado('Pedido', p.dt_pedido ? `${formatar.data(p.dt_pedido)}${p.numero_pedido ? ' · nº ' + p.numero_pedido : ''}${p.valor_pedidos != null ? ' · ' + formatar.moeda(Number(p.valor_pedidos)) : ''}` : null),
      dado('Baixa do CNPJ', formatar.data(p.dt_baixa))),
    [Number(p.prazo_cadastro_vencido) ? mensagem('Prazo de cadastro vencido.', 'erro') : null,
      Number(p.analise_financeira_vencida) ? mensagem('Análise financeira fora do prazo.', 'erro') : null,
      // o ERP só cria o atendimento quando não há registro do representante; com registro (ex.: sem interesse), só avança a etapa
      Number(p.convertido_sem_registro) ? mensagem(p.dt_atendido
        ? `Atendimento automático via importação do ERP em ${formatar.data(p.dt_atendido)} (sem registro do representante). Registre o atendimento para informar a data real — o registro do representante prevalece.`
        : 'Avançou de etapa via importação do ERP sem atendimento registrado pelo representante.', 'info') : null,
      Number(p.parado) ? mensagem(`Sem movimento há ${p.dias_sem_movimento} dias.`, 'info') : null]);

  const forma = p.forma_filtro ?? p.forma_pagamento;
  const semLimite = Number(erp?.sem_limite) === 1;
  const limite = p.limite_credito == null ? null
    : semLimite ? 'sem limite' : Number(p.limite_credito) === 0 ? 'sem crédito (só à vista ou antecipado)' : formatar.moeda(p.limite_credito);
  const comGrupo = grupo.length > 1;
  const credito = p.dt_liberacao_credito ? h('div', { class: 'cartao' },
    h('h2', {}, 'Cadastro e crédito no ERP'),
    h('div', { class: 'dados' },
      dado('Liberado em', formatar.data(p.dt_liberacao_credito)),
      dado('Condição de pagamento', erp?.cond_pgto_descricao || erp?.cond_pgto_codigo ? [erp.cond_pgto_codigo, erp.cond_pgto_descricao].filter(Boolean).join(' · ') : null),
      dado('Forma de pagamento', erp?.forma_pgto_descricao || erp?.forma_pgto_codigo
        ? `${erp.forma_pgto_descricao ?? erp.forma_pgto_codigo} (filtro: ${NOMES_FORMA[forma] ?? forma})` : NOMES_FORMA[forma] ?? forma),
      dado('Prazo', textoPrazo(erp, p)),
      dado('Limite', limite == null ? null : `${limite}${p.limite_credito_origem === 'grupo' ? ' (limite do grupo — Créd. Cliente vazio)' : ''}`),
      dado('Restrição de crédito', Number(p.com_restricao_credito) ? 'com restrição' : null))) : null;

  // grupo econômico: empresas da base com a mesma raiz de CNPJ (sem a razão social de carteiras alheias: só filial e situação)
  const blocoGrupo = comGrupo ? h('div', { class: 'cartao' },
    h('h2', {}, `Grupo · raiz ${formatar.cnpj(p.cnpj).slice(0, 10)}`),
    h('p', { class: 'ajuda' }, `${grupo.length} empresas da base com a mesma raiz de CNPJ. O crédito do grupo é um limite só para todas (não é somado).`),
    tabela([
      { titulo: 'Empresa', valor: (g) => `${formatar.cnpj(g.cnpj)}${Number(g.id) === id ? ' (esta)' : ''}` },
      { titulo: 'Situação', valor: (g) => seloStatus(g) },
      { titulo: 'Cadastro no ERP', valor: (g) => formatar.data(g.dt_cadastro_erp) || '—' },
      { titulo: 'Limite', valor: (g) => (g.limite_credito == null ? '—' : `${formatar.moeda(g.limite_credito)}${g.limite_credito_origem === 'grupo' ? ' (grupo)' : ''}`), classe: 'num' },
    ], grupo)) : null;

  const cadastro = h('div', { class: 'cartao' },
    h('h2', {}, 'Cadastro'),
    h('div', { class: 'dados' },
      dado('CNPJ', formatar.cnpj(p.cnpj)),
      dado('Nome fantasia', p.nome_fantasia),
      dado('Endereço', [p.endereco, p.bairro].filter(Boolean).join(' — ')),
      dado('Cidade', p.cidade ? `${p.cidade}/${p.uf ?? ''}${p.cep ? ' · CEP ' + p.cep : ''}` : null),
      dado('Telefone', p.telefone),
      dado('Tipologia', p.tipologia_gtm),
      dado('Onda', p.onda),
      dado('Rota', p.rota ? `${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : null),
      dado('Carteira', `${p.vendedor_nome}${p.vendedor_codigo ? ' · ' + p.vendedor_codigo : ''}`),
      dado('Supervisor', p.supervisor_nome),
      dado('Observação da base', p.obs)),
    h('div', { class: 'acoes' }, linksContato(p)));

  // pedidos do cliente (0022): o cliente fica com o dono da carteira; quem vendeu aparece com o seu valor
  const pedidos = (await db.execute(consultaPedidos({ usuario, prospectId: id }))).rows;
  const grupoPedidos = (await db.execute(consultaPedidosGrupo({ prospectId: id }))).rows;
  const filiaisForaDaBase = grupoPedidos.filter((g) => g.prospect_id == null);
  const blocoPedidos = pedidos.length || filiaisForaDaBase.length ? (() => {
    const r = resumirPedidos(pedidos);
    const reps = porRepresentante(pedidos).filter((x) => x.venda > 0);
    const somaGrupo = (campo) => grupoPedidos.reduce((t, g) => t + Number(g[campo] ?? 0), 0);
    const linha = (rotulo, v) => h('div', { class: 'ped-linha' }, h('span', {}, rotulo), h('b', {}, v));
    const motivo = pedidos.some((x) => x.tipo === 'venda' && x.fase === 'digitado') ? 'há pedido digitado, ainda fora da carteira' : 'o pedido foi cancelado';
    return h('div', { id: 'pedidos-cliente' },
      p.status_atual === 'aguardando_pedido_valido' ? mensagem(`Aguardando pedido válido: ${motivo}.`, 'info') : null,
      !pedidos.length ? null : cartoes([['Venda válida', moeda(r.venda.valor), `${r.venda.qtd} pedidos`, 'destaque'], ['Faturado', moeda(r.faturado)], ['Em carteira', moeda(r.saldo)], ['Digitado', moeda(r.digitado.valor), `${r.digitado.qtd} pedidos`],
        ['Desistência', moeda(r.cancelado.valor), `${r.cancelado.qtd} pedidos`], ['Investimento', moeda(r.investimento.valor), `${r.investimento.qtd} pedidos`, 'investimento']]),
      h('div', { class: 'ped-colunas' },
        !pedidos.length ? null : h('div', { class: 'largo' }, h('div', { class: 'cartao' }, h('h2', {}, `Pedidos do cliente (${pedidos.length})`),
          tabelaPedidos([{ titulo: 'Pedido', campo: 'numero', classe: 'num' }, { titulo: 'Data', valor: (x) => formatar.data(x.data_situacao), classe: 'num' }, { titulo: 'Tipo', valor: (x) => (x.tipo === 'investimento' ? 'Bonificação' : 'Venda'), classe: 'cen' },
            { titulo: 'Situação', valor: seloSituacao, classe: 'cen' }, { titulo: 'Pedido (R$)', valor: (x) => valor(x.valor_pedido), classe: 'num' }, { titulo: 'Faturado (R$)', valor: (x) => valor(x.valor_faturado), classe: 'num' }, { titulo: 'Representante', valor: rotuloRepresentante }], pedidos))),
        reps.length || grupoPedidos.length > 1 || filiaisForaDaBase.length ? h('div', { class: 'estreito' },
          reps.length ? h('div', { class: 'cartao' }, h('h2', {}, 'Quem vendeu'), reps.map((x) => linha(`${x.rotulo}${x.propria > 0 ? ', dono da carteira' : ''}`, moeda(x.venda))),
            h('p', { class: 'ajuda', style: 'margin:10px 0 0' }, 'O cliente fica com o dono da carteira, e a venda vai para quem a realizou.')) : null,
          grupoPedidos.length > 1 || filiaisForaDaBase.length ? h('div', { class: 'cartao', id: 'pedidos-grupo' }, h('h2', {}, `Grupo · raiz ${formatar.cnpj(p.cnpj).slice(0, 10)}`),
            linha('Empresas com pedido', grupoPedidos.length), filiaisForaDaBase.length ? linha('Filiais fora da base', filiaisForaDaBase.length) : null, linha('Venda válida do grupo', moeda(somaGrupo('venda'))), linha('Em carteira do grupo', moeda(somaGrupo('saldo'))), linha('Investimento do grupo', moeda(somaGrupo('investimento'))),
            p.limite_credito != null && p.limite_credito_origem === 'grupo' ? linha('Créd. Grupo', moeda(p.limite_credito)) : null,
            h('p', { class: 'ajuda', style: 'margin:10px 0 0' }, 'Mostra só pedidos em aberto. Sem os títulos a receber, é uma visão parcial do uso do limite.')) : null) : null));
  })() : null;

  const linhaTempo = h('div', { class: 'cartao' },
    h('h2', {}, 'Histórico de movimentação'),
    movimentos.length ? h('ol', { class: 'linha-tempo' }, movimentos.map((m) => h('li', { style: `--cor:${m.status_novo_cor ?? '#999'}` },
      h('div', { class: 'linha-tempo-data' }, formatar.data(m.data_evento)),
      h('div', {},
        h('b', {}, m.status_anterior && m.status_anterior !== m.status_novo ? `${m.status_anterior_nome} → ${m.status_novo_nome}` : m.status_novo_nome),
        h('div', {}, m.detalhe ?? m.tipo.replace(/_/g, ' ')),
        h('div', { class: 'ajuda', style: 'margin:0' },
          [m.usuario_nome ? `por ${m.usuario_nome}` : null, `via ${NOMES_ORIGEM[m.origem] ?? m.origem}`, `carteira: ${m.vendedor_nome}`].filter(Boolean).join(' · ')))))) 
      : h('p', { class: 'ajuda' }, 'Sem movimentos.'));

  montar(conteudo,
    h('a', { href: voltar, class: 'voltar' }, p.status_atual === 'venda_realizada' ? '‹ Voltar a Explorar pedidos' : '‹ Voltar à lista'),
    h('h1', { style: 'margin-top:8px' }, p.razao_social),
    podeRegistrar ? h('div', { class: 'acoes', style: 'margin:0 0 16px' }, h('a', { class: 'botao', href: `#/registrar?id=${p.id}` }, 'Registrar atendimento')) : null,
    situacao, blocoPedidos, credito, blocoGrupo, linhaTempo, cadastro);
}
