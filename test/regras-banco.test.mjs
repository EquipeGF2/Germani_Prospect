// Regras de negócio garantidas pelo próprio banco (triggers/CHECKs) — docs/03-regras-negocio.md
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, prospect, registrarContato } from './auxiliar.mjs';

let db;
beforeEach(async () => {
  db = await bancoTeste();
  await criarEquipe(db);
});

test('prospect nasce "Não contactado", pendente, com histórico inicial', async () => {
  const id = await criarProspect(db, { n: 1 });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'nao_contactado');
  assert.equal(p.pendente_hoje, 1);
  const h = await db.execute({ sql: 'SELECT * FROM movimentacoes WHERE prospect_id = ?', args: [id] });
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].data_evento, '2026-01-01');
});

test('"Sem interesse" sem motivo é bloqueado', async () => {
  const id = await criarProspect(db, { n: 1 });
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'sem_interesse', data: '2026-10-01' }), /CHECK constraint/);
});

test('motivo "Outro" exige observação', async () => {
  const id = await criarProspect(db, { n: 1 });
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'OUTRO', data: '2026-10-01' }), /exige observação/);
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'OUTRO', observacao: 'dono viajando', data: '2026-10-01' });
});

test('motivos de uso do sistema não podem ser escolhidos no app', async () => {
  const id = await criarProspect(db, { n: 1 });
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'NAO_INFORMADO', data: '2026-10-01' }), /não disponível para o app/);
});

test('data de retorno é opcional, mas não pode ser anterior ao contato', async () => {
  const id = await criarProspect(db, { n: 1 });
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'atendido', retorno: '2026-09-30', data: '2026-10-01' }), /CHECK constraint/);
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  assert.equal((await prospect(db, id)).data_proxima_acao, null);
});

