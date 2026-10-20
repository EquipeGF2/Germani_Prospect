import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bancoTeste } from './auxiliar.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { carregarExemplo } from '../shared/exemplo.mjs';
import { normalizarMapaStatus } from '../shared/importacao-base.mjs';
import { gerarHashSenha, conferirSenha } from '../shared/senha.mjs';
import { consultaPainel } from '../shared/painel.mjs';

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

test('Início pelo resumo (0012) e pelo índice (0011) = consulta direta, com os dados de exemplo (pedidos, crédito, baixas)', async () => {
  const db = await bancoTeste();
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile('config/mapa-status-planilha.json', 'utf8')));
  await carregarExemplo(db, { linhasBase: linhas, mapaStatus, hoje: '2026-10-21', gerarHash: gerarHashSenha });
  const sup = Number((await db.execute("SELECT id FROM usuarios WHERE perfil = 'supervisor' ORDER BY id LIMIT 1")).rows[0].id);
  const ven = Number((await db.execute("SELECT id FROM usuarios WHERE perfil = 'vendedor' ORDER BY id LIMIT 1")).rows[0].id);
  for (const usuario of [{ id: 1, perfil: 'administrador' }, { id: sup, perfil: 'supervisor' }, { id: ven, perfil: 'vendedor' }]) {
    const ler = async (agregarAntes) => (await db.execute(consultaPainel({ usuario, agregarAntes }))).rows.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? null : Number.isFinite(Number(v)) ? Number(v) : v]))));
    const direta = await ler(false);
    assert.ok(direta.length, usuario.perfil);
    assert.deepEqual(await ler(true), direta, usuario.perfil);   // do resumo (0012)
    const pelo = async () => (await db.execute(consultaPainel({ usuario, fonte: 'indice' }))).rows.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? null : Number.isFinite(Number(v)) ? Number(v) : v]))));
    assert.deepEqual(await pelo(), direta, `${usuario.perfil} (índice)`);
  }
});

test('resumo da carteira (migração 0012) acompanha a base em todo o processo: importação, atendimentos, ERP, crédito e transferência', async () => {
  const db = await bancoTeste();
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile('config/mapa-status-planilha.json', 'utf8')));
  await carregarExemplo(db, { linhasBase: linhas, mapaStatus, hoje: '2026-10-21', gerarHash: gerarHashSenha });
  const chave = "vendedor_id || '|' || cidade_busca || '|' || uf || '|' || tipologia_gtm || '|' || onda || '|' || rota || '|' || subrota || '|' || status_atual";
  const direto = async () => (await db.execute(`
    SELECT ${chave} AS k, COUNT(*) AS qtd,
           SUM(dt_atendido IS NOT NULL OR dt_cadastro_erp IS NOT NULL OR dt_liberacao_credito IS NOT NULL OR status_atual = 'venda_realizada') AS atendidos,
           SUM(dt_cadastro_erp IS NOT NULL OR dt_liberacao_credito IS NOT NULL OR status_atual = 'venda_realizada') AS cadastrados,
           SUM(dt_liberacao_credito IS NOT NULL OR status_atual = 'venda_realizada') AS credito
      FROM (SELECT vendedor_id, COALESCE(cidade_busca,'') cidade_busca, COALESCE(uf,'') uf, COALESCE(tipologia_gtm,'') tipologia_gtm, COALESCE(onda,'') onda,
                   COALESCE(rota,'') rota, COALESCE(subrota,'') subrota, status_atual, dt_atendido, dt_cadastro_erp, dt_liberacao_credito FROM prospects)
     GROUP BY k ORDER BY k`)).rows.map((r) => [r.k, Number(r.qtd), Number(r.atendidos), Number(r.cadastrados), Number(r.credito)]);
  const resumo = async () => (await db.execute(`SELECT ${chave} AS k, qtd, atendidos, cadastrados, credito FROM resumo_carteira WHERE qtd > 0 ORDER BY k`))
    .rows.map((r) => [r.k, Number(r.qtd), Number(r.atendidos), Number(r.cadastrados), Number(r.credito)]);
  const antes = await direto();
  assert.ok(antes.length > 5);
  assert.deepEqual(await resumo(), antes, 'depois dos dados de exemplo');
  // transferência de carteira (o resumo muda de vendedor) e reimportação da base (dados cadastrais)
  const p = (await db.execute("SELECT p.id, p.vendedor_id, v.supervisor_id FROM prospects p JOIN usuarios v ON v.id = p.vendedor_id WHERE p.status_atual = 'nao_contactado' LIMIT 1")).rows[0];
  const outro = (await db.execute({ sql: "SELECT id FROM usuarios WHERE perfil = 'vendedor' AND supervisor_id = ? AND id <> ? LIMIT 1", args: [p.supervisor_id, p.vendedor_id] })).rows[0];
  await db.execute({ sql: "INSERT INTO transferencias (prospect_id, de_vendedor_id, para_vendedor_id, data_transferencia, motivo, usuario_id) VALUES (?, ?, ?, '2026-10-21', 'teste', ?)",
    args: [p.id, p.vendedor_id, outro.id, p.supervisor_id] });   // o supervisor da equipe transfere
  assert.equal(Number((await db.execute({ sql: 'SELECT vendedor_id FROM prospects WHERE id = ?', args: [p.id] })).rows[0].vendedor_id), Number(outro.id));
  await db.execute({ sql: "UPDATE prospects SET onda = '9', tipologia_gtm = NULL WHERE id = ?", args: [p.id] });
  assert.deepEqual(await resumo(), await direto(), 'depois de transferência e mudança cadastral');
});

