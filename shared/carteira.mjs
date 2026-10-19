// Lista de prospects (carteira) — visões e escopo por usuário. Usado pelo app (F1).
// docs/03-regras-negocio.md §6
//
// Duas formas de trabalho:
//   * REPRESENTANTE — visita a carteira. Visões: lista, cidade, bairro, status. NÃO tem rota:
//     não agrupa, não filtra e não recebe as colunas rota/subrota.
//   * VENDEDOR      — atendimento mais amplo. Visões: lista, cidade, bairro, status, rota (rota + subrota).
//   * supervisor / administrador — todas as visões, sobre a equipe / sobre tudo.
// tipo_atuacao NULL é tratado como representante (a forma mais restrita).
//
// Lista de prospects = só Não contactado / Em prospecção (vw_prospects.na_lista = 1).
// Acompanhamento = visão 'status' (ou filtro de status): mostra a carteira inteira por status, inclusive
// Em negociação, Sem interesse, Cadastrado, Venda e Inválido — para o vendedor seguir o andamento.
// Indicadores não usam este módulo (contam tudo — shared/indicadores.mjs).
import { normalizarBusca } from './texto.mjs';

export const VISOES = Object.freeze(['lista', 'cidade', 'bairro', 'status', 'rota']);

const COLUNAS_LISTA = ['id', 'cnpj', 'razao_social', 'nome_fantasia', 'endereco', 'bairro', 'cidade', 'uf', 'cep',
  'latitude', 'longitude', 'telefone', 'tipologia_gtm', 'status_atual', 'status_nome', 'status_descricao', 'status_cor',
  'tentativas', 'dt_primeiro_contato', 'dt_segundo_contato', 'dt_ultimo_contato', 'dt_interesse', 'data_proxima_acao',
  'dias_corridos', 'pendente_hoje', 'retorno_pendente', 'na_lista', 'com_interesse', 'prazo_cadastro_vencido',
  'motivo_sem_interesse', 'dt_cadastro_erp', 'dt_pedido', 'numero_pedido', 'dt_baixa', 'vendedor_id', 'vendedor_nome'];
// rota/subrota só existem para prospects de vendedor (nunca de representante), mesmo na visão de gestão
const COLUNAS_ROTA = [
  "CASE WHEN vendedor_tipo_atuacao = 'vendedor' THEN rota END AS rota",
  "CASE WHEN vendedor_tipo_atuacao = 'vendedor' THEN subrota END AS subrota",
];

/** Forma de trabalho efetiva do usuário. */
export function formaDeTrabalho(usuario) {
  if (usuario.perfil === 'administrador' || usuario.perfil === 'supervisor') return 'gestao';
  return usuario.tipo_atuacao === 'vendedor' ? 'vendedor' : 'representante';
}

/** Visões que o usuário pode abrir. */
export function visoesPermitidas(usuario) {
  return formaDeTrabalho(usuario) === 'representante' ? ['lista', 'cidade', 'bairro', 'status'] : [...VISOES];
}

function escopo(usuario) {
  if (usuario.perfil === 'administrador') return { where: [], args: [] };
  if (usuario.perfil === 'supervisor') return { where: ['supervisor_id = ?'], args: [usuario.id] };
  return { where: ['vendedor_id = ?'], args: [usuario.id] };
}

/**
 * Monta a consulta da lista de prospects.
 * @param usuario  { id, perfil, tipo_atuacao }
 * @param visao    'lista' | 'cidade' | 'bairro' | 'status' | 'rota'
 * @param filtros  { cidadeBusca, uf, bairroBusca, rota, subrota, status, somentePendentes, somenteRetornos, vendedorId }
 *                 Informar `status` (ou abrir a visão 'status') mostra a carteira inteira, não só a lista.
 * @param busca    texto livre (nome, CNPJ, cidade, bairro) — acentos ignorados
 * @returns {{ sql: string, args: any[], colunas?: string[] }}
 */
