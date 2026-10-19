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
  assert.equal(m[3].detalhe, 'P9');
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
