// Relatório de crédito do ERP: limite CNPJ prevalece sobre o grupo; forma de pagamento; cadastro + liberação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, cnpjTeste, evento, prospect, registrarContato } from './auxiliar.mjs';
import { contarFormas, importarCredito, mapearColunasCredito, prazoDaCondicao } from '../shared/importar-credito.mjs';
import { consultaCreditoErp, consultaGrupoCnpj } from '../shared/carteira.mjs';
import { comandoLiberarCredito, validarLiberacao } from '../shared/financeiro.mjs';
import { normalizarBusca } from '../shared/texto.mjs';

const CAB = ['CNPJ', 'Cód interno', 'Razão social', 'Forma de pagamento', 'Prazo de pagamento', 'Limite de crédito CNPJ', 'Limite de crédito grupo', 'Data de cadastro'];
const base = { hoje: '2026-10-19', arquivoNome: 'credito.xlsx', arquivoSha256: 'x', executadoPor: 'adm' };

async function cenario() {
  const db = await bancoTeste();
  await criarEquipe(db);
  const p = {};
  for (let i = 1; i <= 8; i++) p[i] = await criarProspect(db, { n: i, razao: `Empresa ${i}` });
  await registrarContato(db, { prospectId: p[1], resultado: 'atendido', data: '2026-10-01' });          // aguardando cadastro
  await registrarContato(db, { prospectId: p[2], resultado: 'atendido', data: '2026-10-01' });
  await evento(db, { prospectId: p[2], tipo: 'cadastro', data: '2026-10-05', documento: 'C2' });           // análise financeira
  await registrarContato(db, { prospectId: p[3], resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' }); // sem interesse
  await evento(db, { prospectId: p[6], tipo: 'pedido', data: '2026-10-05', documento: 'P6' });            // venda realizada
  await evento(db, { prospectId: p[7], tipo: 'baixa', data: '2026-10-05' });                               // baixado
  return { db, p };
}

test('colunas do relatório reconhecidas (com variações de nome)', () => {
  assert.deepEqual(mapearColunasCredito(CAB).faltando, []);
  const m = mapearColunasCredito(['cnpj', 'COD. INTERNO', 'Forma Pagamento', 'Prazo', 'Limite CNPJ', 'Limite Grupo', 'Dt Cadastro'], { forma: 'Forma Pagamento' });
  assert.deepEqual(m.faltando, []);
  assert.equal(m.indices.codigo, 1);
  assert.deepEqual(mapearColunasCredito(['CNPJ']).faltando, ['Forma de pagamento', 'Data de cadastro']);
});

test('relatório de crédito: limite CNPJ prevalece, grupo só quando CNPJ vazio; cadastro + liberação; nenhuma linha some', async () => {
  const { db, p } = await cenario();
  const linhas = [CAB,
    [cnpjTeste(1), '101', 'Empresa 1', 'Boleto', '28', '15.000,00', '50.000,00', '15/10/2026'],   // CNPJ preenchido → 15.000
    [cnpjTeste(2), '102', 'Empresa 2', 'Antecipado', '', '', '30000', '05/10/2026'],             // CNPJ vazio → grupo 30.000
    [cnpjTeste(3), '103', 'Outra Razão', 'À vista', '0', '', '', '16/10/2026'],                 // sem interesse → cadastro + liberação, limite 0
    [cnpjTeste(4), '104', 'Empresa 4', 'Cheque', '30', '1000', '', '16/10/2026'],               // forma não mapeada
    [cnpjTeste(5), '105', 'Empresa 5', 'BOLETO', '30', '', '', '16/10/2026'],                   // boleto sem limite → sem crédito: à vista
    [cnpjTeste(6), '106', 'Empresa 6', 'Boleto', '30', '1000', '', '16/10/2026'],               // venda realizada → ignorada
    [cnpjTeste(7), '107', 'Empresa 7', 'Boleto', '30', '1000', '', '16/10/2026'],               // baixado → rejeitada
    [cnpjTeste(99), '199', 'Fora', 'Boleto', '30', '1000', '', '16/10/2026'],                   // fora da base → ignorada
    [cnpjTeste(8), '108', 'Empresa 8', 'Boleto', '30 dias', '2000', '', '20/10/2026'],          // data futura
    [null, null, null, null, null, null, null, null],
  ];
  const sim = await importarCredito(db, { ...base, linhas, simular: true });
  assert.deepEqual([sim.resumo.linhasLidas, sim.resumo.aceitas, sim.resumo.rejeitadas, sim.resumo.ignoradas, sim.resumo.linhasVazias, sim.resumo.cadastrosRegistrados], [9, 4, 3, 2, 1, 3]);
  assert.equal((await prospect(db, p[1])).status_atual, 'aguardando_cadastro'); // simulação não grava

  const r = await importarCredito(db, { ...base, linhas });
  const msg = (n) => r.resultados.find((x) => x.numeroLinha === n).erros.concat(r.resultados.find((x) => x.numeroLinha === n).avisos).join(' ');
  assert.match(msg(5), /não mapeada: "Cheque"/);
  assert.match(msg(6), /sem crédito no ERP \(limite 0\)/);
  assert.equal((await prospect(db, p[5])).forma_pagamento, 'a_vista');
  assert.match(msg(7), /venda já realizada/);
  assert.match(msg(8), /baixado/);
  assert.match(msg(10), /futuro/);
  assert.match(msg(4), /razão social diferente/);

  let x = await prospect(db, p[1]);
  assert.deepEqual([x.status_atual, x.forma_pagamento, x.prazo_pagamento_dias, x.limite_credito, x.limite_credito_origem, x.codigo_cliente_erp, x.dt_cadastro_erp],
    ['aguardando_pedido', 'boleto', 28, 15000, 'cnpj', '101', '2026-10-15']);
  x = await prospect(db, p[2]);
  assert.deepEqual([x.status_atual, x.forma_pagamento, x.limite_credito, x.limite_credito_origem, x.codigo_cliente_erp], ['aguardando_pedido', 'antecipado', 30000, 'grupo', 'C2']);
  x = await prospect(db, p[3]);
  assert.deepEqual([x.status_atual, x.forma_pagamento, x.limite_credito, x.limite_credito_origem], ['aguardando_pedido', 'a_vista', 0, 'informado']);

  // histórico: sem interesse → análise financeira (cadastro pelo relatório) → aguardando pedido (liberação)
  const mv = (await db.execute({ sql: 'SELECT tipo, status_anterior, status_novo, detalhe FROM movimentacoes WHERE prospect_id = ? ORDER BY id', args: [p[3]] })).rows;
  assert.deepEqual(mv.slice(-2).map((m) => [m.tipo, m.status_anterior, m.status_novo]), [['cadastro', 'sem_interesse', 'analise_financeira'], ['liberacao_credito', 'analise_financeira', 'aguardando_pedido']]);
  const mv1 = (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [p[1]] })).rows[0];
  assert.equal(mv1.detalhe, 'boleto 28 dias · limite R$ 15000.00 (CNPJ) · relatório de crédito');

  const imp = (await db.execute("SELECT * FROM importacoes WHERE tipo = 'credito_erp'")).rows[0];
  assert.equal(Number(imp.linhas_lidas), Number(imp.linhas_aceitas) + Number(imp.linhas_rejeitadas) + Number(imp.linhas_ignoradas));

  // reimportar o mesmo relatório: nada muda (mesmo crédito → ignorado)
  const r2 = await importarCredito(db, { ...base, linhas });
  assert.equal(r2.resumo.aceitas, 0);
  // relatório novo com limite diferente = nova liberação (correção), fica no histórico
  const r3 = await importarCredito(db, { ...base, linhas: [CAB, [cnpjTeste(1), '101', 'Empresa 1', 'Boleto', '28', '20.000,00', '', '15/10/2026']] });
  assert.equal(r3.resumo.aceitas, 1);
  assert.equal((await prospect(db, p[1])).limite_credito, 20000);
});

