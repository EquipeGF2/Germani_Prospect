// Avisos da equipe (tela #/avisos, migração 0031): o que passou do prazo configurado em Parâmetros, quebrado pela hierarquia
// de níveis (padrão: representante) para saber o que cobrar e de quem. Os avisos vêm prontos de vw_avisos; aqui ficam o
// recorte do usuário, os níveis, a árvore da grade e o que o PDF de pendências precisa. docs/03 §18
import { colunasUsuario, juntaUsuario, NIVEIS } from './explorar.mjs';
import { veTodasEquipes } from './perfis.mjs';

/** Tipos de aviso, na sequência do processo (é a ordem dos cards, do resumo e do PDF): o representante trabalha a lista,
 * o cliente parado, o retorno marcado no atendimento, o cadastro e a análise do crédito. `param` = chave em parametros (o número aparece no card); `desde` = o que é a data. */
export const TIPOS_AVISO = Object.freeze([
  { id: 'sem_lancar', nome: 'Representante sem registrar', curto: 'Sem registrar', desde: 'último registro', param: 'dias_alerta_sem_lancamento', rotuloParam: 'limite',
    regra: 'Tem clientes a procurar e nenhum atendimento registrado no app há mais dias que o limite.', acao: 'Cobrar os registros da rota.' },
  { id: 'parado', nome: 'Cliente sem movimento', curto: 'Sem movimento', desde: 'último registro', param: 'dias_alerta_sem_movimento', rotuloParam: 'limite',
    regra: 'Já teve registro (em prospecção ou aguardando pedido) e está parado. Não contactado não entra.', acao: 'Visitar ou registrar sem interesse.' },
  { id: 'retorno', nome: 'Retorno vencido', curto: 'Retorno vencido', desde: 'retornar em', param: null, rotuloParam: 'data do representante',
    regra: 'A data de retorno marcada no atendimento já passou.', acao: 'Voltar a falar com o cliente e registrar.' },
  { id: 'cadastro', nome: 'Prazo de cadastro vencido', curto: 'Cadastro vencido', desde: 'atendido em', param: 'prazo_cadastro_dias', rotuloParam: 'prazo',
    regra: 'Atendido e o cadastro ainda não chegou do ERP depois do prazo.', acao: 'Enviar a ficha cadastral ao ERP.' },
  { id: 'analise', nome: 'Análise financeira fora do prazo', curto: 'Análise financeira', desde: 'cadastro em', param: 'prazo_analise_financeira_dias', rotuloParam: 'prazo',
    regra: 'Cadastro chegou do ERP e o crédito não foi liberado no prazo.', acao: 'Conferir os documentos pendentes com o cliente e o financeiro.' },
]);
export const TIPO_AVISO = Object.freeze(Object.fromEntries(TIPOS_AVISO.map((t) => [t.id, t])));
const IDS = TIPOS_AVISO.map((t) => t.id);

// recorte: gestão (e supervisor que vê todas as equipes) tudo; supervisor a equipe; representante/vendedor a própria carteira
function escopoAvisos(usuario) {
  if (!usuario?.id || !usuario?.perfil) throw new Error('usuário obrigatório');
  if (veTodasEquipes(usuario)) return { where: '', args: [] };
  // a condição em a.vendedor_id desce para cada parte de vw_avisos (cada uma lê só a carteira da equipe, pelo índice)
  if (usuario.perfil === 'supervisor') return { where: 'AND a.vendedor_id IN (SELECT id FROM usuarios WHERE COALESCE(supervisor_id, id) = ?)', args: [usuario.id] };
  return { where: 'AND a.vendedor_id = ?', args: [usuario.id] };
}

