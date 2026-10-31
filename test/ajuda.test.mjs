// Ajuda: toda tela do menu tem ajuda completa, e cada perfil vê os capítulos do que usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AJUDA_TELAS, ajudaDaTela, CAPITULOS, capitulosDoUsuario, DESVIOS, FLUXO, TELAS_SEM_AJUDA } from '../shared/ajuda.mjs';

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
  for (const c of CAPITULOS) assert.ok(c.blocos.length >= 2 && c.blocos.every((b) => ['p', 'h', 'lista', 'passos', 'tabela'].includes(b[0])), `capítulo ${c.n}`);
});