test('app só registra atendido, sem interesse ou pedido identificado — "não atendido" não existe', async () => {
  const id = await criarProspect(db, { n: 1 });
  const ins = (resultado, origem = 'app') => db.execute({
    sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado, origem)
          VALUES (?, ?, 2, 1, '2026-10-01', 'visita', ?, ?)`, args: [`x-${resultado}`, id, resultado, origem] });
  await assert.rejects(ins('nao_atendido'), /CHECK constraint/);
  await assert.rejects(ins('contato_planilha'), /CHECK constraint/); // só a importação usa
  const r = await db.execute("SELECT count(*) n FROM parametros WHERE chave IN ('tentativas_maximas','dias_entre_tentativas')");
  assert.equal(Number(r.rows[0].n), 0);
});

test('"sem interesse" sai da lista principal; dias corridos contam do 1º registro', async () => {
  const id = await criarProspect(db, { n: 1 });
  let p = await prospect(db, id);
  assert.equal(p.na_lista, 1);
  assert.equal(p.pendente_hoje, 1);
  assert.equal(p.dias_corridos, null); // sem registro ainda
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-03' });
  p = await prospect(db, id);
  assert.equal(p.status_atual, 'sem_interesse');
  assert.equal(p.na_lista, 0);
  assert.equal(p.data_proxima_acao, null);
  assert.equal(p.motivo_sem_interesse, 'Preço acima do praticado');
  assert.equal(p.dt_primeiro_contato, '2026-10-03');
  assert.ok(p.dias_corridos > 0);
});

test('reabrir "sem interesse" informando a data de entrada do pedido → Aguardando cadastro (acompanhamento)', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  const sql = `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado, data_pedido_informado)
               VALUES (?, ?, 2, 2, '2026-10-12', 'telefone', 'pedido_informado', ?)`;
  await assert.rejects(db.execute({ sql, args: ['r0', id, null] }), /CHECK constraint/);          // data obrigatória
  await assert.rejects(db.execute({ sql, args: ['r1', id, '2026-10-13'] }), /CHECK constraint/);  // não pode ser futura ao registro
  await db.execute({ sql, args: ['r2', id, '2026-10-10'] });
  let p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_cadastro');
  assert.equal(p.status_descricao, 'Aguardando cadastro · pedido informado em 10/10/2026');
  assert.equal(p.na_lista, 0);
  assert.equal(p.dt_primeiro_contato, '2026-10-01');
  assert.equal(p.convertido_sem_registro, 0);
  // o arquivo de pedidos do ERP confirma a venda
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-10', documento: 'P55' });
  p = await prospect(db, id);
  assert.equal(p.status_atual, 'venda_realizada');
  assert.equal(p.convertido_sem_registro, 0);
});

test('motivo final é o do último "sem interesse"', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'MIX_NAO_ATENDE', data: '2026-10-05' });
  assert.equal((await prospect(db, id)).motivo_sem_interesse, 'Mix de produtos não atende');
});

test('parâmetro é editável e a alteração é auditada', async () => {
  await db.execute("UPDATE parametros SET valor = '20', alterado_por = 'teste' WHERE chave = 'prazo_cadastro_dias'");
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  assert.equal((await prospect(db, id)).prazo_cadastro_ate, '2026-10-21');
  const a = await db.execute("SELECT * FROM auditoria WHERE acao = 'alterar_parametro'");
  assert.equal(a.rows.length, 1);
  assert.equal(JSON.parse(a.rows[0].detalhes).para, '20');
});

test('atendido → Aguardando cadastro (atendido em dd/mm), aguardando cadastro, fora da lista', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', retorno: '2026-10-04', data: '2026-10-01' });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_cadastro');
  assert.equal(p.status_descricao, 'Aguardando cadastro · atendido em 01/10/2026');
  assert.equal(p.data_proxima_acao, '2026-10-04');
  assert.equal(p.retorno_pendente, 1);
  assert.equal(p.prazo_cadastro_ate, '2026-10-16');
  assert.equal(p.prazo_cadastro_vencido, 1);
  assert.equal(p.na_lista, 0);
});

test('em negociação: novos atendimentos mantêm (registros sem limite); sem interesse encerra', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) await registrarContato(db, { prospectId: id, resultado: 'atendido', retorno: '2026-10-09', data: d });
  let p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_cadastro');
  assert.equal(p.tentativas, 4);
  assert.equal(p.data_proxima_acao, '2026-10-09');
  assert.equal(p.status_descricao, 'Aguardando cadastro · atendido em 01/10/2026'); // 1º atendimento
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PEDIDO_MINIMO', data: '2026-10-07' });
  p = await prospect(db, id);
  assert.equal(p.status_atual, 'sem_interesse');
  assert.equal(p.motivo_sem_interesse, 'Pedido mínimo alto');
});

test('contato em cliente já cadastrado no ERP só registra (status não muda)', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-03', documento: 'C1' });
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-05' });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'analise_financeira');
  assert.equal(p.data_proxima_acao, null);
});

test('tudo conta para os indicadores, mesmo fora da lista', async () => {
  const a = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: a, resultado: 'atendido', data: '2026-10-01' });
  const b = await criarProspect(db, { n: 2 });
  await registrarContato(db, { prospectId: b, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await registrarContato(db, { prospectId: b, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-03' });
  const r = await db.execute('SELECT count(*) n FROM vw_prospects WHERE na_lista = 1');
  assert.equal(Number(r.rows[0].n), 0);
  const ind = await db.execute("SELECT count(*) n FROM prospects WHERE status_atual <> 'nao_contactado'");
  assert.equal(Number(ind.rows[0].n), 2);
});

test('pedido tira da lista e continua nos indicadores', async () => {
  const id = await criarProspect(db, { n: 1 });
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-05', documento: 'P1' });
  assert.equal((await prospect(db, id)).na_lista, 0);
});

test('vendedor só registra na própria carteira; supervisor na da equipe; admin em todas', async () => {
  const id = await criarProspect(db, { n: 1, vendedorId: 2 });
  await assert.rejects(registrarContato(db, { prospectId: id, usuarioId: 3, resultado: 'atendido', data: '2026-10-01' }), /sem permissão/);
  await assert.rejects(registrarContato(db, { prospectId: id, usuarioId: 5, resultado: 'atendido', data: '2026-10-01' }), /sem permissão/);
  await registrarContato(db, { prospectId: id, usuarioId: 1, resultado: 'atendido', data: '2026-10-01' });
  const id2 = await criarProspect(db, { n: 2, vendedorId: 2 });
  await registrarContato(db, { prospectId: id2, usuarioId: 4, resultado: 'atendido', data: '2026-10-01' });
  await db.execute('UPDATE usuarios SET ativo = 0 WHERE id = 2');
  const id3 = await criarProspect(db, { n: 3, vendedorId: 2 });
  await assert.rejects(registrarContato(db, { prospectId: id3, usuarioId: 2, resultado: 'atendido', data: '2026-10-01' }), /sem permissão/);
});

test('data do aparelho manda, mas não pode voltar antes do último contato', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-05' });
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-04' }), /anterior ao último contato/);
});

test('reenvio do mesmo contato (offline) não duplica: id único', async () => {
  const id = await criarProspect(db, { n: 1 });
  const sql = `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado)
               VALUES ('uuid-1', ?, 2, 1, '2026-10-01', 'telefone', 'atendido')`;
  await db.execute({ sql, args: [id] });
  await assert.rejects(db.execute({ sql, args: [id] }));
  assert.equal((await prospect(db, id)).tentativas, 1);
});

test('histórico é imutável: contatos, eventos e histórico não aceitam UPDATE/DELETE', async () => {
  const id = await criarProspect(db, { n: 1 });
  const c = await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  await assert.rejects(db.execute({ sql: "UPDATE contatos SET resultado = 'atendido' WHERE id = ?", args: [c] }), /somente inclusão/);
  await assert.rejects(db.execute({ sql: 'DELETE FROM contatos WHERE id = ?', args: [c] }), /somente inclusão/);
  await assert.rejects(db.execute('DELETE FROM movimentacoes'), /somente inclusão/);
  await assert.rejects(db.execute({ sql: 'DELETE FROM prospects WHERE id = ?', args: [id] }), /não são apagados/);
});

test('fluxo completo: atendido → aguardando cadastro → (cadastro) análise financeira → (pedido) venda realizada', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  let p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_cadastro');
  assert.equal(p.prazo_cadastro_ate, '2026-10-16');
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C123' });
  p = await prospect(db, id);
  assert.equal(p.status_atual, 'analise_financeira');
  assert.equal(p.codigo_cliente_erp, 'C123');
  assert.equal(p.analise_financeira_ate, '2026-10-15'); // 10 dias a partir do cadastro
  assert.equal(p.analise_financeira_vencida, 1);
  assert.equal(p.convertido_sem_registro, 0);
  assert.equal(p.na_lista, 0);
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-08', documento: 'P9' });
  p = await prospect(db, id);
  assert.equal(p.status_atual, 'venda_realizada');
  assert.equal(p.numero_pedido, 'P9');
  assert.equal(p.analise_financeira_vencida, 0);
  // cadastro posterior não rebaixa a venda
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-09', documento: 'C124' });
  assert.equal((await prospect(db, id)).status_atual, 'venda_realizada');
  // histórico de movimentação: todo movimento registrado, na ordem, com quem e de quem era a carteira
  const m = (await db.execute({ sql: 'SELECT * FROM vw_movimentacoes WHERE prospect_id = ? ORDER BY id', args: [id] })).rows;
  assert.deepEqual(m.map((x) => [x.tipo, x.status_anterior, x.status_novo, x.data_evento]), [
    ['entrada_base', null, 'nao_contactado', '2026-01-01'],
    ['atendido', 'nao_contactado', 'aguardando_cadastro', '2026-10-01'],
    ['cadastro', 'aguardando_cadastro', 'analise_financeira', '2026-10-05'],
    ['pedido', 'analise_financeira', 'venda_realizada', '2026-10-08'],
    ['cadastro', 'venda_realizada', 'venda_realizada', '2026-10-09'],
  ]);
  assert.equal(m[1].usuario_nome, 'Vend Dez');
  assert.ok(m.every((x) => x.vendedor_nome === 'Vend Dez'));
  assert.equal(m[3].detalhe, 'via importação do pedido (P9)');   // o histórico diz que veio da importação
});

test('pedido sem cadastro antes vai direto para venda realizada', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-03', documento: 'P1' });
  assert.equal((await prospect(db, id)).status_atual, 'venda_realizada');
});

test('cadastro/pedido sem interesse registrado no app → "convertido sem registro"', async () => {
  const id = await criarProspect(db, { n: 1 });
  await evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-05', documento: 'P1' });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'venda_realizada');
  assert.equal(p.convertido_sem_registro, 1);
});

test('CNPJ baixado: inválido, congelado, impossibilitado de faturamento, histórico preservado', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-01' });
  await evento(db, { prospectId: id, tipo: 'baixa', data: '2026-10-10' });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'invalido');
  assert.equal(p.situacao_cadastral, 'baixada');
  assert.equal(p.dt_baixa, '2026-10-10');
  assert.equal(p.dt_primeiro_contato, '2026-10-01');
  await assert.rejects(evento(db, { prospectId: id, tipo: 'pedido', data: '2026-10-11', documento: 'P1' }), /impossibilitado de faturamento/);
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-12' }), /não aceita novo contato/);
  await assert.rejects(db.execute({ sql: "UPDATE prospects SET razao_social = 'X' WHERE id = ?", args: [id] }), /congelado/);
  const c = await db.execute({ sql: 'SELECT count(*) n FROM contatos WHERE prospect_id = ?', args: [id] });
  assert.equal(Number(c.rows[0].n), 1);
});

test('vendedor não consegue marcar inválido: não existe resultado "inválido" no contato', async () => {
  const id = await criarProspect(db, { n: 1 });
  await assert.rejects(
    db.execute({ sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado)
                       VALUES ('x', ?, 2, 1, '2026-10-01', 'visita', 'invalido')`, args: [id] }),
    /CHECK constraint/,
  );
  await assert.rejects(
    db.execute({ sql: `INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, canal, resultado)
                       VALUES ('y', ?, 2, 1, '2026-10-01', 'nao_informado', 'atendido')`, args: [id] }),
    /CHECK constraint/,
  );
});

