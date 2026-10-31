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

  // tela única, como o Explorar carteira: filtros em cascata, níveis, números e pedidos seguem o ramo; nada volta ao banco
  await ir('#/pedidos');
  await pagina.waitForSelector('#analise-pedidos');
  await pagina.waitForSelector('.exp-linha.raiz.escolhida');
  await foto('p6-explorar');
  const colunas = await pagina.locator('#analise-pedidos .exp-linha').evaluateAll((ls) => ls.map((l) => [...l.children].filter((c) => c.classList.contains('num')).map((c) => Math.round(c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2))));
  for (const l of colunas) assert.deepEqual(l, colunas[0], 'os números ficam sob os títulos das colunas');
  assert.equal(await pagina.locator('#menu a[title="Explorar pedidos"]').count(), 1, 'a tela se chama Explorar pedidos');
  assert.equal(await pagina.locator('button[data-aba]').count(), 0, 'sem abas');
  const vendaDe = () => pagina.locator('#analise-numeros .ped-kpi.destaque b').innerText();
  assert.match(await vendaDe(), /1\.580,00/);
  assert.ok(await pagina.locator('#analise-pedidos .exp-nivel[draggable="true"]').count() >= 3, 'níveis arrastáveis');
  assert.equal(await pagina.locator('#pedidos-do-ramo tbody tr').count(), 6, 'todo pedido de cliente da base, qualquer que seja a situação');
  // como no Explorar carteira: sem listas de filtro; quem filtra é a hierarquia, e os números seguem o ramo
  assert.equal(await pagina.locator('#analise-pedidos select, #filtros-pedidos select').count(), 0, 'sem listas de filtro');
  const titulos = await pagina.locator('#analise-pedidos .exp-linha.cab span').allInnerTexts();
  assert.ok(titulos.some((t) => /^invest\. \(r\$\)$/i.test(t)) && titulos.some((t) => /^pr[oó]prio \(r\$\)$/i.test(t)) && titulos.some((t) => /^outro \(r\$\)$/i.test(t)), `rótulos: ${titulos}`);
  const disponiveis = await pagina.locator('#analise-pedidos .exp-nivel.livre').evaluateAll((els) => { const z = els[0].parentElement.getBoundingClientRect(); return els.every((e) => e.getBoundingClientRect().right <= z.right + 1); });
  assert.ok(disponiveis, 'todos os níveis disponíveis ficam à vista');
  // filtro na mesma linha da chave Empresa ou Grupo
  const caixaChave = await pagina.locator('.ped-chave:has(#ver-grupo)').boundingBox();
  const caixaFiltro = await pagina.locator('#filtros-pedidos').boundingBox();
  assert.ok(caixaFiltro.y < caixaChave.y + caixaChave.height && caixaChave.y < caixaFiltro.y + caixaFiltro.height, 'na mesma linha da chave');
  await pagina.click('#tipo-investimento');
  assert.equal(await pagina.locator('#pedidos-do-ramo tbody tr').count(), 1, 'só bonificação');
  assert.match(await vendaDe(), /R\$\s?0,00/, 'bonificação não é venda');
  await pagina.click('#tipo-venda');
  assert.equal(await pagina.locator('#pedidos-do-ramo tbody tr').count(), 5, 'só pedidos de venda');
  await pagina.click('#tipo-ambos');
  assert.equal(await pagina.locator('#varios-sim').count(), 0, 'sem o filtro de mais de um representante');
  // a lista diz de qual linha são os pedidos; a busca procura só nela, sem perder o foco ao digitar
  assert.match(await pagina.locator('#titulo-pedidos').innerText(), /^Todos os pedidos \(6\)$/);
  await pagina.locator('#busca-pedidos').pressSequentially('70005');
  assert.equal(await pagina.inputValue('#busca-pedidos'), '70005');
  assert.equal(await pagina.locator('#pedidos-do-ramo tbody tr').count(), 1);
  assert.match(await vendaDe(), /1\.580,00/, 'a busca não muda os números de cima');
  await pagina.fill('#busca-pedidos', '');
  // níveis: incluir e tirar; ramo escolhido
  await pagina.locator('#analise-pedidos .exp-nivel[data-livre="situacao"]').click();
  assert.equal(await pagina.locator('#analise-pedidos .exp-nivel[data-nivel="situacao"]').count(), 1, 'incluir nível com um clique');
  await pagina.locator('#analise-pedidos .exp-nivel[data-nivel="situacao"] .tirar').click();
  await pagina.locator('#analise-pedidos .exp-linha:not(.cab):not(.raiz)').first().click();
  await pagina.waitForSelector('.exp-caminho button.atual');
  await pagina.locator('#analise-pedidos .exp-linha.raiz').click();
  // chave: por grupo, as empresas da mesma raiz ficam numa linha que abre (A e a loja 2)
  await pagina.click('#ver-grupo');
  await pagina.waitForSelector('#pedidos-do-ramo .ped-grupo .abre-grupo');
  assert.equal(await pagina.locator('#pedidos-do-ramo .ped-grupo').count(), 1, 'um grupo: o cliente A e a loja 2');
  await pagina.click('.ped-grupo .abre-grupo');
  await pagina.waitForSelector('.ped-grupo .abre-grupo[aria-expanded="true"]');
  assert.equal(await pagina.locator('#pedidos-do-ramo tbody tr').count(), 8, 'o grupo aberto, com os 5 pedidos (inclusive o da filial fora da base), e os 2 sem grupo');
  assert.match(await vendaDe(), /1\.660,00/, 'Ver por Grupo soma a filial fora da base');
  assert.ok(await pagina.locator('#pedidos-do-ramo .selo', { hasText: 'Filial do grupo' }).count() === 1);
  await foto('p6c-explorar-grupo');
  await pagina.click('#ver-empresa');
  // alertas numa faixa, que abre ao clicar
  await pagina.click('#faixa-alertas');
  await pagina.waitForSelector('#tabela-alertas');
  await foto('p9-alertas');
  assert.match(await texto(), /Rep\. sem código/);
  assert.doesNotMatch(await texto(), /Venda fora da lista/, 'venda por outro representante não é alerta');

  // o logo leva à página inicial: Explorar carteira, não o Início antigo
  await pagina.click('a.marca');
  await pagina.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === '#/explorar');

  // Acompanhamento: o fluxo do cadastro ao faturado, a hierarquia, a cascata e o crédito
  await ir('#/carteira?aba=acompanhamento');
  await pagina.waitForSelector('#acf-fluxo');
  assert.equal(await pagina.locator('#acompanhamento select').count(), 0, 'sem listas de filtro');
  const nEtapa = async (id) => Number((await pagina.locator(`#etapa-${id} b`).innerText()).replace(/\./g, ''));
  assert.ok((await nEtapa('faturado')) + (await nEtapa('carteira')) >= 1, 'as vendas aparecem no fluxo');
  assert.equal(await nEtapa('cadastro'), (await nEtapa('analise')) + (await nEtapa('pedido')) + (await nEtapa('carteira')) + (await nEtapa('faturado')));
  // cards numa linha, sem quebra
  const topos = await pagina.locator('#acf-fluxo .acf-etapa').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  assert.ok(topos.every((t) => t === topos[0]), 'todos os cards na mesma linha');
  const cortados = await pagina.locator('#acf-fluxo .acf-etapa').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => [e.id, e.scrollWidth, e.clientWidth, e.innerText]));
  assert.deepEqual(cortados, [], 'card sem texto cortado');
  // pedido sem registro de cadastro: aviso e etapa própria, com os pedidos guardados
  if (await pagina.locator('#etapa-sem_cadastro:not([hidden])').count()) {
    assert.match(await pagina.locator('#aviso-sem-cadastro').innerText(), /sem registro de cadastro.*não precisam ser importados de novo/s);
    await pagina.click('#etapa-sem_cadastro');
    await pagina.waitForSelector('#grid-acomp');
    await foto('p9a-acompanhamento-sem-cadastro');
  }
  const etapaVenda = (await nEtapa('faturado')) ? 'faturado' : 'carteira';
  await pagina.click(`#etapa-${etapaVenda}`);
  await pagina.waitForSelector('#grid-acomp');
  const nPrimeiro = await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count();
  const clientesFaturado = await nEtapa(etapaVenda);
  await foto('p9b-acompanhamento');
  await pagina.click('#todos-pedidos');
  assert.ok((await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count()) >= nPrimeiro, 'todos os pedidos: mais ou igual');
  assert.equal(await nEtapa(etapaVenda), clientesFaturado, 'o número de clientes não muda');
  await pagina.click('#so-primeiro');
  // recolher e reexibir
  const cab = pagina.locator('#grid-acomp tr.ped-grupo button').first();
  await cab.click();
  assert.ok((await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count()) < nPrimeiro, 'recolheu a cascata');
  await pagina.locator('#grid-acomp tr.ped-grupo button').first().click();
  assert.equal(await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count(), nPrimeiro, 'reexibiu');
  await pagina.click('#recolher-tudo');
  assert.equal(await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count(), 0);
  await pagina.click('#reexibir-tudo');
  assert.equal(await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count(), nPrimeiro);
  // a hierarquia: abrir e clicar numa linha restringe os cards
  await pagina.locator('#acompanhamento .exp-linha.raiz').waitFor();
  const linhasNivel = pagina.locator('#acompanhamento .exp-linha:not(.cab):not(.raiz)');
  assert.ok((await linhasNivel.count()) >= 1, 'abre o primeiro nível');
  await linhasNivel.first().locator('.nome').click();
  await pagina.waitForFunction(() => document.querySelector('#acompanhamento .exp-linha.escolhida:not(.raiz)'));
  await pagina.locator('#acompanhamento .exp-caminho button').first().click();
  // encerrados só são lidos ao clicar
  await pagina.click('#etapa-encerrados');
  await pagina.waitForFunction(() => document.getElementById('titulo-acomp')?.textContent.startsWith('Encerrados'));
  await pagina.click('#etapa-pedido');
  // crédito × pedido: forma e prazo centralizados, sem listas
  await pagina.click('#visao-credito');
  await pagina.waitForSelector('#acf-credito');
  await pagina.click('#todos-pedidos');
  await foto('p9c-acompanhamento-credito');
  const nCred = async (id) => Number(await pagina.locator(`#credito-${id} b`).innerText());
  assert.equal(await nCred('todos'), (await nCred('dentro')) + (await nCred('acima')) + (await nCred('sem_limite')));
  await pagina.click('#visao-fluxo');
  await pagina.click('#ver-grupo');
  await pagina.waitForSelector('#acf-fluxo');
  await foto('p9d-acompanhamento-grupo');
  await pagina.click('#ver-empresa');
  // ajuda: botão ? em toda tela, painel, fluxograma, capítulos e PDF
  await ir('#/carteira?aba=acompanhamento');
  await pagina.click('#botao-ajuda');
  await pagina.waitForSelector('#painel-ajuda:not([hidden])');
  assert.match(await pagina.locator('#painel-ajuda h2').innerText(), /Ajuda: Acompanhamento/);
  await pagina.click('.ajuda-secao[data-secao="campos"]');
  assert.match(await pagina.locator('#painel-ajuda').innerText(), /Cadastros realizados/);
  await foto('p10a-botao-ajuda');
  await ir('#/pedidos');
  assert.match(await pagina.locator('#painel-ajuda h2').innerText(), /Ajuda: Explorar pedidos/, 'a ajuda acompanha a tela');
  await pagina.click('#fechar-ajuda');
  assert.equal(await pagina.locator('#painel-ajuda').isVisible(), false);
  await ir('#/ajuda');
  await pagina.waitForSelector('#fluxograma');
  assert.equal(await pagina.locator('#fluxograma .ajf-passo').count(), 8);
  // a sequência: as etapas numeradas, e a seta da 1ª linha chega ao início da 2ª, na etapa 5
  assert.deepEqual((await pagina.locator('#fluxograma .ajf-passo b').allInnerTexts()).map((t) => t.split('.')[0]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  const caixaVolta = await pagina.locator('.ajf-volta').boundingBox();
  const caixa5 = await pagina.locator('.ajf-passo[data-etapa="analise"]').boundingBox();
  const caixa4 = await pagina.locator('.ajf-passo[data-etapa="aguardando"]').boundingBox();
  assert.ok(caixaVolta.x > caixa5.x && caixaVolta.x < caixa5.x + caixa5.width, 'a seta chega à etapa 5');
  const fimVolta = caixaVolta.x + caixaVolta.width;
  assert.ok(fimVolta > caixa4.x && fimVolta < caixa4.x + caixa4.width, 'a seta sai da etapa 4');
  await pagina.click('#fluxograma .ajf-passo[data-etapa="analise"]');
  assert.match(await pagina.locator('#detalhe-etapa').innerText(), /Analista financeiro/);
  await foto('p10b-ajuda');
  const [manual] = await Promise.all([pagina.waitForEvent('download'), pagina.click('#pdf-manual')]);
  assert.match(manual.suggestedFilename(), /^manual-germani-.*\.pdf$/);
  if (FOTOS) await manual.saveAs(path.join(FOTOS, 'manual.pdf'));
  await pagina.click('#ler-capitulo');
  await pagina.waitForSelector('#capitulo-ajuda');
  assert.match(await pagina.locator('#capitulo-ajuda h1').innerText(), /^5\. Crédito/);
  await foto('p10c-capitulo');
  const [capPdf] = await Promise.all([pagina.waitForEvent('download'), pagina.click('#pdf-capitulo')]);
  assert.match(capPdf.suggestedFilename(), /^manual-capitulo-5-.*\.pdf$/);
  // no celular: a ajuda em tela cheia e o fluxo de cima para baixo, sem rolagem lateral
  await pagina.setViewportSize({ width: 390, height: 844 });
  await ir('#/ajuda');
  await pagina.waitForSelector('#fluxograma');
  const largCel = await pagina.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(largCel[0] <= largCel[1], `Ajuda mais larga que o celular: ${largCel}`);
  await foto('p10d-ajuda-celular');
  await pagina.click('#botao-ajuda');
  const painelCel = await pagina.locator('#painel-ajuda').boundingBox();
  assert.equal(Math.round(painelCel.width), 390, 'ajuda em tela cheia');
  await foto('p10e-botao-ajuda-celular');
  await pagina.click('#fechar-ajuda');
  await pagina.setViewportSize({ width: 1360, height: 900 });
  // imagem de um capítulo aparece e tem conteúdo
  await ir('#/ajuda?cap=4');
  await pagina.waitForSelector('.ajf-figura img');
  await pagina.waitForFunction(() => { const i = document.querySelector('.ajf-figura img'); i.loading = 'eager'; return i.complete && i.naturalWidth > 0; });
  await foto('p10f-capitulo-com-imagem');

  // imagens do manual, com dados fictícios: IMAGENS_AJUDA=web/img/ajuda npm run test:telas
  if (process.env.IMAGENS_AJUDA) {
    const limpa = await pagina.addStyleTag({ content: '#faixa-demo, .aviso { display: none !important; }' });
    await pagina.setViewportSize({ width: 1360, height: 1200 });
    const imagem = async (nome, { inteira = false, altura = 760 } = {}) => {
      await pagina.evaluate(() => { document.activeElement?.blur?.(); scrollTo(0, 0); });
      const c = await pagina.locator('#conteudo').boundingBox();
      const clip = inteira ? undefined : { x: c.x, y: c.y, width: c.width, height: Math.min(c.height, altura) };
      await pagina.screenshot({ path: path.join(process.env.IMAGENS_AJUDA, `${nome}.jpg`), type: 'jpeg', quality: 72, clip });
    };
    await ir('#/explorar');
    await imagem('explorar-carteira');
    await pagina.setViewportSize({ width: 1360, height: 760 });
    await imagem('menu', { inteira: true });
    await pagina.setViewportSize({ width: 1360, height: 1200 });
    await ir('#/carteira');
    await pagina.selectOption('#filtro-supervisor', { index: 1 });
    await pagina.selectOption('#filtro-vendedor', { index: 1 });
    await pagina.click('#aplicar-filtros');
    await pagina.waitForSelector('.lista-tabela tbody tr');
    await imagem('lista-principal');
    await pagina.locator('a.registrar').first().click();
    await pagina.waitForSelector('h1:text("Registrar atendimento")');
    await imagem('registrar');
    await ir('#/carteira?aba=acompanhamento');
    await pagina.waitForSelector('#acf-fluxo');
    await pagina.click('#etapa-analise');
    await pagina.click('#so-primeiro');
    await imagem('acompanhamento', { altura: 1100 });
    await pagina.click('#visao-credito');
    await pagina.waitForSelector('#acf-credito');
    await pagina.click('#todos-pedidos');
    await imagem('credito-pedido', { altura: 1100 });
    await pagina.click('#visao-fluxo');
    await pagina.click('#so-primeiro');
    // no celular: desenha a tela já na largura do celular, e espera o menu terminar de fechar
    await pagina.setViewportSize({ width: 390, height: 780 });
    await ir('#/pedidos');
    await ir('#/carteira?aba=acompanhamento');
    await pagina.waitForSelector('#acf-fluxo');
    await pagina.waitForTimeout(500);
    await imagem('acompanhamento-celular', { inteira: true });
    await pagina.setViewportSize({ width: 1360, height: 1200 });
    await ir('#/pedidos');
    await imagem('explorar-pedidos');
    await ir('#/financeiro');
    await imagem('console-credito');
    await ir('#/admin/importacoes');
    await imagem('importacoes');
    await ir('#/admin/usuarios');
    await imagem('usuarios');
    await limpa.evaluate((e) => e.remove());
    await pagina.setViewportSize({ width: 1360, height: 900 });
  }

  // a Lista principal não ganhou a chave
  await ir('#/carteira');
  assert.equal(await pagina.locator('#ver-grupo').count(), 0, 'Lista principal não muda');
  await ir('#/explorar');
  assert.equal(await pagina.locator('#ver-grupo').count(), 0, 'Explorar carteira não muda');

  await ir('#/pedidos');
  await pagina.waitForSelector('#pedidos-do-ramo');

  // ficha do cliente com pedidos
  await pagina.locator('#pedidos-do-ramo tbody tr', { hasText: '70001' }).locator('a').click();
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
