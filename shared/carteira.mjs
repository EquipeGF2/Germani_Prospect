// Lista de prospects (carteira) — visões e escopo por usuário. Usado pelo app (F1).
// docs/03-regras-negocio.md §6
//
// Duas formas de trabalho:
//   * REPRESENTANTE — visita a carteira. Visões: lista, cidade, bairro, onda, status. NÃO tem rota:
//     não agrupa, não filtra e não recebe as colunas rota/subrota.
//   * VENDEDOR      — atendimento mais amplo. Visões: lista, cidade, bairro, onda, status, rota (rota + subrota).
//   * supervisor / gerente comercial / administrador — todas as visões, sobre a equipe / sobre tudo.
// tipo_atuacao NULL é tratado como representante (a forma mais restrita).
//
// Lista de prospects = só Não contactado / Em prospecção (vw_prospects.na_lista = 1).
// Acompanhamento = visão 'status' (ou filtro de status): mostra a carteira inteira por status, inclusive
// Aguardando cadastro, Sem interesse, Cadastrado, Venda e Inválido — para o vendedor seguir o andamento.
// Indicadores não usam este módulo (contam tudo — shared/indicadores.mjs).
import { normalizarBusca } from './texto.mjs';
import { veTodasEquipes } from './perfis.mjs';

export const VISOES = Object.freeze(['lista', 'cidade', 'bairro', 'onda', 'status', 'rota']);

const COLUNAS_LISTA = ['id', 'cnpj', 'razao_social', 'nome_fantasia', 'endereco', 'bairro', 'bairro_busca', 'cidade', 'cidade_busca', 'uf', 'cep',
  'latitude', 'longitude', 'telefone', 'tipologia_gtm', 'onda', 'status_atual', 'status_nome', 'status_descricao', 'status_cor',
  'tentativas', 'dt_primeiro_contato', 'dt_segundo_contato', 'dt_ultimo_contato', 'dt_atendido', 'data_proxima_acao',
  'dias_corridos', 'pendente_hoje', 'retorno_pendente', 'na_lista', 'atendido', 'prazo_cadastro_vencido',
  'motivo_sem_interesse', 'dt_cadastro_erp', 'dt_pedido', 'numero_pedido', 'dt_baixa', 'vendedor_id', 'vendedor_nome', 'supervisor_id'];
// rota/subrota só existem para prospects de vendedor (nunca de representante), mesmo na visão de gestão
const COLUNAS_ROTA = [
  "CASE WHEN vendedor_tipo_atuacao = 'vendedor' THEN rota END AS rota",
  "CASE WHEN vendedor_tipo_atuacao = 'vendedor' THEN subrota END AS subrota",
];

/** Forma de trabalho efetiva do usuário. */
export function formaDeTrabalho(usuario) {
  if (['administrador', 'gerente', 'supervisor'].includes(usuario.perfil)) return 'gestao';
  return usuario.tipo_atuacao === 'vendedor' ? 'vendedor' : 'representante';
}

/** Visões que o usuário pode abrir. */
export function visoesPermitidas(usuario) {
  return formaDeTrabalho(usuario) === 'representante' ? VISOES.filter((v) => v !== 'rota') : [...VISOES];
}

// Ordenação da lista pelos rótulos das colunas (tela do computador, exibição em lista). Só chaves conhecidas viram SQL.
const natural = (c) => `${c} IS NULL, length(${c}), ${c}`;
export const ORDENACOES = Object.freeze({
  prospect: (d) => `razao_social ${d}`,
  cidade: (d) => `cidade_busca ${d}, bairro_busca ${d}`,
  onda: (d) => `onda IS NULL, length(onda) ${d}, onda ${d}`,
  rota: (d) => `rota IS NULL, length(rota) ${d}, rota ${d}, subrota ${d}`,
  carteira: (d) => `vendedor_nome ${d}`,
  status: (d) => `(SELECT CASE s.codigo WHEN 'sem_interesse' THEN 100 WHEN 'invalido' THEN 101 ELSE s.ordem END FROM status s WHERE s.codigo = status_atual) ${d}`,
  dias: (d) => `dias_corridos IS NULL, dias_corridos ${d}`,
  ultimo: (d) => `dt_ultimo_contato IS NULL, dt_ultimo_contato ${d}`,
});

