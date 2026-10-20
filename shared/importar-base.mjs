// Carga da planilha base de prospects no banco. Usado por scripts/importar-base.mjs e pelos testes.
// Regras (docs/05-importacao.md):
//   * aceitas + rejeitadas = linhas lidas (linhas 100% vazias são contadas à parte e não entram)
//   * CNPJ novo → prospect "Não contactado" + tentativas de DT 1o/DT 2o como contatos de origem "importacao"
//   * CNPJ existente → atualiza só dados cadastrais; status, contatos e vendedor NÃO mudam
//   * prospect baixado (inválido) está congelado e não é tocado
import { analisarLinhaBase, contarDatasPlanilha, extrairCampos, linhaVazia, localizarCabecalho, mapearCabecalho, verificarConsistencia } from './importacao-base.mjs';
import { normalizarBusca } from './texto.mjs';
import { gravarEmLotes } from './gravacao.mjs';

const CAMPOS_CADASTRAIS = ['razao_social', 'nome_fantasia', 'endereco', 'bairro', 'cidade', 'uf', 'cep', 'latitude', 'longitude',
  'telefone', 'tipologia_gtm', 'onda', 'tipo', 'rota', 'subrota', 'obs_planilha', 'busca', 'cidade_busca', 'bairro_busca', 'cnpj_secundario'];

export function analisarPlanilhaBase(linhas, { mapaStatus, hoje, considerarDatas }) {
  // cabeçalho pode não estar na 1ª linha (título ou linha em branco acima) — localizarCabecalho
  const inicio = localizarCabecalho(linhas);
  const mapa = mapearCabecalho(linhas[inicio] ?? []);
  if (mapa.faltandoObrigatorias.length) {
    throw new Error(`colunas obrigatórias ausentes: ${mapa.faltandoObrigatorias.join(', ')}`);
  }
  const corpo = linhas.slice(inicio + 1);
  // padrão: considera as datas só se a planilha tiver alguma (DT 1o / DT 2o vazias → todos Não contactado)
  const datas = considerarDatas ?? contarDatasPlanilha(linhas) > 0;
  let vazias = 0;
  const resultados = [];
  corpo.forEach((linha, i) => {
    if (linhaVazia(linha)) { vazias++; return; }
    const campos = extrairCampos(linha, mapa.indices);
    const r = analisarLinhaBase(campos, { mapaStatus, hoje, considerarDatas: datas });
    resultados.push({ numeroLinha: inicio + i + 2, bruto: campos, ...r });
  });
  const cadastros = verificarConsistencia(resultados);
  return { mapa, resultados, vazias, considerarDatas: datas, ...cadastros };
}

async function idsUsuarios(db, perfil) {
  const r = await db.execute({ sql: 'SELECT id, codigo_erp, supervisor_id FROM usuarios WHERE perfil = ?', args: [perfil] });
  return new Map(r.rows.map((u) => [String(u.codigo_erp), { id: Number(u.id), supervisorId: u.supervisor_id == null ? null : Number(u.supervisor_id) }]));
}

/** Cria supervisores e vendedores que ainda não existem (sem senha: acesso liberado depois pelo administrador). */
async function garantirUsuarios(db, supervisores, vendedores) {
  await db.batch(supervisores.map((s) => ({
    sql: `INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login) VALUES ('supervisor', ?, ?, ?, ?)
          ON CONFLICT (perfil, codigo_erp) DO NOTHING`,
    args: [s.codigo, s.nome, normalizarBusca(s.nome), `sup${s.codigo}`],
  })), 'write');
  const sups = await idsUsuarios(db, 'supervisor');
  await db.batch(vendedores.map((v) => ({
    sql: `INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES ('vendedor', ?, ?, ?, ?, ?)
          ON CONFLICT (perfil, codigo_erp) DO NOTHING`,
    args: [v.codigo, v.nome, normalizarBusca(v.nome), v.codigo, sups.get(v.supervisorCodigo).id],
  })), 'write');
  return { sups, vends: await idsUsuarios(db, 'vendedor') };
}

