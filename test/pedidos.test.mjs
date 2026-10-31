// Importação de pedidos: leitura do .xls do ERP, classificação, status, reimportação e exclusão por arquivo. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, cnpjTeste, criarEquipe, criarProspect, evento, prospect, registrarContato } from './auxiliar.mjs';
import { lerBiff2 } from '../shared/biff.mjs';
import { lerPlanilhaDeBytes } from '../shared/planilha.mjs';
import { apagarArquivoPedidos, conferirExclusao, gravarPedidos, listarArquivosPedidos, simularPedidos, statusDepois } from '../shared/importar-pedidos.mjs';
import { alertasPedidos, bonificacaoPorCliente, clientesDistintos, clientesVariosRepresentantes, consultaPedidos, porRepresentante, resumirPedidos } from '../shared/pedidos.mjs';
import { consultaPedidosResumo } from '../shared/explorar.mjs';

const CAB = ['Cliente', 'Razão Social', 'CPF / CNPJ', 'Vlr. Pedido', 'Vlr. Faturado', 'Pedido', 'Sit.', 'Situação', 'Transação', 'Desc. Trans.', 'Rep.'];
const SIT = { 9: 'Não Fechado', 1: 'Aberto Total', 2: 'Aberto Parcial', 4: 'Liquidado', 5: 'Desistência' };
const TR = { 90100: 'Pedido de Venda', 90106: 'Pedido de Bonificação' };
const linha = ({ cli = 100, razao = 'Empresa', doc, valor = 100, fat = 0, num, sit = 1, tr = '90100', rep = 10 }) => [cli, razao, doc, valor, fat, num, sit, SIT[sit] ?? 'Outra', tr, TR[tr] ?? 'Outra', rep];
const arquivo = (...linhas) => [CAB, ...linhas];
const grava = (db, linhas, data = '2026-10-31') => gravarPedidos(db, { linhas, dataPadrao: data, hoje: '2026-12-31', arquivoNome: `p-${data}.xls`, arquivoSha256: data, executadoPor: 'teste' });
const adm = { id: 4, perfil: 'administrador' };
const pedidosDe = async (db, usuario = adm) => (await db.execute(consultaPedidos({ usuario }))).rows;

async function montar() {
  const db = await bancoTeste();
  await criarEquipe(db);
  return db;
}

/** Monta um .xls BIFF2 como o do Senior: texto Windows-1252, número em double. */
function xlsBiff2(linhas) {
  const partes = [Buffer.from([0x09, 0, 4, 0, 0, 0, 0x10, 0])];
  linhas.forEach((l, i) => l.forEach((v, j) => {
    if (v == null) return;
    const ini = Buffer.alloc(7); ini.writeUInt16LE(i, 0); ini.writeUInt16LE(j, 2);
    if (typeof v === 'number') {
      const n = Buffer.alloc(8); n.writeDoubleLE(v, 0);
      const c = Buffer.alloc(4); c.writeUInt16LE(3, 0); c.writeUInt16LE(15, 2);
      partes.push(c, ini, n);
    } else {
      const t = Buffer.from(String(v), 'latin1');
      const c = Buffer.alloc(4); c.writeUInt16LE(4, 0); c.writeUInt16LE(8 + t.length, 2);
      partes.push(c, ini, Buffer.from([t.length]), t);
    }
  }));
  partes.push(Buffer.from([0x0a, 0, 0, 0]));
  return new Uint8Array(Buffer.concat(partes));
}

test('.xls BIFF2 do ERP: acento, número, zero à esquerda; extensão em maiúsculas; outra versão é recusada com instrução', async () => {
  const bytes = xlsBiff2([CAB, [112, 'AÇÃO LTDA', '11222333000181', 65.11, 0, 70000, 1, 'Aberto Total', '90100', 'Pedido de Venda', 30]]);
  const linhas = lerBiff2(bytes);
  assert.deepEqual(linhas[0], CAB);
  assert.deepEqual(linhas[1], [112, 'AÇÃO LTDA', '11222333000181', 65.11, 0, 70000, 1, 'Aberto Total', '90100', 'Pedido de Venda', 30]);
  const lido = await lerPlanilhaDeBytes(bytes, 'pedidos_excel.xlsx.XLS', {});
  assert.equal(lido.formato, 'xls');
  assert.throws(() => lerBiff2(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), /salve como .xlsx/);
});