/**
 * "Agrupar por" da lista do computador: a lista sai ordenada pelo grupo (cabeçalho a cada troca) e, dentro dele, pela
 * ordem escolhida. Bairro só com a cidade escolhida; rota só para quem trabalha com rota.
 */
export const AGRUPAMENTOS = Object.freeze({
  cidade: { nome: 'Cidade', ordem: 'cidade_busca, uf', rotulo: (p) => (p.cidade ? `${p.cidade}${p.uf ? '/' + p.uf : ''}` : '(sem cidade)') },
  bairro: { nome: 'Bairro', ordem: 'bairro_busca', rotulo: (p) => p.bairro || '(sem bairro)' },
  onda: { nome: 'Onda', ordem: 'onda IS NULL, length(onda), onda', rotulo: (p) => (p.onda ? `Onda ${p.onda}` : '(sem onda)') },
  segmento: { nome: 'Segmento', ordem: 'tipologia_gtm IS NULL, tipologia_gtm', rotulo: (p) => p.tipologia_gtm || '(sem segmento)' },
  representante: { nome: 'Representante', ordem: 'vendedor_nome, vendedor_id', rotulo: (p) => p.vendedor_nome ?? '—' },
  rota: { nome: 'Rota', ordem: 'rota IS NULL, length(rota), rota, subrota', rotulo: (p) => (p.rota ? `Rota ${p.rota}${p.subrota ? ' / ' + p.subrota : ''}` : '(sem rota)') },
});

/** Agrupamentos que fazem sentido agora (bairro só com cidade; representante só para gestão; rota só com rota). */
export function agrupamentosPossiveis(usuario, filtros = {}) {
  return Object.keys(AGRUPAMENTOS).filter((k) => (k !== 'bairro' || filtros.cidadeBusca)
    && (k !== 'representante' || usuario.perfil !== 'vendedor') && (k !== 'rota' || visoesPermitidas(usuario).includes('rota')));
}

function escopo(usuario) {
  if (veTodasEquipes(usuario)) return { where: [], args: [] };
  if (usuario.perfil === 'supervisor') return { where: ['supervisor_id = ?'], args: [usuario.id] };
  return { where: ['vendedor_id = ?'], args: [usuario.id] };
}

/**
 * Monta a consulta da lista de prospects.
 * @param usuario  { id, perfil, tipo_atuacao }
 * @param visao    'lista' | 'cidade' | 'bairro' | 'onda' | 'status' | 'rota'
 * @param filtros  { cidadeBusca, uf, bairroBusca, onda, rota, subrota, status, somentePendentes, somenteRetornos, vendedorId, supervisorId, foraDaLista }
 *                 `supervisorId` / `vendedorId` só valem para gestão (o vendedor vê sempre a própria carteira).
 *                 `dataDe` / `dataAte` (AAAA-MM-DD): data do último registro do prospect.
 * @param ordemNatural  onda e rota em ordem (Onda 1, 2, 3…) em vez de por pendências (tela do computador)
 * @param rotaEmNiveis  visão rota em 2 níveis: rotas; com `filtros.rota`, as subrotas daquela rota (tela do computador)
 * @param ordenar  lista: { campo: chave de ORDENACOES, desc } — clique no rótulo da coluna; sem campo = ordem de trabalho
 *                 `foraDaLista` = só o acompanhamento (quem já saiu da lista principal).
 *                 Informar `status` (ou abrir a visão 'status') mostra a carteira inteira, não só a lista.
 *                 `somenteRetornos` na lista = retornos da lista; com `status: 'aguardando_cadastro'` = retornos da negociação.
 * @param busca    texto livre (nome, CNPJ, cidade, bairro) — acentos ignorados
 * @returns {{ sql: string, args: any[], colunas?: string[] }}
 */
