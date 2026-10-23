// Modo demonstração com os dados de exemplo: Início nas 3 visualizações, filtro por período e os outros perfis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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
// a página inicial é o Explorar carteira; os testes do Início entram nele pelo menu
const irAoInicio = async () => {
  await pagina.waitForFunction(() => ['#/explorar', '#/inicio'].includes(document.getElementById('conteudo').dataset.pronto));
  if (await pagina.evaluate(() => location.hash) === '#/explorar') await pagina.click('#menu a[title="Início"]');
};
const entrar = async (login) => {
  await pagina.fill('#login', login);
  await pagina.fill('#senha', 'demo1234');
  await pagina.click('button[type=submit]');
};

test('dados de exemplo: Início preenchido nas 3 visualizações, com período, e os outros perfis', { timeout: 180000 }, async () => {
  await pagina.goto(base);
  await pagina.waitForSelector('#login');
  await entrar('admin');
  await pagina.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === '#/explorar');   // página inicial
  await pagina.click('#menu a[title="Início"]');
  await pagina.waitForSelector('#carregar-exemplo');
  assert.equal(await pagina.locator('script[src*="exceljs"]').count(), 0, 'a biblioteca de planilha não carrega na abertura do site');
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

  // lista principal no computador: sempre em tabela, filtros em grupos; a gestão escolhe a equipe antes de ler
  await pagina.goto(`${base}#/carteira`);
  await telaPronta();
  await pagina.waitForSelector('#lista-falta');
  assert.equal(await pagina.locator('.lista-tabela').count(), 0, 'nada lido antes da equipe');
  assert.equal(await pagina.locator('#filtro-periodo').count(), 0, 'Lista principal não tem período');
  assert.equal(await pagina.locator('#filtro-bairro').count(), 0, 'bairro só com a cidade');
  assert.equal(await pagina.locator('.cartao-prospect, #filtro-visao, .exibicao').count(), 0, 'sem cards e sem visões no computador');
  await pagina.selectOption('#filtro-supervisor', { index: 1 });
  // escolher um filtro não lê nada: só o botão Buscar aplica
  assert.ok(!(await pagina.evaluate(() => location.hash)).includes('supervisorId='), 'o filtro só vale no Buscar');
  assert.equal(await pagina.locator('#lista-falta').count(), 1);
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('supervisorId='));
  await telaPronta();
  await pagina.waitForSelector('#lista-falta');                            // Lista: o representante também é obrigatório
  assert.equal(await pagina.locator('.lista-tabela').count(), 0);
  assert.equal(await pagina.locator('#agrupar option[value=representante]').count(), 0, 'sem agrupar por representante');
  await pagina.selectOption('#filtro-vendedor', { index: 1 });
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('vendedorId='));
  await telaPronta();
  await pagina.waitForSelector('.lista-tabela tbody tr');
  const situacoes = await pagina.locator('.chip-situacao').evaluateAll((els) => els.map((el) => el.dataset.status));
  assert.equal(situacoes[0], 'todos');
  assert.ok(situacoes.slice(1).every((x) => ['nao_contactado', 'em_prospeccao'].includes(x)), `situações: ${situacoes}`);
  assert.equal(await pagina.locator('#carregar-mais').count(), 0, 'a lista vem inteira (sem páginas de 50)');
  // situação, ordem e grupos mudam no navegador, sem nova leitura (o endereço não muda)
  const enderecoAntes = await pagina.evaluate(() => location.hash);
  const totalLinhas = await pagina.locator('.lista-tabela tbody tr').count();
  await pagina.click('.chip-situacao[data-status="nao_contactado"]');
  assert.ok((await pagina.locator('.lista-tabela tbody tr').count()) <= totalLinhas);
  await pagina.click('.chip-situacao[data-status="todos"]');
  await pagina.click('.lista-tabela th button[data-ordem="prospect"]');
  const nomesAsc = await pagina.locator('.lista-tabela tbody a.nome').allInnerTexts();
  assert.deepEqual(nomesAsc, [...nomesAsc].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })));
  await pagina.click('.lista-tabela th button[data-ordem="prospect"]');
  assert.match(await pagina.locator('.lista-tabela th button.ativa').innerText(), /▼/);
  // agrupar por cidade (na linha dos filtros): grupos recolhidos, um clique abre
  await pagina.selectOption('#agrupar', 'cidade');
  const gruposCidade = await pagina.locator('.lista-tabela .linha-grupo').allInnerTexts();
  assert.ok(gruposCidade.length >= 1 && new Set(gruposCidade).size === gruposCidade.length, `grupos: ${gruposCidade}`);
  assert.equal(await pagina.locator('.lista-tabela tbody tr:not(.linha-grupo)').count(), 0, 'grupos começam recolhidos');
  await pagina.click('.lista-tabela .abre-grupo >> nth=0');
  assert.ok(await pagina.locator('.lista-tabela tbody tr:not(.linha-grupo)').count() > 0, 'o clique abre o grupo');
  assert.equal(await pagina.evaluate(() => location.hash), enderecoAntes, 'nada disso voltou ao banco');
  // relatório em PDF (jsPDF, carregado só agora): baixa um PDF da lista como está na tela, com o representante no nome
  assert.equal(await pagina.locator('script[src*="jspdf"]').count(), 0, 'a biblioteca de PDF só carrega ao gerar');
  const [baixado] = await Promise.all([pagina.waitForEvent('download'), pagina.click('#imprimir-lista')]);
  assert.match(baixado.suggestedFilename(), /^lista-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = await readFile(await baixado.path());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 20000, 'PDF com o logotipo e a tabela');
  // filtro por onda (coluna 4: marca, prospect, cidade, onda)
  await pagina.selectOption('#agrupar', '');
  await pagina.selectOption('#filtro-onda', { index: 1 });
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('onda='));
  await telaPronta();
  const onda = (await pagina.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('onda')));
  assert.ok((await pagina.locator('.lista-tabela tbody tr:not(.linha-grupo) td:nth-child(4)').allInnerTexts()).every((t) => t === onda));
  assert.equal(await pagina.locator('#agrupar option[value=bairro]').count(), 0, 'agrupar por bairro só com a cidade');
  await pagina.selectOption('#filtro-cidade', { index: 1 });
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('cidadeBusca='));
  await telaPronta();
  assert.equal(await pagina.locator('#filtro-bairro').count(), 1, 'com a cidade aparece o bairro');
  assert.equal(await pagina.locator('#agrupar option[value=bairro]').count(), 1);
  await foto('25-lista-tabela');

  // Explorar carteira: árvore sobre o resumo, níveis arrastáveis, lista só de um ramo
  await pagina.goto(`${base}#/explorar`);
  await telaPronta();
  await pagina.waitForSelector('.exp-linha.raiz');
  assert.equal(await pagina.locator('#abrir-lista').count(), 0, 'sem abrir a base inteira');
  assert.equal(await pagina.locator('.exp-linha.raiz .abre').getAttribute('aria-expanded'), 'true', 'a raiz já vem aberta');
  const supervisores = await pagina.locator('.exp-linha:not(.raiz):not(.cab)').count();
  assert.ok(supervisores >= 2, `supervisores: ${supervisores}`);
  await pagina.click('.exp-linha:not(.raiz):not(.cab) b.num >> nth=0');         // clicar em qualquer parte da linha escolhe e abre
  assert.ok(await pagina.locator('.exp-linha:not(.raiz):not(.cab)').count() > supervisores, 'abriu os representantes');
  // da totalidade: 5 partes (sem interesse do cliente e do representante separados) que somam o total do ramo; dos contactados: as 4 etapas do processo
  const partesTotal = await pagina.locator('#grafico-totalidade .exp-legenda b').allInnerTexts();
  const totalRamo = Number((await pagina.locator('#grafico-totalidade .exp-total b').innerText()).replace(/\./g, ''));
  assert.equal(partesTotal.length, 5);
  assert.equal(partesTotal.reduce((t, x) => t + Number(x.replace(/\./g, '')), 0), totalRamo, 'as 5 partes somam o total');
  assert.equal(await pagina.locator('#grafico-contactados .exp-etapa').count(), 4);
  assert.equal(await pagina.locator('.exp-linha.cab span').count(), 12, 'colunas: ramo, prospects, contactados, cobertura, sem interesse do cliente e do representante, 3 etapas, pedido realizado, R$');
  await pagina.locator('.exp-nivel[data-nivel="cidade"]').dragTo(pagina.locator('.exp-nivel[data-nivel="supervisor"]'));
  assert.match(await pagina.locator('.exp-niveis .exp-nivel >> nth=0').innerText(), /Cidade/, 'arrastou Cidade para o 1º nível');
  await pagina.click('.exp-linha:not(.raiz):not(.cab) .nome >> nth=0');
  await foto('33-explorar');
  // níveis e disponíveis numa linha; caminho fora do topo, abaixo dos níveis, numa linha; botão da lista baixo
  const alturas = await pagina.evaluate(() => {
    const linhas = (sel) => new Set([...document.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().top))).size;
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { niveis: linhas('.exp-niveis .exp-nivel'), caminho: linhas('.exp-caminho button'), noTopo: document.querySelectorAll('.exp-topo .exp-caminho').length,
      abaixo: r('.exp-caminho').top >= r('.exp-niveis').bottom, botao: r('#abrir-lista').height };
  });
  assert.deepEqual({ niveis: alturas.niveis, caminho: alturas.caminho, noTopo: alturas.noTopo, abaixo: alturas.abaixo }, { niveis: 1, caminho: 1, noTopo: 0, abaixo: true });
  assert.ok(alturas.botao <= 34, `botão Abrir na Lista: ${alturas.botao}px`);
  const total = (await pagina.locator('#abrir-lista').innerText()).match(/· ([\d.]+) prospects/)[1];
  await pagina.click('#abrir-lista');
  await pagina.waitForFunction(() => location.hash.includes('cidadeBusca='));
  await telaPronta();
  // o ramo foi só a cidade: a lista abre com ela escolhida e já lida — vinda do Explorar, o ramo dispensa a equipe
  assert.notEqual(await pagina.locator('#filtro-cidade').inputValue(), '', 'a lista abre com a cidade do ramo');
  assert.match(await pagina.evaluate(() => location.hash), /de=explorar/);
  await pagina.waitForSelector('.lista-tabela tbody tr');
  assert.equal(await pagina.locator('#lista-falta').count(), 0);
  assert.ok(Number(total.replace(/\./g, '')) > 0);
  // Acompanhamento: equipe e período obrigatórios; situações na ordem do processo
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await telaPronta();
  await pagina.waitForSelector('#lista-falta');
  assert.equal(await pagina.locator('#filtro-periodo').count(), 1);
  assert.equal(await pagina.locator('#agrupar').count(), 0, 'sem agrupar no Acompanhamento');
  assert.ok((await pagina.locator('#filtro-supervisor option').count()) > 1, 'equipes para escolher mesmo com o Acompanhamento vazio');
  await pagina.selectOption('#filtro-supervisor', { index: 1 });
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('supervisorId='));
  await telaPronta();
  assert.equal(await pagina.locator('#filtro-periodo').inputValue(), 'mes', 'o período já vem em Este mês');
  await pagina.waitForSelector('.lista-tabela tbody tr, .mensagem');     // equipe escolhida + mês atual: já lê
  await pagina.selectOption('#filtro-periodo', 'periodo');
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('periodo=periodo'));
  await telaPronta();
  assert.equal(await pagina.locator('#filtro-data-de').count(), 1, 'período abre as datas');
  await pagina.selectOption('#filtro-periodo', 'mes');
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('periodo=mes'));
  await telaPronta();
  await pagina.waitForSelector('.lista-tabela tbody tr');
  const ordem = await pagina.locator('.chip-situacao').evaluateAll((els) => els.slice(1).map((el) => el.dataset.status));
  const processo = ['aguardando_cadastro', 'analise_financeira', 'aguardando_pedido', 'venda_realizada', 'sem_interesse:cliente', 'sem_interesse:representante', 'invalido'];
  assert.ok(ordem.length >= 2 && ordem.every((x, i) => i === 0 || processo.indexOf(x) > processo.indexOf(ordem[i - 1])), `ordem: ${ordem}`);
  // filtros em cascata: escolher a cidade deixa só os representantes dela
  const opcoesDe = (id) => pagina.locator(`#${id} option`).evaluateAll((os) => os.slice(1).map((o) => o.value));
  const repsTodos = await opcoesDe('filtro-vendedor');
  assert.ok((await opcoesDe('filtro-uf')).length >= 1, 'UF separada da cidade');
  await pagina.selectOption('#filtro-cidade', { index: 1 });
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('cidadeBusca='));
  await telaPronta();
  const repsCidade = await opcoesDe('filtro-vendedor');
  assert.ok(repsCidade.length >= 1 && repsCidade.length <= repsTodos.length && repsCidade.every((v) => repsTodos.includes(v)), 'representantes só da cidade');
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
  await irAoInicio();
  await pagina.waitForSelector('h1:text("Sua equipe")');
  const menuSup = await pagina.locator('#menu a').allInnerTexts();
  assert.ok(menuSup.some((t) => t.includes('Lista principal')) && !menuSup.some((t) => t.includes('Acompanhamento')), `menu: ${menuSup}`);
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await pagina.waitForSelector('text=Seu perfil não tem acesso a esta tela.');
  await pagina.click('.menu-sair');
  await entrar('admin');
  await irAoInicio();
  await pagina.waitForSelector('.painel-web');

  // outros perfis com a senha de exemplo
  await pagina.click('.menu-sair');
  await entrar('gerente');
  await irAoInicio();
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
  await irAoInicio();
  await pagina.waitForSelector('h1:text("Sua equipe")');
  assert.equal(await pagina.locator('#painel-supervisor').count(), 0);
});