test('classifica: venda válida, digitado, desistência e bonificação à parte; nenhuma linha some', async () => {
  const db = await montar();
  const a = cnpjTeste(1); const b = cnpjTeste(2);
  await criarProspect(db, { n: 1 }); await criarProspect(db, { n: 2 });
  const linhas = arquivo(
    linha({ doc: a, num: 1, sit: 9, valor: 10 }), linha({ doc: a, num: 2, sit: 1, valor: 20 }),
    linha({ doc: a, num: 3, sit: 2, valor: 30, fat: 5 }), linha({ doc: a, num: 4, sit: 4, valor: 40, fat: 40 }),
    linha({ doc: b, num: 5, sit: 5, valor: 50 }), linha({ doc: a, num: 6, sit: 4, valor: 60, fat: 60, tr: '90106' }));
  const s = await simularPedidos(db, { linhas, dataPadrao: '2026-10-31', hoje: '2026-10-31' });
  assert.equal(s.resumo.linhasLidas, 6);
  assert.equal(s.resumo.aceitas + s.resumo.rejeitadas + s.resumo.ignoradas, 6);
  assert.deepEqual(s.totais.venda, { qtd: 3, valor: 90, faturado: 45 });
  assert.equal(s.totais.saldo, 45);
  assert.deepEqual(s.totais.digitado, { qtd: 1, valor: 10 });
  assert.deepEqual(s.totais.cancelado, { qtd: 1, valor: 50 });
  assert.deepEqual(s.totais.investimento, { qtd: 1, valor: 60 });
  await grava(db, linhas);
  const r = resumirPedidos(await pedidosDe(db));
  assert.deepEqual(r.venda, { qtd: 3, valor: 90 });
  assert.equal(r.faturado, 45); assert.equal(r.saldo, 45);
  assert.deepEqual(r.investimento, { qtd: 1, valor: 60 }, 'bonificação fica em conta própria');
});

test('status: pedido válido = Venda realizada; só digitado ou cancelado = Aguardando pedido válido; só bonificação não muda', async () => {
  const db = await montar();
  const [v, d, c, i, x] = [1, 2, 3, 4, 5].map((n) => cnpjTeste(n));
  const ids = [];
  for (const n of [1, 2, 3, 4, 5]) ids.push(await criarProspect(db, { n }));
  await registrarContato(db, { prospectId: ids[0], resultado: 'atendido', data: '2026-10-10' });
  await grava(db, arquivo(linha({ doc: v, num: 1, sit: 4, valor: 10, fat: 10 }), linha({ doc: v, num: 2, sit: 5 }),
    linha({ doc: d, num: 3, sit: 9 }), linha({ doc: c, num: 4, sit: 5 }), linha({ doc: i, num: 5, sit: 4, tr: '90106' })));
  const st = async (id) => (await prospect(db, id)).status_atual;
  assert.equal(await st(ids[0]), 'venda_realizada');
  assert.equal(await st(ids[1]), 'aguardando_pedido_valido');
  assert.equal(await st(ids[2]), 'aguardando_pedido_valido');
  assert.equal(await st(ids[3]), 'nao_contactado', 'só bonificação não muda o status');
  assert.equal(await st(ids[4]), 'nao_contactado', 'sem pedido');
  const p = await prospect(db, ids[0]);
  assert.equal(p.numero_pedido, '1'); assert.equal(p.dt_pedido, '2026-10-31');
  assert.equal(Number(p.convertido_sem_registro), 0, 'havia atendimento registrado');
  const sem = await prospect(db, ids[1]);
  assert.equal(sem.dt_atendido, '2026-10-31', 'sem registro do representante: atendimento automático');
  assert.equal(Number(sem.convertido_sem_registro), 1);
  const mov = (await db.execute({ sql: "SELECT tipo, status_novo FROM movimentacoes WHERE prospect_id = ? AND origem = 'erp' ORDER BY id", args: [ids[1]] })).rows;
  assert.deepEqual(mov.map((m) => [m.tipo, m.status_novo]), [['atendido', 'nao_contactado'], ['pedido', 'aguardando_pedido_valido']]);
});

