// Montagem de rotas do VENDEDOR (representante não tem rota). docs/03-regras-negocio.md §7
// Princípios:
//   * Rota é um plano editável enquanto 'planejada'; o que foi feito é medido pelos contatos (vw_rotas_execucao).
//   * Sem cálculo de distância: coordenadas de planilha são aproximadas (ADR-0005). A ordem sugerida
//     agrupa por cidade → bairro → rota/subrota da planilha → endereço; o vendedor ajusta à mão.
//   * As coordenadas servem só para abrir o mapa do próprio celular.
import { formaDeTrabalho } from './carteira.mjs';
import { normalizarBusca } from './texto.mjs';

const chave = (v) => (v == null || v === '' ? '￿' : String(v)); // vazios por último
// usa a forma normalizada gravada; se a linha não a trouxer, normaliza aqui (acento não separa grupos)
const norm = (p, campo) => chave(p[`${campo}_busca`] ?? (p[campo] == null ? null : normalizarBusca(p[campo])));

/** Ordem sugerida das paradas (sem distância). Recebe linhas da carteira; devolve os ids na ordem. */
export function sugerirOrdem(prospects) {
  return [...prospects]
    .sort((a, b) =>
      norm(a, 'cidade').localeCompare(norm(b, 'cidade')) ||
      norm(a, 'bairro').localeCompare(norm(b, 'bairro')) ||
      chave(a.rota).localeCompare(chave(b.rota), 'pt-BR', { numeric: true }) ||
      chave(a.subrota).localeCompare(chave(b.subrota), 'pt-BR', { numeric: true }) ||
      chave(a.endereco).localeCompare(chave(b.endereco), 'pt-BR', { numeric: true }) ||
      chave(a.razao_social).localeCompare(chave(b.razao_social)))
    .map((p) => p.id);
}

function exigirVendedor(usuario) {
  if (formaDeTrabalho(usuario) !== 'vendedor') throw new Error('montagem de rota é exclusiva do vendedor (representante não tem rota)');
}

/** Cria a rota. O banco confere de novo (trigger trg_rotas_somente_vendedor). */
export function comandoCriarRota({ usuario, dataRota, nome = null }) {
  exigirVendedor(usuario);
  return { sql: 'INSERT INTO rotas (vendedor_id, data_rota, nome) VALUES (?, ?, ?) RETURNING id', args: [usuario.id, dataRota, nome] };
}

/** Grava as paradas na ordem informada (substitui as anteriores). Executar com db.batch(…, 'write'). */
export function comandosSalvarParadas({ usuario, rotaId, prospectIds }) {
  exigirVendedor(usuario);
  if (new Set(prospectIds).size !== prospectIds.length) throw new Error('prospect repetido na rota');
  return [
    { sql: 'DELETE FROM rota_paradas WHERE rota_id = ? AND rota_id IN (SELECT id FROM rotas WHERE vendedor_id = ?)', args: [rotaId, usuario.id] },
    ...prospectIds.map((id, i) => ({ sql: 'INSERT INTO rota_paradas (rota_id, prospect_id, ordem) VALUES (?, ?, ?)', args: [rotaId, id, i + 1] })),
  ];
}

/** Concluir ou cancelar a rota (depois disso ela fica travada). */
export function comandoEncerrarRota({ usuario, rotaId, situacao }) {
  exigirVendedor(usuario);
  if (!['concluida', 'cancelada'].includes(situacao)) throw new Error('situação inválida');
  return {
    sql: `UPDATE rotas SET situacao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND vendedor_id = ?`,
    args: [situacao, rotaId, usuario.id],
  };
}

/** Paradas de uma rota, na ordem, com "atendida". Supervisor/admin podem consultar rotas da equipe. */
export function consultaParadas({ usuario, rotaId }) {
  const escopo = usuario.perfil === 'administrador' ? '' : usuario.perfil === 'supervisor'
    ? 'AND vendedor_id IN (SELECT id FROM usuarios WHERE supervisor_id = ?)' : 'AND vendedor_id = ?';
  return {
    sql: `SELECT * FROM vw_rota_paradas WHERE rota_id = ? ${escopo} ORDER BY ordem`,
    args: usuario.perfil === 'administrador' ? [rotaId] : [rotaId, usuario.id],
  };
}

/** Link para abrir o ponto no mapa do celular (coordenada da planilha, sem dado pessoal). */
export function linkMapa({ latitude, longitude }) {
  if (latitude == null || longitude == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`;
}
