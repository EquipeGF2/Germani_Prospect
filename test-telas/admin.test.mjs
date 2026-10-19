// Teste das telas no navegador (modo demonstração): npm run test:telas
// Usa o Chromium instalado (PLAYWRIGHT_BROWSERS_PATH ou CHROMIUM_PATH). Não roda no CI padrão.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from '../scripts/servir.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { analisarCnpj } from '../shared/cnpj.mjs';

const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FOTOS = process.env.FOTOS_TELAS ?? null;
let srv, navegador, pagina, base, tmp;

before(async () => {
  srv = await servir(0);
  base = `http://localhost:${srv.address().port}/`;
  navegador = await chromium.launch({ executablePath: CHROME });
  pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
  pagina.on('pageerror', (e) => console.error('erro na página:', e.message));
  tmp = await mkdtemp(path.join(os.tmpdir(), 'telas-'));
});
after(async () => { await navegador?.close(); srv?.close(); });

async function foto(nome) { if (FOTOS) await pagina.screenshot({ path: path.join(FOTOS, `${nome}.png`), fullPage: true }); }
const texto = () => pagina.locator('main').innerText();

test('administrador faz a carga e libera a equipe, tudo pela tela', { timeout: 180000 }, async () => {
  await pagina.goto(base);
  await pagina.waitForSelector('#login');
  await foto('01-entrar');
  await pagina.fill('#login', 'admin');
  await pagina.fill('#senha', 'errada1');
  await pagina.click('button[type=submit]');
  await pagina.waitForSelector('.aviso.erro');
  await pagina.fill('#senha', 'demo1234');
  await pagina.click('button[type=submit]');
  await pagina.waitForSelector('h1:text("Administração")');
  await foto('02-admin');

  // 1. base de prospects
  await pagina.click('a:text("Base de prospects")');
  await pagina.setInputFiles('#arquivo-base', 'exemplos/base-ficticia.xlsx');
  await pagina.click('button:text("Ler arquivo")');
  await pagina.waitForSelector('text=Como tratar cada valor');
  await foto('03-base-status');
  await pagina.click('button:text("Simular importação")');
  await pagina.waitForSelector('text=Resultado da simulação', { timeout: 60000 });
  assert.match(await texto(), /120 prospects novos/);
  await foto('04-base-simulacao');
  await pagina.click('button:text("Confirmar e gravar")');
  await pagina.waitForSelector('text=Importação nº 1 concluída', { timeout: 60000 });
  await foto('05-base-gravada');

  // 2. representantes / vendedores
  const tipos = path.join(tmp, 'tipos.csv');
  await writeFile(tipos, 'COD;NOME;TIPO\n1101;Bruno;Representante\n1102;Carla;REP\n1201;Érica;Vendedor\n1202;Fábio;vendedor interno\n9999;Ninguém;Vendedor\n');
  await pagina.click('a:text("Representantes / vendedores")');
  await pagina.setInputFiles('#arquivo-tipos', tipos);
  await pagina.click('button:text("Ler arquivo")');
  await pagina.click('button:text("Simular")');
  await pagina.waitForSelector('text=Resultado da simulação');
  await pagina.click('button:text("Confirmar e gravar")');
  await pagina.waitForSelector('text=Importação nº 2');
  assert.match(await texto(), /não cadastrado/); // 9999 rejeitado, com motivo
  await foto('06-tipos');

  // 3. usuários: liberar acesso do vendedor 1201
  await pagina.click('a:text("Usuários")');
  await pagina.fill('input[aria-label=Buscar]', '1201');
  await pagina.click('button:text("Liberar acesso")');
  await pagina.waitForSelector('.senha-gerada');
  const senhaVendedor = (await pagina.locator('.senha-gerada').innerText()).trim();
  assert.match(senhaVendedor, /^[A-Za-z0-9]{10}$/);
  await foto('07-usuarios-senha');
  await pagina.fill('#novo-login', 'analista');
  await pagina.fill('#novo-nome', 'Analista Financeiro Teste');
  await pagina.click('button:text("Criar usuário")');
  await pagina.waitForSelector('text=Senha provisória de analista');

  // 4. arquivo de cadastro do ERP (2 CNPJs da base + 1 de fora)
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const cnpjs = linhas.slice(1, 3).map((l) => analisarCnpj(l[0]).cnpj);
  const cadastro = path.join(tmp, 'cadastro.csv');
  await writeFile(cadastro, `CNPJ;Data Cadastro;Codigo\n${cnpjs[0]};15/10/2026;C1\n${cnpjs[1]};16/10/2026;C2\n11222333000181;16/10/2026;C3\n`);
  await pagina.click('a:text("Cadastro · Pedidos · Baixados")');
  await pagina.selectOption('#tipo-erp', 'cadastro');
  await pagina.setInputFiles('#arquivo-erp', cadastro);
  await pagina.click('button:text("Ler arquivo")');
  await pagina.selectOption('#col-data', 'Data Cadastro');
  await pagina.selectOption('#col-doc', 'Codigo');
  await pagina.click('button:text("Simular")');
  await pagina.waitForSelector('text=Resultado da simulação');
  await pagina.click('button:text("Confirmar e gravar")');
  await pagina.waitForSelector('text=2 movimento(s) gravado(s)');
  await foto('08-cadastro-erp');

  // 4b. relatório de crédito: o 1º cadastrado (análise financeira) + o 3º da base (sem cadastro ainda)
  const cnpj3 = analisarCnpj(linhas[3][0]).cnpj;
  const credito = path.join(tmp, 'credito.csv');
  await writeFile(credito, `CNPJ;Cód interno;Razão social;Forma de pagamento;Prazo de pagamento;Limite de crédito CNPJ;Limite de crédito grupo;Data de cadastro\n${cnpjs[0]};C1;X;BOLETO;28;15.000,00;50.000,00;15/10/2026\n${cnpj3};C9;Y;Pix;0;;;16/10/2026\n`);
  await pagina.click('a:text("Relatório de crédito")');
  await pagina.setInputFiles('#arquivo-credito', credito);
  await pagina.click('button:text("Ler arquivo")');
  await pagina.waitForSelector('text=Como tratar cada forma de pagamento');
  await pagina.selectOption('select[aria-label="forma Pix"]', 'a_vista');
  await pagina.click('button:text("Simular")');
  await pagina.waitForSelector('text=Resultado da simulação');
  assert.match(await texto(), /2 liberação\(ões\) de crédito, 1 com cadastro registrado pelo relatório/);
  await pagina.click('button:text("Confirmar e gravar")');
  await pagina.waitForSelector('text=passaram para Aguardando pedido');
  await foto('08b-credito');

  // 5. parâmetros
  await pagina.click('a:text("Parâmetros")');
  await pagina.fill('input[aria-label=prazo_cadastro_dias]', '20');
  await pagina.locator('tr', { has: pagina.locator('input[aria-label=prazo_cadastro_dias]') }).locator('button').click();
  await pagina.waitForSelector('text=Parâmetro salvo.');
  assert.equal(await pagina.inputValue('input[aria-label=prazo_cadastro_dias]'), '20');

  // 6. histórico de importações
  await pagina.click('a:text("Importações")');
  await pagina.waitForSelector('table');
  assert.match(await texto(), /Cadastro \(ERP\)/);
  await pagina.click('a:text("Ver linhas") >> nth=0');
  await pagina.waitForSelector('text=Importação nº 4'); // a mais recente: relatório de crédito
  await foto('09-importacoes');

  // 7. vendedor entra com a senha gerada (mesmo banco: a sessão do demo continua na página)
  await pagina.click('button:text("Sair")');
  await pagina.waitForSelector('#login');
  await pagina.fill('#login', '1201');
  await pagina.fill('#senha', senhaVendedor);
  await pagina.click('button:text("Entrar")');
  await pagina.waitForSelector('text=Olá, Representante');
  assert.match(await pagina.locator('#usuario-topo').innerText(), /Vendedor/);
  await pagina.goto(`${base}#/admin/usuarios`);
  await pagina.waitForSelector('text=exclusiva do administrador');
});

test('telas cabem no celular (sem rolagem horizontal da página)', async () => {
  const cel = await navegador.newPage({ viewport: { width: 375, height: 740 } });
  await cel.goto(base);
  await cel.waitForSelector('#login');
  const larguras = await cel.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(larguras[0] <= larguras[1], `página mais larga que a tela: ${larguras}`);
  if (FOTOS) await cel.screenshot({ path: path.join(FOTOS, '10-celular-entrar.png') });
  await cel.close();
});
