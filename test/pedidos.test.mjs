// Importação de pedidos: leitura do .xls do ERP, classificação, status, reimportação e exclusão por arquivo. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, cnpjTeste, criarEquipe, criarProspect, evento, prospect, registrarContato } from './auxiliar.mjs';
import { lerBiff2 } from '../shared/biff.mjs';
import { lerPlanilhaDeBytes } from '../shared/planilha.mjs';
import { apagarArquivoPedidos, conferirExclusao, gravarPedidos, listarArquivosPedidos, simularPedidos, statusDepois } from '../shared/importar-pedidos.mjs';
import { agruparPorRaiz, alertasPedidos, bonificacaoPorCliente, clientesDistintos, clientesVariosRepresentantes, consultaPedidos, consultaPedidosGrupo, consultaSaldoFiliais, filtrarPedidos, filtrosPedidosPossiveis, indicadoresRamo, montarArvorePedidos, opcoesPedidosEmCascata, niveisPedidosPossiveis, porRepresentante, resumirPedidos, rotuloGrupo } from '../shared/pedidos.mjs';
import { consultaPedidosResumo } from '../shared/explorar.mjs';
import { consultaCarteira } from '../shared/carteira.mjs';
import { STATUS_ENCERRADOS } from '../shared/status.mjs';

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
  await criarProspect(db, { n: 2, vendedorId: 3 });   // carteira do vendedor 11
  await grava(db, arquivo(linha({ doc: a, num: 1, sit: 4, valor: 70, fat: 70, rep: 10 }), linha({ doc: a, num: 2, sit: 1, valor: 30, rep: 11 }),
    linha({ doc: cnpjTeste(2), num: 3, sit: 1, valor: 5, rep: 11 }), linha({ doc: cnpjTeste(2), num: 4, sit: 1, valor: 7, rep: 77 }), linha({ doc: fora, num: 5, sit: 1, valor: 9, rep: 11 })));
  const todos = await pedidosDe(db);
  const reps = porRepresentante(todos);
  const r10 = reps.find((r) => r.codigo === '10'); const r11 = reps.find((r) => r.codigo === '11'); const r77 = reps.find((r) => r.codigo === '77');
  assert.equal(r10.venda, 70); assert.equal(r10.propria, 70); assert.equal(r10.rotulo, '10 · Vend Dez');
  assert.equal(r11.outra, 30); assert.equal(r11.propria, 5);
  assert.equal(r77.rotulo, '77 · sem cadastro');
  assert.equal(reps.reduce((s, r) => s + r.venda, 0), 112, 'valor nunca duplica');
  assert.equal(reps.reduce((s, r) => s + r.clientes.length, 0), 4); assert.equal(clientesDistintos(todos), 2, 'cliente distinto no total');
  const varios = clientesVariosRepresentantes(todos);
  assert.equal(varios.length, 2); assert.deepEqual(varios.find((c) => c.documento === a).reps.map((r) => r.parte), [70, 30]);
  assert.equal((await prospect(db, 1)).vendedor_id, 2, 'a carteira não muda');
  const do11 = await pedidosDe(db, { id: 3, perfil: 'vendedor' });
  assert.deepEqual(do11.map((p) => p.numero).sort(), ['2', '3', '4'], 'o 11 vê o que vendeu, inclusive fora da lista dele, e os pedidos da carteira dele');
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
  await criarProspect(db, { n: 3 });
  assert.equal(por[7].resultado, 'ignorada'); assert.match(por[7].erros.join(), /CPF/);
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

