// Importação de pedidos pela tela, com dados fictícios: etapas, abas, ficha e apagar o arquivo. npm run test:telas
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from '../scripts/servir.mjs';
import { lerPlanilha } from '../lib/planilha.mjs';
import { analisarCnpj, calcularDv } from '../shared/cnpj.mjs';

const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FOTOS = process.env.FOTOS_TELAS ?? null;
let srv, navegador, pagina, base, tmp;

before(async () => {
  srv = await servir(0);
  base = `http://localhost:${srv.address().port}/`;
  navegador = await chromium.launch({ executablePath: CHROME });
  pagina = await navegador.newPage({ viewport: { width: 1360, height: 900 } });
  pagina.on('pageerror', (e) => console.error('erro na página:', e.message));
  tmp = await mkdtemp(path.join(os.tmpdir(), 'pedidos-'));
});
after(async () => { await navegador?.close(); srv?.close(); });

const foto = async (nome) => { if (FOTOS) await pagina.screenshot({ path: path.join(FOTOS, `${nome}.png`), fullPage: true }); };
const texto = () => pagina.locator('main').innerText();
const ir = async (destino) => { await pagina.evaluate((d) => { location.hash = d; }, destino); await pagina.waitForFunction((d) => document.getElementById('conteudo').dataset.pronto === d, destino); };
const alinhamento = (seletor) => pagina.locator(seletor).evaluate((el) => getComputedStyle(el).textAlign);

/** .xls BIFF2 como o do Senior. */
function xls(linhas) {
  const partes = [Buffer.from([0x09, 0, 4, 0, 0, 0, 0x10, 0])];
  linhas.forEach((l, i) => l.forEach((v, j) => {
    const ini = Buffer.alloc(7); ini.writeUInt16LE(i, 0); ini.writeUInt16LE(j, 2);
    if (typeof v === 'number') { const n = Buffer.alloc(8); n.writeDoubleLE(v, 0); const c = Buffer.alloc(4); c.writeUInt16LE(3, 0); c.writeUInt16LE(15, 2); partes.push(c, ini, n); }
    else { const t = Buffer.from(String(v), 'latin1'); const c = Buffer.alloc(4); c.writeUInt16LE(4, 0); c.writeUInt16LE(8 + t.length, 2); partes.push(c, ini, Buffer.from([t.length]), t); }
  }));
  partes.push(Buffer.from([0x0a, 0, 0, 0]));
  return Buffer.concat(partes);
}
const CAB = ['Cliente', 'Razão Social', 'CPF / CNPJ', 'Vlr. Pedido', 'Vlr. Faturado', 'Pedido', 'Sit.', 'Situação', 'Transação', 'Desc. Trans.', 'Rep.'];

