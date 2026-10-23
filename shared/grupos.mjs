// Grupos de CNPJ — base × arquivo do ERP (tela Administração → Grupos de CNPJ).  docs/03 §13
// Compara só a RAIZ do CNPJ (8 primeiros dígitos): para cada grupo do arquivo que também está na base, mostra as empresas
// da base e sugere o que fazer. Nada é gravado aqui; o expurgo é feito por comandosExpurgo (tabela expurgos, 0021).
//
// Sugestão (o administrador decide caso a caso):
//   Expurgar — o MESMO CNPJ está no arquivo, cadastro anterior ao início da campanha (ou sem data) e o prospect ainda
//              não foi trabalhado (Não contactado / Em prospecção, sem atendimento): já era cliente, não é prospect.
//   Manter   — cadastro feito na campanha (é conversão) ou prospect já trabalhado (atendido, cadastro, crédito, pedido,
//              sem interesse…): o trabalho do representante fica.
//   Decidir  — filial nova de um grupo que já é cliente (CNPJ fora do arquivo) e ainda não trabalhada.
// Já expurgado: aparece com a opção de desfazer.
import { analisarCnpj, raizCnpj } from './cnpj.mjs';
import { analisarData } from './datas.mjs';
import { chaveCabecalho, limparTexto, somenteDigitos } from './texto.mjs';
import { linhaVazia } from './importacao-base.mjs';
import { lerValor } from './financeiro.mjs';

const COLUNAS = {
  cnpj: ['CPF / CNPJ', 'CPF/CNPJ', 'CNPJ', 'CNPJ / CPF'],
  codigo: ['Cliente', 'Cód interno', 'Código interno', 'Código', 'Cód cliente'],
  razao: ['Razão Social', 'Razão social', 'Nome'],
  data: ['Dt. Cadastro', 'Data de cadastro', 'Data cadastro', 'Dt cadastro'],
  grupo: ['Créd. Grupo', 'Limite de crédito grupo', 'Limite grupo'],
};
export const EXPURGAVEIS = Object.freeze(['nao_contactado', 'em_prospeccao']);

/** Colunas do arquivo pelo título (só CPF / CNPJ é obrigatória). */
export function colunasDoArquivo(cabecalho) {
  const chaves = Array.from(cabecalho ?? [], (t) => chaveCabecalho(t));
  const indices = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = nomes.map((n) => chaves.indexOf(chaveCabecalho(n))).find((x) => x >= 0);
    if (i !== undefined) indices[campo] = i;
  }
  if (indices.cnpj === undefined) throw new Error('o arquivo precisa da coluna CPF / CNPJ (ou CNPJ)');
  return indices;
}

/** Lê o arquivo: raiz → { cnpjs: Map(cnpj → { codigo, razao, dataCadastro }), credGrupo }. CPF e CNPJ inválido ficam fora. */
export function gruposDoArquivo(linhas) {
  const [cabecalho = [], ...corpo] = linhas;
  const ix = colunasDoArquivo(cabecalho);
  const grupos = new Map();
  let lidas = 0; let ignoradas = 0;
  for (const l of corpo) {
    if (linhaVazia(l)) continue;
    lidas++;
    const bruto = l[ix.cnpj];
    const digitos = somenteDigitos(String(bruto ?? '').replace(/\.0+$/, ''));
    if (!digitos || digitos.length <= 11) { ignoradas++; continue; }   // vazio ou CPF
    const { cnpj, erro } = analisarCnpj(bruto);
    if (erro) { ignoradas++; continue; }
    const raiz = raizCnpj(cnpj);
    const g = grupos.get(raiz) ?? { raiz, cnpjs: new Map(), credGrupo: null };
    grupos.set(raiz, g);
    const d = ix.data === undefined ? { data: null } : analisarData(l[ix.data]);
    g.cnpjs.set(cnpj, {
      codigo: ix.codigo === undefined ? null : limparTexto(l[ix.codigo])?.replace(/\.0+$/, '') ?? null,
      razao: ix.razao === undefined ? null : limparTexto(l[ix.razao]),
      dataCadastro: d.data ?? null,
    });
    const cg = ix.grupo === undefined ? null : lerValor(l[ix.grupo]);
    if (cg != null && !Number.isNaN(cg)) g.credGrupo = Math.max(g.credGrupo ?? 0, cg);
  }
  return { grupos, lidas, ignoradas };
}