export function consultaCarteira({ usuario, visao = 'lista', filtros = {}, busca = '', incluirForaDaLista = false, limite = 200, deslocamento = 0, ordemNatural = false, rotaEmNiveis = false, ordenar = null, agrupar = null, usarFaixas = true }) {
  if (!usuario?.id || !usuario?.perfil) throw new Error('usuário obrigatório');
  if (!VISOES.includes(visao)) throw new Error(`visão inválida: ${visao}`);
  const permitidas = visoesPermitidas(usuario);
  if (!permitidas.includes(visao)) throw new Error(`visão "${visao}" não disponível para representante`);
  const comRota = permitidas.includes('rota');
  if (!comRota && (filtros.rota || filtros.subrota)) throw new Error('representante não trabalha com rota');

  const { where, args } = escopo(usuario);
  // Aguardando cadastro, Sem interesse etc. só aparecem no acompanhamento (visão 'status' ou filtro de status)
  if (!incluirForaDaLista && !filtros.foraDaLista && visao !== 'status' && !filtros.status) where.push('na_lista = 1');
  if (filtros.foraDaLista) where.push('na_lista = 0');
  if (filtros.somentePendentes) where.push('pendente_hoje = 1');
  if (filtros.somenteRetornos) where.push('retorno_pendente = 1');
  if (filtros.status) { where.push('status_atual = ?'); args.push(filtros.status); }
  if (filtros.vendedorId && usuario.perfil !== 'vendedor') { where.push('vendedor_id = ?'); args.push(filtros.vendedorId); }
  if (filtros.supervisorId && usuario.perfil !== 'vendedor') { where.push('supervisor_id = ?'); args.push(filtros.supervisorId); }
  if (filtros.dataDe) { where.push('dt_ultimo_contato >= ?'); args.push(filtros.dataDe); }
  if (filtros.dataAte) { where.push('dt_ultimo_contato <= ?'); args.push(filtros.dataAte); }
  if (filtros.cidadeBusca) { where.push('cidade_busca = ?'); args.push(filtros.cidadeBusca); }
  if (filtros.uf) { where.push('uf = ?'); args.push(filtros.uf); }
  if (filtros.bairroBusca) { where.push('bairro_busca = ?'); args.push(filtros.bairroBusca); }
  if (filtros.onda) { where.push('onda = ?'); args.push(String(filtros.onda)); }
  if (filtros.segmento) { where.push('tipologia_gtm = ?'); args.push(filtros.segmento); }
  if (visao === 'rota' || filtros.rota || filtros.subrota) where.push("vendedor_tipo_atuacao = 'vendedor'");
  if (filtros.rota) { where.push('rota = ?'); args.push(filtros.rota); }
  if (filtros.subrota) { where.push('subrota = ?'); args.push(filtros.subrota); }
  const termo = normalizarBusca(busca);
  if (termo) {
    const termoCnpj = termo.replace(/[.\-\/\s]/g, '');
    // índice de texto (FTS5 trigram, migração 0006) em vez de varrer a tabela. `busca` já contém fantasia, CNPJ,
    // cidade e BAIRRO, então o antigo "OR bairro_busca LIKE" era redundante; o CNPJ digitado com pontuação
    // continua achado pelo início do CNPJ (faixa no índice único) — mesmo resultado de antes.
    const porTexto = "id IN (SELECT rowid FROM prospects_busca WHERE busca LIKE '%' || ? || '%')";
    // também pelo representante/vendedor dono da carteira: nome (sem acento) ou código do ERP
    const porDono = "vendedor_id IN (SELECT u.id FROM usuarios u WHERE u.nome_busca LIKE '%' || ? || '%' OR CAST(u.codigo_erp AS TEXT) = ?)";
    where.push(termoCnpj ? `(${porTexto} OR ${porDono} OR (cnpj >= ? AND cnpj < ?))` : `(${porTexto} OR ${porDono})`);
    args.push(termo, termo, termo);
    if (termoCnpj) args.push(termoCnpj, `${termoCnpj}~`);
  }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (visao === 'lista') {
    const colunas = comRota ? [...COLUNAS_LISTA, ...COLUNAS_ROTA] : COLUNAS_LISTA;
    const grupo = AGRUPAMENTOS[agrupar] && (agrupar !== 'rota' || comRota) ? `${AGRUPAMENTOS[agrupar].ordem}, ` : '';
    const porColuna = grupo + (ORDENACOES[ordenar?.campo] && (ordenar.campo !== 'rota' || comRota)
      ? `${ORDENACOES[ordenar.campo](ordenar.desc ? 'DESC' : 'ASC')}, razao_social, ` : '');
    const nomes = colunas.map((c) => c.split(' AS ').pop());
    // Lista principal (Não contactado / Em prospecção), sem busca, sem filtro de data e sem ordenação por coluna:
    // a ordem "pendências primeiro" é a junção de 3 faixas da próxima ação — vencida/hoje (por data), sem data e
    // futura (por data) —, cada uma lida pelo índice já na ordem e cortada no tamanho da página (migração 0010).
    // Mesmo resultado da ordenação geral, sem ler e ordenar a base inteira a cada página.
    const faixas = usarFaixas && !porColuna && where.includes('na_lista = 1') && !termo && !filtros.dataDe && !filtros.dataAte;
    if (faixas) {
      const corte = limite + deslocamento;
      const hoje = "date('now','-3 hours')";
      const faixa = (n, condicao, ordem) => `SELECT * FROM (SELECT ${n} AS _faixa, ${colunas.join(', ')}, data_proxima_acao AS _dpa
            FROM vw_prospects WHERE ${[...where, condicao].join(' AND ')} ORDER BY ${ordem} LIMIT ${corte})`;
      const resto = 'cidade_busca, bairro_busca, razao_social, id';
      return {
        colunas: nomes,
        sql: `${faixa(0, `data_proxima_acao <= ${hoje}`, `data_proxima_acao, ${resto}`)}
              UNION ALL ${faixa(1, 'data_proxima_acao IS NULL', resto)}
              UNION ALL ${faixa(2, `data_proxima_acao > ${hoje}`, `data_proxima_acao, ${resto}`)}
              ORDER BY _faixa, _dpa, cidade_busca, bairro_busca, razao_social, id
              LIMIT ? OFFSET ?`,
        args: [...args, ...args, ...args, limite, deslocamento],
      };
    }
    return {
      colunas: nomes,
      sql: `SELECT ${colunas.join(', ')} FROM vw_prospects ${filtro}
            ORDER BY ${porColuna}pendente_hoje DESC, retorno_pendente DESC, COALESCE(data_proxima_acao, '0000-00-00'), cidade_busca, bairro_busca, razao_social, id
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
             ORDER BY CASE s.codigo WHEN 'sem_interesse' THEN 100 WHEN 'invalido' THEN 101 ELSE s.ordem END`,   // na ordem do processo; encerrados por último
      args,
    };
  }

  const grupo = {
    cidade: { chave: ['cidade_busca', 'uf'], rotulo: "COALESCE(MIN(cidade), '(sem cidade)') || '/' || COALESCE(uf, '')" },
    bairro: { chave: ['cidade_busca', 'uf', 'bairro_busca'], rotulo: "COALESCE(MIN(bairro), '(sem bairro)') || ' — ' || COALESCE(MIN(cidade), '(sem cidade)')" },
    onda: { chave: ['onda'], rotulo: "COALESCE('Onda ' || onda, '(sem onda)')" },
    rota: !rotaEmNiveis ? { chave: ['rota', 'subrota'], rotulo: "COALESCE(rota, '(sem rota)') || COALESCE(' / ' || subrota, '')" }
      : filtros.rota ? { chave: ['rota', 'subrota'], rotulo: "COALESCE('Subrota ' || subrota, '(sem subrota)')", natural: 'subrota' }   // nível 2
        : { chave: ['rota'], rotulo: "COALESCE('Rota ' || rota, '(sem rota)')", natural: 'rota' },                                    // nível 1
  }[visao];
  // ordem natural (1, 2, 10…; vazios por último) para onda e rota/subrota
  const campoNatural = ordemNatural ? (visao === 'onda' ? 'onda' : grupo.natural) : null;
  const ordem = campoNatural ? `${campoNatural} IS NULL, length(${campoNatural}), ${campoNatural}` : 'pendentes_hoje DESC, prospects DESC, rotulo';
  return {
    sql: `SELECT ${grupo.chave.join(', ')}, ${grupo.rotulo} AS rotulo,
                 COUNT(*)                              AS prospects,
                 SUM(pendente_hoje)                    AS pendentes_hoje,
                 SUM(status_atual = 'nao_contactado')  AS nao_contactados,
                 SUM(status_atual = 'em_prospeccao')   AS em_prospeccao,
                 SUM(atendido)                    AS atendido,
                 AVG(latitude)                         AS latitude_media,
                 AVG(longitude)                        AS longitude_media
            FROM vw_prospects ${filtro}
           GROUP BY ${grupo.chave.join(', ')}
           ORDER BY ${ordem}`,
    args,
  };
}