test('Explorar carteira: árvore do resumo bate com o Início, filhos somam o pai, escopo e filtros da lista', async () => {
  const { consultaResumo, consultaPedidosResumo, montarArvore, niveisPossiveis } = await import('../shared/explorar.mjs');
  const { somarPainel } = await import('../shared/painel.mjs');
  const db = await bancoTeste();
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile('config/mapa-status-planilha.json', 'utf8')));
  await carregarExemplo(db, { linhasBase: linhas, mapaStatus, hoje: '2026-10-21', gerarHash: gerarHashSenha });
  const parametros = { percentual_pipeline: 30, valor_medio_cliente: 1200 };
  const ler = async (usuario) => [(await db.execute(consultaResumo({ usuario }))).rows, (await db.execute(consultaPedidosResumo({ usuario }))).rows];
  const ADM = { id: 1, perfil: 'administrador' };
  const [res, ped] = await ler(ADM);
  const niveis = ['supervisor', 'representante', 'cidade'];
  // tudo aberto: raiz + todos os ramos
  const caminhos = new Set(['']);
  for (let k = 0; k < 3; k++) for (const n of montarArvore({ linhas: res, pedidos: ped, niveis, abertos: caminhos, parametros })) caminhos.add(n.caminho);
  const arv = montarArvore({ linhas: res, pedidos: ped, niveis, abertos: caminhos, parametros });
  const raiz = arv[0].ind;
  const painel = somarPainel((await db.execute(consultaPainel({ usuario: ADM }))).rows);
  assert.equal(raiz.base, painel.total);
  assert.equal(raiz.contactados, painel.contactados);
  assert.equal(raiz.atendidos, painel.atendidos);
  assert.equal(raiz.cadastrados, painel.cadastrados);
  assert.equal(raiz.credito, painel.credito_liberado);
  assert.equal(raiz.vendas, painel.venda_realizada);
  assert.equal(raiz.semInteresse, painel.sem_interesse);
  assert.equal(raiz.qtdPedidos, painel.qtd_pedidos);
  assert.equal(raiz.valorPedidos, painel.valor_pedidos);
  // filhos somam o pai, em todos os níveis
  for (const n of arv.filter((x) => x.aberto)) {
    const filhos = arv.filter((x) => x.profundidade === n.profundidade + 1 && x.caminho.startsWith(`${n.caminho}/`));
    assert.equal(filhos.reduce((s, f) => s + f.ind.qtd, 0), n.ind.qtd, n.caminho);
    assert.equal(filhos.reduce((s, f) => s + f.ind.valorPedidos, 0), n.ind.valorPedidos, n.caminho);
  }
  // ramo de cidade leva os filtros da Lista principal do caminho todo
  const folha = arv.find((x) => x.profundidade === 3);
  assert.ok(folha.filtros.supervisorId && folha.filtros.vendedorId && folha.filtros.cidadeBusca, JSON.stringify(folha.filtros));
  // supervisor: só a equipe, sem o nível Supervisor
  const sup = Number((await db.execute("SELECT id FROM usuarios WHERE perfil = 'supervisor' ORDER BY id LIMIT 1")).rows[0].id);
  const [resSup] = await ler({ id: sup, perfil: 'supervisor' });
  assert.ok(resSup.length && resSup.every((l) => Number(l.supervisor_id) === sup));
  assert.ok(!niveisPossiveis({ id: sup, perfil: 'supervisor' }).includes('supervisor'));
  assert.deepEqual(niveisPossiveis({ id: 9, perfil: 'vendedor' }).includes('representante'), false);
  // filtro representante × vendedor
  const soRep = montarArvore({ linhas: res, pedidos: ped, niveis, abertos: new Set(), tipo: 'representante', parametros })[0].ind.qtd;
  const soVen = montarArvore({ linhas: res, pedidos: ped, niveis, abertos: new Set(), tipo: 'vendedor', parametros })[0].ind.qtd;
  assert.equal(soRep + soVen, raiz.qtd);
});

