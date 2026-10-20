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
  assert.match(await pagina.locator('#valor-pedidos').innerText(), /^R\$\s?[1-9]/, 'valor real dos pedidos do arquivo do ERP');
  await foto('20-exemplo-executivo');

  await pagina.selectOption('#painel-visao', 'arrojado');
  await pagina.waitForSelector('.vis-arrojado .ranking .rk');
  await foto('21-exemplo-arrojado');

  await pagina.selectOption('#painel-visao', 'equipe');
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
  await pagina.selectOption('#painel-visao', 'executivo');
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
  await foto('23b-periodo-personalizado');
  // com o período personalizado aberto, os filtros continuam na linha do título (1440 px, menu aberto)
  const [topoTitulo, topoFiltros] = await Promise.all(['.cabecalho-pagina h1', '.controles-painel'].map((s) => pagina.locator(s).evaluate((el) => el.getBoundingClientRect().top)));
  assert.ok(topoFiltros < topoTitulo + 40, `filtros quebraram de linha (${topoTitulo} × ${topoFiltros})`);
  const funil = (await pagina.locator('.funil-barras .v').allInnerTexts()).map((t) => Number(t.replace(/\./g, '')));
  assert.ok(funil.every((v, i) => i === 0 || v <= funil[i - 1]), `funil cresceu: ${funil}`);
  await foto('23-exemplo-periodo');

  // lista principal no computador: barra única, cards × lista, ondas em ordem, rota em 2 níveis, data do último registro
  await pagina.goto(`${base}#/carteira`);
  await telaPronta();
  assert.equal(await pagina.locator('.barra-carteira #busca').count(), 1);
  assert.equal(await pagina.locator('.barra-carteira #filtro-supervisor').count(), 1);
  assert.equal(await pagina.locator('#so-retornos').count(), 0, 'sem "só retornos" no computador');
  await pagina.click('.exibicao a[data-exibicao="lista"]');
  await pagina.waitForSelector('.tabela-carteira tbody tr');
  const umaLinha = () => pagina.locator('.barra-carteira > *').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().bottom))).size);
  assert.equal(await umaLinha(), 1, 'filtros da lista numa linha só (1440 px, admin)');
  // rótulo da coluna ordena: Prospect crescente, depois decrescente
  await pagina.click('.tabela-carteira th a[data-ordem="prospect"]');
  await pagina.waitForFunction(() => location.hash.includes('ordem=prospect') && !location.hash.includes('dir=desc'));
  await telaPronta();
  const nomesAsc = await pagina.locator('.tabela-carteira tbody a.nome').allInnerTexts();
  assert.deepEqual(nomesAsc, [...nomesAsc].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  await pagina.click('.tabela-carteira th a[data-ordem="prospect"]');
  await pagina.waitForFunction(() => location.hash.includes('dir=desc'));
  await telaPronta();
  assert.match(await pagina.locator('.tabela-carteira th a.ativa').innerText(), /▼/);
  // filtro por onda
  await pagina.selectOption('#filtro-onda', '2');
  await pagina.waitForFunction(() => location.hash.includes('onda=2'));
  await telaPronta();
  assert.ok((await pagina.locator('.tabela-carteira tbody td:nth-child(4)').allInnerTexts()).every((t) => t === 'Onda 2'));
  assert.equal(await umaLinha(), 1, 'com o filtro de onda continua numa linha');
  await foto('25-lista-tabela');
  await pagina.goto(`${base}#/carteira`);
  await telaPronta();
  await pagina.goto(`${base}#/carteira?visao=onda`);
  await telaPronta();
  const ondas = await pagina.locator('.lista-grupos .grupo b').allInnerTexts();
  assert.deepEqual(ondas.filter((o) => o.startsWith('Onda')), [...ondas.filter((o) => o.startsWith('Onda'))].sort((x, y) => Number(x.slice(5)) - Number(y.slice(5))));
  await pagina.goto(`${base}#/carteira?visao=rota`);
  await telaPronta();
  const rotas = await pagina.locator('.lista-grupos .grupo b').allInnerTexts();
  assert.ok(rotas.length && rotas.every((r) => r.startsWith('Rota') || r === '(sem rota)'), `nível 1: ${rotas}`);
  await pagina.click('.lista-grupos a.grupo >> nth=0');
  await telaPronta();
  assert.match(await pagina.evaluate(() => location.hash), /visao=rota.*rota=|rota=.*visao=rota/);
  const subrotas = await pagina.locator('.lista-grupos .grupo b').allInnerTexts();
  assert.ok(subrotas.every((r) => r.startsWith('Subrota') || r === '(sem subrota)'), `nível 2: ${subrotas}`);
  await foto('26-rota-subrota');
  await pagina.goto(`${base}#/carteira?aba=acompanhamento&visao=lista&dataDe=2026-10-01&dataAte=2026-10-09`);
  await telaPronta();
  assert.match(await pagina.locator('.chips').innerText(), /Último registro de 01\/10\/2026 até 09\/10\/2026/);
  assert.equal(await umaLinha(), 1, 'filtros do acompanhamento numa linha só');
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await telaPronta();
  const ordem = await pagina.locator('.status-cartao b').allInnerTexts();
  assert.deepEqual(ordem, ['Aguardando cadastro', 'Análise financeira', 'Aguardando pedido', 'Venda realizada', 'Sem interesse', 'Inválido (baixado)']);
  await foto('27-acompanhamento');

  // perfis: o administrador cria "Supervisor regional" (só Início e Lista) e atribui ao 1º supervisor
  const supPerfil = await pagina.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { bancoApp } = await import(`./js/db.js${v}`);
    return (await (await bancoApp()).execute("SELECT login FROM usuarios WHERE perfil = 'supervisor' ORDER BY login LIMIT 1")).rows[0].login;
  });
  await pagina.goto(`${base}#/admin/usuarios`);
  await telaPronta();
  await pagina.click('#botao-perfis');
  await pagina.waitForSelector('h1:text("Perfis e telas de acesso")');
  assert.equal(await pagina.locator('.lista-perfis .perfil').count(), 5, 'os 5 perfis do sistema');
  await pagina.click('#novo-perfil-botao');
  await pagina.fill('#perfil-nome', 'Supervisor regional');
  await pagina.selectOption('#perfil-base', 'supervisor');
  assert.ok(await pagina.locator('#form-perfil input[data-tela="credito"]').isDisabled(), 'crédito não serve para supervisor');
  await pagina.uncheck('#form-perfil input[data-tela="acompanhamento"]');
  await pagina.uncheck('#form-perfil input[data-tela="registrar"]');
  await foto('29-perfil-novo');
  await pagina.click('#form-perfil button:text("Incluir perfil")');
  await pagina.waitForSelector('.lista-perfis .perfil[data-perfil="Supervisor regional"]');
  await foto('30-perfis');
  await pagina.click('a:text("Voltar aos usuários")');
  await telaPronta();
  await pagina.locator(`select[data-perfil-usuario="${supPerfil}"]`).selectOption({ label: 'Supervisor regional' });
  await pagina.waitForSelector(`text=perfil Supervisor regional`);
  // administrador/gerente/financeiro trocam de perfil entre si; a lista não tem mais a coluna Prospects
  const opcoesGerente = await pagina.locator('select[data-perfil-usuario="gerente"] option').allInnerTexts();
  assert.ok(opcoesGerente.includes('Analista financeiro') && opcoesGerente.includes('Administrador'), `opções: ${opcoesGerente}`);
  assert.equal(await pagina.locator('th:text-is("Prospects")').count(), 0);
  // perfis que não servem aparecem desabilitados, com o motivo (ex.: Supervisor regional no gerente)
  assert.ok(await pagina.locator('select[data-perfil-usuario="gerente"] option:has-text("Supervisor regional")').isDisabled());
  await foto('31-usuarios-perfil');
  await pagina.click('.menu-sair');
  await entrar(supPerfil);
  await pagina.waitForSelector('h1:text("Sua equipe")');
  const menuSup = await pagina.locator('#menu a').allInnerTexts();
  assert.ok(menuSup.some((t) => t.includes('Lista principal')) && !menuSup.some((t) => t.includes('Acompanhamento')), `menu: ${menuSup}`);
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await pagina.waitForSelector('text=Seu perfil não tem acesso a esta tela.');
  await pagina.click('.menu-sair');
  await entrar('admin');
  await pagina.waitForSelector('.painel-web');

  // outros perfis com a senha de exemplo
  await pagina.click('.menu-sair');
  await entrar('gerente');
  await pagina.waitForSelector('#painel-supervisor');
  await pagina.click('.menu-sair');
  await entrar('financeiro');
  await pagina.waitForSelector('h1:text("Console de crédito")');
  assert.ok(await pagina.locator('table tbody tr').count() >= 0);
  assert.equal(await pagina.locator('.barra-console .visoes').count(), 0, 'sem abas: os cards são o filtro');
  const topoConsole = await pagina.locator('.barra-console > *').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
  assert.equal(topoConsole, 1, 'cards e busca numa linha');
  await pagina.click('.filtrantes [data-filtro="liberados"]');
  await pagina.waitForFunction(() => location.hash.includes('aba=liberados'));
  await telaPronta();
  assert.ok(await pagina.locator('.filtrantes [data-filtro="liberados"].ativo').count());
  await pagina.click('.filtrantes [data-filtro="analise"]');
  await telaPronta();
  await foto('24-exemplo-console');
  await pagina.click('a:text("Liberar crédito") >> nth=0');
  await pagina.waitForSelector('h1:text("Liberar crédito")');
  const topos = await pagina.locator('.opcoes-resultado.em-linha .opcao').evaluateAll((els) => els.map((el) => [Math.round(el.getBoundingClientRect().top), el.getBoundingClientRect().height]));
  assert.equal(new Set(topos.map((t) => t[0])).size, 1, 'formas de pagamento lado a lado');
  assert.ok(topos.every((t) => t[1] < 70), `sem quebra de linha nos cards: ${topos}`);
  await foto('28-exemplo-liberar');
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