test('forma de pagamento: valores do arquivo listados para mapear na tela; mapa escolhido vale', async () => {
  const { db, p } = await cenario();
  const linhas = [CAB, [cnpjTeste(1), '101', 'Empresa 1', 'Cheque pré', '30', '1000', '', '15/10/2026'], [cnpjTeste(2), '1', 'x', 'BOLETO BANCÁRIO', '10', '5', '', '05/10/2026']];
  const { indices } = mapearColunasCredito(CAB);
  assert.deepEqual(contarFormas(linhas, indices).map((f) => [f.valor, f.sugerida]), [['Cheque pré', ''], ['BOLETO BANCÁRIO', 'boleto']]);
  const r = await importarCredito(db, { ...base, linhas, mapaFormas: { [normalizarBusca('Cheque pré')]: 'boleto', BOLETO: 'boleto', 'BOLETO BANCARIO': 'boleto' } });
  assert.equal(r.resumo.aceitas, 2);
  assert.equal((await prospect(db, p[1])).forma_pagamento, 'boleto');
});

test('console continua possível: forma, prazo, restrição e limite informados pelo analista', async () => {
  const { db, p } = await cenario();
  await db.execute({ sql: "INSERT INTO usuarios (perfil, nome, nome_busca, login) VALUES ('financeiro', 'Fin', 'FIN', 'fin')", args: [] });
  const fin = { id: 6, perfil: 'financeiro' };
  await db.execute(comandoLiberarCredito({ usuario: fin, prospectId: p[2], formaPagamento: 'boleto', prazoDias: '21', comRestricao: true, limiteCredito: '8.000,00', dataLiberacao: '2026-10-07' }));
  const x = await prospect(db, p[2]);
  assert.deepEqual([x.status_atual, x.forma_pagamento, x.prazo_pagamento_dias, x.limite_credito, x.limite_credito_origem, x.com_restricao_credito],
    ['aguardando_pedido', 'boleto', 21, 8000, 'informado', 1]);
  assert.match(validarLiberacao({ formaPagamento: 'boleto', prazoDias: '', comRestricao: false, limiteCredito: '0', dataLiberacao: '2026-10-07' }).erros.join(), /boleto exige limite/);
  // banco recusa liberação de relatório sem importação e a regra "CNPJ prevalece"
  await assert.rejects(db.execute({ sql: "INSERT INTO liberacoes_credito (prospect_id, origem, data_liberacao, forma_pagamento, limite_credito, limite_origem) VALUES (?, 'importacao', '2026-10-08', 'a_vista', 0, 'informado')", args: [p[2]] }), /CHECK/);
  const imp = await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('credito_erp','a','x','t') RETURNING id");
  await assert.rejects(db.execute({ sql: "INSERT INTO liberacoes_credito (prospect_id, origem, importacao_id, data_liberacao, forma_pagamento, limite_cnpj, limite_grupo, limite_credito, limite_origem) VALUES (?, 'importacao', ?, '2026-10-08', 'boleto', 100, 500, 500, 'grupo')", args: [p[2], imp.rows[0].id] }), /CHECK/);
});