test('a simulação prevê o mesmo status que o banco aplica', async () => {
  const db = await montar();
  for (const n of [1, 2, 3]) await criarProspect(db, { n });
  const linhas = arquivo(linha({ doc: cnpjTeste(1), num: 1, sit: 1 }), linha({ doc: cnpjTeste(2), num: 2, sit: 9 }), linha({ doc: cnpjTeste(3), num: 3, sit: 4, tr: '90106' }));
  const s = await simularPedidos(db, { linhas, dataPadrao: '2026-10-31', hoje: '2026-10-31' });
  assert.deepEqual(s.movimentos.map((m) => [m.antes, m.depois, m.clientes]).sort(), [['nao_contactado', 'aguardando_pedido_valido', 1], ['nao_contactado', 'venda_realizada', 1]]);
  const antes = (await db.execute('SELECT COUNT(*) n FROM pedidos_erp')).rows[0].n;
  assert.equal(Number(antes), 0, 'simular não grava');
  await grava(db, linhas);
  const agora = (await db.execute("SELECT status_atual, COUNT(*) n FROM prospects WHERE status_atual <> 'nao_contactado' GROUP BY 1 ORDER BY 1")).rows;
  assert.deepEqual(agora.map((l) => [l.status_atual, Number(l.n)]), [['aguardando_pedido_valido', 1], ['venda_realizada', 1]]);
  assert.equal(statusDepois('expurgado', [{ valida: true, tipo: 'venda' }]), 'expurgado');
});

test('próximo arquivo: registra a mudança com a data, entra em carteira, cancela o único e ignora o que não mudou', async () => {
  const db = await montar();
  const a = cnpjTeste(1); const b = cnpjTeste(2);
  const idA = await criarProspect(db, { n: 1 }); const idB = await criarProspect(db, { n: 2 });
  await grava(db, arquivo(linha({ doc: a, num: 1, sit: 9 }), linha({ doc: b, num: 2, sit: 1 }), linha({ doc: b, num: 3, sit: 4, fat: 100 })), '2026-10-31');
  assert.equal((await prospect(db, idA)).status_atual, 'aguardando_pedido_valido');
  assert.equal((await prospect(db, idB)).status_atual, 'venda_realizada');
  const g = await grava(db, arquivo(linha({ doc: a, num: 1, sit: 1 }), linha({ doc: b, num: 2, sit: 5 }), linha({ doc: b, num: 3, sit: 4, fat: 100 })), '2026-11-05');
  assert.equal(g.resumo.ignoradas, 1, 'pedido igual ao anterior não grava de novo');
  assert.equal((await prospect(db, idA)).status_atual, 'venda_realizada', 'digitado entrou em carteira');
  assert.equal((await prospect(db, idB)).status_atual, 'venda_realizada', 'continua pelo outro pedido');
  const g3 = await grava(db, arquivo(linha({ doc: b, num: 3, sit: 5 })), '2026-11-06');
  assert.equal(g3.sumiram, 1, 'o pedido 1, em carteira, não veio: só avisa');
  assert.equal((await prospect(db, idB)).status_atual, 'aguardando_pedido_valido', 'cancelou o último válido');
  assert.equal((await prospect(db, idB)).dt_pedido, null);
  const hist = (await db.execute("SELECT data_situacao, situacao_codigo FROM pedidos_erp WHERE numero = '3' ORDER BY id")).rows;
  assert.deepEqual(hist.map((h) => [h.data_situacao, h.situacao_codigo]), [['2026-10-31', '4'], ['2026-11-06', '5']], 'nada é sobrescrito');
  const ped1 = (await pedidosDe(db)).find((p) => p.numero === '1');
  assert.equal(ped1.fase, 'carteira', 'situação do pedido que sumiu é mantida');
  await assert.rejects(db.execute("UPDATE pedidos_erp SET valor_pedido = 1 WHERE numero = '1'"), /somente inclusão/);
  await assert.rejects(db.execute("DELETE FROM pedidos_erp WHERE numero = '1'"), /exclusão do arquivo/);
});