/** Ficha de um prospect (respeita o escopo do usuário). Sem linha = sem acesso ou inexistente. */
export function consultaFicha({ usuario, prospectId }) {
  const { where, args } = escopo(usuario);
  where.push('id = ?');
  args.push(prospectId);
  return { sql: `SELECT vw_prospects.*,
                       (SELECT SUM(e.valor) FROM eventos_erp e WHERE e.prospect_id = vw_prospects.id AND e.tipo = 'pedido') AS valor_pedidos
                  FROM vw_prospects WHERE ${where.join(' AND ')}`, args };
}

/** Ondas existentes na base (para o filtro), em ordem natural: 1, 2, 3… */
// Filtros que restringem a lista (sem nenhum deles, a gestão não carrega a Lista principal — ver precisaFiltro)
const FILTROS_RESTRITIVOS = ['uf', 'cidadeBusca', 'bairroBusca', 'onda', 'segmento', 'rota', 'subrota', 'status', 'supervisorId', 'vendedorId', 'dataDe', 'dataAte', 'somenteRetornos'];

// No celular o representante/vendedor estreita a própria carteira por um destes (UF e equipe não estreitam a dele)
const FILTROS_DO_CELULAR = FILTROS_RESTRITIVOS.filter((f) => !['uf', 'supervisorId', 'vendedorId'].includes(f));