// Layout real do ERP (relatório de cadastro): "Descrição" repetida, coluna sem título, Créd. Cliente → Créd. Grupo.
const CAB_ERP = ['Cliente', 'CPF / CNPJ', 'Razão Social', 'Cond. Pgto', 'Descrição', 'Forma Pgto', 'Descrição', null, 'Créd. Cliente', 'Créd. Grupo', 'Dt. Cadastro'];

test('relatório de cadastro do ERP: colunas pela posição, prazo médio da condição, CPF e fora da base ignorados', async () => {
  const m = mapearColunasCredito(CAB_ERP);
  assert.deepEqual(m.faltando, []);
  assert.deepEqual([m.indices.codigo, m.indices.cnpj, m.indices.cond, m.indices.cond_desc, m.indices.forma, m.indices.forma_desc, m.indices.limite_cnpj, m.indices.limite_grupo, m.indices.data_cadastro],
    [0, 1, 3, 4, 5, 6, 8, 9, 10]);
  assert.deepEqual(['21/28/35 DD BOLETO', '28 DD BOLETO', '07/23 ALIMENTAR/PRATO FEITO', '30/40/60 DD BOLETO', 'A VISTA', 'ANTECIPADO', null].map(prazoDaCondicao), [28, 28, 15, 43, 0, 0, 0]);

  const { db, p } = await cenario();
  const linhas = [CAB_ERP,
    [101, cnpjTeste(1), 'Empresa 1', '28B', '21/28/35 DD BOLETO', 1, 'Boleto', null, 15000, null, 46310],        // serial Excel = 2026-10-15
    [102, cnpjTeste(2), 'Empresa 2', '28A', '28 DD BOLETO', 1, 'Boleto', null, 0, null, '05/10/2026'],           // sem crédito → à vista
    [103, cnpjTeste(3), 'Empresa 3', '00A', 'A VISTA', 4, 'A vista', null, 9999999, null, '16/10/2026'],        // sem limite
    [104, 12345678901, 'Pessoa física', '00A', 'A VISTA', 4, 'A vista', null, 0, null, '16/10/2026'],            // CPF
    [105, '1234567890', 'CPF sem zero', '00A', 'A VISTA', 4, 'A vista', null, 0, null, '16/10/2026'],             // CPF (zero perdido)
    [106, cnpjTeste(99), 'Fora', '28A', '28 DD BOLETO', 1, 'Boleto', null, 1000, null, '16/10/2026'],           // fora da base
    [107, cnpjTeste(8), 'Empresa 8', '00A', 'A VISTA', 4, 'A vista', null, 0, null, '00/00/0000'],              // sem data
  ];
  const r = await importarCredito(db, { ...base, linhas });
  assert.deepEqual([r.resumo.aceitas, r.resumo.ignoradas, r.resumo.rejeitadas, r.resumo.cpf, r.resumo.naBase, r.resumo.semLimite, r.resumo.semCredito], [3, 3, 1, 2, 4, 1, 1]);
  let x = await prospect(db, p[1]);
  assert.deepEqual([x.forma_pagamento, x.prazo_pagamento_dias, x.limite_credito, x.codigo_cliente_erp, x.dt_cadastro_erp], ['boleto', 28, 15000, '101', '2026-10-15']);
  x = await prospect(db, p[2]);
  assert.deepEqual([x.forma_pagamento, x.prazo_pagamento_dias, x.limite_credito], ['a_vista', 0, 0]);
  const lib = (await db.execute({ sql: 'SELECT * FROM liberacoes_credito WHERE prospect_id = ?', args: [p[1]] })).rows[0];
  assert.deepEqual([lib.cond_pgto_codigo, lib.cond_pgto_descricao, lib.forma_pgto_codigo, lib.forma_pgto_descricao, Number(lib.prazo_medio_dias), Number(lib.sem_limite)],
    ['28B', '21/28/35 DD BOLETO', '1', 'Boleto', 28, 0]);
  const det = async (id) => (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [id] })).rows[0].detalhe;
  assert.equal(await det(p[1]), 'boleto 28 dias · limite R$ 15000.00 (CNPJ) · relatório de crédito — ERP: cond. 28B 21/28/35 DD BOLETO · forma 1 Boleto');
  assert.match(await det(p[3]), /^à vista · sem limite \(CNPJ\)/);
  // ficha: dados do ERP da última liberação
  const erp = (await db.execute(consultaCreditoErp({ prospectId: p[3] }))).rows[0];
  assert.deepEqual([erp.cond_pgto_descricao, Number(erp.sem_limite)], ['A VISTA', 1]);
});

