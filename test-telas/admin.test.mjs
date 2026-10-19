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
  await pagina.click('#menu a[title="Base de prospects"]');
  await pagina.setInputFiles('#arquivo-base', 'exemplos/base-ficticia.xlsx');
  await pagina.click('button:text("Ler arquivo")');
  await pagina.waitForSelector('text=Datas de contato da planilha');
  assert.ok(await pagina.isChecked('#considerar-datas'), 'planilha com datas: considera por padrão');
  await foto('03a-base-datas');
  await pagina.click('#continuar-datas');
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
  await pagina.click('#menu a[title="Representantes / vendedores"]');
  await pagina.setInputFiles('#arquivo-tipos', tipos);
  await pagina.click('button:text("Ler arquivo")');
  await pagina.click('button:text("Simular")');
  await pagina.waitForSelector('text=Resultado da simulação');
  await pagina.click('button:text("Confirmar e gravar")');
  await pagina.waitForSelector('text=Importação nº 2');
  assert.match(await texto(), /não cadastrado/); // 9999 rejeitado, com motivo
  await foto('06-tipos');

  // 3. usuários: liberar acesso do vendedor 1201
  await pagina.click('#menu a[title="Usuários"]');
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
  await pagina.click('#menu a[title="Cadastro · Pedidos · Baixados"]');
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
  await pagina.click('#menu a[title="Relatório de crédito"]');
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
  await pagina.click('#menu a[title="Parâmetros"]');
  await pagina.fill('input[aria-label=prazo_cadastro_dias]', '20');
  await pagina.locator('tr', { has: pagina.locator('input[aria-label=prazo_cadastro_dias]') }).locator('button').click();
  await pagina.waitForSelector('text=Parâmetro salvo.');
  assert.equal(await pagina.inputValue('input[aria-label=prazo_cadastro_dias]'), '20');

  // 6. histórico de importações
  await pagina.click('#menu a[title="Importações"]');
  await pagina.waitForSelector('h1:text-is("Importações")');               // a tela de parâmetros também tem tabela
  await pagina.waitForSelector('td:has-text("Cadastro (ERP)")');
  await pagina.click('a:text("Ver linhas") >> nth=0');
  await pagina.waitForSelector('text=Importação nº 4'); // a mais recente: relatório de crédito
  await foto('09-importacoes');

  // 7. vendedor entra com a senha gerada (mesmo banco: a sessão do demo continua na página)
  await pagina.click('.menu-sair');
  await pagina.waitForSelector('#login');
  await pagina.fill('#login', '1201');
  await pagina.fill('#senha', senhaVendedor);
  await pagina.click('button:text("Entrar")');
  await pagina.waitForSelector('text=Olá, Representante');
  assert.match(await pagina.locator('#usuario-lateral').innerText(), /Vendedor/);
  assert.equal(await pagina.locator('#menu a[title="Base de prospects"]').count(), 0, 'vendedor não vê o menu de administração');
  await pagina.goto(`${base}#/admin/usuarios`);
  await pagina.waitForSelector('text=exclusiva do administrador');

  // 8. lista principal do vendedor (com visão por rota) → ficha → registrar atendido
  await pagina.goto(`${base}#/inicio`);
  await pagina.waitForSelector('text=na lista principal');
  await foto('10b-inicio-vendedor');
  await pagina.click('#menu a[title="Lista principal"]');
  await pagina.waitForSelector('.cartao-prospect');
  assert.ok(await pagina.locator('.visoes a:text("Rota")').count(), 'vendedor tem visão por rota');
  await foto('11-lista-principal');
  const primeiro = (await pagina.locator('.cartao-prospect-corpo b').first().innerText()).trim();
  await pagina.fill('#busca', primeiro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  await pagina.click('button:text("Buscar")');
  await pagina.waitForFunction(() => location.hash.includes('busca='));
  await pagina.waitForSelector('.cartao-prospect');
  assert.ok((await pagina.locator('.cartao-prospect').count()) >= 1, 'busca sem acento encontra o prospect');
  await pagina.click('.cartao-prospect-corpo >> nth=0');
  await pagina.waitForSelector('text=Histórico de movimentação');
  await pagina.click('a:text("Registrar atendimento")');
  await pagina.waitForSelector('text=Não atendeu? Não precisa registrar.');
  await pagina.click('label.opcao:has-text("Sem interesse")');
  await pagina.click('button:text("Gravar registro")');
  await pagina.waitForSelector('text=motivo obrigatório');                // validação antes de enviar
  await pagina.click('label.opcao:has-text("Atendido")');
  await foto('12-registrar');
  await pagina.click('button:text("Gravar registro")');
  await pagina.waitForSelector('text=Atendido registrado.');
  await pagina.waitForSelector('text=Histórico de movimentação');
  assert.match(await texto(), /Aguardando cadastro · atendido em \d{2}\/\d{2}\/\d{4}/);
  assert.match(await texto(), /→ Aguardando cadastro/);                  // linha do tempo mostra o movimento
  await foto('13-ficha');
  const cnpjAtendido = (await pagina.locator('.dado:has(span:text-is("CNPJ")) b').innerText()).replace(/\D/g, '');

  // 9. o atendido saiu da lista principal; "sem interesse" em lote para 2 prospects
  await pagina.goto(`${base}#/carteira`);
  await pagina.waitForSelector('.cartao-prospect');
  await pagina.fill('#busca', cnpjAtendido);
  await pagina.click('button:text("Buscar")');
  await pagina.waitForSelector(`text=Nada encontrado para "${cnpjAtendido}"`);   // atendido saiu da lista principal
  await pagina.goto(`${base}#/carteira`);
  await pagina.waitForSelector('.cartao-prospect');
  await pagina.check('.cartao-prospect input[type=checkbox] >> nth=0');
  await pagina.check('.cartao-prospect input[type=checkbox] >> nth=1');
  await pagina.waitForSelector('text=2 selecionado(s)');
  await pagina.click('a:text("Sem interesse em lote")');
  await pagina.waitForSelector('text=Gravar 2 registro(s)');
  await pagina.selectOption('#motivo-lote', { label: 'Preço acima do praticado' });
  await pagina.locator('.lote-item select').nth(1).selectOption({ label: 'Já tem fornecedor / contrato' });
  await foto('14-lote');
  await pagina.click('button:text("Gravar 2 registro(s)")');
  await pagina.waitForSelector('text=Lote gravado');
  assert.match(await texto(), /2\s+gravados/);

  // 10. acompanhamento por status → lista dos sem interesse → ficha com o motivo individual
  await pagina.click('#menu a[title="Acompanhamento"]');
  await pagina.waitForSelector('.status-cartao');
  await foto('15-acompanhamento');
  await pagina.click('.status-cartao:has-text("Sem interesse")');
  await pagina.waitForSelector('.cartao-prospect');
  assert.equal(await pagina.locator('.cartao-prospect').count(), 2);
  await pagina.click('.cartao-prospect-corpo >> nth=0');
  await pagina.waitForSelector('text=Histórico de movimentação');
  assert.match(await texto(), /(Preço acima do praticado|Já tem fornecedor)/);
  assert.ok(await pagina.locator('a:text("Registrar atendimento")').count(), 'sem interesse pode ser reaberto');
  await pagina.click('a:text("Registrar atendimento")');
  await pagina.waitForSelector('label.opcao:has-text("pedido identificado")');

  // 11. menu lateral: recolher e expandir (a preferência fica no navegador)
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await pagina.waitForSelector('.status-cartao');
  assert.equal(await pagina.locator('#menu a.ativo').innerText(), 'Acompanhamento');
  await pagina.click('#botao-menu');
  await pagina.waitForSelector('#casca.recolhido');
  await pagina.waitForFunction(() => document.getElementById('lateral').getBoundingClientRect().width < 100); // só os ícones (após a animação)
  await foto('17-menu-recolhido');
  await pagina.click('#botao-menu');
  await pagina.waitForSelector('#casca:not(.recolhido)');
});

