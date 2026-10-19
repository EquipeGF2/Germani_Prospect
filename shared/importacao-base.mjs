// Importação da planilha base de prospects (carga inicial).
// Funções puras: recebem linhas já lidas da planilha e devolvem o que gravar, os erros e os avisos.
// Layout documentado em docs/05-importacao.md. Nenhuma linha é descartada em silêncio.
import { analisarCnpj, raizCnpj } from './cnpj.mjs';
import { analisarData } from './datas.mjs';
import { chaveCabecalho, limparTexto, normalizarBusca, somenteDigitos } from './texto.mjs';

/** Colunas da planilha base, na ordem enviada pela GERMANI. `ocorrencia` diferencia cabeçalhos repetidos. */
export const COLUNAS_BASE = Object.freeze([
  { campo: 'cnpj', cabecalho: 'CNPJ', obrigatoria: true },
  { campo: 'razao_social', cabecalho: 'Razão social', obrigatoria: true },
  { campo: 'nome_fantasia', cabecalho: 'Nome Fantasia' },
  { campo: 'endereco', cabecalho: 'Endereço' },
  { campo: 'bairro', cabecalho: 'Bairro' },
  { campo: 'cidade', cabecalho: 'Cidade' },
  { campo: 'uf', cabecalho: 'Estado' },
  { campo: 'cep', cabecalho: 'Código Postal' },
  { campo: 'latitude', cabecalho: 'Latitude' },
  { campo: 'longitude', cabecalho: 'Longitude' },
  { campo: 'tipologia_gtm', cabecalho: 'TIPOLOGIA GTM' },
  { campo: 'telefone', cabecalho: 'Telefone' },
  { campo: 'onda', cabecalho: 'ONDA' },
  { campo: 'cnpj_2', cabecalho: 'CNPJ', ocorrencia: 2 },
  { campo: 'tipo', cabecalho: 'TIPO' },
  { campo: 'cod_supervisor', cabecalho: 'COD SUP', obrigatoria: true },
  { campo: 'nome_supervisor', cabecalho: 'SUPERVISOR', obrigatoria: true },
  { campo: 'cod_vendedor', cabecalho: 'COD', obrigatoria: true },
  { campo: 'nome_vendedor', cabecalho: 'NOME', obrigatoria: true },
  { campo: 'rota', cabecalho: 'ROTA' },
  { campo: 'subrota', cabecalho: 'SUBROTA' },
  { campo: 'obs', cabecalho: 'OBS' },
  { campo: 'dt_1', cabecalho: 'DT 1o.contato' },
  { campo: 'dt_2', cabecalho: 'DT 2o.contato' },
  { campo: 'status_planilha', cabecalho: 'Status Atual' },
  { campo: 'dias_corridos_planilha', cabecalho: '# Dias Corridos' }, // recalculado pelo sistema (vw_prospects.dias_corridos)
]);

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

/**
 * Localiza as colunas no cabeçalho (sem acento, sem pontuação, sem diferenciar maiúsculas).
 * Retorna { indices: {campo: posição}, faltandoObrigatorias, faltandoOpcionais, naoReconhecidas }.
 */
export function mapearCabecalho(cabecalho) {
  const posicoes = new Map(); // chave → [posições]
  cabecalho.forEach((titulo, i) => {
    const chave = chaveCabecalho(titulo);
    if (!chave) return;
    if (!posicoes.has(chave)) posicoes.set(chave, []);
    posicoes.get(chave).push(i);
  });
  const indices = {};
  const usadas = new Set();
  const faltandoObrigatorias = [];
  const faltandoOpcionais = [];
  for (const col of COLUNAS_BASE) {
    const pos = posicoes.get(chaveCabecalho(col.cabecalho))?.[(col.ocorrencia ?? 1) - 1];
    if (pos === undefined) (col.obrigatoria ? faltandoObrigatorias : faltandoOpcionais).push(col.cabecalho);
    else {
      indices[col.campo] = pos;
      usadas.add(pos);
    }
  }
  const naoReconhecidas = cabecalho.map((t, i) => ({ t, i })).filter(({ t, i }) => limparTexto(t) && !usadas.has(i)).map(({ t }) => String(t));
  return { indices, faltandoObrigatorias, faltandoOpcionais, naoReconhecidas };
}

/** Converte a linha (array) em objeto {campo: valor bruto}. */
export function extrairCampos(linha, indices) {
  const obj = {};
  for (const [campo, pos] of Object.entries(indices)) obj[campo] = linha[pos] ?? null;
  return obj;
}

export function linhaVazia(linha) {
  return !linha || linha.every((v) => limparTexto(v instanceof Date ? 'x' : v) === null);
}

function numero(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return valor;
  const s = String(valor).trim().replace(/\s/g, '');
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}

function codigo(valor) {
  const t = limparTexto(valor);
  return t === null ? null : t.replace(/\.0+$/, '');
}

