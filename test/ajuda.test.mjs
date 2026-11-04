// Ajuda: toda tela do menu tem ajuda completa, e cada perfil vê os capítulos do que usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AJUDA_TELAS, ajudaDaTela, blocosSimples, buscarTermos, CAPITULOS, capituloDeTermos, capitulosDoUsuario, DESVIOS, FLUXO, grupoDeTermos, OPCOES_TOPO, opcoesDaTela, TELAS_SEM_AJUDA, TERMOS, termosDoUsuario } from '../shared/ajuda.mjs';
import { readdirSync } from 'node:fs';

const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../web/js/menu.js', import.meta.url), 'utf8');
const rotas = [...app.matchAll(/\{ caminho: '([^']+)'/g)].map((m) => m[1]);
const noMenu = [...menu.matchAll(/\{ caminho: '([^']+)', rotulo/g)].map((m) => m[1]);

test('toda tela tem ajuda: objetivo, como funciona, campos, o que analisar, situações comuns e próximo passo', () => {
  assert.ok(rotas.length > 15, 'leu as rotas');
  for (const c of [...rotas, ...noMenu]) {
    if (TELAS_SEM_AJUDA.includes(c)) continue;
    const [caminho, consulta] = c.split('?');
    assert.ok(ajudaDaTela(caminho, consulta), `tela sem ajuda: ${c}`);
  }
  for (const [c, a] of Object.entries(AJUDA_TELAS)) {
    assert.ok(a.titulo && a.objetivo && a.proximo, `${c}: título, objetivo e próximo passo`);
    for (const lista of ['como', 'campos', 'analisar', 'comuns']) assert.ok(a[lista].length >= 1, `${c}: ${lista}`);
    assert.ok(CAPITULOS.some((x) => x.n === a.cap), `${c}: capítulo ${a.cap}`);
  }
});

test('os recortes dos capítulos existem, e todo capítulo tem para que serve, em 30 segundos e perguntas', () => {
  const recortes = CAPITULOS.flatMap((c) => c.blocos).filter((b) => b[0] === 'parte');
  assert.ok(recortes.length >= 20);
  for (const b of recortes) { assert.ok(existsSync(new URL(`../web/img/ajuda/${b[1]}.jpg`, import.meta.url)), `falta o recorte ${b[1]}`); assert.ok(b[2] && b[3] && b[4].length, `${b[1]}: título, resumo e itens`); }
  for (const c of CAPITULOS) for (const tipo of ['serve', 'rapido', 'perguntas']) assert.ok(c.blocos.some((b) => b[0] === tipo), `capítulo ${c.n}: ${tipo}`);
  for (const b of CAPITULOS.flatMap((c) => c.blocos).filter((x) => x[0] === 'termos')) assert.ok(TERMOS.some((g) => g.id === b[1]), `grupo de termos ${b[1]}`);
  for (const b of CAPITULOS.flatMap((c) => c.blocos).filter((x) => x[0] === 'opcoes')) assert.ok(OPCOES_TOPO[b[1]], `opções de ${b[1]}`);
  const simples = blocosSimples(CAPITULOS[3]);
  assert.ok(simples.every((b) => ['p', 'h', 'lista', 'passos', 'tabela', 'img', 'destaque'].includes(b[0])), 'o PDF recebe só blocos simples');
});

test('o Acompanhamento tem ajuda própria, separada da Lista principal', () => {
  assert.equal(ajudaDaTela('/carteira', 'aba=acompanhamento').titulo, 'Acompanhamento');
  assert.equal(ajudaDaTela('/carteira', 'vendedorId=1').titulo, 'Lista principal');
  assert.equal(ajudaDaTela('/entrar'), null);
});

test('cada perfil vê só o que usa', () => {
  const nums = (u) => capitulosDoUsuario(u).map((c) => c.n);
  assert.deepEqual(nums({ id: 1, perfil: 'administrador' }), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(nums({ id: 2, perfil: 'vendedor' }), [1, 2, 3, 4, 6, 7]);
  assert.deepEqual(nums({ id: 3, perfil: 'supervisor' }), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(nums({ id: 4, perfil: 'financeiro' }), [1, 2, 5]);
});

test('o fluxo aponta para capítulos que existem, e os capítulos têm conteúdo', () => {
  assert.equal(FLUXO.length, 8);
  for (const e of [...FLUXO, ...DESVIOS]) {
    assert.ok(e.nome && e.quem && e.tela && e.faz && e.avanca, e.id);
    assert.ok(CAPITULOS.some((c) => c.n === e.cap), `${e.id}: capítulo ${e.cap}`);
  }
  assert.deepEqual(CAPITULOS.map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const c of CAPITULOS) assert.ok(c.blocos.length >= 2 && c.blocos.every((b) => ['p', 'h', 'lista', 'passos', 'tabela', 'serve', 'rapido', 'parte', 'opcoes', 'termos', 'perguntas'].includes(b[0])), `capítulo ${c.n}`);
});

// código das telas e das regras, sem a própria ajuda: é onde o termo precisa aparecer
const codigo = ['../web/js/', '../web/js/telas/', '../shared/'].flatMap((d) => readdirSync(new URL(d, import.meta.url)).filter((f) => /\.m?js$/.test(f) && f !== 'ajuda.mjs')
  .map((f) => readFileSync(new URL(d + f, import.meta.url), 'utf8'))).join('\n');

test('significado dos termos: só o que existe nas telas, sem repetir', () => {
  const vistos = new Set();
  for (const g of TERMOS) {
    assert.ok(g.termos.length >= 3, `${g.nome}: termos`);
    for (const t of g.termos) {
      assert.ok(codigo.includes(t.termo), `"${t.termo}" (${g.nome}) não aparece em nenhuma tela`);
      assert.ok(t.significado.length > 10, `${t.termo}: significado`);
      const chave = `${g.id}|${t.termo}`; assert.ok(!vistos.has(chave), `repetido: ${chave}`); vistos.add(chave);
    }
  }
});

test('as abreviações das telas estão nos termos', () => {
  const todos = TERMOS.flatMap((g) => g.termos.map((t) => `${t.termo} ${t.significado}`)).join(' ');
  for (const a of ['Invest.', 'Invest. ÷ venda', 'Ag. cad.', 'Ag. fin.', 'Ag. ped.', 'S.I. cli.', 'S.I. rep.', 'Cobert.', 'Ag. pedido válido', 'Rep. sem código', 'Créd. Cliente', 'Dt. Cadastro'])
    assert.ok(todos.includes(a), `falta ${a}`);
});

test('termos por perfil, busca sem acento e o grupo da tela do botão ?', () => {
  assert.deepEqual(termosDoUsuario({ id: 1, perfil: 'administrador' }).map((g) => g.id), TERMOS.map((g) => g.id));
  assert.ok(!termosDoUsuario({ id: 2, perfil: 'vendedor' }).some((g) => g.id.startsWith('importar')), 'importações só para quem importa');
  assert.equal(grupoDeTermos('/carteira', 'aba=acompanhamento').id, 'acompanhamento');
  assert.equal(grupoDeTermos('/pedidos').id, 'pedidos');
  assert.equal(grupoDeTermos('/admin/usuarios'), null);
  const achados = buscarTermos(TERMOS, 'DESISTENCIA').flatMap((g) => g.termos.map((t) => t.termo));
  assert.ok(achados.includes('Desistência'));
  const cap = capituloDeTermos({ id: 1, perfil: 'administrador' });
  assert.ok(cap.blocos.filter((b) => b[0] === 'tabela').length >= TERMOS.length, 'termos e opções no PDF');
  assert.ok(JSON.stringify(cap.blocos).includes('Apenas o primeiro pedido'), 'as opções do topo também saem no PDF');
});

test('opções do topo: toda tela com chave ou filtro no topo explica cada opção, e cada opção existe na tela', () => {
  for (const c of ['/explorar', '/carteira', '/carteira?aba=acompanhamento', '/pedidos', '/financeiro', '/admin/grupos']) {
    assert.ok(OPCOES_TOPO[c]?.length, `${c}: opções do topo`);
    assert.ok(AJUDA_TELAS[c], `${c}: tela com ajuda`);
  }
  for (const [c, grupos] of Object.entries(OPCOES_TOPO)) for (const g of grupos) for (const o of g.opcoes) {
    assert.ok(codigo.includes(o.opcao), `${c}: a opção "${o.opcao}" não aparece em nenhuma tela`);
    assert.ok(o.significado.length > 10, `${c}: ${o.opcao}`);
  }
  assert.deepEqual(opcoesDaTela('/carteira', 'aba=acompanhamento').map((g) => g.nome), ['Fluxo | Crédito × Pedido', 'Apenas o primeiro pedido | Todos os pedidos', 'Ver por Empresa | Ver por Grupo']);
  assert.equal(opcoesDaTela('/carteira')[0].nome, 'Equipe');
  assert.deepEqual(opcoesDaTela('/admin/usuarios'), []);
});

test('Ajuda é o último item do menu, sem tela separada de termos', () => {
  const grupos = [...menu.matchAll(/\{ titulo: '([^']+)', itens/g)].map((m) => m[1]);
  assert.equal(grupos.at(-1), 'Ajuda');
  assert.ok(!menu.includes('termos=todos'));
});