test('transferência de carteira: só supervisor da equipe ou admin; registrada e aplicada', async () => {
  const id = await criarProspect(db, { n: 1, vendedorId: 2 });
  const t = (usuarioId, de = 2, para = 3) => db.execute({
    sql: `INSERT INTO transferencias (prospect_id, de_vendedor_id, para_vendedor_id, data_transferencia, motivo, usuario_id)
          VALUES (?, ?, ?, '2026-10-01', 'férias', ?)`, args: [id, de, para, usuarioId] });
  await assert.rejects(t(2), /sem permissão/);
  await assert.rejects(t(5), /sem permissão/);
  await assert.rejects(t(1, 3, 2), /não é o vendedor atual/);
  await t(1);
  assert.equal(Number((await prospect(db, id)).vendedor_id), 3);
  const mv = (await db.execute({ sql: "SELECT * FROM vw_movimentacoes WHERE prospect_id = ? AND tipo = 'transferencia'", args: [id] })).rows[0];
  assert.equal(mv.detalhe, 'Vend Dez → Vend Onze: férias');
  assert.equal(mv.usuario_nome, 'Sup Um');
  assert.equal(mv.vendedor_nome, 'Vend Onze');
  assert.equal(mv.status_anterior, mv.status_novo); // transferência não muda o status
});

