// Registro em lote de "sem interesse": justificativa do lote e/ou individual; falha de um não derruba os outros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, evento, prospect } from './auxiliar.mjs';
import { prepararLote, registrarLote } from '../shared/lote.mjs';

const REP = { id: 2, perfil: 'vendedor', tipo_atuacao: 'representante' };
const motivoId = async (db, cod) => Number((await db.execute({ sql: 'SELECT id FROM motivos_sem_interesse WHERE codigo = ?', args: [cod] })).rows[0].id);

test('lote com justificativa comum e individual', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const ids = [await criarProspect(db, { n: 1 }), await criarProspect(db, { n: 2 }), await criarProspect(db, { n: 3 })];
  const preco = await motivoId(db, 'PRECO');
  const outro = await motivoId(db, 'OUTRO');
  const lote = prepararLote({
    usuario: REP,
    prospects: ids.map((id) => ({ id, tentativas: 0 })),
    comum: { canal: 'visita', dataContato: '2026-10-15', motivoId: preco, observacao: 'tabela acima da concorrência' },
    individuais: { [ids[2]]: { motivoId: outro, observacao: 'loja vai fechar' } },
    motivos: { [outro]: { exige_observacao: 1 } },
  });
  const r = await registrarLote(db, lote);
  assert.equal(r.gravados, 3);
  assert.deepEqual(r.recusados, []);
  const p1 = await prospect(db, ids[0]);
  const p3 = await prospect(db, ids[2]);
  assert.equal(p1.status_atual, 'sem_interesse');
  assert.equal(p1.motivo_sem_interesse, 'Preço acima do praticado');
  assert.equal(p3.motivo_sem_interesse, 'Outro (descrever na observação)');
  const c = (await db.execute({ sql: 'SELECT lote_id, observacao FROM contatos ORDER BY prospect_id' })).rows;
  assert.equal(new Set(c.map((x) => x.lote_id)).size, 1);
  assert.equal(c[2].observacao, 'loja vai fechar');
  assert.equal(c[0].observacao, 'tabela acima da concorrência');
});

test('itens inválidos e recusados pelo banco são informados; os demais gravam', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const ok = await criarProspect(db, { n: 1 });
  const semMotivo = await criarProspect(db, { n: 2 });
  const outraCarteira = await criarProspect(db, { n: 3, vendedorId: 3 });
  const baixado = await criarProspect(db, { n: 4 });
  await evento(db, { prospectId: baixado, tipo: 'baixa', data: '2026-10-01' });
  const preco = await motivoId(db, 'PRECO');
  const lote = prepararLote({
    usuario: REP,
    prospects: [ok, semMotivo, outraCarteira, baixado].map((id) => ({ id, tentativas: 0 })),
    comum: { canal: 'telefone', dataContato: '2026-10-15' },
    individuais: { [ok]: { motivoId: preco }, [outraCarteira]: { motivoId: preco }, [baixado]: { motivoId: preco } },
  });
  const r = await registrarLote(db, lote);
  assert.equal(r.gravados, 1);
  const erros = Object.fromEntries(r.recusados.map((x) => [x.prospectId, x.erros.join(' ')]));
  assert.match(erros[semMotivo], /motivo obrigatório/);
  assert.match(erros[outraCarteira], /sem permissão/);
  assert.match(erros[baixado], /não aceita novo contato/);
  assert.equal((await prospect(db, ok)).status_atual, 'sem_interesse');
});

test('lote recusa repetidos e reabertura com pedido (que é individual)', () => {
  assert.throws(() => prepararLote({ usuario: REP, prospects: [{ id: 1, tentativas: 0 }, { id: 1, tentativas: 0 }], comum: {} }), /repetido/);
  assert.throws(() => prepararLote({ usuario: REP, prospects: [{ id: 1, tentativas: 0 }], comum: { resultado: 'pedido_informado' } }), /um a um/);
});