/**
 * Analisa uma linha da planilha base.
 * @param campos      objeto de extrairCampos
 * @param mapaStatus  config/mapa-status-planilha.json (chaves já normalizadas por normalizarMapaStatus)
 * @param hoje        AAAA-MM-DD (São Paulo)
 * @returns {{ dados: object|null, erros: string[], avisos: string[] }}
 */
export function analisarLinhaBase(campos, { mapaStatus, hoje }) {
  const erros = [];
  const avisos = [];

  const { cnpj, erro: erroCnpj } = analisarCnpj(campos.cnpj);
  if (erroCnpj) erros.push(`${erroCnpj}: "${campos.cnpj ?? ''}"`);
  let cnpjSecundario = null;
  if (limparTexto(campos.cnpj_2) !== null) {
    const seg = analisarCnpj(campos.cnpj_2);
    if (seg.cnpj !== cnpj) {
      cnpjSecundario = seg.cnpj ?? limparTexto(campos.cnpj_2);
      avisos.push(`segunda coluna CNPJ diferente da primeira: "${campos.cnpj_2}" (guardado em cnpj_secundario)`);
    }
  }

  const razao = limparTexto(campos.razao_social);
  if (!razao) erros.push('Razão social vazia');

  const vendedor = { codigo: codigo(campos.cod_vendedor), nome: limparTexto(campos.nome_vendedor) };
  const supervisor = { codigo: codigo(campos.cod_supervisor), nome: limparTexto(campos.nome_supervisor) };
  if (!vendedor.codigo || !vendedor.nome) erros.push('COD / NOME do representante-vendedor vazio');
  if (!supervisor.codigo || !supervisor.nome) erros.push('COD SUP / SUPERVISOR vazio');

  let uf = normalizarBusca(campos.uf) || null;
  if (uf && !UFS.has(uf)) {
    avisos.push(`Estado inválido "${campos.uf}" — gravado vazio`);
    uf = null;
  }
  let cep = somenteDigitos(campos.cep);
  if (cep && cep.length < 8 && cep.length >= 7) cep = cep.padStart(8, '0');
  if (cep && cep.length !== 8) {
    avisos.push(`Código Postal inválido "${campos.cep}" — gravado vazio`);
    cep = null;
  }

  let lat = numero(campos.latitude);
  let lng = numero(campos.longitude);
  // Brasil: latitude −34 a +6, longitude −74 a −28
  const coordOk = lat !== null && lng !== null && lat >= -34 && lat <= 6 && lng >= -74 && lng <= -28;
  if ((lat !== null || lng !== null) && !coordOk) {
    avisos.push(`Latitude/Longitude fora do Brasil ou inválidas (${campos.latitude}; ${campos.longitude}) — gravadas vazias`);
    lat = lng = null;
  }

  // Tentativas de contato (DT 1o / DT 2o) + Status Atual
  const d1 = analisarData(campos.dt_1);
  const d2 = analisarData(campos.dt_2);
  if (d1.erro) erros.push(`DT 1o.contato: ${d1.erro}`);
  if (d2.erro) erros.push(`DT 2o.contato: ${d2.erro}`);
  if (d2.data && !d1.data && !d1.erro) erros.push('DT 2o.contato preenchida sem DT 1o.contato');
  if (d1.data && d2.data && d2.data < d1.data) erros.push('DT 2o.contato anterior à DT 1o.contato');
  for (const d of [d1.data, d2.data]) if (d && d > hoje) erros.push(`data de contato no futuro: ${d}`);

  const statusTexto = limparTexto(campos.status_planilha) ?? '';
  const resultadoFinal = mapaStatus[normalizarBusca(statusTexto)];
  const datas = [d1.data, d2.data].filter(Boolean);
  const tentativas = [];
  if (resultadoFinal === undefined) {
    erros.push(`Status Atual não mapeado: "${statusTexto}" (defina como tratar este valor no mapeamento do Status Atual)`);
  } else if (resultadoFinal === 'sem_contato') {
    if (datas.length) erros.push(`Status Atual "${statusTexto}" indica sem contato, mas há data de contato`);
  } else if (!datas.length) {
    erros.push(`Status Atual "${statusTexto}" exige DT 1o.contato`);
  } else {
    datas.forEach((data, i) => {
      const ultima = i === datas.length - 1;
      const resultado = ultima ? resultadoFinal : 'contato_planilha';
      tentativas.push({
        numero: i + 1,
        data,
        resultado,
        motivoCodigo: resultado === 'sem_interesse' ? 'NAO_INFORMADO' : null,
      });
    });
    if (resultadoFinal === 'sem_interesse') avisos.push('sem interesse sem motivo na planilha — motivo "Não informado (importação inicial)"');
  }

  if (erros.length) return { dados: null, erros, avisos };

  const nomeFantasia = limparTexto(campos.nome_fantasia);
  const cidade = limparTexto(campos.cidade);
  const bairro = limparTexto(campos.bairro);
  const dtEntrada = datas.length && datas[0] < hoje ? datas[0] : hoje;
  return {
    erros,
    avisos,
    dados: {
      prospect: {
        cnpj,
        cnpj_raiz: raizCnpj(cnpj),
        cnpj_secundario: cnpjSecundario,
        razao_social: razao,
        nome_fantasia: nomeFantasia,
        endereco: limparTexto(campos.endereco),
        bairro,
        cidade,
        uf,
        cep,
        latitude: lat,
        longitude: lng,
        telefone: somenteDigitos(campos.telefone),
        tipologia_gtm: limparTexto(campos.tipologia_gtm),
        onda: codigo(campos.onda),
        tipo: limparTexto(campos.tipo),
        rota: codigo(campos.rota),
        subrota: codigo(campos.subrota),
        obs_planilha: limparTexto(campos.obs),
        dt_entrada_base: dtEntrada,
        busca: normalizarBusca([razao, nomeFantasia, cnpj, cidade, bairro].filter(Boolean).join(' ')),
        cidade_busca: cidade ? normalizarBusca(cidade) : null,
        bairro_busca: bairro ? normalizarBusca(bairro) : null,
      },
      vendedor,
      supervisor,
      tentativas,
    },
  };
}