/** Os avisos no escopo do usuário, com o cliente e a equipe (o "sem registrar" vem sem cliente). */
export function consultaAvisos({ usuario }) {
  const e = escopoAvisos(usuario);
  return {
    sql: `SELECT a.tipo, a.prospect_id, a.vendedor_id, a.data_ref, a.atraso, x.codigo_cliente_erp, x.razao_social, x.cnpj,
                 COALESCE(x.cidade, '') AS cidade, COALESCE(x.cidade_busca, '') AS cidade_busca, COALESCE(x.uf, '') AS uf,
                 COALESCE(x.tipologia_gtm, '') AS tipologia_gtm, COALESCE(x.onda, '') AS onda, COALESCE(x.rota, '') AS rota, COALESCE(x.subrota, '') AS subrota,
                 ${colunasUsuario}
            FROM vw_avisos a
            LEFT JOIN prospects x ON x.id = a.prospect_id
            ${juntaUsuario.replace('ON v.id = x.vendedor_id', 'ON v.id = a.vendedor_id')}
           WHERE 1 = 1 ${e.where}`,
    args: e.args,
  };
}

/** Prazos dos cards e o início da campanha (Parâmetros). */
const PARAMETROS = [...TIPOS_AVISO.filter((t) => t.param).map((t) => t.param), 'data_inicio_campanha'];
export const consultaParametrosAvisos = () => ({ sql: `SELECT chave, valor FROM parametros WHERE chave IN (${PARAMETROS.map(() => '?').join(', ')})`, args: PARAMETROS });

/**
 * O que a data do aviso é. Sem registrar e sem movimento contam a partir do início da campanha (0032): quando a data é ela,
 * o registro é anterior à campanha (ou não houve).
 */
export function rotuloDesde(aviso, parametros) {
  if ((aviso.tipo === 'sem_lancar' || aviso.tipo === 'parado') && aviso.data_ref && aviso.data_ref === parametros?.data_inicio_campanha) return 'início da campanha';
  return TIPO_AVISO[aviso.tipo].desde;
}

/** "Prazo: 15 dias" ou "Limite: 7 dias", com o número dos Parâmetros (ou o texto do tipo sem parâmetro): cabe no card sem quebrar. */
export function textoParametro(tipo, parametros) {
  const t = TIPO_AVISO[tipo];
  const rotulo = t.rotuloParam[0].toUpperCase() + t.rotuloParam.slice(1);
  if (!t.param) return rotulo;
  const n = Number(parametros?.[t.param]);
  return `${rotulo}: ${Number.isFinite(n) ? `${n} ${n === 1 ? 'dia' : 'dias'}` : '—'}`;
}

/** Sem interesse do representante nos últimos `dias` dias (o "para conferir" do PDF: não é pendência). */
export function consultaParaConferir({ usuario, dias = 7 }) {
  const e = escopoAvisos(usuario);
  e.where = e.where.replace('a.vendedor_id', 'x.vendedor_id');
  return {
    sql: `SELECT x.id AS prospect_id, x.vendedor_id, x.razao_social, COALESCE(x.cidade, '') AS cidade, COALESCE(x.uf, '') AS uf, x.dt_ultimo_contato AS data_ref, m.descricao AS motivo,
                 ${colunasUsuario}
            FROM prospects x JOIN motivos_sem_interesse m ON m.id = x.motivo_sem_interesse_id
            ${juntaUsuario}
           WHERE x.status_atual = 'sem_interesse' AND m.origem = 'representante' AND x.dt_ultimo_contato >= date('now', '-3 hours', ?) ${e.where}
           ORDER BY x.dt_ultimo_contato DESC`,
    args: [`-${Number(dias)} days`, ...e.args],
  };
}

/** Linha lida pronta para as contas. */
export const prepararAviso = (l) => ({ ...l, atraso: l.atraso == null ? null : Number(l.atraso), prospect_id: l.prospect_id == null ? null : Number(l.prospect_id) });

/**
 * Níveis da grade: os do Explorar carteira. O "sem registrar" é do representante (não tem cliente): nos níveis do cliente
 * (cidade, segmento, onda, rota, subrota) ele fica num ramo próprio, "Do representante".
 */
const DO_REPRESENTANTE = '\u0000rep';
export const NIVEIS_AVISOS = Object.freeze(Object.fromEntries(Object.entries(NIVEIS).map(([k, def]) => [k,
  k === 'supervisor' || k === 'representante' ? def
    : { ...def, chave: (l) => (l.tipo === 'sem_lancar' ? DO_REPRESENTANTE : def.chave(l)), rotulo: (l) => (l.tipo === 'sem_lancar' ? 'Do representante' : def.rotulo(l)) }])));

