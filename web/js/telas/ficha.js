// Ficha do cliente: dados, situação, crédito e a linha do tempo (histórico de movimentação). docs/08
import { bancoApp } from '../db.js';
import { ajustarFicha, consultaFicha, consultaLinhaTempo } from '../../shared/carteira.mjs';
import { linkMapa } from '../../shared/rotas.mjs';
import { somenteDigitos } from '../../shared/texto.mjs';
import { h, montar, mensagem, formatar } from '../ui.js';
import { abasCarteira, seloStatus } from './_carteira.js';

const NOMES_FORMA = { antecipado: 'Antecipado', a_vista: 'À vista', boleto: 'Boleto' };
const NOMES_ORIGEM = { contato: 'app', importacao: 'importação da base', erp: 'arquivo do ERP', financeiro: 'financeiro', transferencia: 'transferência' };

function dado(rotulo, valor) {
  if (valor == null || valor === '') return null;
  return h('div', { class: 'dado' }, h('span', {}, rotulo), h('b', {}, valor));
}

function linksContato(p) {
  const fone = somenteDigitos(p.telefone ?? '');
  const links = [];
  if (fone.length >= 10) {
    const nacional = fone.startsWith('55') && fone.length > 11 ? fone : `55${fone}`;
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
  if (!linha) return montar(conteudo, abasCarteira('', usuario), mensagem('Prospect não encontrado ou fora da sua carteira.', 'erro'));
  const p = ajustarFicha(usuario, linha);
  const movimentos = (await db.execute(consultaLinhaTempo({ prospectId: id }))).rows;
  const podeRegistrar = usuario.perfil !== 'financeiro' && Number(p.aceita_contato) === 1;
  const voltar = Number(p.na_lista) ? '#/carteira' : '#/carteira?aba=acompanhamento';

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
      dado('Motivo (sem interesse)', p.status_atual === 'sem_interesse' ? p.motivo_sem_interesse : null),
      dado('Cadastro no ERP', p.dt_cadastro_erp ? `${formatar.data(p.dt_cadastro_erp)}${p.codigo_cliente_erp ? ' · cód. ' + p.codigo_cliente_erp : ''}` : null),
      dado('Pedido', p.dt_pedido ? `${formatar.data(p.dt_pedido)}${p.numero_pedido ? ' · nº ' + p.numero_pedido : ''}` : null),
      dado('Baixa do CNPJ', formatar.data(p.dt_baixa))),
    [Number(p.prazo_cadastro_vencido) ? mensagem('Prazo de cadastro vencido.', 'erro') : null,
      Number(p.analise_financeira_vencida) ? mensagem('Análise financeira fora do prazo.', 'erro') : null,
      Number(p.convertido_sem_registro) ? mensagem('Convertido sem registro de atendimento no app.', 'info') : null,
      Number(p.parado) ? mensagem(`Sem movimento há ${p.dias_sem_movimento} dias.`, 'info') : null]);

  const credito = p.dt_liberacao_credito ? h('div', { class: 'cartao' },
    h('h2', {}, 'Crédito'),
    h('div', { class: 'dados' },
      dado('Liberado em', formatar.data(p.dt_liberacao_credito)),
      dado('Forma de pagamento', NOMES_FORMA[p.forma_pagamento] ?? p.forma_pagamento),
      dado('Prazo', p.prazo_pagamento_dias != null ? `${p.prazo_pagamento_dias} dia(s)` : null),
      dado('Limite', p.limite_credito != null ? `${formatar.moeda(p.limite_credito)}${p.limite_credito_origem === 'grupo' ? ' (limite do grupo)' : ''}` : null),
      dado('Restrição de crédito', Number(p.com_restricao_credito) ? 'com restrição' : null))) : null;

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
    abasCarteira(Number(p.na_lista) ? '/carteira' : '/carteira?aba=acompanhamento', usuario),
    h('a', { href: voltar, class: 'voltar' }, '‹ Voltar à lista'),
    h('h1', { style: 'margin-top:8px' }, p.razao_social),
    podeRegistrar ? h('div', { class: 'acoes', style: 'margin:0 0 16px' }, h('a', { class: 'botao', href: `#/registrar?id=${p.id}` }, 'Registrar atendimento')) : null,
    situacao, credito, linhaTempo, cadastro);
}