export function consultaCarteira({ usuario, visao = 'lista', filtros = {}, busca = '', incluirForaDaLista = false, limite = 200, deslocamento = 0 }) {
  if (!usuario?.id || !usuario?.perfil) throw new Error('usuário obrigatório');
  if (!VISOES.includes(visao)) throw new Error(`visão inválida: ${visao}`);
  const permitidas = visoesPermitidas(usuario);
  if (!permitidas.includes(visao)) throw new Error(`visão "${visao}" não disponível para representante`);
  const comRota = permitidas.includes('rota');
  if (!comRota && (filtros.rota || filtros.subrota)) throw new Error('representante não trabalha com rota');

  const { where, args } = escopo(usuario);
  if (!incluirForaDaLista && visao !== 'status' && !filtros.status && !filtros.somenteRetornos) where.push('na_lista = 1');
  if (filtros.somentePendentes) where.push('pendente_hoje = 1');
  if (filtros.somenteRetornos) where.push('retorno_pendente = 1');
  if (filtros.status) { where.push('status_atual = ?'); args.push(filtros.status); }
  if (filtros.vendedorId && usuario.perfil !== 'vendedor') { where.push('vendedor_id = ?'); args.push(filtros.vendedorId); }
  if (filtros.cidadeBusca) { where.push('cidade_busca = ?'); args.push(filtros.cidadeBusca); }
  if (filtros.uf) { where.push('uf = ?'); args.push(filtros.uf); }
  if (filtros.bairroBusca) { where.push('bairro_busca = ?'); args.push(filtros.bairroBusca); }
  if (visao === 'rota' || filtros.rota || filtros.subrota) where.push("vendedor_tipo_atuacao = 'vendedor'");
  if (filtros.rota) { where.push('rota = ?'); args.push(filtros.rota); }
  if (filtros.subrota) { where.push('subrota = ?'); args.push(filtros.subrota); }
  const termo = normalizarBusca(busca);
  if (termo) {
    const termoCnpj = termo.replace(/[.\-\/\s]/g, '');
    where.push("(busca LIKE '%' || ? || '%' OR COALESCE(bairro_busca, '') LIKE '%' || ? || '%' OR cnpj LIKE ? || '%')");
    args.push(termo, termo, termoCnpj);
  }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (visao === 'lista') {
    const colunas = comRota ? [...COLUNAS_LISTA, ...COLUNAS_ROTA] : COLUNAS_LISTA;
    return {
      colunas: colunas.map((c) => c.split(' AS ').pop()),
      sql: `SELECT ${colunas.join(', ')} FROM vw_prospects ${filtro}
            ORDER BY pendente_hoje DESC, retorno_pendente DESC, COALESCE(data_proxima_acao, '0000-00-00'), cidade_busca, bairro_busca, razao_social
            LIMIT ? OFFSET ?`,
      args: [...args, limite, deslocamento],
    };
  }

  if (visao === 'status') {
    return {
      sql: `SELECT s.codigo AS status_atual, s.nome AS rotulo, s.cor AS status_cor, s.ordem, s.lista_trabalho AS na_lista,
                   COUNT(p.id)                        AS prospects,
                   COALESCE(SUM(p.retorno_pendente), 0) AS retornos_pendentes,
                   COALESCE(SUM(p.prazo_cadastro_vencido), 0) AS prazos_cadastro_vencidos,
                   CAST(ROUND(AVG(p.dias_corridos)) AS INTEGER) AS media_dias_corridos
              FROM status s
              LEFT JOIN (SELECT * FROM vw_prospects ${filtro}) p ON p.status_atual = s.codigo
             GROUP BY s.codigo
             ORDER BY s.ordem`,
      args,
    };
  }

  const grupo = {
    cidade: { chave: ['cidade_busca', 'uf'], rotulo: "COALESCE(MIN(cidade), '(sem cidade)') || '/' || COALESCE(uf, '')" },
    bairro: { chave: ['cidade_busca', 'uf', 'bairro_busca'], rotulo: "COALESCE(MIN(bairro), '(sem bairro)') || ' — ' || COALESCE(MIN(cidade), '(sem cidade)')" },
    rota: { chave: ['rota', 'subrota'], rotulo: "COALESCE(rota, '(sem rota)') || COALESCE(' / ' || subrota, '')" },
  }[visao];
  return {
    sql: `SELECT ${grupo.chave.join(', ')}, ${grupo.rotulo} AS rotulo,
                 COUNT(*)                              AS prospects,
                 SUM(pendente_hoje)                    AS pendentes_hoje,
                 SUM(status_atual = 'nao_contactado')  AS nao_contactados,
                 SUM(status_atual = 'em_prospeccao')   AS em_prospeccao,
                 SUM(com_interesse)                    AS com_interesse,
                 AVG(latitude)                         AS latitude_media,
                 AVG(longitude)                        AS longitude_media
            FROM vw_prospects ${filtro}
           GROUP BY ${grupo.chave.join(', ')}
           ORDER BY pendentes_hoje DESC, prospects DESC, rotulo`,
    args,
  };
}