/** Sugestão para um prospect do grupo (ver o topo do arquivo). */
export function sugerir(p, noArquivo, inicioCampanha) {
  if (p.status_atual === 'expurgado') return 'expurgado';
  const trabalhado = !EXPURGAVEIS.includes(p.status_atual) || Boolean(p.dt_atendido);
  if (trabalhado) return 'manter';
  if (!noArquivo) return 'decidir';
  if (noArquivo.dataCadastro && inicioCampanha && noArquivo.dataCadastro >= inicioCampanha) return 'manter';
  return 'expurgar';
}

/**
 * Cruza o arquivo com a base pela raiz. Lê os prospects das raízes do arquivo em blocos (índice ix_prospects_raiz).
 * @returns {{ grupos: object[], resumo: object }}
 */
export async function analisarGrupos(db, { linhas }) {
  const arquivo = gruposDoArquivo(linhas);
  const raizes = [...arquivo.grupos.keys()];
  const inicioCampanha = (await db.execute("SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'")).rows[0]?.valor ?? null;
  const prospects = [];
  for (let i = 0; i < raizes.length; i += 400) {
    const bloco = raizes.slice(i, i + 400);
    const r = await db.execute({
      sql: `SELECT p.id, p.cnpj, p.cnpj_raiz, p.razao_social, p.cidade, p.uf, p.status_atual, s.nome AS status_nome, s.cor AS status_cor,
                   p.dt_atendido, p.dt_cadastro_erp, p.vendedor_id, v.nome AS vendedor_nome, sup.nome AS supervisor_nome,
                   COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END) AS supervisor_id
              FROM prospects p
              JOIN status s ON s.codigo = p.status_atual
              JOIN usuarios v ON v.id = p.vendedor_id
              LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
             WHERE p.cnpj_raiz IN (${bloco.map(() => '?').join(', ')})
             ORDER BY p.cnpj`,
      args: bloco,
    });
    prospects.push(...r.rows);
  }
  const porRaiz = new Map();
  for (const p of prospects) {
    const g = arquivo.grupos.get(p.cnpj_raiz);
    const noArquivo = g?.cnpjs.get(p.cnpj) ?? null;
    const item = { ...p, id: Number(p.id), noArquivo, sugestao: sugerir(p, noArquivo, inicioCampanha) };
    if (!porRaiz.has(p.cnpj_raiz)) porRaiz.set(p.cnpj_raiz, []);
    porRaiz.get(p.cnpj_raiz).push(item);
  }
  const grupos = [...porRaiz.entries()].map(([raiz, itens]) => {
    const g = arquivo.grupos.get(raiz);
    const nome = [...g.cnpjs.values()].find((c) => c.razao)?.razao ?? itens[0].razao_social;
    return { raiz, nome, arquivoQtd: g.cnpjs.size, credGrupo: g.credGrupo, prospects: itens };
  }).sort((a, b) => a.raiz.localeCompare(b.raiz));
  const todos = grupos.flatMap((g) => g.prospects);
  const conta = (f) => todos.filter(f).length;
  return {
    grupos,
    resumo: {
      linhasArquivo: arquivo.lidas, ignoradasArquivo: arquivo.ignoradas, raizesArquivo: arquivo.grupos.size,
      raizesEmComum: grupos.length, prospects: todos.length,
      mesmoCnpj: conta((p) => p.noArquivo), filialNova: conta((p) => !p.noArquivo),
      expurgar: conta((p) => p.sugestao === 'expurgar'), manter: conta((p) => p.sugestao === 'manter'),
      decidir: conta((p) => p.sugestao === 'decidir'), expurgados: conta((p) => p.sugestao === 'expurgado'),
    },
  };
}

/** Comandos de expurgo (ou desfazer) — um por prospect; o banco valida (só administrador; só quem não foi trabalhado). */
export function comandosExpurgo({ usuario, prospectIds, acao = 'expurgar', motivo, data }) {
  const m = limparTexto(motivo);
  if (!m) throw new Error('informe o motivo');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data ?? '')) throw new Error('data inválida');
  if (!['expurgar', 'desfazer'].includes(acao)) throw new Error('ação inválida');
  return [...new Set(prospectIds.map(Number))].map((id) => ({
    sql: 'INSERT INTO expurgos (prospect_id, acao, data_expurgo, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)',
    args: [id, acao, data, m, usuario.id],
  }));
}

export const MOTIVOS_EXPURGO = Object.freeze(['Já é cliente no ERP (mesmo CNPJ)', 'Filial de grupo que já é cliente', 'Cadastro duplicado na base']);
