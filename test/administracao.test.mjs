import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoTeste, criarEquipe } from './auxiliar.mjs';
import { conferirSenha } from '../shared/senha.mjs';
import { criarUsuarioSistema, definirAtivo, definirTipoAtuacao, gerarSenhaProvisoria, listarUsuarios, redefinirSenha } from '../shared/usuarios.mjs';
import { alterarParametro, linhasDaImportacao, listarImportacoes, listarParametros } from '../shared/administracao.mjs';
import { contarStatusPlanilha, COLUNAS_BASE } from '../shared/importacao-base.mjs';

test('senha provisória: 10 caracteres do alfabeto sem ambíguos', () => {
  const s = gerarSenhaProvisoria();
  assert.match(s, /^[A-HJ-NP-Za-km-z2-9]{10}$/);
  assert.notEqual(gerarSenhaProvisoria(), s);
});

test('usuários: criar admin/financeiro, senha, tipo, ativar — tudo auditado', async () => {
  const db = await bancoTeste();
  await criarEquipe(db);
  const fin = await criarUsuarioSistema(db, { perfil: 'financeiro', login: 'analista', nome: 'Analista Teste', executadoPor: 'adm' });
  const u = (await db.execute({ sql: 'SELECT * FROM usuarios WHERE id = ?', args: [fin.id] })).rows[0];
  assert.equal(u.perfil, 'financeiro');
  assert.ok(await conferirSenha(fin.senha, u.senha_hash));
  await assert.rejects(criarUsuarioSistema(db, { perfil: 'vendedor', login: 'x1', nome: 'Xxx' }), /administrador, gerente ou financeiro/);
  await assert.rejects(criarUsuarioSistema(db, { perfil: 'financeiro', login: 'analista', nome: 'Outro', executadoPor: 'adm' }), /UNIQUE/);
  const r = await redefinirSenha(db, { usuarioId: 2, executadoPor: 'adm' });
  assert.equal(r.login, 'vendedor10');
  assert.ok(await conferirSenha(r.senha, (await db.execute('SELECT senha_hash FROM usuarios WHERE id = 2')).rows[0].senha_hash));
  await definirTipoAtuacao(db, { usuarioId: 3, tipo: 'vendedor', executadoPor: 'adm' });
  await assert.rejects(definirTipoAtuacao(db, { usuarioId: 3, tipo: 'gerente', executadoPor: 'adm' }), /representante ou vendedor/);
  await definirAtivo(db, { usuarioId: 3, ativo: false, executadoPor: 'adm' });
  const lista = await listarUsuarios(db);
  const v11 = lista.find((x) => Number(x.id) === 3);
  assert.deepEqual([v11.tipo_atuacao, v11.ativo, v11.situacao_senha], ['vendedor', 0, 'sem_acesso']);
  assert.equal(lista.find((x) => Number(x.id) === 2).situacao_senha, 'provisoria');
  const aud = (await db.execute('SELECT acao FROM auditoria ORDER BY id')).rows.map((x) => x.acao);
  assert.deepEqual(aud, ['criar_financeiro', 'senha_provisoria', 'tipo_atuacao', 'desativar']);
});

test('parâmetros: altera com validação e auditoria; importações listadas', async () => {
  const db = await bancoTeste();
  await alterarParametro(db, { chave: 'prazo_cadastro_dias', valor: '20', executadoPor: 'adm' });
  assert.equal((await listarParametros(db)).find((p) => p.chave === 'prazo_cadastro_dias').valor, '20');
  await assert.rejects(alterarParametro(db, { chave: 'prazo_cadastro_dias', valor: '-1', executadoPor: 'adm' }), /inteiro/);
  await assert.rejects(alterarParametro(db, { chave: 'nao_existe', valor: '1', executadoPor: 'adm' }), /inexistente/);
  assert.equal(Number((await db.execute("SELECT count(*) n FROM auditoria WHERE acao = 'alterar_parametro'")).rows[0].n), 1);
  const imp = await db.execute("INSERT INTO importacoes (tipo, arquivo_nome, arquivo_sha256, executado_por) VALUES ('base_prospects','a.xlsx','x','adm') RETURNING id");
  await db.execute({ sql: "INSERT INTO importacao_linhas (importacao_id, numero_linha, resultado, mensagens, dados_brutos) VALUES (?, 2, 'rejeitada', '[\"erro A\",\"erro B\"]', '{}')", args: [imp.rows[0].id] });
  assert.equal((await listarImportacoes(db)).length, 1);
  const l = await linhasDaImportacao(db, { importacaoId: imp.rows[0].id, resultado: 'rejeitada' });
  assert.equal(l[0].mensagens, 'erro A | erro B');
});

test('contagem de "Status Atual" para o mapeamento na tela', () => {
  const cab = COLUNAS_BASE.map((c) => c.cabecalho);
  const iStatus = COLUNAS_BASE.findIndex((c) => c.campo === 'status_planilha');
  const linha = (st) => cab.map((_, i) => (i === 0 ? '1' : i === iStatus ? st : null));
  const r = contarStatusPlanilha([cab, linha('Sem interesse'), linha('SEM INTERESSE'), linha('Ligar'), cab.map(() => null)]);
  assert.deepEqual(r.map((x) => [x.valor, x.quantidade]), [['Sem interesse', 2], ['Ligar', 1]]); // acento/maiúsculas agrupados
  assert.equal(r[0].chave, 'SEM INTERESSE');
});