test('Créd. Grupo: vale quando o do cliente está vazio, o mesmo valor (não somado) em todas as empresas da raiz', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const matriz = await criarProspect(db, { n: 50 });
  const filial = await criarProspect(db, { n: 51, cnpj: cnpjTeste(50, 2) });
  const outra = await criarProspect(db, { n: 52, cnpj: cnpjTeste(50, 3) });
  const linhas = [CAB_ERP,
    [1, cnpjTeste(50), 'G', '28A', '28 DD BOLETO', 1, 'Boleto', null, null, 2000, '10/10/2026'],
    [2, cnpjTeste(50, 2), 'G', '28A', '28 DD BOLETO', 1, 'Boleto', null, '', 2000, '10/10/2026'],
    [3, cnpjTeste(50, 3), 'G', '28A', '28 DD BOLETO', 1, 'Boleto', null, 500, 2000, '10/10/2026'],   // crédito próprio prevalece
  ];
  const r = await importarCredito(db, { ...base, linhas });
  assert.deepEqual([r.resumo.aceitas, r.resumo.grupos, r.resumo.gruposMistos, r.resumo.gruposDivergentes, r.resumo.limiteGrupo, r.resumo.limiteCliente], [3, 1, 1, 0, 2, 1]);
  const lim = async (id) => { const x = await prospect(db, id); return [x.limite_credito, x.limite_credito_origem]; };
  assert.deepEqual([await lim(matriz), await lim(filial), await lim(outra)], [[2000, 'grupo'], [2000, 'grupo'], [500, 'cnpj']]);
  const grupo = (await db.execute(consultaGrupoCnpj({ prospectId: filial }))).rows;
  assert.deepEqual(grupo.map((g) => Number(g.id)), [matriz, filial, outra]);

  // valores diferentes de Créd. Grupo na mesma raiz: avisados em todas as linhas do grupo
  const div = await importarCredito(db, { ...base, simular: true, linhas: [CAB_ERP,
    [1, cnpjTeste(50), 'G', '28A', '28 DD BOLETO', 1, 'Boleto', null, null, 3000, '10/10/2026'],
    [2, cnpjTeste(50, 2), 'G', '28A', '28 DD BOLETO', 1, 'Boleto', null, null, 2500, '10/10/2026']] });
  assert.equal(div.resumo.gruposDivergentes, 1);
  assert.ok(div.resultados.every((x) => x.avisos.some((a) => /Créd\. Grupo diferente.*2500 · 3000/.test(a))));
});