test('só entram os clientes da base: CPF e CNPJ de fora são ignorados; filial do grupo fica só na visão do grupo', async () => {
  const db = await montar();
  const base = cnpjTeste(1); const filial = cnpjTeste(1, 2); const fora = cnpjTeste(7);
  const id = await criarProspect(db, { n: 1, vendedorId: 2 });
  const linhas = arquivo(linha({ doc: base, num: 1, sit: 1, valor: 100 }), linha({ doc: filial, num: 2, sit: 1, valor: 40 }),
    linha({ doc: fora, num: 3, sit: 4, valor: 900, fat: 900, tr: '95000' }), linha({ doc: '12345678909', num: 4, sit: 1, valor: 60, rep: 77 }));
  const s = await simularPedidos(db, { linhas, dataPadrao: '2026-10-31', hoje: '2026-10-31' });
  assert.deepEqual(s.novos, { transacoes: [], situacoes: [] }, 'código novo de quem está fora da base não trava a importação');
  assert.deepEqual([s.resumo.linhasLidas, s.resumo.aceitas, s.resumo.rejeitadas, s.resumo.ignoradas], [4, 2, 0, 2], 'nenhuma linha some');
  assert.deepEqual(s.totais.venda, { qtd: 1, valor: 100, faturado: 0 });
  assert.deepEqual(s.totais.grupo, { qtd: 1, valor: 40 });
  assert.deepEqual(s.pontos.foraDaBase, { linhas: 2, valor: 960, clientes: 2 });
  assert.deepEqual(s.pontos.semCodigo, [], 'representante de quem está fora não importa');
  const g = await grava(db, linhas);
  assert.equal(Number((await db.execute('SELECT COUNT(*) n FROM pedidos_erp')).rows[0].n), 2, 'o que está fora não é gravado');
  assert.equal(Number((await db.execute({ sql: 'SELECT COUNT(*) n FROM importacao_linhas WHERE importacao_id = ?', args: [g.importacaoId] })).rows[0].n), 4, 'mas fica no relatório da importação');
  const pedidos = await pedidosDe(db);
  assert.deepEqual(pedidos.map((p) => p.numero), ['1'], 'a filial não entra nas contas do cliente');
  assert.equal(resumirPedidos(pedidos).venda.valor, 100);
  assert.equal((await prospect(db, id)).status_atual, 'venda_realizada');
  const grupo = (await db.execute(consultaPedidosGrupo({ prospectId: id }))).rows;
  assert.deepEqual(grupo.map((x) => [x.cpf_cnpj, Number(x.saldo)]).sort(), [[base, 100], [filial, 40]].sort());
  const sf = new Map((await db.execute(consultaSaldoFiliais())).rows.map((f) => [f.raiz, Number(f.saldo)]));
  assert.equal(sf.get(base.slice(0, 8)), 40);
  const limite = pedidos.map((p) => ({ ...p, limite_credito: 120, limite_credito_origem: 'grupo' }));
  assert.ok(alertasPedidos(limite, { hoje: '2026-11-01', saldoFiliais: sf }).some((a) => a.tipo === 'limite'), 'o limite do grupo conta o que está em aberto na filial');
  assert.ok(!alertasPedidos(limite, { hoje: '2026-11-01' }).some((a) => a.tipo === 'limite'));
  // cliente que entra na base depois: o pedido passa a entrar no próximo arquivo
  await criarProspect(db, { n: 7, vendedorId: 2 });
  const g2 = await grava(db, arquivo(linha({ doc: fora, num: 3, sit: 1, valor: 900 })), '2026-11-05');
  assert.equal(g2.resumo.aceitas, 1);
});