test('importa, acompanha e apaga o arquivo de pedidos pela tela', { timeout: 240000 }, async () => {
  await pagina.goto(base);
  await pagina.waitForSelector('#login');
  await pagina.fill('#login', 'admin');
  await pagina.fill('#senha', 'demo1234');
  await pagina.click('button[type=submit]');
  await pagina.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === '#/explorar');
  await ir('#/inicio');
  await pagina.click('#carregar-exemplo');
  await pagina.waitForSelector('text=Dados de exemplo carregados', { timeout: 120000 });

  // clientes fictícios ainda não vendidos da base de exemplo
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const cnpjs = linhas.slice(1).map((l) => analisarCnpj(l[0])).filter((c) => !c.erro).map((c) => c.cnpj);
  const [a, b, c] = cnpjs.slice(100, 103);
  const filialDe = (ordem) => { const b = a.slice(0, 8) + ordem; return b + calcularDv(b); };
  const filial = filialDe('0777');          // fora da base: só na visão do grupo
  const naBase = filialDe('0888');          // na base: forma um grupo com o cliente A
  await pagina.evaluate(async ([novo, origem]) => {
    // o mesmo módulo da tela (o site carrega com a versão no endereço): a base de exemplo não tem empresas da mesma raiz
    const { bancoAdmin } = await import(performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/js\/db\.js/.test(n)));
    const db = await bancoAdmin();
    await db.execute({ sql: `INSERT INTO prospects (cnpj, cnpj_raiz, razao_social, cidade, cidade_busca, uf, busca, vendedor_id, dt_entrada_base)
      SELECT ?, cnpj_raiz, razao_social, cidade, cidade_busca, uf, busca, vendedor_id, dt_entrada_base FROM prospects WHERE cnpj = ?`, args: [novo, origem] });
  }, [naBase, a]);
  const arquivo = path.join(tmp, 'pedidos_teste.xlsx.XLS');
  await writeFile(arquivo, xls([CAB,
    [901, 'CLIENTE A', a, 1000, 1000, 70001, 4, 'Liquidado', '90100', 'Pedido de Venda', 9001],
    [901, 'CLIENTE A', a, 500, 0, 70002, 1, 'Aberto Total', '90100', 'Pedido de Venda', 9002],
    [901, 'CLIENTE A', a, 50, 50, 70003, 4, 'Liquidado', '90106', 'Pedido de Bonificação', 9001],
    [902, 'CLIENTE B', b, 300, 0, 70004, 9, 'Não Fechado', '90100', 'Pedido de Venda', 9002],
    [903, 'CLIENTE C', c, 200, 0, 70005, 5, 'Desistência', '90100', 'Pedido de Venda', 9001],
    [906, 'CLIENTE A FILIAL', filial, 80, 0, 70008, 1, 'Aberto Total', '90100', 'Pedido de Venda', 9001],
    [907, 'CLIENTE A LOJA 2', naBase, 80, 0, 70009, 1, 'Aberto Total', '90100', 'Pedido de Venda', 9002],
    [904, 'FORA DA BASE', '11222333000181', 400, 0, 70006, 1, 'Aberto Total', '90100', 'Pedido de Venda', 9001],
    [905, 'PESSOA', '12345678909', 100, 0, 70007, 1, 'Aberto Total', '90100', 'Pedido de Venda', 9002],
  ]));

  await ir('#/admin/importar/erp');
  await pagina.click('#importar-pedidos');
  await pagina.waitForSelector('#arquivo-pedidos');
  await pagina.setInputFiles('#arquivo-pedidos', arquivo);
  await pagina.fill('#data-arquivo', '2026-10-31');
  await foto('p1-arquivo');
  await pagina.click('#ler-pedidos');
  await pagina.waitForSelector('#ir-classificar');
  assert.match(await texto(), /Fora da base e CPF \(ignorados\)/);
  await foto('p1b-conferencia');
  await pagina.click('#ir-classificar');
  await pagina.waitForSelector('#ir-vincular');
  await foto('p2-classificacao');
  // colunas alinhadas nas duas tabelas e "Conta como" centralizado
  const larguras = await pagina.locator('table.ped-fixa').evaluateAll((ts) => ts.map((t) => [...t.tHead.rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().width))));
  assert.deepEqual(larguras[0], larguras[1], 'mesmas larguras em Transação e Situação');
  assert.equal(await alinhamento('table.ped-fixa tbody td:nth-child(5) >> nth=0'), 'center');
  await pagina.click('#ir-vincular');
  await pagina.waitForSelector('#ir-simular');
  await foto('p3-vinculo');
  assert.equal(await pagina.locator('#clientes-arquivo tbody tr').count(), 5, 'os 4 da base e a filial do grupo; fora da base e CPF não entram');
  assert.equal(await alinhamento('#clientes-arquivo tbody td:nth-child(1) >> nth=0'), 'left', 'razão social à esquerda');
  assert.equal(await alinhamento('#clientes-arquivo tbody td:nth-child(5) >> nth=0'), 'center', 'número centralizado');
  assert.equal(await alinhamento('#clientes-arquivo thead th:nth-child(1)'), 'center', 'rótulo centralizado');
  await pagina.click('#ir-simular');
  await pagina.waitForSelector('#gravar-pedidos');
  await foto('p4-simulacao');
  const simulado = await texto();
  assert.match(simulado, /Aguardando pedido válido/);
  assert.match(simulado, /R\$\s?1\.580,00/, 'venda válida só dos clientes da base');
  assert.match(simulado, /sem código no cadastro/);
  await pagina.click('#gravar-pedidos');
  await pagina.waitForSelector('text=concluída');
  await foto('p5-gravado');

  // análise: abre direto, como o Explorar carteira; os números seguem o ramo escolhido e nada volta ao banco
  await ir('#/pedidos');
  await pagina.waitForSelector('#analise-pedidos');
  await pagina.waitForSelector('.exp-linha.raiz.escolhida');
  await foto('p5b-analise');
  const vendaDe = () => pagina.locator('#analise-numeros .ped-kpi.destaque b').innerText();
  assert.match(await vendaDe(), /1\.580,00/);
  assert.ok(await pagina.locator('#analise-pedidos .exp-nivel[draggable="true"]').count() >= 3, 'níveis arrastáveis');
  const ramos = pagina.locator('#analise-pedidos .exp-linha:not(.cab):not(.raiz)');
  await ramos.first().click();
  await pagina.waitForSelector('.exp-caminho button.atual');
  await pagina.locator('#analise-pedidos .exp-nivel[data-livre="situacao"]').click();
  assert.equal(await pagina.locator('#analise-pedidos .exp-nivel[data-nivel="situacao"]').count(), 1, 'incluir nível com um clique');
  await pagina.locator('#analise-pedidos .exp-nivel[data-nivel="situacao"] .tirar').click();
  await pagina.locator('#analise-pedidos .exp-nivel[data-nivel="supervisor"] .tirar').click();
  await pagina.locator('#analise-pedidos .exp-nivel[data-nivel="representante"] .tirar').click();
  await pagina.locator('#analise-pedidos .exp-linha.raiz').click();
  await pagina.waitForSelector('#pedidos-do-ramo tbody tr');
  await foto('p5c-analise-ramo');
  assert.equal(await pagina.locator('#pedidos-do-ramo tbody tr').count(), 6, 'pedidos do ramo escolhido');
  await pagina.click('button[data-aba="pedidos"]');
  await pagina.waitForSelector('#lista-pedidos');
  await foto('p6-pedidos');
  assert.ok(await pagina.locator('#menu a[title="Explorar pedidos"]').count() === 1, 'a tela se chama Explorar pedidos');
  // chave: por grupo, as empresas da mesma raiz ficam numa linha que abre (A e a filial)
  await pagina.click('#ver-grupo');
  await pagina.waitForSelector('.ped-grupo .abre-grupo');
  await foto('p6b-pedidos-grupo');
  assert.equal(await pagina.locator('#lista-pedidos .ped-grupo').count(), 1, 'um grupo: o cliente A e a loja 2');
  await pagina.click('.ped-grupo .abre-grupo');
  await pagina.waitForSelector('.ped-grupo .abre-grupo[aria-expanded="true"]');
  assert.equal(await pagina.locator('#lista-pedidos tbody tr').count(), 7, 'o grupo aberto, com os 4 pedidos, e os 2 sem grupo');
  await foto('p6c-pedidos-grupo-aberto');
  await pagina.click('button[data-aba="analise"]');
  await pagina.waitForSelector('#analise-pedidos');
  await foto('p6d-analise-grupo');
  await pagina.click('button[data-aba="representantes"]');
  await pagina.waitForSelector('#tabela-representantes');
  await pagina.click('button[data-aba="pedidos"]');
  await pagina.waitForSelector('#lista-pedidos');
  await pagina.click('#ver-empresa');

  assert.equal(await pagina.locator('#lista-pedidos tbody tr').count(), 6, 'todo pedido de cliente da base, qualquer que seja a situação');
  const umaLinha = await pagina.locator('.ped-kpi').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  assert.equal(umaLinha, 1, 'cards numa linha só');
  await pagina.click('button[data-aba="representantes"]');
  await pagina.waitForSelector('#tabela-representantes');
  await foto('p7-representantes');
  assert.match(await texto(), /9001 · sem cadastro/);
  assert.match(await texto(), /distintos/);
  await pagina.click('button[data-aba="bonificacao"]');
  await pagina.waitForSelector('#tabela-bonificacao');
  await foto('p8-bonificacao');
  await pagina.click('button[data-aba="alertas"]');
  await pagina.waitForSelector('#tabela-alertas');
  await foto('p9-alertas');
  assert.match(await texto(), /Rep\. sem código/);
  assert.doesNotMatch(await texto(), /Venda fora da lista/, 'venda por outro representante não é alerta');

  // Acompanhamento: em andamento e encerrados; a venda não aparece; a chave também vale aqui
  await ir('#/carteira?aba=acompanhamento&periodo=periodo&dataDe=2000-01-01&dataAte=2099-12-31&q=FICT&busca=FICT&ver=1');
  await pagina.waitForSelector('.lista-situacao');
  await pagina.waitForFunction(() => document.querySelector('.chip-situacao[data-conjunto="andamento"]'));
  assert.equal(await pagina.locator('.chip-situacao[data-status="venda_realizada"]').count(), 0, 'venda não está no Acompanhamento');
  assert.ok(await pagina.locator('.chip-situacao[data-status="aguardando_pedido_valido"]').count() >= 1, 'aguardando pedido válido está');
  assert.equal(await pagina.locator('.chip-situacao[data-status="invalido"]').count(), 0, 'encerrado fica no outro filtro');
  await foto('p9b-acompanhamento');
  await pagina.click('.chip-situacao[data-conjunto="encerrados"]');
  assert.ok(await pagina.locator('.chip-situacao[data-status^="sem_interesse"]').count() >= 1, 'sem interesse em Encerrados');
  assert.equal(await pagina.locator('.chip-situacao[data-status="aguardando_cadastro"]').count(), 0);
  await pagina.click('.chip-situacao[data-conjunto="andamento"]');
  await pagina.click('#ver-grupo');
  await foto('p9c-acompanhamento-grupo');
  await pagina.click('#ver-empresa');
  // a Lista principal não ganhou a chave
  await ir('#/carteira');
  assert.equal(await pagina.locator('#ver-grupo').count(), 0, 'Lista principal não muda');
  await ir('#/explorar');
  assert.equal(await pagina.locator('#ver-grupo').count(), 0, 'Explorar carteira não muda');

  await ir('#/pedidos');
  await pagina.waitForSelector('button[data-aba="pedidos"]');

  // ficha do cliente com pedidos
  await pagina.click('button[data-aba="pedidos"]');
  await pagina.waitForSelector('#lista-pedidos');
  await pagina.locator('#lista-pedidos tbody tr', { hasText: '70001' }).locator('a').click();
  await pagina.waitForSelector('#pedidos-cliente');
  await pagina.waitForSelector('#pedidos-grupo >> text=Filiais fora da base');
  await foto('p10-ficha');

  // apagar: tira os dados e volta os status
  await ir('#/admin/importacoes');
  await pagina.waitForSelector('#arquivos-pedidos');
  await foto('p11-importacoes');
  await pagina.locator('#arquivos-pedidos a[data-apagar]').click();
  await pagina.waitForSelector('#confirma-arquivo');
  await foto('p12-apagar');
  assert.ok(await pagina.isDisabled('#apagar-arquivo'), 'só depois de digitar o nome do arquivo');
  await pagina.fill('#confirma-arquivo', 'pedidos_teste.xlsx.XLS');
  await pagina.click('#apagar-arquivo');
  await pagina.waitForSelector('#arquivos-pedidos');
  await pagina.waitForSelector('text=Apagada em');
  await ir('#/pedidos');
  await pagina.waitForFunction(() => /Nenhum pedido importado ainda/.test(document.querySelector('main').innerText));
});