test('filtros em cascata (Lista principal e Acompanhamento) pelo resumo = valores distintos da própria carteira com os outros filtros', async () => {
  const { consultaResumo, opcoesEmCascata } = await import('../shared/explorar.mjs');
  const db = await bancoTeste();
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const mapaStatus = normalizarMapaStatus(JSON.parse(await readFile('config/mapa-status-planilha.json', 'utf8')));
  await carregarExemplo(db, { linhasBase: linhas, mapaStatus, hoje: '2026-10-21', gerarHash: gerarHashSenha });
  const ADM = { id: 1, perfil: 'administrador' };
  const resumo = (await db.execute(consultaResumo({ usuario: ADM }))).rows;
  // direto na carteira: valores distintos de uma coluna com os OUTROS filtros (o que a cascata promete)
  const direto = async (coluna, f, aba) => {
    const w = [aba === 'acompanhamento' ? "p.status_atual NOT IN ('nao_contactado','em_prospeccao')" : "p.status_atual IN ('nao_contactado','em_prospeccao')"]; const a = [];
    const sup = "COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)";
    if (f.supervisorId && coluna !== 'sup') { w.push(`${sup} = ?`); a.push(f.supervisorId); }
    if (f.vendedorId && coluna !== 'p.vendedor_id') { w.push('p.vendedor_id = ?'); a.push(f.vendedorId); }
    if (f.uf && coluna !== 'p.uf') { w.push('p.uf = ?'); a.push(f.uf); }
    if (f.cidadeBusca && coluna !== 'p.cidade_busca') { w.push('p.cidade_busca = ?'); a.push(f.cidadeBusca); }
    if (f.segmento && coluna !== 'p.tipologia_gtm') { w.push('p.tipologia_gtm = ?'); a.push(f.segmento); }
    if (f.onda && coluna !== 'p.onda') { w.push('p.onda = ?'); a.push(f.onda); }
    const col = coluna === 'sup' ? sup : coluna;
    const r = await db.execute({ sql: `SELECT DISTINCT ${col} AS x FROM prospects p JOIN usuarios v ON v.id = p.vendedor_id
      WHERE ${w.join(' AND ')} AND ${col} IS NOT NULL AND ${col} <> ''`, args: a });
    return r.rows.map((l) => String(l.x)).sort();
  };
  const conferir = async (f, aba) => {
    const o = opcoesEmCascata(resumo, f, { aba });
    const s = (l) => l.map(String).sort();
    assert.deepEqual(s(o.supervisores.map((x) => x.id)), await direto('sup', f, aba), `supervisores ${JSON.stringify(f)} ${aba}`);
    assert.deepEqual(s(o.vendedores.map((x) => x.id)), await direto('p.vendedor_id', f, aba), `vendedores ${JSON.stringify(f)} ${aba}`);
    assert.deepEqual(s(o.ufs), await direto('p.uf', f, aba));
    assert.deepEqual(s([...new Set(o.cidades.map((x) => x.cidade_busca))]), await direto('p.cidade_busca', f, aba));
    assert.deepEqual(s(o.segmentos), await direto('p.tipologia_gtm', f, aba));
    assert.deepEqual(s(o.ondas), await direto('p.onda', f, aba));
    return o;
  };
  const tudo = await conferir({}, 'principal');
  assert.ok(tudo.cidades.length > 1 && tudo.vendedores.length > 1, 'a base de exemplo tem mais de uma cidade e representante');
  const cidade = tudo.cidades[0];
  const naCidade = await conferir({ cidadeBusca: cidade.cidade_busca, uf: cidade.uf }, 'principal');
  assert.ok(naCidade.vendedores.length <= tudo.vendedores.length);
  const rep = tudo.vendedores[0].id;
  await conferir({ vendedorId: rep }, 'principal');
  await conferir({ supervisorId: tudo.supervisores[0].id, onda: tudo.ondas[0] }, 'principal');
  await conferir({}, 'acompanhamento');
  await conferir({ cidadeBusca: cidade.cidade_busca, vendedorId: rep }, 'acompanhamento');
});