test('análise: níveis livres, cada ramo soma o que está abaixo dele e abre até o pedido', async () => {
  const db = await montar();
  await criarProspect(db, { n: 1, vendedorId: 2, cidade: 'Lajeado', onda: '1' }); await criarProspect(db, { n: 2, vendedorId: 3, cidade: 'Estrela', onda: '2' });
  await grava(db, arquivo(linha({ doc: cnpjTeste(1), num: 1, sit: 4, valor: 100, fat: 100, rep: 10 }), linha({ doc: cnpjTeste(1), num: 2, sit: 1, valor: 50, rep: 11 }),
    linha({ doc: cnpjTeste(2), num: 3, sit: 1, valor: 300, rep: 11 }), linha({ doc: cnpjTeste(2), num: 4, sit: 5, valor: 20, rep: 11 }), linha({ doc: cnpjTeste(2), num: 5, sit: 4, valor: 7, fat: 7, tr: '90106', rep: 11 })));
  const pedidos = await pedidosDe(db);
  const fechada = montarArvorePedidos({ pedidos, niveis: ['representante', 'cliente'], abertos: new Set() });
  assert.equal(fechada.length, 1, 'fechada: só a raiz');
  assert.deepEqual(fechada[0].ind.venda, { qtd: 3, valor: 450 });
  assert.equal(fechada[0].ind.clientes, 2);
  assert.equal(fechada[0].ind.investimento.valor, 7, 'bonificação à parte');
  const aberta = montarArvorePedidos({ pedidos, niveis: ['representante', 'cliente'], abertos: new Set(['', '/representante=11']) });
  assert.deepEqual(aberta.map((n) => [n.profundidade, n.rotulo, n.ind.venda.valor]), [[0, 'Todos os pedidos', 450], [1, '11 · Vend Onze', 350], [2, `100 - Empresa 2`, 300], [2, `100 - Empresa 1`, 50], [1, '10 · Vend Dez', 100]], 'do maior para o menor');
  const reps = aberta.filter((n) => n.profundidade === 1);
  assert.equal(reps.reduce((s, n) => s + n.ind.venda.valor, 0), aberta[0].ind.venda.valor, 'os filhos somam o pai');
  assert.equal(reps.reduce((s, n) => s + n.pedidos.length, 0), pedidos.length);
  const porCidade = montarArvorePedidos({ pedidos, niveis: ['cidade', 'lista', 'situacao'], abertos: new Set(['']) });
  assert.deepEqual(porCidade.slice(1).map((n) => n.rotulo), ['Estrela/RS', 'Lajeado/RS']);
  assert.equal(niveisPedidosPossiveis({ perfil: 'vendedor' }).includes('supervisor'), false);
  assert.equal(niveisPedidosPossiveis(adm).includes('supervisor'), true);
});

test('ver por grupo: empresas da mesma raiz numa linha que abre, sem mudar os valores; empresa sem grupo fica solta', async () => {
  const db = await montar();
  const m = cnpjTeste(1, 1); const f = cnpjTeste(1, 2); const s = cnpjTeste(2);
  await criarProspect(db, { n: 1, cnpj: m, razao: 'Rede Um', vendedorId: 2 }); await criarProspect(db, { n: 3, cnpj: f, razao: 'Rede Um Filial', vendedorId: 3 }); await criarProspect(db, { n: 2, cnpj: s, razao: 'Loja Só', vendedorId: 2 });
  await grava(db, arquivo(linha({ doc: m, num: 1, sit: 4, valor: 100, fat: 100, rep: 10 }), linha({ doc: f, num: 2, sit: 1, valor: 50, rep: 11 }), linha({ doc: f, num: 3, sit: 4, valor: 9, fat: 9, tr: '90106', rep: 11 }), linha({ doc: s, num: 4, sit: 1, valor: 30, rep: 10 })));
  const pedidos = await pedidosDe(db);
  const { grupos, soltas } = agruparPorRaiz(pedidos, (p) => p.cpf_cnpj);
  assert.equal(grupos.length, 1); assert.equal(grupos[0].empresas.size, 2); assert.deepEqual(soltas.map((p) => p.numero), ['4']);
  assert.equal(clientesDistintos(pedidos), 3); assert.equal(clientesDistintos(pedidos, { porGrupo: true }), 2);
  const raiz = m.slice(0, 8);
  const arv = montarArvorePedidos({ pedidos, niveis: ['cliente'], abertos: new Set(['', `/grupo=${raiz}`]), porGrupo: true });
  assert.deepEqual(arv.map((n) => [n.profundidade, n.ehGrupo, n.ind.venda.valor]), [[0, false, 180], [1, true, 150], [2, false, 100], [2, false, 50], [1, false, 30]]);
  assert.match(arv[1].rotulo, /^Grupo .* · 2 empresas$/);
  assert.equal(arv[2].temFilhos, false, 'a empresa é a última folha');
  assert.equal(arv[0].ind.clientes, 2);
  const comSituacao = montarArvorePedidos({ pedidos, niveis: ['cliente', 'situacao'], abertos: new Set(['', `/grupo=${raiz}`, `/grupo=${raiz}/cliente=${f}`]), porGrupo: true });
  assert.ok(comSituacao.some((n) => n.nivel === 'situacao' && n.profundidade === 3), 'abre o nível seguinte dentro do grupo');
  const emp = montarArvorePedidos({ pedidos, niveis: ['cliente'], abertos: new Set(['']) });
  assert.equal(emp.filter((n) => n.profundidade === 1).length, 3, 'por empresa, sem grupo');
  assert.equal(emp[0].ind.venda.valor, arv[0].ind.venda.valor, 'a chave não muda os valores');
  const r10 = porRepresentante(pedidos, { porGrupo: true }).find((r) => r.codigo === '10');
  assert.deepEqual(r10.clientes.map((c) => [c.documento, c.venda]), [[raiz, 100], [s, 30]]);
  const varios = clientesVariosRepresentantes(pedidos, { porGrupo: true });
  assert.equal(varios.length, 1, 'o grupo foi vendido por dois representantes'); assert.equal(clientesVariosRepresentantes(pedidos).length, 0);
  const b = bonificacaoPorCliente(pedidos, { porGrupo: true });
  assert.deepEqual(b.map((c) => [c.documento, c.investimento, c.venda]), [[raiz, 9, 150]]);
  assert.equal((await prospect(db, 1)).status_atual, 'venda_realizada'); assert.equal(pedidos.length, 4);
});