test('registro do app no histórico: quem registrou, motivo e observação', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, usuarioId: 1, resultado: 'sem_interesse', motivo: 'PRECO', observacao: 'tabela alta', data: '2026-10-02' });
  const mv = (await db.execute({ sql: "SELECT * FROM vw_movimentacoes WHERE prospect_id = ? AND tipo = 'sem_interesse'", args: [id] })).rows[0];
  assert.equal(mv.usuario_nome, 'Sup Um');      // supervisor registrou
  assert.equal(mv.vendedor_nome, 'Vend Dez');   // carteira do vendedor
  assert.equal(mv.detalhe, 'Preço acima do praticado — tabela alta');
  assert.equal(mv.status_novo_nome, 'Sem interesse');
});

test('hierarquia: vendedor precisa de supervisor válido', async () => {
  await assert.rejects(db.execute("INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login) VALUES ('vendedor','99','X','X','x99')"), /CHECK constraint/);
  await assert.rejects(db.execute("INSERT INTO usuarios (perfil, codigo_erp, nome, nome_busca, login, supervisor_id) VALUES ('vendedor','99','X','X','x99', 2)"), /perfil supervisor/);
});

test('alerta de prospect parado e ranking de motivos', async () => {
  const id = await criarProspect(db, { n: 1 }); // dt_entrada_base 2026-01-01 → parado há mais de 30 dias
  assert.equal((await prospect(db, id)).parado, 1);
  const id2 = await criarProspect(db, { n: 2 });
  await registrarContato(db, { prospectId: id2, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await registrarContato(db, { prospectId: id2, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-02' });
  assert.equal((await prospect(db, id2)).parado, 0); // encerrado não conta como parado
  const r = (await db.execute('SELECT codigo, quantidade FROM vw_ranking_motivos')).rows;
  assert.deepEqual(r.map((x) => [x.codigo, Number(x.quantidade)]), [['PRECO', 1]]);
});

test('arquivos do ERP prevalecem: cadastro ou pedido de cliente "Sem interesse" (ou nunca contactado) segue o fluxo', async () => {
  const a = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: a, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await evento(db, { prospectId: a, tipo: 'cadastro', data: '2026-10-05', documento: 'C1' });
  let p = await prospect(db, a);
  assert.equal(p.status_atual, 'analise_financeira');   // cadastro → Análise financeira
  assert.equal(p.convertido_sem_registro, 1);           // alerta: virou cliente sem "atendido" registrado
  const b = await criarProspect(db, { n: 2 });
  await registrarContato(db, { prospectId: b, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await evento(db, { prospectId: b, tipo: 'pedido', data: '2026-10-06', documento: 'P1' });
  assert.equal((await prospect(db, b)).status_atual, 'venda_realizada'); // pedido → Venda realizada
  const c = await criarProspect(db, { n: 3 });
  await evento(db, { prospectId: c, tipo: 'cadastro', data: '2026-10-05', documento: 'C3' });
  assert.equal((await prospect(db, c)).status_atual, 'analise_financeira');
  const mv = (await db.execute({ sql: "SELECT status_anterior, status_novo FROM movimentacoes WHERE prospect_id = ? AND tipo = 'cadastro'", args: [a] })).rows[0];
  assert.deepEqual([mv.status_anterior, mv.status_novo], ['sem_interesse', 'analise_financeira']); // fica no histórico
});

test('sem atendimento registrado, o cadastro do ERP vira o atendimento (data, 1º registro e histórico)', async () => {
  const id = await criarProspect(db, { n: 1 });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C1' });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'analise_financeira');
  assert.equal(p.dt_atendido, '2026-10-05', 'atendido em = data do cadastro');
  assert.equal(p.dt_primeiro_contato, '2026-10-05', 'dias corridos contam do cadastro');
  assert.equal(p.convertido_sem_registro, 1, 'o alerta marca que foi automático');
  const m = (await db.execute({ sql: 'SELECT tipo, status_anterior, status_novo, origem, usuario_id, detalhe FROM movimentacoes WHERE prospect_id = ? ORDER BY id', args: [id] })).rows;
  assert.deepEqual(m.slice(1).map((x) => [x.tipo, x.status_anterior, x.status_novo, x.origem]), [
    ['atendido', 'nao_contactado', 'nao_contactado', 'erp'],
    ['cadastro', 'nao_contactado', 'analise_financeira', 'erp'],
  ]);
  assert.equal(m[1].usuario_id, null);
  assert.equal(m[1].detalhe, 'atendimento automático via importação do cadastro (C1) — sem registro do representante');
  assert.equal(m[2].detalhe, 'via importação do cadastro (C1)');
  // pedido sem cadastro e sem atendimento: o pedido vira o atendimento
  const v = await criarProspect(db, { n: 2 });
  await evento(db, { prospectId: v, tipo: 'pedido', data: '2026-10-07', documento: 'P1' });
  assert.equal((await prospect(db, v)).dt_atendido, '2026-10-07');
  // com atendimento já registrado, nada muda: vale a data do representante
  const r = await criarProspect(db, { n: 3 });
  await registrarContato(db, { prospectId: r, resultado: 'atendido', data: '2026-10-01' });
  await evento(db, { prospectId: r, tipo: 'cadastro', data: '2026-10-05', documento: 'C3' });
  const pr = await prospect(db, r);
  assert.equal(pr.dt_atendido, '2026-10-01');
  assert.equal(pr.convertido_sem_registro, 0);
  assert.equal((await db.execute({ sql: "SELECT COUNT(*) AS n FROM movimentacoes WHERE prospect_id = ? AND tipo = 'atendido'", args: [r] })).rows[0].n, 1);
});

test('atendimento informado depois do automático: vale sempre a primeira data e o histórico diz quando a dele é posterior', async () => {
  const detalheDo = async (pid) => (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND origem = 'contato' ORDER BY id DESC LIMIT 1", args: [pid] })).rows[0].detalhe;
  // informou data ANTERIOR à importação: vale a dele (o atendimento real)
  const id = await criarProspect(db, { n: 1 });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C1' });
  await registrarContato(db, { prospectId: id, resultado: 'atendido', data: '2026-10-02' });
  let p = await prospect(db, id);
  assert.equal(p.status_atual, 'analise_financeira', 'o registro não muda a fase');
  assert.equal(p.dt_atendido, '2026-10-02');
  assert.equal(p.dt_primeiro_contato, '2026-10-02');
  assert.equal(p.convertido_sem_registro, 0, 'o representante informou');
  assert.doesNotMatch(await detalheDo(id) ?? '', /posterior/);
  // informou data POSTERIOR à importação: continua a primeira data (a da importação) e fica registrado
  const b = await criarProspect(db, { n: 2 });
  await evento(db, { prospectId: b, tipo: 'cadastro', data: '2026-10-05', documento: 'C2' });
  await registrarContato(db, { prospectId: b, resultado: 'atendido', data: '2026-10-08' });
  p = await prospect(db, b);
  assert.equal(p.dt_atendido, '2026-10-05', 'sempre a primeira data');
  assert.equal(p.dt_primeiro_contato, '2026-10-05');
  assert.equal(p.convertido_sem_registro, 0);
  assert.equal(await detalheDo(b), 'representante informou data posterior à importação (atendimento considerado em 05/10/2026)');
  // um 2º atendimento não mexe mais nas datas nem repete o aviso
  await registrarContato(db, { prospectId: b, resultado: 'atendido', data: '2026-10-10' });
  p = await prospect(db, b);
  assert.equal(p.dt_atendido, '2026-10-05');
  assert.equal(p.dt_primeiro_contato, '2026-10-05');
  assert.doesNotMatch(await detalheDo(b) ?? '', /posterior/);
  // nada é substituído: o atendimento automático e cada registro do representante ficam no histórico, um por linha
  const hist = (await db.execute({ sql: 'SELECT tipo, origem, data_evento FROM movimentacoes WHERE prospect_id = ? ORDER BY id', args: [b] })).rows;
  assert.deepEqual(hist.slice(1).map((x) => [x.tipo, x.origem, x.data_evento]), [
    ['atendido', 'erp', '2026-10-05'], ['cadastro', 'erp', '2026-10-05'],
    ['atendido', 'contato', '2026-10-08'], ['atendido', 'contato', '2026-10-10'],
  ]);
  assert.equal((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM contatos WHERE prospect_id = ?', args: [b] })).rows[0].n, 2);
});

test('representante registrou "sem interesse" e o cadastro chega: próxima etapa, sem atendimento automático, via importação', async () => {
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-01' });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C1' });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'analise_financeira', 'considera a próxima etapa');
  assert.equal(p.dt_atendido, null, 'o ERP não cria atendimento sobre o registro do representante');
  assert.equal(p.dt_primeiro_contato, '2026-10-01', 'o 1º registro continua o do representante');
  assert.equal(p.convertido_sem_registro, 1, 'alerta: cadastrou sem "atendido" registrado');
  const m = (await db.execute({ sql: 'SELECT tipo, status_anterior, status_novo, origem, detalhe FROM movimentacoes WHERE prospect_id = ? ORDER BY id', args: [id] })).rows;
  assert.deepEqual(m.slice(1).map((x) => [x.tipo, x.status_anterior, x.status_novo, x.origem, x.detalhe]), [
    ['sem_interesse', 'nao_contactado', 'sem_interesse', 'contato', 'Preço acima do praticado'],
    ['cadastro', 'sem_interesse', 'analise_financeira', 'erp', 'via importação do cadastro (C1)'],
  ]);
});

test('sem interesse do cliente × do representante: a origem vem do motivo; o resumo separa os do representante', async () => {
  const motivos = (await db.execute("SELECT codigo, origem FROM motivos_sem_interesse WHERE uso_app = 1")).rows;
  assert.ok(motivos.some((m) => m.origem === 'cliente') && motivos.some((m) => m.origem === 'representante'));
  assert.equal(motivos.find((m) => m.codigo === 'PRECO').origem, 'cliente', 'os motivos antigos são do cliente');
  const siRep = async () => Number((await db.execute("SELECT COALESCE(SUM(si_representante), 0) AS n FROM resumo_carteira")).rows[0].n);
  const id = await criarProspect(db, { n: 1 });
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'REP_FORA_ROTA', data: '2026-10-01' });
  let p = await prospect(db, id);
  assert.equal(p.status_atual, 'sem_interesse', 'um status só');
  assert.equal(p.sem_interesse_origem, 'representante');
  assert.equal(p.status_descricao, 'Sem interesse · representante');
  assert.equal(await siRep(), 1);
  // novo registro (nunca substitui): agora o cliente recusou — vale o último motivo
  await registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'PRECO', data: '2026-10-05' });
  p = await prospect(db, id);
  assert.equal(p.sem_interesse_origem, 'cliente');
  assert.equal(p.status_descricao, 'Sem interesse · cliente');
  assert.equal(await siRep(), 0);
  assert.equal(Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM contatos WHERE prospect_id = ?", args: [id] })).rows[0].n), 2);
  // "Outro" do representante também exige observação
  await assert.rejects(registrarContato(db, { prospectId: id, resultado: 'sem_interesse', motivo: 'REP_OUTRO', data: '2026-10-06' }), /exige observação/);
});

test('0016: liberação guarda condição/forma do ERP; "sem limite" no histórico; liberação continua só inclusão', async () => {
  const id = await criarProspect(db, { n: 70 });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C70' });
  const imp = await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('credito_erp','a','x','t') RETURNING id");
  await db.execute({ sql: `INSERT INTO liberacoes_credito (prospect_id, origem, importacao_id, data_liberacao, forma_pagamento, limite_cnpj, limite_credito, limite_origem,
                             cond_pgto_codigo, cond_pgto_descricao, forma_pgto_codigo, forma_pgto_descricao, prazo_medio_dias, sem_limite)
                           VALUES (?, 'importacao', ?, '2026-10-06', 'a_vista', 9999999, 9999999, 'cnpj', '00A', 'A VISTA', '4', 'A vista', 0, 1)`, args: [id, imp.rows[0].id] });
  const p = await prospect(db, id);
  assert.equal(p.status_atual, 'aguardando_pedido');
  const det = (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [id] })).rows[0].detalhe;
  assert.equal(det, 'A vista · sem limite (CNPJ) · relatório de crédito');
  await assert.rejects(db.execute({ sql: 'UPDATE liberacoes_credito SET sem_limite = 0 WHERE prospect_id = ?', args: [id] }), /somente inclusão/);
  await assert.rejects(db.execute({ sql: `INSERT INTO liberacoes_credito (prospect_id, origem, importacao_id, data_liberacao, forma_pagamento, limite_credito, limite_origem, sem_limite)
                                          VALUES (?, 'importacao', ?, '2026-10-07', 'a_vista', 0, 'informado', 2)`, args: [id, imp.rows[0].id] }), /CHECK/);
});

test('0017: boleto com limite 0 aceito na importação (forma do ERP), recusado no console; dados preservados na recriação', async () => {
  const id = await criarProspect(db, { n: 71 });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C71' });
  const imp = await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('credito_erp','a','x','t') RETURNING id");
  await db.execute({ sql: `INSERT INTO liberacoes_credito (prospect_id, origem, importacao_id, data_liberacao, forma_pagamento, prazo_pagamento_dias, limite_cnpj, limite_credito, limite_origem,
                             cond_pgto_codigo, cond_pgto_descricao, forma_pgto_descricao, prazo_medio_dias, prazo_parcelas)
                           VALUES (?, 'importacao', ?, '2026-10-06', 'boleto', 21, 0, 0, 'cnpj', '21B', '14/21/28 DD BOLETO', 'Boleto', 21, '14/21/28')`, args: [id, imp.rows[0].id] });
  const det = (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [id] })).rows[0].detalhe;
  assert.equal(det, 'Boleto 14/21/28 dias (médio 21) · limite R$ 0.00 (CNPJ) · relatório de crédito');
  await db.execute({ sql: "INSERT INTO usuarios (perfil, nome, nome_busca, login) VALUES ('financeiro', 'Fin', 'FIN', 'fin71')", args: [] });
  const fin = Number((await db.execute("SELECT id FROM usuarios WHERE login = 'fin71'")).rows[0].id);
  await assert.rejects(db.execute({ sql: `INSERT INTO liberacoes_credito (prospect_id, origem, usuario_id, data_liberacao, forma_pagamento, limite_credito, limite_origem, com_restricao)
                                          VALUES (?, 'console', ?, '2026-10-07', 'boleto', 0, 'informado', 0)`, args: [id, fin] }), /CHECK/);
  // índices e triggers recriados
  const nomes = (await db.execute("SELECT name FROM sqlite_master WHERE tbl_name = 'liberacoes_credito' AND type IN ('index','trigger')")).rows.map((r) => r.name);
  for (const n of ['ix_liberacoes_prospect', 'ix_liberacoes_data', 'trg_liberacoes_validar', 'trg_liberacoes_aplicar', 'trg_liberacoes_imutavel_upd', 'trg_liberacoes_imutavel_del']) assert.ok(nomes.includes(n), n);
});