/**
 * A Lista principal da gestão (administrador, gerente, supervisor, financeiro) só é lida depois de um filtro ou de uma
 * busca: ninguém trabalha a base inteira de uma vez, e assim a tela não varre os ~23 mil prospects a cada entrada.
 * Representante/vendedor vê direto a própria carteira no computador; no celular (`celular`), também ele escolhe antes
 * uma cidade (ou outro filtro) ou faz uma busca — o celular não carrega a carteira toda página a página.
 */
export function precisaFiltro(usuario, { visao = 'lista', filtros = {}, busca = '', celular = false } = {}) {
  if (visao !== 'lista') return false;
  const vendedor = usuario?.perfil === 'vendedor';
  if (vendedor && !celular) return false;
  const restritivos = vendedor ? FILTROS_DO_CELULAR : FILTROS_RESTRITIVOS;
  return !normalizarBusca(busca) && !restritivos.some((f) => filtros[f] != null && filtros[f] !== '' && filtros[f] !== false);
}

/** Cidades da base (para o filtro), pelo índice de cidade. */
export function consultaCidades() {
  return { sql: 'SELECT cidade_busca, uf, MIN(cidade) AS cidade FROM prospects WHERE cidade_busca IS NOT NULL GROUP BY cidade_busca, uf ORDER BY cidade_busca, uf', args: [] };
}

/** Segmentos (TIPOLOGIA GTM da planilha base), para o filtro. */
export function consultaSegmentos() {
  return { sql: "SELECT DISTINCT tipologia_gtm AS segmento FROM prospects WHERE tipologia_gtm IS NOT NULL AND tipologia_gtm <> '' ORDER BY 1", args: [] };
}

export function consultaOndas() {
  return { sql: `SELECT DISTINCT onda FROM prospects WHERE onda IS NOT NULL AND onda <> '' ORDER BY ${natural('onda')}`, args: [] };
}