test('Acompanhamento: só o que está em processo e encerrados; a venda fica em Explorar pedidos', async () => {
  const db = await montar();
  const ids = [];
  for (const n of [1, 2, 3, 4]) ids.push(await criarProspect(db, { n }));
  await registrarContato(db, { prospectId: ids[0], resultado: 'atendido', data: '2026-10-10' });
  await registrarContato(db, { prospectId: ids[1], resultado: 'sem_interesse', data: '2026-10-10', motivo: 'OUTRO', observacao: 'x' });
  await grava(db, arquivo(linha({ doc: cnpjTeste(3), num: 1, sit: 1 })));
  const consulta = consultaCarteira({ usuario: adm, filtros: { foraDaLista: true, semVenda: true } });
  const st = (await db.execute(consulta)).rows.map((p) => p.status_atual).sort();
  assert.deepEqual(st, ['aguardando_cadastro', 'sem_interesse']);
  const lista = (await db.execute(consultaCarteira({ usuario: adm, filtros: {} }))).rows.map((p) => p.status_atual);
  assert.deepEqual(lista, ['nao_contactado'], 'a Lista principal não muda');
  assert.deepEqual([...STATUS_ENCERRADOS].sort(), ['expurgado', 'invalido', 'sem_interesse']);
});

test('filtros em cascata: cada filtro mostra só o que existe com os outros, e os atalhos restringem por cliente', async () => {
  const db = await montar();
  await criarProspect(db, { n: 1, vendedorId: 2, cidade: 'Lajeado', onda: '1' }); await criarProspect(db, { n: 2, vendedorId: 3, cidade: 'Estrela', onda: '2' }); await criarProspect(db, { n: 3, vendedorId: 2, cidade: 'Lajeado', onda: '2' });
  await grava(db, arquivo(linha({ doc: cnpjTeste(1), num: 1, sit: 4, valor: 100, fat: 100, rep: 10 }), linha({ doc: cnpjTeste(1), num: 2, sit: 1, valor: 50, rep: 11 }),
    linha({ doc: cnpjTeste(2), num: 3, sit: 1, valor: 300, rep: 11 }), linha({ doc: cnpjTeste(3), num: 4, sit: 4, valor: 9, fat: 9, tr: '90106', rep: 10 })));
  const pedidos = await pedidosDe(db);
  const cidades = (op) => op.cidade.map((o) => o.rotulo);
  const tudo = opcoesPedidosEmCascata(pedidos);
  assert.deepEqual(cidades(tudo), ['Estrela/RS', 'Lajeado/RS']);
  const lajeado = 'Lajeado|RS';
  const comCidade = opcoesPedidosEmCascata(pedidos, { filtros: { cidade: lajeado } });
  assert.deepEqual(comCidade.onda.map((o) => o.valor), ['1', '2'], 'só as ondas de Lajeado');
  assert.deepEqual(comCidade.representante.map((o) => o.valor), ['10', '11']);
  assert.deepEqual(cidades(comCidade), ['Estrela/RS', 'Lajeado/RS'], 'a própria faceta não se restringe: dá para trocar a cidade');
  const comOnda = opcoesPedidosEmCascata(pedidos, { filtros: { onda: '2', representante: '10' } });
  assert.deepEqual(cidades(comOnda), ['Lajeado/RS'], 'cada escolha estreita as outras');
  assert.deepEqual(filtrarPedidos(pedidos, { filtros: { cidade: lajeado, onda: '1' } }).map((p) => p.numero).sort(), ['1', '2']);
  assert.deepEqual(filtrarPedidos(pedidos, { busca: 'vend onze' }).map((p) => p.numero).sort(), ['2', '3'], 'busca pelo nome do representante, sem acento');
  assert.deepEqual(filtrarPedidos(pedidos, { variosReps: true }).map((p) => p.numero).sort(), ['1', '2'], 'cliente com mais de um representante');
  assert.deepEqual(filtrarPedidos(pedidos, { comBonificacao: true }).map((p) => p.numero), ['4'], 'cliente com bonificação');
  const r = indicadoresRamo(pedidos);
  assert.equal(r.propria + r.outra, r.venda.valor, 'na lista + fora da lista = venda');
  assert.equal(r.propria, 400); assert.equal(r.outra, 50);
  assert.ok(Math.abs(r.pctInvestimento - (9 / 450) * 100) < 0.001);
  const expl = opcoesPedidosEmCascata(pedidos, { possiveis: filtrosPedidosPossiveis({ perfil: 'vendedor' }) });
  assert.equal('supervisor' in expl, false, 'vendedor não filtra por supervisor');
});

