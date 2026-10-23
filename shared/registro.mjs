// Registro no app (mobile): Atendido · Sem interesse · Reabrir com pedido identificado. docs/03 §2
// "Não atendido" não gera registro. A data é a do aparelho. O banco confere tudo (trg_contatos_validar).
import { normalizarBusca } from './texto.mjs';
import { validarContato } from './status.mjs';

export async function listarMotivos(db) {
  return (await db.execute('SELECT id, codigo, descricao, exige_observacao, origem FROM motivos_sem_interesse WHERE ativo = 1 AND uso_app = 1 ORDER BY ordem')).rows;
}

/**
 * @param prospect  { id, tentativas } — linha da ficha (tentativas = nº de registros até agora)
 * @returns {{ sql, args, id }}
 */
export function comandoRegistrarContato({ usuario, prospect, canal, resultado, motivoId = null, motivoExigeObservacao = false, observacao = null,
  dataContato, dataRetorno = null, dataPedido = null, dataHoraDispositivo = new Date().toISOString(), gerarId = () => crypto.randomUUID() }) {
  const erros = validarContato({ canal, resultado, motivoId, motivoExigeObservacao, observacao, dataContato, dataRetorno, dataPedido });
  if (erros.length) throw new Error(erros.join('; '));
  const id = gerarId();
  const obs = String(observacao ?? '').trim() || null;
  return {
    id,
    sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, data_hora_dispositivo, canal, resultado,
                                motivo_id, observacao, observacao_busca, data_retorno, data_pedido_informado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, prospect.id, usuario.id, Number(prospect.tentativas) + 1, dataContato, dataHoraDispositivo, canal, resultado,
      resultado === 'sem_interesse' ? motivoId : null, obs, obs ? normalizarBusca(obs) : null, dataRetorno || null,
      resultado === 'pedido_informado' ? dataPedido : null],
  };
}