/** Quantos avisos de cada tipo e o total. */
export function contarAvisos(avisos) {
  const c = Object.fromEntries(IDS.map((t) => [t, 0]));
  for (const a of avisos) c[a.tipo] += 1;
  return { ...c, total: avisos.length };
}

/** "2 cadastro vencido · 5 sem movimento": o que cobrar daquele ramo, na ordem dos cards. */
export function resumoAvisos(avisos) {
  const c = contarAvisos(avisos);
  return TIPOS_AVISO.filter((t) => c[t.id]).map((t) => `${c[t.id]} ${t.curto.toLowerCase()}`).join(' · ');
}

/** Mais atrasados primeiro; quem nunca registrou (atraso desconhecido) vem antes de todos. */
export function ordenarAvisos(avisos) {
  const peso = (a) => (a.atraso == null ? Infinity : a.atraso);
  return [...avisos].sort((a, b) => peso(b) - peso(a) || IDS.indexOf(a.tipo) - IDS.indexOf(b.tipo) || String(a.razao_social ?? '').localeCompare(String(b.razao_social ?? ''), 'pt-BR'));
}

/**
 * Grade: linhas de grupo (uma por ramo dos níveis, com total e resumo) e, nos ramos abertos, os avisos.
 * A grade abre sempre recolhida: `abertos` = caminhos que o usuário abriu ('/representante=7'). Ramos com mais avisos primeiro.
 */
export function montarGradeAvisos({ avisos, niveis, abertos = new Set() }) {
  const linhas = [];
  const visitar = (lista, prof, caminho) => {
    if (prof === niveis.length) { for (const a of ordenarAvisos(lista)) linhas.push({ grupo: false, prof, aviso: a }); return; }
    const def = NIVEIS_AVISOS[niveis[prof]];
    const grupos = new Map();
    for (const a of lista) { const k = def.chave(a); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(a); }
    [...grupos.entries()].sort((a, b) => b[1].length - a[1].length || def.rotulo(a[1][0]).localeCompare(def.rotulo(b[1][0]), 'pt-BR'))
      .forEach(([k, g]) => {
        const c = `${caminho}/${niveis[prof]}=${k}`;
        const aberto = abertos.has(c);
        linhas.push({ grupo: true, prof, caminho: c, nivel: niveis[prof], rotulo: def.rotulo(g[0]), aberto, avisos: g, resumo: resumoAvisos(g) });
        if (aberto) visitar(g, prof + 1, c);
      });
  };
  visitar(avisos, 0, '');
  return linhas;
}

/**
 * PDF de pendências: um bloco por representante (supervisor › mais avisos primeiro), cada um com os avisos por tipo e
 * os sem interesse dele para conferir.
 */
export function pendenciasPorRepresentante(avisos, conferir = []) {
  const reps = new Map();
  const rep = (l) => {
    const k = String(l.vendedor_id);
    if (!reps.has(k)) reps.set(k, { vendedor_id: l.vendedor_id, nome: l.vendedor_nome ?? '—', codigo: l.vendedor_codigo ?? null, supervisor: l.supervisor_nome ?? '', avisos: [], conferir: [] });
    return reps.get(k);
  };
  for (const a of avisos) rep(a).avisos.push(a);
  for (const c of conferir) if (reps.has(String(c.vendedor_id))) rep(c).conferir.push(c);
  return [...reps.values()].map((r) => ({ ...r, cont: contarAvisos(r.avisos),
    porTipo: TIPOS_AVISO.map((t) => ({ tipo: t, avisos: ordenarAvisos(r.avisos.filter((a) => a.tipo === t.id)) })).filter((b) => b.avisos.length) }))
    .sort((a, b) => a.supervisor.localeCompare(b.supervisor, 'pt-BR') || b.avisos.length - a.avisos.length || a.nome.localeCompare(b.nome, 'pt-BR'));
}
