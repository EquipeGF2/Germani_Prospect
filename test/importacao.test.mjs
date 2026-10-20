import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, cnpjTeste } from './auxiliar.mjs';
import { importarBase } from '../shared/importar-base.mjs';
import { importarEventos } from '../shared/importar-eventos.mjs';
import { COLUNAS_BASE, chaveStatus, contarStatusPlanilha, mapearCabecalho, normalizarMapaStatus } from '../shared/importacao-base.mjs';
import { formatarCnpj } from '../shared/cnpj.mjs';

const MAPA = normalizarMapaStatus({ '': 'sem_contato', 'Não contactado': 'sem_contato', 'Em prospecção': 'contato_planilha', 'Aguardando cadastro': 'atendido', 'Sem interesse': 'sem_interesse' });
const CAB = COLUNAS_BASE.map((c) => c.cabecalho);
const HOJE = '2026-10-19';

function linha({ cnpj, razao = 'Empresa', cod = '10', nome = 'Vend Dez', codSup = '90', sup = 'Sup Um', dt1 = null, dt2 = null, status = '', cidade = 'Santa Cruz do Sul', lat = '-29,7', lng = '-52,4' }) {
  const v = Object.fromEntries(CAB.map((c, i) => [i, null]));
  const set = (campo, valor) => { v[COLUNAS_BASE.findIndex((c) => c.campo === campo)] = valor; };
  set('cnpj', cnpj); set('cnpj_2', cnpj); set('razao_social', razao); set('cidade', cidade); set('uf', 'RS'); set('cep', '96810-000');
  set('latitude', lat); set('longitude', lng); set('cod_vendedor', cod); set('nome_vendedor', nome); set('cod_supervisor', codSup); set('nome_supervisor', sup);
  set('dt_1', dt1); set('dt_2', dt2); set('status_planilha', status);
  return CAB.map((_, i) => v[i]);
}

const importar = (db, linhas) => importarBase(db, { linhas: [CAB, ...linhas], arquivoNome: 't.xlsx', arquivoSha256: 'x', executadoPor: 'teste', mapaStatus: MAPA, hoje: HOJE });

test('cabeçalho real da planilha é reconhecido, incluindo a 2ª coluna CNPJ', async () => {
  const m = mapearCabecalho(CAB);
  assert.deepEqual(m.faltandoObrigatorias, []);
  assert.equal(m.indices.cnpj, 0);
  assert.equal(m.indices.cnpj_2, 13);
  assert.equal(m.indices.cod_vendedor, 17);
  await assert.rejects(importarBase(null, { linhas: [['Razão social']], mapaStatus: MAPA, hoje: HOJE }), /obrigatórias ausentes: CNPJ, COD SUP/);
});

test('nenhuma linha some: aceitas + rejeitadas = lidas; rejeitadas com motivo', async () => {
  const db = await bancoTeste();
  const linhas = [
    linha({ cnpj: formatarCnpj(cnpjTeste(1)) }),
    linha({ cnpj: cnpjTeste(2), dt1: '01/10/2026', status: 'Em prospecção' }),
    linha({ cnpj: '11.111.111/1111-11' }),                                    // DV inválido
    linha({ cnpj: cnpjTeste(3), status: 'Ligar amanhã' }),                    // status não mapeado
    linha({ cnpj: cnpjTeste(1) }),                                            // repetido
    linha({ cnpj: cnpjTeste(4), dt2: '02/10/2026', status: 'Em prospecção' }),// DT2 sem DT1
    linha({ cnpj: cnpjTeste(5), cod: '10', codSup: '91', sup: 'Sup Dois' }),  // vendedor com 2 supervisores
    linha({ cnpj: cnpjTeste(6), dt1: '01/12/2026', status: 'Em prospecção' }),// data futura
    linha({ cnpj: cnpjTeste(7), lat: '10', lng: '20' }),                      // coordenada fora do Brasil → aviso
    CAB.map(() => null),                                                      // linha vazia
  ];
  const { resumo, importacaoId } = await importar(db, linhas);
  assert.equal(resumo.linhasLidas, 9);
  assert.equal(resumo.linhasVazias, 1);
  assert.equal(resumo.aceitas, 3);
  assert.equal(resumo.rejeitadas, 6);
  const imp = (await db.execute({ sql: 'SELECT * FROM importacoes WHERE id = ?', args: [importacaoId] })).rows[0];
  assert.equal(imp.situacao, 'concluida');
  assert.equal(Number(imp.linhas_lidas), Number(imp.linhas_aceitas) + Number(imp.linhas_rejeitadas));
  const linhasReg = (await db.execute({ sql: 'SELECT numero_linha, resultado, mensagens FROM importacao_linhas WHERE importacao_id = ? ORDER BY numero_linha', args: [importacaoId] })).rows;
  assert.equal(linhasReg.length, 9);
  const msg = (n) => JSON.parse(linhasReg.find((l) => Number(l.numero_linha) === n).mensagens).join(' ');
  assert.match(msg(4), /dígito verificador/);
  assert.match(msg(5), /não mapeado/);
  assert.match(msg(6), /repetido/);
  assert.match(msg(7), /sem DT 1o/);
  assert.match(msg(8), /outro supervisor/);
  assert.match(msg(9), /futuro/);
  assert.match(msg(10), /fora do Brasil/);
});

