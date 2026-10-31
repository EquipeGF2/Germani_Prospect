// Espelho das tabelas de referência do banco (db/migrations/0001_inicial.sql).
// O banco é a fonte da verdade; estas constantes servem para validação antecipada e para o app.
export const STATUS = Object.freeze({
  NAO_CONTACTADO: 'nao_contactado',
  EM_PROSPECCAO: 'em_prospeccao',
  EM_NEGOCIACAO: 'aguardando_cadastro',
  SEM_INTERESSE: 'sem_interesse',
  CADASTRADO_ERP: 'analise_financeira',
  VENDA_REALIZADA: 'venda_realizada',
  INVALIDO: 'invalido',
});

/** Status que aparecem na lista de prospects (os demais só saem da lista — continuam nos indicadores). */
export const STATUS_LISTA = Object.freeze([STATUS.NAO_CONTACTADO, STATUS.EM_PROSPECCAO]);

/** Acompanhamento: em andamento × encerrados. Venda realizada não entra: está em Explorar pedidos. */
export const STATUS_ENCERRADOS = Object.freeze(['sem_interesse', STATUS.INVALIDO, 'expurgado']);

/** Status que aceitam novo contato (não há limite de contatos). */
export const STATUS_ACEITAM_CONTATO = Object.freeze([STATUS.NAO_CONTACTADO, STATUS.EM_PROSPECCAO, STATUS.EM_NEGOCIACAO,
  STATUS.SEM_INTERESSE, STATUS.CADASTRADO_ERP]);

/** Tipo de atuação: representante (sem rota) · vendedor (com rota/subrota). NULL é tratado como representante. */
export const TIPOS_ATUACAO = Object.freeze(['representante', 'vendedor']);

export const CANAIS = Object.freeze(['visita', 'telefone', 'whatsapp']);
/** Resultados que o app registra. "Não atendido" não gera registro. */
export const RESULTADOS = Object.freeze(['atendido', 'sem_interesse', 'pedido_informado']);

/** Rótulos do formulário. "Pedido informado" é a reabertura de um prospect (ex.: Sem interesse) com pedido. */
export const ROTULOS_RESULTADO = Object.freeze({
  atendido: 'Atendido',
  sem_interesse: 'Sem interesse',
  pedido_informado: 'Reabrir: pedido identificado',
});

/**
 * "Sem interesse" tem duas origens (migração 0015): do CLIENTE (recusou) e do REPRESENTANTE (não vai trabalhar o cliente).
 * O status é um só; a origem vem do motivo escolhido (motivos_sem_interesse.origem).
 */
export const ORIGENS_SEM_INTERESSE = Object.freeze({
  cliente: { rotulo: 'Sem interesse do cliente', curto: 'cliente', ajuda: 'O cliente recusou a proposta' },
  representante: { rotulo: 'Sem interesse do representante', curto: 'representante', ajuda: 'O representante não vai trabalhar este cliente' },
});
/** Motivos de uma origem (a lista vem de listarMotivos, com a coluna origem). */
export const motivosDaOrigem = (motivos, origem) => motivos.filter((m) => (m.origem ?? 'cliente') === origem);

/** Validação do formulário "Registrar contato" — mesmas regras dos CHECKs/triggers do banco. */
export function validarContato({ canal, resultado, motivoId, motivoExigeObservacao, observacao, dataContato, dataRetorno, dataPedido }) {
  const erros = [];
  if (!CANAIS.includes(canal)) erros.push('canal inválido');
  if (!RESULTADOS.includes(resultado)) erros.push('resultado inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataContato ?? '')) erros.push('data do contato obrigatória');
  if (resultado === 'sem_interesse' && !motivoId) erros.push('motivo obrigatório para "sem interesse"');
  if (resultado === 'sem_interesse' && motivoExigeObservacao && !String(observacao ?? '').trim()) erros.push('este motivo exige observação');
  if (dataRetorno && dataRetorno < dataContato) erros.push('data de retorno anterior ao contato');
  if (resultado === 'pedido_informado') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPedido ?? '')) erros.push('data de entrada do pedido obrigatória para reabrir');
    else if (dataPedido > dataContato) erros.push('data do pedido posterior à data do registro');
  } else if (dataPedido) erros.push('data do pedido só vale para "pedido identificado"');
  return erros;
}