test('telas cabem no celular (sem rolagem horizontal da página)', async () => {
  const cel = await navegador.newPage({ viewport: { width: 375, height: 740 } });
  await cel.goto(base);
  await cel.waitForSelector('#login');
  const larguras = await cel.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(larguras[0] <= larguras[1], `página mais larga que a tela: ${larguras}`);
  if (FOTOS) await cel.screenshot({ path: path.join(FOTOS, '10-celular-entrar.png') });
  // a carteira cabe no celular (o administrador vê tudo; a base de demonstração é carregada na mesma página)
  await cel.fill('#login', 'admin');
  await cel.fill('#senha', 'demo1234');
  await cel.click('button[type=submit]');
  await cel.waitForSelector('h1:text("Administração")');
  for (const tela of ['#/inicio', '#/admin/usuarios', '#/carteira', '#/carteira?aba=acompanhamento', '#/carteira?visao=cidade']) {
    await cel.goto(`${base}${tela}`);
    await cel.waitForSelector('h1');
    const [larg, vis] = await cel.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(larg <= vis, `${tela} mais larga que a tela: ${larg} > ${vis}`);
  }
  if (FOTOS) await cel.screenshot({ path: path.join(FOTOS, '16-celular-carteira.png'), fullPage: true });
  // no celular o menu é uma gaveta: abre pelo botão e fecha ao escolher a tela
  assert.ok((await cel.locator('#lateral').boundingBox()).x < 0, 'menu fechado fora da tela');
  await cel.click('#botao-menu');
  await cel.waitForSelector('#casca.gaveta-aberta');
  await cel.waitForFunction(() => document.getElementById('lateral').getBoundingClientRect().x >= 0); // fim da animação
  if (FOTOS) await cel.screenshot({ path: path.join(FOTOS, '18-celular-gaveta.png') });
  await cel.click('#menu a[title="Usuários"]');
  await cel.waitForSelector('#casca:not(.gaveta-aberta)');
  await cel.close();
});
