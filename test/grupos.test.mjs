// Grupos de CNPJ (base × arquivo pela raiz) e expurgo de quem já é cliente — docs/03 §13 · migração 0021.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe, criarProspect, cnpjTeste, prospect, registrarContato } from './auxiliar.mjs';
import { analisarGrupos, comandosExpurgo, sugerir } from '../shared/grupos.mjs';
import { consultaLinhaTempo } from '../shared/carteira.mjs';

const CAB = ['Cliente', 'CPF / CNPJ', 'Razão Social', 'Cond. Pgto', 'Descrição', 'Forma Pgto', 'Descrição', null, 'Créd. Cliente', 'Créd. Grupo', 'Dt. Cadastro'];
const admin = { id: 4, perfil: 'administrador' };

async function cenario() {
  const db = await bancoTeste();
  await criarEquipe(db);
  const p = {
    antigo: await criarProspect(db, { n: 10 }),                              // mesmo CNPJ, cliente desde 2019 → expurgar
    novo: await criarProspect(db, { n: 11 }),                                // mesmo CNPJ, cadastro na campanha → manter
    filial: await criarProspect(db, { n: 12, cnpj: cnpjTeste(10, 2) }),      // filial nova do grupo 10 → decidir
    atendido: await criarProspect(db, { n: 13, cnpj: cnpjTeste(10, 3) }),    // já trabalhado → manter
    fora: await criarProspect(db, { n: 14 }),                                // raiz fora do arquivo: não aparece
  };
  await registrarContato(db, { prospectId: p.atendido, resultado: 'atendido', data: '2026-10-05' });
  const linhas = [CAB,
    [101, cnpjTeste(10), 'GRUPO DEZ', '28A', '28 DD BOLETO', 1, 'Boleto', null, null, 5000, '14/03/2019'],
    [102, cnpjTeste(10, 4), 'GRUPO DEZ FILIAL 4', '28A', '28 DD BOLETO', 1, 'Boleto', null, null, 5000, '20/05/2020'],
    [111, cnpjTeste(11), 'ONZE', '00A', 'A VISTA', 4, 'A vista', null, 0, null, '15/10/2026'],
    [900, '12345678901', 'PESSOA', '00A', 'A VISTA', 4, 'A vista', null, 0, null, '15/10/2026'],
  ];
  return { db, p, linhas };
}

test('grupos de CNPJ: cruza só pela raiz, com sugestão por empresa', async () => {
  const { db, p, linhas } = await cenario();
  const { grupos, resumo } = await analisarGrupos(db, { linhas });
  assert.deepEqual(grupos.map((g) => [g.raiz, g.arquivoQtd, g.credGrupo, g.prospects.length]), [['00000010', 2, 5000, 3], ['00000011', 1, null, 1]]);
  const sug = Object.fromEntries(grupos.flatMap((g) => g.prospects).map((x) => [x.id, x.sugestao]));
  assert.deepEqual([sug[p.antigo], sug[p.novo], sug[p.filial], sug[p.atendido], sug[p.fora]], ['expurgar', 'manter', 'decidir', 'manter', undefined]);
  assert.deepEqual([resumo.raizesArquivo, resumo.raizesEmComum, resumo.prospects, resumo.mesmoCnpj, resumo.filialNova, resumo.expurgar, resumo.ignoradasArquivo],
    [2, 2, 4, 2, 2, 1, 1]);
  assert.equal(sugerir({ status_atual: 'nao_contactado' }, { dataCadastro: null }, '2026-10-01'), 'expurgar', 'sem data de cadastro: já era cliente');
});

test('expurgo: só administrador, só não trabalhado; sai da carteira válida, fica no histórico e pode ser desfeito', async () => {
  const { db, p } = await cenario();
  const cmd = (ids, acao = 'expurgar', usuario = admin) => db.batch(comandosExpurgo({ usuario, prospectIds: ids, acao, motivo: 'Já é cliente no ERP (mesmo CNPJ)', data: '2026-10-23' }), 'write');
  await assert.rejects(cmd([p.antigo], 'expurgar', { id: 1, perfil: 'supervisor' }), /só o administrador/);
  await assert.rejects(cmd([p.atendido]), /ainda não trabalhado/);
  await cmd([p.antigo]);
  let x = await prospect(db, p.antigo);
  assert.deepEqual([x.status_atual, Number(x.aceita_contato)], ['expurgado', 0]);
  await assert.rejects(registrarContato(db, { prospectId: p.antigo, resultado: 'atendido', data: '2026-10-24' }));
  const hist = (await db.execute(consultaLinhaTempo({ prospectId: p.antigo }))).rows;
  assert.equal(hist[0].tipo, 'expurgo');
  assert.match(hist[0].detalhe, /expurgado: Já é cliente/);
  assert.deepEqual([hist[0].status_anterior, hist[0].status_novo, hist[0].usuario_nome], ['nao_contactado', 'expurgado', 'Admin']);
  // fora das contas: carteira válida e resumo
  const valida = Number((await db.execute("SELECT SUM(s.conta_carteira) AS n FROM prospects p JOIN status s ON s.codigo = p.status_atual")).rows[0].n);
  assert.equal(valida, 4);
  // desfazer devolve a situação anterior; registros nunca são alterados
  await cmd([p.antigo], 'desfazer');
  x = await prospect(db, p.antigo);
  assert.equal(x.status_atual, 'nao_contactado');
  await assert.rejects(cmd([p.antigo], 'desfazer'), /não está expurgado/);
  await assert.rejects(db.execute('UPDATE expurgos SET motivo = \'x\''), /somente inclusão/);
  await assert.rejects(db.execute('DELETE FROM expurgos'), /somente inclusão/);
  assert.equal((await db.execute(consultaLinhaTempo({ prospectId: p.antigo }))).rows.filter((m) => m.tipo.startsWith('expurgo')).length, 2);
});