test('representante: cliente fica com o dono, venda vai para quem realizou, valor não duplica e cada um vê o seu', async () => {
  const db = await montar();
  const a = cnpjTeste(1); const fora = cnpjTeste(9);
  await criarProspect(db, { n: 1, vendedorId: 2 });   // carteira do vendedor 10
  await grava(db, arquivo(linha({ doc: a, num: 1, sit: 4, valor: 70, fat: 70, rep: 10 }), linha({ doc: a, num: 2, sit: 1, valor: 30, rep: 11 }),
    linha({ doc: fora, num: 3, sit: 1, valor: 5, rep: 11 }), linha({ doc: '12345678909', num: 4, sit: 1, valor: 7, rep: 77 })));
  const todos = await pedidosDe(db);
  const reps = porRepresentante(todos);
  const r10 = reps.find((r) => r.codigo === '10'); const r11 = reps.find((r) => r.codigo === '11'); const r77 = reps.find((r) => r.codigo === '77');
  assert.equal(r10.venda, 70); assert.equal(r10.propria, 70); assert.equal(r10.rotulo, '10 · Vend Dez');
  assert.equal(r11.outra, 30); assert.equal(r11.fora, 5);
  assert.equal(r77.rotulo, '77 · sem cadastro');
  assert.equal(reps.reduce((s, r) => s + r.venda, 0), 112, 'valor nunca duplica');
  assert.equal(reps.reduce((s, r) => s + r.clientes.length, 0), 4); assert.equal(clientesDistintos(todos), 3, 'cliente distinto no total');
  const varios = clientesVariosRepresentantes(todos);
  assert.equal(varios.length, 1); assert.deepEqual(varios[0].reps.map((r) => r.parte), [70, 30]);
  assert.equal((await prospect(db, 1)).vendedor_id, 2, 'a carteira não muda');
  const do11 = await pedidosDe(db, { id: 3, perfil: 'vendedor' });
  assert.deepEqual(do11.map((p) => p.numero).sort(), ['2', '3'], 'o 11 vê o que vendeu, inclusive fora da lista dele');
  const do10 = await pedidosDe(db, { id: 2, perfil: 'vendedor' });
  assert.deepEqual(do10.map((p) => p.numero).sort(), ['1', '2'], 'o dono vê todos os pedidos do cliente dele');
  const alertas = alertasPedidos(todos, { hoje: '2026-11-01' });
  assert.deepEqual(alertas.map((x) => x.tipo), ['sem_codigo'], 'venda por outro representante não gera alerta');
});

test('investimento por cliente e alerta de bonificação sem venda', async () => {
  const db = await montar();
  const a = cnpjTeste(1); const b = cnpjTeste(2);
  await criarProspect(db, { n: 1 }); await criarProspect(db, { n: 2 });
  await grava(db, arquivo(linha({ doc: a, num: 1, sit: 4, valor: 1000, fat: 1000 }), linha({ doc: a, num: 2, sit: 4, valor: 10, fat: 10, tr: '90106' }), linha({ doc: b, num: 3, sit: 4, valor: 500, fat: 500, tr: '90106' })));
  const pedidos = await pedidosDe(db);
  const b1 = bonificacaoPorCliente(pedidos);
  assert.deepEqual(b1.map((c) => [c.documento, c.investimento, c.venda, c.pct]), [[b, 500, 0, null], [a, 10, 1000, 1]]);
  assert.equal(resumirPedidos(pedidos).venda.valor, 1000, 'bonificação não muda a venda');
  assert.deepEqual(alertasPedidos(pedidos, { hoje: '2026-11-01' }).map((x) => x.tipo), ['bonificacao']);
});