test('pedido de filial fora da base: aparece só em Ver por Grupo, com o dono do grupo, e não muda status nem o resto', async () => {
  const db = await montar();
  const base = cnpjTeste(1); const filial = cnpjTeste(1, 2); const fora = cnpjTeste(7);
  const id = await criarProspect(db, { n: 1, vendedorId: 2, razao: 'Rede Um' });
  await grava(db, arquivo(linha({ doc: filial, num: 2, razao: 'Rede Um Filial', sit: 1, valor: 40, rep: 11 }), linha({ doc: fora, num: 3, sit: 1, valor: 900 })));
  assert.equal((await pedidosDe(db)).length, 0, 'por empresa, nada');
  const lerTodos = async (usuario = adm) => (await db.execute(consultaPedidos({ usuario, incluirFiliais: true }))).rows;
  const todos = await lerTodos();
  assert.deepEqual(todos.map((p) => [p.numero, p.prospect_id, Number(p.dono_id), p.relacao]), [['2', null, 2, 'outra']], 'a filial fica com o dono da empresa da base');
  assert.equal((await prospect(db, id)).status_atual, 'nao_contactado', 'não muda o status');
  const { grupos, soltas } = agruparPorRaiz(todos, (p) => p.cpf_cnpj);
  assert.equal(grupos.length, 1, 'mesmo sendo o único pedido do grupo'); assert.equal(soltas.length, 0);
  assert.match(rotuloGrupo(grupos[0]), /^Grupo Rede Um Filial · 1 empresa$/);
  const arv = montarArvorePedidos({ pedidos: todos, niveis: ['cliente'], abertos: new Set(['', `/grupo=${base.slice(0, 8)}`]), porGrupo: true });
  assert.deepEqual(arv.map((n) => [n.profundidade, n.ehGrupo, n.ind.venda.valor]), [[0, false, 40], [1, true, 40], [2, false, 40]]);
  assert.equal(arv[0].ind.clientes, 1);
  assert.deepEqual(porRepresentante(todos, { porGrupo: true }).find((r) => r.codigo === '11').clientes.map((c) => c.documento), [base.slice(0, 8)]);
  assert.deepEqual((await lerTodos({ id: 2, perfil: 'vendedor' })).map((p) => p.numero), ['2'], 'o dono da carteira vê');
  assert.deepEqual((await lerTodos({ id: 3, perfil: 'vendedor' })).map((p) => p.numero), ['2'], 'quem vendeu vê');
  assert.equal((await lerTodos({ id: 5, perfil: 'supervisor' })).length, 0, 'outra equipe não vê');
  assert.deepEqual((await lerTodos({ id: 1, perfil: 'supervisor' })).map((p) => p.numero), ['2'], 'o supervisor da equipe vê');
  const valor = Number((await db.execute({ sql: 'SELECT COALESCE(SUM(valor), 0) v FROM vw_valor_pedidos WHERE prospect_id = ?', args: [id] })).rows[0].v);
  assert.equal(valor, 0, 'não entra no valor do Início e do Explorar carteira');
});