/** Remove da ficha o que o perfil não usa (representante não tem rota). */
export function ajustarFicha(usuario, ficha) {
  if (!ficha) return ficha;
  const f = { ...ficha };
  if (formaDeTrabalho(usuario) === 'representante' || f.vendedor_tipo_atuacao !== 'vendedor') { delete f.rota; delete f.subrota; }
  return f;
}

/** Linha do tempo (histórico de movimentação) — chamar só depois de consultaFicha confirmar o acesso. */
export function consultaLinhaTempo({ prospectId, limite = null }) {
  return { sql: `SELECT * FROM vw_movimentacoes WHERE prospect_id = ? ORDER BY data_evento DESC, id DESC${limite ? ' LIMIT ?' : ''}`,
    args: limite ? [prospectId, limite] : [prospectId] };
}

/** Bairros da cidade escolhida (filtro Bairro, que só aparece com a cidade), no escopo do usuário. */
export function consultaBairros({ usuario, cidadeBusca, uf = null }) {
  const { where, args } = escopo(usuario);
  where.push('cidade_busca = ?', "bairro_busca IS NOT NULL AND bairro_busca <> ''"); args.push(cidadeBusca);
  if (uf) { where.push('uf = ?'); args.push(uf); }
  return { sql: `SELECT bairro_busca, MIN(bairro) AS bairro FROM vw_prospects WHERE ${where.join(' AND ')} GROUP BY bairro_busca ORDER BY bairro_busca`, args };
}

/** Período do Acompanhamento: 'mes' (este mês até hoje), 'ultimo' (mês passado) ou 'periodo' (de · até). */
export const PERIODOS_LISTA = Object.freeze({ mes: 'Este mês', ultimo: 'Último mês', periodo: 'Período…' });
export function datasDoPeriodo(chave, { hoje, de = null, ate = null }) {
  const [a, m] = hoje.split('-').map(Number);
  const dia = (ano, mes, d) => `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (chave === 'mes') return { dataDe: dia(a, m, 1), dataAte: hoje };
  if (chave === 'ultimo') {
    const [pa, pm] = m === 1 ? [a - 1, 12] : [a, m - 1];
    return { dataDe: dia(pa, pm, 1), dataAte: dia(pa, pm, new Date(Date.UTC(pa, pm, 0)).getUTCDate()) };
  }
  if (chave === 'periodo' && (de || ate)) return { dataDe: de || null, dataAte: ate || null };
  return { dataDe: null, dataAte: null };
}

/**
 * O que falta escolher antes de ler a lista do computador (docs/03 §6): na Lista principal, o REPRESENTANTE (com o
 * supervisor; o vendedor já é o seu); no Acompanhamento, a EQUIPE para quem vê todas as equipes (supervisor ou
 * representante; uma busca também basta); o Acompanhamento exige também o PERÍODO do último registro.
 * A Lista principal não tem período: não contactados não têm data nenhuma.
 */
export function faltaParaLista(usuario, { aba = 'principal', filtros = {}, busca = '' } = {}) {
  const falta = [];
  // quem vê todas as equipes (gestão, financeiro, supervisor que também é gerente) escolhe uma; supervisor e vendedor já
  // têm a sua. Uma busca (CNPJ, nome, representante…) já é estreita o bastante e dispensa a equipe — nunca o período.
  // Lista principal: supervisor E representante obrigatórios para a gestão e o supervisor (o vendedor já é o representante);
  // a lista sai inteira, para o representante. No Acompanhamento basta a equipe (uma busca também), mais o período.
  if (aba !== 'acompanhamento') {
    if (usuario.perfil !== 'vendedor' && !filtros.vendedorId) falta.push('representante');
  } else if (veTodasEquipes(usuario) && !filtros.supervisorId && !filtros.vendedorId && !normalizarBusca(busca)) falta.push('equipe');
  if (aba === 'acompanhamento' && !filtros.dataDe && !filtros.dataAte) falta.push('periodo');
  return falta;
}