test('alertas: prazo de pedido válido, desistências, pedido parado e limite do grupo', async () => {
  const pedido = (extra) => ({ cpf_cnpj: 'X', razao_social: 'R', codigo_cliente: '1', raiz: 'R1', tipo: 'venda', fase: 'carteira', valida: 1, saldo: 0, valor_pedido: 10, rep_id: 1, rep_codigo: '10', data_situacao: '2026-10-31', prospect_id: 1, ...extra });
  const op = { hoje: '2026-12-31', prazoPedidoValido: 10, desistencias: 2, diasAberto: 30 };
  assert.ok(alertasPedidos([pedido({ fase: 'digitado', valida: 0, status_atual: 'aguardando_pedido_valido' })], op).some((a) => a.tipo === 'pedido_valido'));
  assert.ok(alertasPedidos([pedido({ fase: 'cancelado', valida: 0 }), pedido({ fase: 'cancelado', valida: 0 })], op).some((a) => a.tipo === 'desistencia'));
  assert.ok(alertasPedidos([pedido({})], op).some((a) => a.tipo === 'aberto'));
  assert.ok(alertasPedidos([pedido({ saldo: 100, limite_credito: 50, limite_credito_origem: 'grupo' })], op).some((a) => a.tipo === 'limite'));
  assert.ok(!alertasPedidos([pedido({ saldo: 100, limite_credito: 9999999, limite_credito_origem: 'grupo' })], op).some((a) => a.tipo === 'limite'), '9.999.999 = sem limite');
});

test('linhas recusadas, CPF, CNPJ baixado, expurgado e código novo', async () => {
  const db = await montar();
  const baixado = cnpjTeste(1); const exp = cnpjTeste(2);
  const idBaixado = await criarProspect(db, { n: 1 }); const idExp = await criarProspect(db, { n: 2 });
  await evento(db, { prospectId: idBaixado, tipo: 'baixa', data: '2026-10-01' });
  await db.execute({ sql: "INSERT INTO expurgos (prospect_id, acao, data_expurgo, motivo, usuario_id) VALUES (?, 'expurgar', '2026-10-01', 'já cliente', 4)", args: [idExp] });
  const linhas = arquivo(linha({ doc: 'abc', num: 1 }), linha({ doc: cnpjTeste(3), num: null }), linha({ doc: cnpjTeste(3), num: 2, valor: -1 }),
    linha({ doc: baixado, num: 3 }), linha({ doc: exp, num: 4 }), linha({ doc: '12345678909', num: 5 }), linha({ doc: cnpjTeste(3), num: 5 }));
  const s = await simularPedidos(db, { linhas, dataPadrao: '2026-10-31', hoje: '2026-10-31' });
  const por = Object.fromEntries(s.resultados.map((r) => [r.numeroLinha, r]));
  assert.equal(por[2].resultado, 'rejeitada'); assert.equal(por[3].resultado, 'rejeitada'); assert.equal(por[4].resultado, 'rejeitada');
  assert.match(por[5].erros[0], /impossibilitado de faturamento/);
  assert.equal(por[6].resultado, 'aceita'); assert.match(por[6].avisos.join(), /expurgado/);
  assert.match(por[7].avisos.join(), /CPF/);
  assert.match(por[8].erros[0], /repetido/);
  await grava(db, linhas);
  assert.equal((await prospect(db, idExp)).status_atual, 'expurgado', 'o pedido só fica registrado');
  await assert.rejects(simularPedidos(db, { linhas: [['A', 'B'], [1, 2]], dataPadrao: '2026-10-31', hoje: '2026-10-31' }), /não é o relatório de pedidos/);
  const novo = arquivo(linha({ doc: cnpjTeste(3), num: 9, sit: 7, tr: '95000' }));
  const sn = await simularPedidos(db, { linhas: novo, dataPadrao: '2026-10-31', hoje: '2026-10-31' });
  assert.deepEqual(sn.novos.transacoes.map((t) => t.codigo), ['95000']); assert.deepEqual(sn.novos.situacoes.map((t) => t.codigo), ['7']);
  await assert.rejects(grava(db, novo), /classifique os códigos/);
  const data = await simularPedidos(db, { linhas: arquivo(linha({ doc: cnpjTeste(3), num: 10 })), dataPadrao: '2099-01-01', hoje: '2026-10-31' });
  assert.match(data.resultados[0].erros[0], /futuro/);
});

