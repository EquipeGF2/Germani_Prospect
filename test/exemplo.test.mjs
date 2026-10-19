import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bancoTeste } from './auxiliar.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { carregarExemplo } from '../shared/exemplo.mjs';
import { normalizarMapaStatus } from '../shared/importacao-base.mjs';
import { gerarHashSenha, conferirSenha } from '../shared/senha.mjs';

test('dados de exemplo (modo demonstração): processo completo com as regras reais', async () => {
  const db = await bancoTeste();
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile('config/mapa-status-planilha.json', 'utf8')));
  const r = await carregarExemplo(db, { linhasBase: linhas, mapaStatus, hoje: '2026-10-21', gerarHash: gerarHashSenha });
  assert.ok(r.contatos > 20 && r.atendidos > 10 && r.cadastrados > 3 && r.liberados > 1 && r.vendas >= 1, JSON.stringify(r));
  const st = Object.fromEntries((await db.execute('SELECT status_atual, count(*) n FROM prospects GROUP BY 1')).rows.map((x) => [x.status_atual, Number(x.n)]));
  for (const s of ['nao_contactado', 'sem_interesse', 'aguardando_cadastro', 'venda_realizada']) assert.ok(st[s] > 0, `${s}: ${JSON.stringify(st)}`);
  assert.ok((st.analise_financeira ?? 0) + (st.aguardando_pedido ?? 0) > 0);
  // histórico completo e logins prontos
  const tipos = (await db.execute('SELECT DISTINCT tipo FROM movimentacoes')).rows.map((x) => x.tipo);
  for (const t of ['entrada_base', 'atendido', 'sem_interesse', 'cadastro', 'liberacao_credito', 'pedido']) assert.ok(tipos.includes(t), `${t} em ${tipos}`);
  const g = (await db.execute("SELECT senha_hash FROM usuarios WHERE login = 'gerente'")).rows[0];
  assert.ok(await conferirSenha('demo1234', g.senha_hash));
  assert.equal(Number((await db.execute("SELECT count(*) n FROM usuarios WHERE perfil = 'vendedor' AND tipo_atuacao IS NULL")).rows[0].n), 0);
  // reproduzível e só num banco vazio
  await assert.rejects(carregarExemplo(db, { linhasBase: linhas, mapaStatus, hoje: '2026-10-21', gerarHash: gerarHashSenha }), /banco vazio/);
});