export async function importarBase(db, { linhas, arquivoNome, arquivoSha256, executadoPor, mapaStatus, hoje, considerarDatas, simular = false }) {
  const analise = analisarPlanilhaBase(linhas, { mapaStatus, hoje, considerarDatas });
  const existentes = new Map((await db.execute('SELECT cnpj, vendedor_id, status_atual FROM prospects')).rows
    .map((r) => [r.cnpj, { vendedorId: Number(r.vendedor_id), status: r.status_atual }]));

  const aceitas = analise.resultados.filter((r) => r.dados);
  const resumo = {
    linhasLidas: analise.resultados.length,
    linhasVazias: analise.vazias,
    novos: aceitas.filter((r) => !existentes.has(r.dados.prospect.cnpj)).length,
    atualizados: aceitas.filter((r) => existentes.has(r.dados.prospect.cnpj)).length,
    rejeitadas: analise.resultados.length - aceitas.length,
    colunasNaoReconhecidas: analise.mapa.naoReconhecidas,
    colunasOpcionaisAusentes: analise.mapa.faltandoOpcionais,
    considerarDatas: analise.considerarDatas,
  };
  if (simular) return { resumo, resultados: analise.resultados, importacaoId: null };

  const imp = await db.execute({
    sql: `INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por, observacao)
          VALUES ('base_prospects', ?, ?, ?, ?) RETURNING id`,
    args: [arquivoNome, arquivoSha256, executadoPor, JSON.stringify({ vazias: analise.vazias, considerarDatas: analise.considerarDatas })],
  });
  const importacaoId = Number(imp.rows[0].id);

  try {
    const { sups, vends } = await garantirUsuarios(db, analise.supervisores, analise.vendedores);

    // vendedor já existente com outro supervisor → rejeita (a hierarquia não muda por importação)
    for (const r of aceitas) {
      const v = vends.get(r.dados.vendedor.codigo);
      const s = sups.get(r.dados.supervisor.codigo);
      if (v.supervisorId !== s.id) {
        r.erros.push(`representante ${r.dados.vendedor.codigo} já cadastrado com outro supervisor — ajuste o cadastro antes`);
        r.dados = null;
        continue;
      }
      const ex = existentes.get(r.dados.prospect.cnpj);
      if (ex && ex.vendedorId !== v.id) r.avisos.push('CNPJ já existe com outro vendedor — vendedor NÃO alterado (use transferência)');
      if (ex && ex.status === 'invalido') r.avisos.push('CNPJ baixado (congelado) — dados não atualizados');
      r.vendedorId = v.id;
    }

    const paraGravar = analise.resultados.filter((r) => r.dados);
    const gravacao = await gravarEmLotes(db, paraGravar, (r) => montarLinha(r, importacaoId));
    gravacao.forEach((g, i) => {
      if (!g.ok) {
        paraGravar[i].erros.push(`banco recusou: ${g.erro}`);
        paraGravar[i].dados = null;
      }
    });

    // registro de todas as linhas (aceitas e rejeitadas)
    const registros = analise.resultados.map((r) => ({
      sql: `INSERT INTO importacao_linhas (importacao_id, numero_linha, cnpj, resultado, mensagens, dados_brutos)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [importacaoId, r.numeroLinha, r.dados?.prospect.cnpj ?? null, r.dados ? 'aceita' : 'rejeitada',
        JSON.stringify(r.dados ? r.avisos : r.erros), JSON.stringify(r.bruto, (_, v) => v ?? null)],
    }));
    for (let i = 0; i < registros.length; i += 200) await db.batch(registros.slice(i, i + 200), 'write');

    const nAceitas = analise.resultados.filter((r) => r.dados).length;
    await db.execute({
      sql: `UPDATE importacoes SET situacao = 'concluida', concluido_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              linhas_lidas = ?, linhas_aceitas = ?, linhas_rejeitadas = ? WHERE id = ?`,
      args: [analise.resultados.length, nAceitas, analise.resultados.length - nAceitas, importacaoId],
    });
    resumo.rejeitadas = analise.resultados.length - nAceitas;
    resumo.aceitas = nAceitas;
    return { resumo, resultados: analise.resultados, importacaoId };
  } catch (e) {
    await db.execute({ sql: `UPDATE importacoes SET situacao = 'falhou', observacao = ? WHERE id = ?`, args: [String(e.message), importacaoId] });
    throw e;
  }
}

function montarLinha(r, importacaoId) {
  const p = r.dados.prospect;
  const colunas = ['cnpj', 'cnpj_raiz', ...CAMPOS_CADASTRAIS, 'dt_entrada_base', 'vendedor_id', 'importacao_id'];
  const valores = { ...p, vendedor_id: r.vendedorId, importacao_id: importacaoId };
  const stmts = [{
    sql: `INSERT INTO prospects (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})
          ON CONFLICT (cnpj) DO UPDATE SET ${CAMPOS_CADASTRAIS.map((c) => `${c} = excluded.${c}`).join(', ')},
            atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE prospects.status_atual <> 'invalido'`,
    args: colunas.map((c) => valores[c] ?? null),
  }];
  // tentativas da planilha: só entram se o prospect ainda não tem aquela tentativa nem contato feito no app
  for (const t of r.dados.tentativas) {
    stmts.push({
      sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado,
                                  motivo_id, origem, importacao_id)
            SELECT ?, p.id, p.vendedor_id, ?, ?, 'nao_informado', ?,
                   (SELECT id FROM motivos_sem_interesse WHERE codigo = ?), 'importacao', ?
              FROM prospects p
             WHERE p.cnpj = ?
               AND p.status_atual IN ('nao_contactado','em_prospeccao')
               AND NOT EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = p.id AND (c.numero_tentativa = ? OR c.origem = 'app'))`,
      args: [`imp-${p.cnpj}-${t.numero}`, t.numero, t.data, t.resultado, t.motivoCodigo, importacaoId, p.cnpj, t.numero],
    });
  }
  return stmts;
}