test('cria supervisores e vendedores pelo código, sem senha (acesso liberado depois)', async () => {
  const db = await bancoTeste();
  await importar(db, [linha({ cnpj: cnpjTeste(1) }), linha({ cnpj: cnpjTeste(2), cod: '11', nome: 'Vend Onze' })]);
  const u = (await db.execute('SELECT login, perfil, senha_hash, supervisor_id FROM usuarios ORDER BY login')).rows;
  assert.deepEqual(u.map((x) => [x.login, x.perfil]), [['10', 'vendedor'], ['11', 'vendedor'], ['sup90', 'supervisor']]);
  assert.ok(u.every((x) => x.senha_hash === null));
});

test('DT 1o / DT 2o viram tentativas com o histórico na data certa', async () => {
  const db = await bancoTeste();
  await importar(db, [
    linha({ cnpj: cnpjTeste(1), dt1: '01/09/2026', status: 'Em prospecção' }),
    linha({ cnpj: cnpjTeste(2), dt1: '01/09/2026', dt2: '10/09/2026', status: 'Em prospecção' }),
    linha({ cnpj: cnpjTeste(3), dt1: '01/09/2026', status: 'Aguardando cadastro' }),
    linha({ cnpj: cnpjTeste(4), dt1: '01/09/2026', dt2: '05/09/2026', status: 'Sem interesse' }),
  ]);
  const st = Object.fromEntries((await db.execute('SELECT cnpj, status_atual, tentativas, dt_entrada_base FROM prospects')).rows.map((r) => [r.cnpj, r]));
  assert.equal(st[cnpjTeste(1)].status_atual, 'em_prospeccao');
  assert.equal(st[cnpjTeste(2)].status_atual, 'em_prospeccao'); // contatos na planilha sem resultado: continua na lista
  assert.equal(st[cnpjTeste(3)].status_atual, 'aguardando_cadastro');
  assert.equal(st[cnpjTeste(4)].status_atual, 'sem_interesse');
  assert.equal(st[cnpjTeste(1)].dt_entrada_base, '2026-09-01');
  const c = (await db.execute("SELECT canal, origem FROM contatos")).rows;
  assert.ok(c.every((x) => x.canal === 'nao_informado' && x.origem === 'importacao'));
});

