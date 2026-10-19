// Espelho das tabelas de referência do banco (db/migrations/0001_inicial.sql).
// O banco é a fonte da verdade; estas constantes servem para validação antecipada e para o app.
export const STATUS = Object.freeze({
  NAO_CONTACTADO: 'nao_contactado',
  EM_PROSPECCAO: 'em_prospeccao',
  EM_NEGOCIACAO: 'em_negociacao',
  SEM_INTERESSE: 'sem_interesse',
  CADASTRADO_ERP: 'cadastrado_erp',
  VENDA_REALIZADA: 'venda_realizada',
  INVALIDO: 'invalido',
});

/** Status em que o vendedor ainda trabalha o prospect (aceitam novo contato). */
export const STATUS_ATIVOS = Object.freeze([STATUS.NAO_CONTACTADO, STATUS.EM_PROSPECCAO, STATUS.EM_NEGOCIACAO]);

export const CANAIS = Object.freeze(['visita', 'telefone', 'whatsapp']);
export const RESULTADOS = Object.freeze(['com_interesse', 'sem_interesse', 'sem_conclusao']);

/** Validação do formulário "Registrar contato" — mesmas regras dos CHECKs/triggers do banco. */
export function validarContato({ canal, resultado, motivoId, motivoExigeObservacao, observacao, dataContato, dataRetorno }) {
  const erros = [];
  if (!CANAIS.includes(canal)) erros.push('canal inválido');
  if (!RESULTADOS.includes(resultado)) erros.push('resultado inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataContato ?? '')) erros.push('data do contato obrigatória');
  if (resultado === 'sem_interesse' && !motivoId) erros.push('motivo obrigatório para "sem interesse"');
  if (resultado === 'sem_interesse' && motivoExigeObservacao && !String(observacao ?? '').trim()) erros.push('este motivo exige observação');
  if (resultado === 'com_interesse') {
    if (!dataRetorno) erros.push('data de retorno obrigatória para "com interesse"');
    else if (dataRetorno < dataContato) erros.push('data de retorno anterior ao contato');
  }
  return erros;
}
