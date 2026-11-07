// Registro no app (mobile): Atendido · Sem interesse · Reabrir com pedido identificado. docs/03 §2
// "Não atendido" não gera registro. A data é a do aparelho. O banco confere tudo (trg_contatos_validar).
import { normalizarBusca } from './texto.mjs';
import { validarContato } from './status.mjs';

export async function listarMotivos(db) {
  return (await db.execute('SELECT id, codigo, descricao, exige_observacao, origem FROM motivos_sem_interesse WHERE ativo = 1 AND uso_app = 1 ORDER BY ordem')).rows;
}

/**
 * O próximo sem interesse do cliente é a 1ª recusa? (0034) Então exige data de retorno e o cliente continua na lista; senão
 * (já recusou antes, ou já está cadastrado no ERP e o status não muda) ele sai da lista sem data. Lê só os registros do cliente.
 */
export const consultaPrimeiraRecusa = (prospectId) => ({
  sql: `SELECT p.status_atual NOT IN ('analise_financeira', 'aguardando_pedido', 'aguardando_pedido_valido')
               AND NOT EXISTS (SELECT 1 FROM contatos c JOIN motivos_sem_interesse m ON m.id = c.motivo_id
                                WHERE c.prospect_id = p.id AND c.resultado = 'sem_interesse' AND m.origem = 'cliente') AS primeira
          FROM prospects p WHERE p.id = ?`,
  args: [prospectId],
});

/**
 * @param prospect  { id, tentativas } — linha da ficha (tentativas = nº de registros até agora)
 * @returns {{ sql, args, id }}
 */
export function comandoRegistrarContato({ usuario, prospect, canal, resultado, motivoId = null, motivoExigeObservacao = false, observacao = null,
  dataContato, dataRetorno = null, dataPedido = null, exigeRetorno = false, dataHoraDispositivo = new Date().toISOString(), gerarId = () => crypto.randomUUID() }) {
  const erros = validarContato({ canal, resultado, motivoId, motivoExigeObservacao, observacao, dataContato, dataRetorno, dataPedido, exigeRetorno });
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
