import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, prospect } from './auxiliar.mjs';
import { comandoRegistrarContato, listarMotivos } from '../shared/registro.mjs';
import { ajustarFicha, consultaFicha, consultaLinhaTempo } from '../shared/carteira.mjs';

test('registro pelo app: atendido, sem interesse (motivo) e reabertura com pedido; ficha e linha do tempo', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  await db.execute("UPDATE usuarios SET tipo_atuacao = 'representante' WHERE id = 2");
  const id = await criarProspect(db, { n: 1, vendedorId: 2, rota: 'R1' });
  const REP = { id: 2, perfil: 'vendedor', tipo_atuacao: 'representante' };
  const motivos = await listarMotivos(db);
  assert.ok(motivos.length >= 10 && motivos.every((m) => m.codigo !== 'NAO_INFORMADO'));
  let ficha = (await db.execute(consultaFicha({ usuario: REP, prospectId: id }))).rows[0];
  assert.equal(ajustarFicha(REP, ficha).rota, undefined);           // representante não recebe rota
  assert.throws(() => comandoRegistrarContato({ usuario: REP, prospect: ficha, canal: 'visita', resultado: 'sem_interesse', dataContato: '2026-10-02' }), /motivo obrigatório/);
  const preco = motivos.find((m) => m.codigo === 'PRECO');
  await db.execute(comandoRegistrarContato({ usuario: REP, prospect: ficha, canal: 'visita', resultado: 'sem_interesse', motivoId: preco.id, observacao: 'Tabela alta', dataContato: '2026-10-02' }));
  ficha = (await db.execute(consultaFicha({ usuario: REP, prospectId: id }))).rows[0];
  assert.equal(ficha.status_atual, 'sem_interesse');
  await db.execute(comandoRegistrarContato({ usuario: REP, prospect: ficha, canal: 'telefone', resultado: 'pedido_informado', dataPedido: '2026-10-05', dataContato: '2026-10-06' }));
  assert.equal((await prospect(db, id)).status_descricao, 'Aguardando cadastro · pedido informado em 05/10/2026');
  const { consultaCarteira } = await import('../shared/carteira.mjs');
  const acompanhamento = (await db.execute(consultaCarteira({ usuario: REP, filtros: { foraDaLista: true } }))).rows;
  assert.deepEqual(acompanhamento.map((p) => p.id), [id]);                // acompanhamento = quem saiu da lista principal
  assert.equal((await db.execute(consultaCarteira({ usuario: REP }))).rows.length, 0);
  const lt = (await db.execute(consultaLinhaTempo({ prospectId: id }))).rows;
  assert.deepEqual(lt.map((m) => m.tipo), ['pedido_informado', 'sem_interesse', 'entrada_base']);
  assert.equal(lt[1].detalhe, 'Preço acima do praticado — Tabela alta');
  // outro vendedor / outro supervisor não abrem a ficha
  assert.equal((await db.execute(consultaFicha({ usuario: { id: 3, perfil: 'vendedor' }, prospectId: id }))).rows.length, 0);
  assert.equal((await db.execute(consultaFicha({ usuario: { id: 5, perfil: 'supervisor' }, prospectId: id }))).rows.length, 0);
  assert.equal((await db.execute(consultaFicha({ usuario: { id: 1, perfil: 'supervisor' }, prospectId: id }))).rows.length, 1);
  assert.equal((await db.execute(consultaFicha({ usuario: { id: 9, perfil: 'financeiro' }, prospectId: id }))).rows.length, 1);
});
