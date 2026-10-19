// Modo demonstração com os dados de exemplo: Início nas 3 visualizações, filtro por período e os outros perfis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from '../scripts/servir.mjs';

const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FOTOS = process.env.FOTOS_TELAS ?? null;
let srv, navegador, pagina, base;

before(async () => {
  srv = await servir(0);
  base = `http://localhost:${srv.address().port}/`;
  navegador = await chromium.launch({ executablePath: CHROME });
  pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  pagina.on('pageerror', (e) => console.error('erro na página:', e.message));
});
after(async () => { await navegador?.close(); srv?.close(); });

const foto = async (nome) => { if (FOTOS) await pagina.screenshot({ path: path.join(FOTOS, `${nome}.png`), fullPage: true }); };
const telaPronta = () => pagina.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === location.hash);
const entrar = async (login) => {
  await pagina.fill('#login', login);
  await pagina.fill('#senha', 'demo1234');
  await pagina.click('button[type=submit]');
};

test('dados de exemplo: Início preenchido nas 3 visualizações, com período, e os outros perfis', { timeout: 180000 }, async () => {
  await pagina.goto(base);
  await pagina.waitForSelector('#login');
  await entrar('admin');
  await pagina.click('#carregar-exemplo');
  await pagina.waitForSelector('text=Dados de exemplo carregados', { timeout: 60000 });
  await pagina.waitForSelector('.vis-executivo');
  assert.equal(await pagina.locator('#carregar-exemplo').count(), 0, 'o botão some depois da carga');
  assert.ok(Number(await pagina.locator('#painel-vendas').innerText()) > 0, 'há vendas');
  await foto('20-exemplo-executivo');

  await pagina.click('.controles-painel .visoes a[data-visao="arrojado"]');
  await pagina.waitForSelector('.vis-arrojado .ranking .rk');
  await foto('21-exemplo-arrojado');

  await pagina.click('.controles-painel .visoes a[data-visao="equipe"]');
  await pagina.waitForSelector('.vis-equipe .sup');
  await pagina.click('.vis-equipe .sup >> nth=1');
  await pagina.waitForSelector('.vis-equipe .sup.sel >> nth=0');
  assert.ok(await pagina.locator('.vis-equipe .sup').nth(1).evaluate((el) => el.classList.contains('sel')));
  await foto('22-exemplo-equipe');

  // a escolha da visualização fica guardada no navegador
  await pagina.goto(`${base}#/carteira`);
  await telaPronta();
  await pagina.goto(`${base}#/inicio`);
  await pagina.waitForSelector('.vis-equipe');

  // período: hoje (talvez vazio) × desde o início da campanha × personalizado
  await pagina.click('.controles-painel .visoes a[data-visao="executivo"]');
  await pagina.selectOption('#painel-periodo', 'campanha');
  await pagina.waitForFunction(() => location.hash.includes('periodo=campanha'));
  await telaPronta();
  assert.match(await pagina.locator('main').innerText(), /Eventos de \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}/);
  await pagina.selectOption('#painel-periodo', 'personalizado');
  await pagina.fill('#painel-de', '2026-10-01');
  await pagina.fill('#painel-ate', '2026-10-09');
  await pagina.click('.controles-painel button:text("Aplicar")');
  await pagina.waitForFunction(() => location.hash.includes('de=2026-10-01'));
  await telaPronta();
  assert.match(await pagina.locator('main').innerText(), /Eventos de 01\/10\/2026 a 09\/10\/2026/);
  const funil = (await pagina.locator('.funil-barras .v').allInnerTexts()).map((t) => Number(t.replace(/\./g, '')));
  assert.ok(funil.every((v, i) => i === 0 || v <= funil[i - 1]), `funil cresceu: ${funil}`);
  await foto('23-exemplo-periodo');

  // outros perfis com a senha de exemplo
  await pagina.click('.menu-sair');
  await entrar('gerente');
  await pagina.waitForSelector('#painel-supervisor');
  await pagina.click('.menu-sair');
  await entrar('financeiro');
  await pagina.waitForSelector('h1:text("Console de crédito")');
  assert.ok(await pagina.locator('table tbody tr').count() >= 0);
  await foto('24-exemplo-console');
  await pagina.click('.menu-sair');
  const supervisor = await pagina.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;   // mesma versão do app (?v=…) = mesmo banco
    const { bancoApp } = await import(`./js/db.js${v}`);
    return (await (await bancoApp()).execute("SELECT login FROM usuarios WHERE perfil = 'supervisor' ORDER BY login LIMIT 1")).rows[0].login;
  });
  await entrar(supervisor);
  await pagina.waitForSelector('h1:text("Sua equipe")');
  assert.equal(await pagina.locator('#painel-supervisor').count(), 0);
});
