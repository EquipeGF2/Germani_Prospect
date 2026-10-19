// Registro em LOTE (ex.: vários "sem interesse" de uma vez). docs/03-regras-negocio.md §2.1
// A justificativa (motivo + observação) pode ser informada para o lote todo e/ou individualmente:
// o que vier no item vale para o item; o que faltar vem do lote.
// Cada item vira um contato normal (mesmas regras do banco) e todos compartilham o mesmo lote_id.
// Se um item for recusado pelo banco, os demais continuam gravados e o resultado diz qual falhou.
import { normalizarBusca } from './texto.mjs';
import { validarContato } from './status.mjs';
import { gravarEmLotes } from './gravacao.mjs';

/**
 * @param usuario     { id }
 * @param prospects   [{ id, tentativas }]  — linhas da carteira (tentativas atual de cada prospect)
 * @param comum       { resultado = 'sem_interesse', canal, dataContato, motivoId, observacao }
 * @param individuais { [prospectId]: { motivoId, observacao } }
 * @param motivos     { [motivoId]: { exige_observacao } } — para validar "Outro" antes de enviar
 * @returns {{ loteId, itens: [{ prospectId, erros, comando }] }}
 */
export function prepararLote({ usuario, prospects, comum, individuais = {}, motivos = {}, gerarId = () => crypto.randomUUID() }) {
  if (!prospects?.length) throw new Error('lote vazio');
  if (new Set(prospects.map((p) => p.id)).size !== prospects.length) throw new Error('prospect repetido no lote');
  const resultado = comum.resultado ?? 'sem_interesse';
  if (resultado === 'pedido_informado') throw new Error('reabertura com pedido é feita um a um (cada pedido tem sua data)');
  const loteId = gerarId();
  const itens = prospects.map((p) => {
    const ind = individuais[p.id] ?? {};
    const motivoId = ind.motivoId ?? comum.motivoId ?? null;
    const observacao = (ind.observacao ?? comum.observacao ?? '').trim() || null;
    const erros = validarContato({
      canal: comum.canal, resultado, dataContato: comum.dataContato, dataRetorno: comum.dataRetorno,
      motivoId, observacao, motivoExigeObservacao: Boolean(motivos[motivoId]?.exige_observacao),
    });
    return {
      prospectId: p.id,
      erros,
      comando: erros.length ? null : {
        sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, data_hora_dispositivo, canal,
                                    resultado, motivo_id, observacao, observacao_busca, data_retorno, lote_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [gerarId(), p.id, usuario.id, Number(p.tentativas) + 1, comum.dataContato, comum.dataHoraDispositivo ?? null, comum.canal,
          resultado, resultado === 'sem_interesse' ? motivoId : null, observacao, observacao ? normalizarBusca(observacao) : null,
          comum.dataRetorno ?? null, loteId],
      },
    };
  });
  return { loteId, itens };
}

/** Grava o lote preparado. Itens com erro de validação não são enviados. */
export async function registrarLote(db, { loteId, itens }) {
  const validos = itens.filter((i) => i.comando);
  const gravacao = await gravarEmLotes(db, validos, (i) => [i.comando]);
  gravacao.forEach((g, k) => { if (!g.ok) validos[k].erros.push(g.erro); });
  return {
    loteId,
    gravados: itens.filter((i) => i.comando && !i.erros.length).length,
    recusados: itens.filter((i) => i.erros.length).map((i) => ({ prospectId: i.prospectId, erros: i.erros })),
  };
}