/** Normaliza as chaves do mapa de status (ignora chaves iniciadas por "_"). */
export function normalizarMapaStatus(mapa) {
  const validos = new Set(['sem_contato', 'contato_planilha', 'atendido', 'sem_interesse']);
  const saida = {};
  for (const [k, v] of Object.entries(mapa)) {
    if (k.startsWith('_')) continue;
    if (!validos.has(v)) throw new Error(`mapa de status: valor inválido "${v}" para "${k}"`);
    saida[normalizarBusca(k)] = v;
  }
  return saida;
}

/**
 * Verificações entre linhas: CNPJ repetido na planilha, vendedor com dois supervisores,
 * mesmo código com nomes diferentes. Altera `resultados` (rejeita / acrescenta avisos).
 * @param resultados [{ numeroLinha, dados, erros, avisos }]
 */
export function verificarConsistencia(resultados) {
  const cnpjs = new Map();
  const vendedores = new Map(); // cod → { supervisor, nome, linha }
  const supervisores = new Map(); // cod → nome
  for (const r of resultados) {
    if (!r.dados) continue;
    const { prospect, vendedor, supervisor } = r.dados;
    if (cnpjs.has(prospect.cnpj)) {
      r.erros.push(`CNPJ repetido na planilha (primeira ocorrência na linha ${cnpjs.get(prospect.cnpj)})`);
      r.dados = null;
      continue;
    }
    const v = vendedores.get(vendedor.codigo);
    if (v && v.supervisor !== supervisor.codigo) {
      r.erros.push(`representante ${vendedor.codigo} aparece com outro supervisor (${v.supervisor}, linha ${v.linha})`);
      r.dados = null;
      continue;
    }
    cnpjs.set(prospect.cnpj, r.numeroLinha);
    if (!v) vendedores.set(vendedor.codigo, { supervisor: supervisor.codigo, nome: vendedor.nome, linha: r.numeroLinha });
    else if (normalizarBusca(v.nome) !== normalizarBusca(vendedor.nome)) r.avisos.push(`representante ${vendedor.codigo} com nome diferente da linha ${v.linha} — mantido "${v.nome}"`);
    const s = supervisores.get(supervisor.codigo);
    if (s === undefined) supervisores.set(supervisor.codigo, supervisor.nome);
    else if (normalizarBusca(s) !== normalizarBusca(supervisor.nome)) r.avisos.push(`supervisor ${supervisor.codigo} com nome diferente — mantido "${s}"`);
  }
  return {
    vendedores: [...vendedores.entries()].map(([codigo, v]) => ({ codigo, nome: v.nome, supervisorCodigo: v.supervisor })),
    supervisores: [...supervisores.entries()].map(([codigo, nome]) => ({ codigo, nome })),
  };
}

/** Valores distintos da coluna "Status Atual" (sem acento/maiúsculas) com a quantidade de linhas — mapeamento na tela. */
export function contarStatusPlanilha(linhas) {
  const [cabecalho = [], ...corpo] = linhas;
  const { indices } = mapearCabecalho(cabecalho);
  const grupos = new Map(); // chave → { valor (1º visto), quantidade }
  for (const l of corpo) {
    if (linhaVazia(l)) continue;
    const valor = limparTexto(extrairCampos(l, indices).status_planilha) ?? '';
    const chave = normalizarBusca(valor);
    const g = grupos.get(chave) ?? { valor, chave, quantidade: 0 };
    g.quantidade++;
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade);
}