test('apagar arquivo: tira só o que ele trouxe, volta o status e deixa o registro; do mais novo para o mais antigo', async () => {
  const db = await montar();
  const a = cnpjTeste(1); const b = cnpjTeste(2); const c = cnpjTeste(3);
  const idA = await criarProspect(db, { n: 1 }); const idB = await criarProspect(db, { n: 2 }); const idC = await criarProspect(db, { n: 3 });
  await registrarContato(db, { prospectId: idA, resultado: 'atendido', data: '2026-10-10' });
  const resumoAntes = (await db.execute('SELECT status_atual, SUM(qtd) q FROM resumo_carteira GROUP BY 1 HAVING q > 0 ORDER BY 1')).rows.map((l) => [l.status_atual, Number(l.q)]);
  const linhasAntes = Number((await db.execute('SELECT COUNT(*) n FROM movimentacoes')).rows[0].n);
  const g1 = await grava(db, arquivo(linha({ doc: a, num: 1, sit: 4, valor: 10, fat: 10 }), linha({ doc: b, num: 2, sit: 9 }), linha({ doc: c, num: 3, sit: 1 })), '2026-10-31');
  const pedidoApp = await prospect(db, idB);
  assert.equal(pedidoApp.status_atual, 'aguardando_pedido_valido');
  // depois do arquivo, o representante registra um atendimento no cliente em Aguardando pedido válido
  await registrarContato(db, { prospectId: idB, resultado: 'atendido', data: '2026-11-01' });
  assert.equal((await prospect(db, idB)).status_atual, 'aguardando_pedido_valido', 'registro não muda a fase');
  const g2 = await grava(db, arquivo(linha({ doc: c, num: 3, sit: 5 })), '2026-11-05');
  assert.equal((await prospect(db, idC)).status_atual, 'aguardando_pedido_valido');

  await assert.rejects(apagarArquivoPedidos(db, { importacaoId: g1.importacaoId, usuarioId: 4 }), /mais novo/);
  await assert.rejects(apagarArquivoPedidos(db, { importacaoId: g2.importacaoId, usuarioId: 2 }), /administrador/);
  const lista = await listarArquivosPedidos(db);
  assert.deepEqual(lista.map((x) => [x.id, x.pode_apagar]), [[g2.importacaoId, true], [g1.importacaoId, false]]);

  await assert.rejects(db.execute('DELETE FROM importacao_linhas'), /somente inclusão/, 'as linhas continuam protegidas fora da exclusão');
  await apagarArquivoPedidos(db, { importacaoId: g2.importacaoId, usuarioId: 4 });
  assert.equal((await prospect(db, idC)).status_atual, 'venda_realizada', 'volta ao que o arquivo anterior deixou');
  assert.equal((await pedidosDe(db)).find((p) => p.numero === '3').fase, 'carteira', 'situação anterior do pedido reaparece');

  const confere = await conferirExclusao(db, g1.importacaoId);
  assert.deepEqual(confere.total, { qtd: 3, valor: 210 });
  await apagarArquivoPedidos(db, { importacaoId: g1.importacaoId, usuarioId: 4 });
  assert.equal((await pedidosDe(db)).length, 0);
  assert.equal(Number((await db.execute('SELECT COUNT(*) n FROM importacao_linhas WHERE importacao_id = ?', [g1.importacaoId])).rows[0].n), 0, 'linhas do arquivo saem');
  const pa = await prospect(db, idA);
  assert.equal(pa.status_atual, 'aguardando_cadastro', 'volta ao anterior');
  assert.equal(pa.dt_pedido, null); assert.equal(pa.numero_pedido, null); assert.equal(pa.dt_atendido, '2026-10-10');
  const pb = await prospect(db, idB);
  assert.equal(pb.status_atual, 'aguardando_cadastro', 'o atendimento do representante depois do arquivo continua valendo');
  assert.equal(pb.dt_atendido, '2026-11-01', 'mantém a data dele'); assert.equal(Number(pb.convertido_sem_registro), 0);
  const pc = await prospect(db, idC);
  assert.equal(pc.status_atual, 'nao_contactado'); assert.equal(pc.dt_atendido, null); assert.equal(pc.dt_primeiro_contato, null);
  const contatos = Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM contatos WHERE prospect_id = ?', args: [idB] })).rows[0].n);
  assert.equal(contatos, 1, 'o registro do representante é mantido');
  const movs = Number((await db.execute("SELECT COUNT(*) n FROM movimentacoes WHERE origem = 'erp'")).rows[0].n);
  assert.equal(movs, 0, 'o histórico do arquivo sai');
  assert.equal(Number((await db.execute('SELECT COUNT(*) n FROM movimentacoes')).rows[0].n), linhasAntes + 1, 'só fica o que não veio do arquivo');
  const resumoDepois = (await db.execute('SELECT status_atual, SUM(qtd) q FROM resumo_carteira GROUP BY 1 HAVING q > 0 ORDER BY 1')).rows.map((l) => [l.status_atual, Number(l.q)]);
  assert.notDeepEqual(resumoDepois, []); assert.equal(resumoAntes.length > 0, true);
  const real = (await db.execute('SELECT status_atual, COUNT(*) q FROM prospects GROUP BY 1 ORDER BY 1')).rows.map((l) => [l.status_atual, Number(l.q)]);
  assert.deepEqual(resumoDepois, real, 'o resumo da carteira bate com a base');
  const rel = (await listarArquivosPedidos(db)).find((x) => x.id === g1.importacaoId);
  assert.ok(rel.apagada_em); assert.equal(Number(rel.apagados_pedidos), 3);
  await assert.rejects(apagarArquivoPedidos(db, { importacaoId: g1.importacaoId, usuarioId: 4 }), /não é uma importação|UNIQUE/);
  await assert.rejects(db.execute('DELETE FROM pedido_exclusoes'), /somente inclusão/);
  await assert.rejects(db.execute('DELETE FROM movimentacoes'), /somente inclusão/, 'o histórico continua protegido fora da exclusão');
});