test('0018: depósito e Pix no filtro (forma_filtro); forma_pagamento de prospects segue com as 3 opções', async () => {
  const id = await criarProspect(db, { n: 72 });
  await evento(db, { prospectId: id, tipo: 'cadastro', data: '2026-10-05', documento: 'C72' });
  const imp = await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('credito_erp','a','x','t') RETURNING id");
  await db.execute({ sql: `INSERT INTO liberacoes_credito (prospect_id, origem, importacao_id, data_liberacao, forma_pagamento, prazo_pagamento_dias, limite_cnpj, limite_credito, limite_origem, forma_pgto_descricao, prazo_parcelas)
                           VALUES (?, 'importacao', ?, '2026-10-06', 'deposito', 28, 500, 500, 'cnpj', 'Deposito e Pix', '28')`, args: [id, imp.rows[0].id] });
  const p = await prospect(db, id);
  assert.deepEqual([p.forma_filtro, p.forma_pagamento], ['deposito', 'boleto']);
  const det = (await db.execute({ sql: "SELECT detalhe FROM movimentacoes WHERE prospect_id = ? AND tipo = 'liberacao_credito'", args: [id] })).rows[0].detalhe;
  assert.equal(det, 'Deposito e Pix 28 dias · limite R$ 500.00 (CNPJ) · relatório de crédito');
  await assert.rejects(db.execute({ sql: "UPDATE prospects SET forma_filtro = 'cheque' WHERE id = ?", args: [id] }), /CHECK/);
});

test('0019: erros do app — somente inclusão; listagem dos frequentes por mensagem', async () => {
  const { listarErrosApp } = await import('../shared/administracao.mjs');
  const ins = (msg, login) => db.execute({ sql: "INSERT INTO erros_app (login, tela, versao, tipo, mensagem, detalhe) VALUES (?, '#/ficha?id=9', 'abc1234', 'TypeError', ?, 'código do erro: E-2310-1200-ABCD')", args: [login, msg] });
  await ins('falha A', 'ana'); await ins('falha A', 'bruno'); await ins('falha B', 'ana');
  const { lista, frequentes } = await listarErrosApp(db, { dias: 1 });
  assert.equal(lista.length, 3);
  assert.deepEqual(frequentes.map((f) => [f.mensagem, Number(f.vezes), Number(f.usuarios)]), [['falha A', 2, 2], ['falha B', 1, 1]]);
  await assert.rejects(db.execute("UPDATE erros_app SET mensagem = 'x'"), /somente inclusão/);
  await assert.rejects(ins('x'.repeat(1001), 'ana'), /CHECK/);
});