test('reimportar a mesma planilha não altera status, histórico, contatos nem vendedor', async () => {
  const db = await bancoTeste();
  const linhas = [
    linha({ cnpj: cnpjTeste(1), dt1: '01/09/2026', status: 'Em prospecção' }),
    linha({ cnpj: cnpjTeste(2) }),
  ];
  await importar(db, linhas);
  const foto = async () => ({
    p: (await db.execute('SELECT cnpj, status_atual, tentativas, vendedor_id, data_proxima_acao FROM prospects ORDER BY cnpj')).rows.map((r) => ({ ...r })),
    c: Number((await db.execute('SELECT count(*) n FROM contatos')).rows[0].n),
    h: Number((await db.execute('SELECT count(*) n FROM movimentacoes')).rows[0].n),
  });
  const antes = await foto();
  // contato registrado no app entre as importações
  await db.execute({ sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado, data_retorno)
                           SELECT 'app-1', id, vendedor_id, 1, '2026-10-02', 'visita', 'atendido', NULL FROM prospects WHERE cnpj = ?`, args: [cnpjTeste(2)] });
  const depoisApp = await foto();
  const linhasAlteradas = [linha({ cnpj: cnpjTeste(1), razao: 'Empresa Renomeada', dt1: '01/09/2026', status: 'Em prospecção', cod: '11', nome: 'Vend Onze' }), linhas[1]];
  const { resultados } = await importar(db, linhasAlteradas);
  const depois = await foto();
  assert.deepEqual(depois, depoisApp);
  assert.notDeepEqual(antes.c, depoisApp.c);
  assert.equal((await db.execute({ sql: 'SELECT razao_social FROM prospects WHERE cnpj = ?', args: [cnpjTeste(1)] })).rows[0].razao_social, 'Empresa Renomeada');
  assert.match(resultados[0].avisos.join(' '), /vendedor NÃO alterado/);
});

test('importação de eventos: pedido, cadastro e baixados; não-prospect fica ignorado; reimportação idempotente', async () => {
  const db = await bancoTeste();
  await importar(db, [linha({ cnpj: cnpjTeste(1) }), linha({ cnpj: cnpjTeste(2) }), linha({ cnpj: cnpjTeste(3) })]);
  const base = { hoje: HOJE, arquivoNome: 'e.csv', arquivoSha256: 'x', executadoPor: 'teste' };
  const pedidos = [['CNPJ', 'Data', 'Pedido'], [cnpjTeste(1), '15/10/2026', '777'], [cnpjTeste(99), '15/10/2026', '778'], ['123', '15/10/2026', '779'], [cnpjTeste(2), '', '780']];
  const r1 = await importarEventos(db, { ...base, tipo: 'pedido', linhas: pedidos, colunas: { cnpj: 'CNPJ', data: 'Data', documento: 'Pedido' } });
  assert.deepEqual([r1.resumo.aceitas, r1.resumo.ignoradas, r1.resumo.rejeitadas], [1, 1, 2]);
  const r2 = await importarEventos(db, { ...base, tipo: 'pedido', linhas: pedidos, colunas: { cnpj: 'CNPJ', data: 'Data', documento: 'Pedido' } });
  assert.deepEqual([r2.resumo.aceitas, r2.resumo.ignoradas], [0, 2]);
  const baixas = [['cnpj'], [cnpjTeste(3)], [cnpjTeste(1)]];
  const r3 = await importarEventos(db, { ...base, tipo: 'baixa', linhas: baixas, colunas: { cnpj: 'CNPJ' }, dataPadrao: '2026-10-19' });
  assert.equal(r3.resumo.aceitas, 2);
  const st = Object.fromEntries((await db.execute('SELECT cnpj, status_atual FROM prospects')).rows.map((r) => [r.cnpj, r.status_atual]));
  assert.equal(st[cnpjTeste(1)], 'invalido'); // baixado após a venda: congelado com o histórico da época
  assert.equal(st[cnpjTeste(3)], 'invalido');
  const r4 = await importarEventos(db, { ...base, tipo: 'cadastro', linhas: [['CNPJ', 'Data', 'Cod'], [cnpjTeste(3), '2026-10-19', 'C1']], colunas: { cnpj: 'CNPJ', data: 'Data', documento: 'Cod' } });
  assert.equal(r4.resumo.rejeitadas, 1);
  assert.match(r4.resultados[0].erros.join(), /impossibilitado de faturamento/);
  const imps = (await db.execute("SELECT * FROM importacoes WHERE tipo <> 'base_prospects'")).rows;
  assert.ok(imps.every((i) => Number(i.linhas_lidas) === Number(i.linhas_aceitas) + Number(i.linhas_rejeitadas) + Number(i.linhas_ignoradas)));
});

test('DT 1o / DT 2o vazias (ou desconsideradas): todos entram como Não contactado, Status Atual ignorado com aviso', async () => {
  const db = await bancoTeste();
  // planilha sem nenhuma data → padrão desconsidera; status "Sem interesse" não é aplicado (não há data)
  const r = await importar(db, [linha({ cnpj: cnpjTeste(1), status: 'Sem interesse' }), linha({ cnpj: cnpjTeste(2), status: 'Ligar amanhã' })]);
  assert.equal(r.resumo.considerarDatas, false);
  assert.equal(r.resumo.rejeitadas, 0);
  assert.match(r.resultados[0].avisos.join(' '), /ignorado \(datas de contato desconsideradas\)/);
  // com datas na planilha, mas o administrador escolheu não considerar
  const db2 = await bancoTeste();
  const r2 = await importarBase(db2, { linhas: [CAB, linha({ cnpj: cnpjTeste(3), dt1: '01/09/2026', status: 'Em prospecção' })], arquivoNome: 't', arquivoSha256: 'x',
    executadoPor: 'teste', mapaStatus: MAPA, hoje: HOJE, considerarDatas: false });
  assert.equal(r2.resumo.considerarDatas, false);
  for (const banco of [db, db2]) {
    const p = (await banco.execute('SELECT status_atual, tentativas, dt_primeiro_contato, dt_entrada_base FROM prospects')).rows;
    assert.ok(p.every((x) => x.status_atual === 'nao_contactado' && Number(x.tentativas) === 0 && x.dt_primeiro_contato === null && x.dt_entrada_base === HOJE));
    assert.equal(Number((await banco.execute('SELECT count(*) n FROM contatos')).rows[0].n), 0);
  }
  // padrão com alguma data na planilha = considera
  const db3 = await bancoTeste();
  const r3 = await importar(db3, [linha({ cnpj: cnpjTeste(4), dt1: '01/09/2026', status: 'Em prospecção' }), linha({ cnpj: cnpjTeste(5) })]);
  assert.equal(r3.resumo.considerarDatas, true);
});

test('importação de pedidos com valor (migração 0004): "1.234,56" e números; vazio avisa; inválido é rejeitado', async () => {
  const db = await bancoTeste();
  await importar(db, [linha({ cnpj: cnpjTeste(1) }), linha({ cnpj: cnpjTeste(2) }), linha({ cnpj: cnpjTeste(3) }), linha({ cnpj: cnpjTeste(4) })]);
  const base = { hoje: HOJE, arquivoNome: 'p.csv', arquivoSha256: 'x', executadoPor: 'teste' };
  const linhas = [['CNPJ', 'Data', 'Pedido', 'Valor Total'],
    [cnpjTeste(1), '15/10/2026', '1', 'R$ 1.234,56'], [cnpjTeste(2), '15/10/2026', '2', 800], [cnpjTeste(3), '15/10/2026', '3', ''], [cnpjTeste(4), '15/10/2026', '4', 'abc']];
  const r = await importarEventos(db, { ...base, tipo: 'pedido', linhas, colunas: { cnpj: 'CNPJ', data: 'Data', documento: 'Pedido', valor: 'Valor Total' } });
  assert.deepEqual([r.resumo.aceitas, r.resumo.rejeitadas], [3, 1]);
  assert.match(r.resultados[2].avisos.join(), /pedido sem valor/);
  assert.match(r.resultados[3].erros.join(), /valor do pedido inválido/);
  const v = (await db.execute("SELECT documento, valor FROM eventos_erp WHERE tipo = 'pedido' ORDER BY documento")).rows.map((x) => [x.documento, x.valor]);
  assert.deepEqual(v, [['1', 1234.56], ['2', 800], ['3', null]]);
  // valor só existe em pedido e nunca negativo
  const pid = (await db.execute('SELECT id FROM prospects LIMIT 1')).rows[0].id;
  const imp = (await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('cadastro_erp','t','x','t') RETURNING id")).rows[0].id;
  await assert.rejects(db.execute({ sql: "INSERT INTO eventos_erp (prospect_id, tipo, data_evento, documento, valor, importacao_id) VALUES (?, 'cadastro', '2026-10-15', 'C9', 10, ?)", args: [pid, imp] }), /CHECK constraint/);
  await assert.rejects(db.execute({ sql: "INSERT INTO eventos_erp (prospect_id, tipo, data_evento, documento, valor, importacao_id) VALUES (?, 'pedido', '2026-10-15', 'P9', -1, ?)", args: [pid, imp] }), /CHECK constraint/);
});

test('planilha real: cabeçalho na 2ª linha e Status Atual com número na frente ("1 - Não Contactado")', async () => {
  const db = await bancoTeste();
  assert.equal(chaveStatus('1 - Não Contactado'), 'NAO CONTACTADO');
  assert.equal(chaveStatus('2 - Sem Interesse'), 'SEM INTERESSE');
  const linhas = [[], CAB, linha({ cnpj: cnpjTeste(1), status: '1 - Não Contactado' }), linha({ cnpj: cnpjTeste(2), dt1: '01/10/2026', status: '2 - Sem Interesse' }),
    linha({ cnpj: '11.111.111/1111-11' })];
  assert.deepEqual(contarStatusPlanilha(linhas).map((v) => [v.chave, v.quantidade]), [['NAO CONTACTADO', 1], ['SEM INTERESSE', 1], ['', 1]]);
  const { resumo, importacaoId } = await importarBase(db, { linhas, arquivoNome: 't.xlsx', arquivoSha256: 'x', executadoPor: 'teste', mapaStatus: MAPA, hoje: HOJE });
  assert.equal(resumo.aceitas, 2);
  assert.equal(resumo.rejeitadas, 1);
  // número da linha = linha real da planilha (cabeçalho na 2, dados a partir da 3)
  const rej = (await db.execute({ sql: "SELECT numero_linha FROM importacao_linhas WHERE importacao_id = ? AND resultado = 'rejeitada'", args: [importacaoId] })).rows[0];
  assert.equal(Number(rej.numero_linha), 5);
});

test('coluna TIPO define representante × vendedor; reimportar preenche quem está sem tipo e não muda quem já tem', async () => {
  const db = await bancoTeste();
  const iTipo = COLUNAS_BASE.findIndex((c) => c.campo === 'tipo');
  const comTipo = (l, t) => { l[iTipo] = t; return l; };
  const etapas = [];
  await importarBase(db, { linhas: [CAB, comTipo(linha({ cnpj: cnpjTeste(1), cod: '10', nome: 'Vend Dez' }), 'Representante'),
    comTipo(linha({ cnpj: cnpjTeste(2), cod: '11', nome: 'Vend Onze' }), 'Vendedor'), comTipo(linha({ cnpj: cnpjTeste(3), cod: '12', nome: 'Vend Doze' }), null)],
  arquivoNome: 't.xlsx', arquivoSha256: 'x', executadoPor: 'teste', mapaStatus: MAPA, hoje: HOJE, aoProgredir: (p) => etapas.push(p.etapa) });
  const tipo = async (cod) => (await db.execute({ sql: "SELECT tipo_atuacao FROM usuarios WHERE perfil = 'vendedor' AND codigo_erp = ?", args: [cod] })).rows[0].tipo_atuacao;
  assert.equal(await tipo('10'), 'representante');
  assert.equal(await tipo('11'), 'vendedor');
  assert.equal(await tipo('12'), null);
  assert.deepEqual([...new Set(etapas)], ['equipe', 'prospects', 'relatorio']);
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'vendedor' WHERE codigo_erp = '10'");   // ajustado na tela
  await importarBase(db, { linhas: [CAB, comTipo(linha({ cnpj: cnpjTeste(1), cod: '10', nome: 'Vend Dez' }), 'Representante'),
    comTipo(linha({ cnpj: cnpjTeste(3), cod: '12', nome: 'Vend Doze' }), 'Representante')],
  arquivoNome: 't.xlsx', arquivoSha256: 'y', executadoPor: 'teste', mapaStatus: MAPA, hoje: HOJE });
  assert.equal(await tipo('10'), 'vendedor', 'tipo já definido não muda');
  assert.equal(await tipo('12'), 'representante', 'sem tipo: preenchido pela planilha');
});

test('falta de permissão no banco (SQLITE_AUTH) para a importação inteira com mensagem clara, sem tentar linha a linha', async () => {
  const { gravarEmLotes } = await import('../shared/gravacao.mjs');
  let chamadas = 0;
  const db = { batch: async () => { chamadas++; throw new Error('SQLITE_AUTH: SQLite error: not authorized'); } };
  await assert.rejects(gravarEmLotes(db, [1, 2, 3], (x) => [{ sql: 'x', args: [x] }]), /falta de permissão.*Criar administrador/);
  assert.equal(chamadas, 1);
});