test('arquivo antigo de pedidos (eventos_erp) não pode ser apagado e o valor não conta em dobro', async () => {
  const db = await montar();
  const id = await criarProspect(db, { n: 1 });
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-01', documento: '500', valor: 100 });
  const imp = Number((await db.execute("SELECT id FROM importacoes WHERE tipo = 'pedido_erp'")).rows[0].id);
  await assert.rejects(apagarArquivoPedidos(db, { importacaoId: imp, usuarioId: 4 }), /não é uma importação/);
  const soma = async () => Number((await db.execute({ sql: 'SELECT SUM(valor) v FROM vw_valor_pedidos WHERE prospect_id = ?', args: [id] })).rows[0].v);
  assert.equal(await soma(), 100);
  await grava(db, arquivo(linha({ doc: cnpjTeste(1), num: 500, sit: 1, valor: 100 }), linha({ doc: cnpjTeste(1), num: 501, sit: 1, valor: 50 })));
  assert.equal(await soma(), 150, 'o mesmo pedido não soma duas vezes');
  const ex = (await db.execute(consultaPedidosResumo({ usuario: adm }))).rows;
  assert.equal(ex.reduce((s, l) => s + Number(l.valor), 0), 150, 'Explorar usa a venda válida');
});

test('Aguardando pedido válido aceita registro sem mudar a fase e não cai no crédito nem no cadastro', async () => {
  const db = await montar();
  const id = await criarProspect(db, { n: 1 });
  await grava(db, arquivo(linha({ doc: cnpjTeste(1), num: 1, sit: 9 })));
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-11-01' });
  assert.equal((await prospect(db, id)).status_atual, 'aguardando_pedido_valido');
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-11-02', documento: 'C1' });
  assert.equal((await prospect(db, id)).status_atual, 'aguardando_pedido_valido', 'cadastro depois do pedido não rebaixa');
  const st = (await db.execute('SELECT codigo, ordem FROM status ORDER BY ordem')).rows.map((s) => s.codigo);
  assert.equal(st.indexOf('aguardando_pedido_valido'), st.indexOf('aguardando_pedido') + 1);
  assert.equal(st.indexOf('venda_realizada'), st.indexOf('aguardando_pedido_valido') + 1);
});
