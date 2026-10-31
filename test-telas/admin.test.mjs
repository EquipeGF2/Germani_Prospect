// Teste das telas no navegador (modo demonstração): npm run test:telas
// Usa o Chromium instalado (PLAYWRIGHT_BROWSERS_PATH ou CHROMIUM_PATH). Não roda no CI padrão.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
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
// espera a tela do endereço atual terminar de desenhar (o roteador marca main[data-pronto])
const telaPronta = () => pagina.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === location.hash);

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
  // página inicial = Explorar carteira; o Início saiu do menu (só pelo endereço)
  await pagina.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === '#/explorar');
  assert.equal(await pagina.locator('#menu a[title="Início"]').count(), 0, 'Início fora do menu (os números estão no Explorar)');
  await pagina.evaluate(() => { location.hash = '#/inicio'; });
  await pagina.waitForSelector('.painel-web');
  assert.equal(await pagina.locator('#menu a[title="Visão geral"]').count(), 0);
  await foto('02-inicio-vazio');

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
  assert.equal(await pagina.locator('#menu a[title="Representantes / vendedores"]').count(), 0, 'cadastro de representantes é em Usuários');
  await pagina.evaluate(() => { location.hash = '#/admin/importar/tipos'; });
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
  // padronizar logins: mostra o que muda (supervisor pelo primeiro nome) e só grava no botão
  await pagina.click('#botao-padronizar');
  await pagina.waitForSelector('#painel-logins');
  const novos = await pagina.locator('#painel-logins tbody tr td:nth-child(5)').allInnerTexts();
  assert.ok(novos.length && novos.every((l) => !/^sup\d/.test(l)), `logins novos: ${novos}`);
  await pagina.click('#painel-logins button:text("Fechar")');
  assert.equal(await pagina.locator('#painel-logins').count(), 0);
  await pagina.fill('input[aria-label=Buscar]', '1201');
  // o administrador define a senha do vendedor (curta é recusada)
  await pagina.click('button:text("Liberar acesso")');
  await pagina.fill('.definir-senha .campo-senha', 'curta');
  await pagina.click('.definir-senha button:text("Salvar")');
  await pagina.waitForSelector('text=ao menos 8 caracteres');
  const senhaVendedor = 'vendedor-1201';
  await pagina.fill('.definir-senha .campo-senha', senhaVendedor);
  await foto('07-usuarios-senha');
  await pagina.click('.definir-senha button:text("Salvar")');
  await pagina.waitForSelector('text=Senha de 1201 definida.');
  // cards = filtro de situação
  await pagina.fill('input[aria-label=Buscar]', '');
  await pagina.click('.filtrantes [data-filtro="sem_acesso"]');
  assert.ok(await pagina.locator('.filtrantes [data-filtro="sem_acesso"].ativo').count());
  assert.equal(await pagina.locator('button:text("Definir senha")').count(), 0, 'só quem está sem acesso');
  await pagina.click('.filtrantes [data-filtro="todos"]');
  await pagina.fill('#novo-login', 'analista');
  await pagina.fill('#novo-nome', 'Analista Financeiro Teste');
  const senhaAnalista = 'analista-2026';
  await pagina.fill('#novo-senha', senhaAnalista);                       // senha definida pelo administrador
  await pagina.click('button:text("Criar usuário")');
  await pagina.waitForSelector('text=Usuário analista criado com a senha definida.');
  await pagina.selectOption('#novo-perfil', 'gerente||');
  await pagina.fill('#novo-login', 'gerente');
  await pagina.fill('#novo-nome', 'Gerente Comercial Teste');
  await pagina.click('button:text("Criar usuário")');
  await pagina.waitForSelector('text=Senha provisória de gerente');
  const senhaGerente = (await pagina.locator('.senha-gerada').last().innerText()).trim();
  // supervisor e representante criados pela tela (código do ERP; representante escolhe o supervisor)
  assert.ok(await pagina.locator('#novo-codigo').isHidden(), 'código do ERP só para supervisor/vendedor');
  await pagina.selectOption('#novo-perfil', 'supervisor||');
  await pagina.fill('#novo-login', 'supmanual');
  await pagina.fill('#novo-nome', 'Supervisor Manual');
  await pagina.fill('#novo-codigo', '990');
  await pagina.fill('#novo-senha', 'super-2026');
  await pagina.click('button:text("Criar usuário")');
  await pagina.waitForSelector('text=Usuário supmanual criado com a senha definida.');
  await pagina.selectOption('#novo-perfil', 'tipo:representante');
  await pagina.selectOption('#novo-supervisor', { label: 'Supervisor Manual · 990' });
  await pagina.fill('#novo-login', 'repmanual');
  await pagina.fill('#novo-nome', 'Representante Manual');
  await pagina.fill('#novo-codigo', '1990');
  await pagina.fill('#novo-senha', 'repre-2026');
  await pagina.click('button:text("Criar usuário")');
  await pagina.waitForSelector('text=Usuário repmanual criado com a senha definida.');
  assert.equal(await pagina.locator('select[data-perfil-usuario="repmanual"]').inputValue(), 'tipo:representante');
  await foto('32-usuarios-equipe-manual');

  // 4. arquivo de cadastro do ERP (2 CNPJs da base + 1 de fora)
  const { linhas } = await lerPlanilha('exemplos/base-ficticia.xlsx');
  const cnpjs = linhas.slice(1, 3).map((l) => analisarCnpj(l[0]).cnpj);
  const cadastro = path.join(tmp, 'cadastro.csv');
  await writeFile(cadastro, `CNPJ;Data Cadastro;Codigo\n${cnpjs[0]};15/10/2026;C1\n${cnpjs[1]};16/10/2026;C2\n11222333000181;16/10/2026;C3\n`);
  await pagina.click('#menu a[title="Pedidos · Baixados (ERP)"]');
  await pagina.waitForSelector('#importar-pedidos');
  await pagina.click('label.card-tipo[data-tipo="baixa"]');
  await pagina.click('label.card-tipo[data-tipo="cadastro"]');             // escolha por cards
  assert.ok(await pagina.isChecked('input[name="tipo-erp"][value="cadastro"]'));
  await foto('08a-erp-cards');
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
  // layout real do ERP: "Descrição" repetida, coluna sem título, CPF (ignorado), crédito 0 = sem crédito
  await writeFile(credito, `Cliente;CPF / CNPJ;Razão Social;Cond. Pgto;Descrição;Forma Pgto;Descrição;;Créd. Cliente;Créd. Grupo;Dt. Cadastro\n`
    + `C1;${cnpjs[0]};X;28B;21/28/35 DD BOLETO;1;Boleto;;15.000,00;;15/10/2026\n`
    + `C9;${cnpj3};Y;00A;A VISTA;9;Pix;;0;;16/10/2026\n`
    + `C5;12345678901;Z;00A;A VISTA;4;A vista;;0;;16/10/2026\n`);
  await pagina.click('#menu a[title="Cadastro e crédito (ERP)"]');
  await pagina.setInputFiles('#arquivo-credito', credito);
  await pagina.click('button:text("Ler arquivo")');
  await pagina.waitForSelector('text=Forma de pagamento do ERP → filtro rápido');
  await pagina.selectOption('select[aria-label="forma Pix"]', 'a_vista');
  await pagina.click('button:text("Simular")');
  await pagina.waitForSelector('text=Resultado da simulação');
  assert.match(await texto(), /2 liberação\(ões\) de crédito, 1 com cadastro registrado pelo relatório/);
  assert.match(await texto(), /O que o arquivo traz[\s\S]*CPF \(ignoradas\)\s*1/);
  // relatório em partes: aceitas e rejeitadas (ignoradas só na contagem)
  assert.ok(await pagina.isVisible('button:text("Baixar aceitas (2) · CSV")'));
  assert.ok(await pagina.isDisabled('button:text("Baixar rejeitadas (0) · CSV")'));
  const download = pagina.waitForEvent('download');
  await pagina.click('button:text("Baixar aceitas (2) · CSV")');
  const baixado = await download;
  assert.match(baixado.suggestedFilename(), /^simulacao-credito-.*-aceitas\.csv$/);
  const csv = await readFile(await baixado.path(), 'utf8');
  assert.match(csv, /Linha;Resultado;CNPJ;Data de cadastro;Mensagens/);
  assert.match(csv, /15\/10\/2026/);
  assert.match(await texto(), /1 linha\(s\) ignorada\(s\) não entram nos relatórios/);
  await foto('08a-credito-simulacao');
  await pagina.click('button:text("Confirmar e gravar")');
  await pagina.waitForSelector('text=passaram para Aguardando pedido');
  await foto('08b-credito');
  // ficha do 1º cadastrado: condição e forma como vieram do ERP; prazo limpo da descrição e médio do código
  await pagina.evaluate(() => { location.hash = '#/ficha?id=1'; });
  await telaPronta();
  assert.match(await texto(), /Cadastro e crédito no ERP[\s\S]*28B · 21\/28\/35 DD BOLETO[\s\S]*Boleto \(filtro: Boleto\)[\s\S]*21\/28\/35 dias · médio 28/);
  await foto('08c-ficha-credito-erp');
  // grupos de CNPJ: arquivo do ERP com CNPJs da base (antigos clientes) → sugestão, expurgo e desfazer
  const grupos = path.join(tmp, 'grupos.csv');
  const doGrupo = linhas.slice(10, 20).map((l) => analisarCnpj(l[0]).cnpj).filter(Boolean);
  await writeFile(grupos, 'Cliente;CPF / CNPJ;Razão Social;Dt. Cadastro\n' + doGrupo.map((c, i) => `${500 + i};${c};GRUPO ${i};14/03/2019`).join('\n') + '\n');
  await pagina.click('#menu a[title="Grupos de CNPJ"]');
  await pagina.setInputFiles('#arquivo-grupos', grupos);
  await pagina.click('button:text("Ler arquivo")');
  await pagina.waitForSelector('text=raízes em comum');
  const aplicar = pagina.locator('button', { hasText: /^Aplicar \(/ });
  const qtdExpurgo = Number(/\((\d+) expurgar/.exec(await aplicar.innerText())[1]);
  assert.ok(qtdExpurgo > 0, 'há sugestões de expurgo');
  await foto('08d-grupos-cnpj');
  await aplicar.click();
  await pagina.waitForSelector('[aria-label="Confirmar expurgo"]');
  await pagina.click(`button:text("Expurgar ${qtdExpurgo}")`);
  await pagina.waitForSelector(`text=Pronto: ${qtdExpurgo} expurgado(s)`);
  await pagina.waitForSelector('text=já expurgados');
  await pagina.click('[data-sugestao="expurgado"]');
  assert.equal(await pagina.locator('.tabela-grupos tbody tr:not(.grupo-raiz)').count(), qtdExpurgo);
  // desfazer um
  await pagina.locator('.tabela-grupos select').first().selectOption('desfazer');
  await aplicar.click();
  await pagina.locator('button', { hasText: /desfazer 1$/ }).click();
  await pagina.waitForSelector('text=1 desfeito(s)');
  // desfaz o resto (os passos seguintes contam a carteira inteira)
  for (const sel of await pagina.locator('.tabela-grupos select').all()) {
    await sel.selectOption((await sel.locator('option[value="desfazer"]').count()) ? 'desfazer' : 'manter');
  }
  await aplicar.click();
  await pagina.locator('button', { hasText: new RegExp(`^Expurgar 0 · desfazer ${qtdExpurgo - 1}$`) }).click();
  await pagina.waitForSelector(`text=${qtdExpurgo - 1} desfeito(s)`);

  // exportar a base inteira em Excel (CNPJ, razão social, cidade, UF)
  await pagina.click('#menu a[title="Base de prospects"]');
  const baixandoBase = pagina.waitForEvent('download');
  await pagina.click('#exportar-base');
  const baseXlsx = await baixandoBase;
  assert.match(baseXlsx.suggestedFilename(), /^base-prospects-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.readFile(await baseXlsx.path());
  const folha = livro.worksheets[0];
  assert.deepEqual(folha.getRow(1).values.slice(1), ['CNPJ', 'Razão social', 'Cidade', 'UF']);
  assert.ok(folha.rowCount > 100, `linhas: ${folha.rowCount}`);

  // erros do app: tela do administrador abre (lista vazia no banco de demonstração)
  await pagina.click('#menu a[title="Erros do app"]');
  await pagina.waitForSelector('text=Mais frequentes');

  // 5. parâmetros
  await pagina.click('#menu a[title="Parâmetros"]');
  await pagina.fill('input[aria-label=prazo_cadastro_dias]', '20');
  await pagina.locator('tr', { has: pagina.locator('input[aria-label=prazo_cadastro_dias]') }).locator('button').click();
  await pagina.waitForSelector('text=Parâmetro salvo.');
  assert.equal(await pagina.inputValue('input[aria-label=prazo_cadastro_dias]'), '20');

  // 5b. feriados: inclui um municipal e exclui
  await pagina.click('#menu a[title="Feriados"]');
  await pagina.waitForSelector('td:has-text("Nossa Senhora Aparecida")');   // nacionais vêm da migração
  await pagina.selectOption('#feriado-abrangencia', 'municipal');
  await pagina.fill('#feriado-data', '2026-10-15');
  await pagina.fill('#feriado-descricao', 'Feriado municipal de teste');
  await pagina.click('button:text("Incluir feriado")');
  await pagina.waitForSelector('text=informe a UF');
  await pagina.fill('#feriado-uf', 'rs');
  await pagina.fill('#feriado-cidade', 'Santa Cruz do Sul');
  await pagina.click('button:text("Incluir feriado")');
  await pagina.waitForSelector('td:has-text("Santa Cruz do Sul/RS")');
  await foto('09a-feriados');
  pagina.once('dialog', (d) => d.accept());
  await pagina.click('button[aria-label="Excluir Feriado municipal de teste"]');
  await pagina.waitForSelector('text=Feriado excluído.');
  assert.equal(await pagina.locator('td:has-text("Santa Cruz do Sul/RS")').count(), 0);

  // 5c. Início no computador (visão Executivo): 120 prospects; Arrojado mostra 2 com crédito liberado; seletor de supervisor
  await pagina.evaluate(() => { location.hash = '#/inicio'; });
  await pagina.waitForSelector('.vis-executivo');
  assert.match(await texto(), /de 120 contactados/);
  await pagina.selectOption('#painel-visao', 'arrojado');
  await pagina.waitForSelector('.vis-arrojado');
  assert.equal(await pagina.locator('.kpis-linha > div').nth(3).locator('.v').innerText(), '2');
  const opcoesSup = await pagina.locator('#painel-supervisor option').allInnerTexts();
  assert.ok(opcoesSup.length >= 3 && opcoesSup[0] === 'Todos os supervisores');
  await pagina.selectOption('#painel-supervisor', { index: 2 });
  await pagina.waitForFunction(() => document.querySelector('.kpis-linha .v')?.textContent !== '120');   // só a equipe escolhida
  await foto('09b-inicio-arrojado');
  await pagina.selectOption('#painel-visao', 'executivo');
  await pagina.waitForSelector('.vis-executivo');
  await pagina.setViewportSize({ width: 390, height: 844 });                 // celular: layout de sempre (cartões)
  await pagina.waitForSelector('.agentes-cartoes .agente');
  assert.equal(await pagina.locator('.controles-painel').count(), 0, 'no celular não há visualizações nem período');
  await pagina.waitForFunction(() => document.getElementById('lateral').getBoundingClientRect().right <= 0);   // menu recolhido (fim da animação)
  const [largura, janela] = await pagina.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(largura <= janela, `painel mais largo que o celular: ${largura}`);
  await foto('09c-inicio-celular');
  await pagina.setViewportSize({ width: 1280, height: 900 });
  await pagina.waitForSelector('.vis-executivo');

  // 5d. lista principal do administrador: filtro por supervisor e por vendedor/representante
  await pagina.click('#menu a[title="Lista principal"]');
  await pagina.waitForSelector('#filtro-supervisor');
  await pagina.waitForSelector('#lista-falta');                            // gestão: escolhe a equipe antes de ler a lista
  assert.equal(await pagina.locator('.lista-tabela tbody tr').count(), 0);
  await pagina.selectOption('#filtro-supervisor', { index: 2 });   // 2º supervisor (o 0 é "Todos")
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('supervisorId='));
  await telaPronta();
  await pagina.waitForSelector('#lista-falta');                            // Lista: falta o representante
  await pagina.waitForFunction(() => document.querySelector('#filtro-vendedor')?.options[0]?.text === 'Escolha…');
  const agentesDoSup = (await pagina.locator('#filtro-vendedor option').allInnerTexts()).slice(1);
  assert.ok(agentesDoSup.length >= 1 && agentesDoSup.every((t) => / · (Vendedor|Representante|Supervisor)/.test(t)));
  const nomeAgente = agentesDoSup[0].split(' · ')[0];
  await pagina.selectOption('#filtro-vendedor', { index: 1 });
  await pagina.click('#aplicar-filtros');
  await pagina.waitForFunction(() => location.hash.includes('vendedorId='));
  await telaPronta();
  await pagina.waitForSelector('.lista-tabela tbody tr, .mensagem');
  const cartoes = await pagina.locator('.lista-tabela tbody tr').allInnerTexts();
  // a coluna Representante sai da Lista (ele é obrigatório): a ficha ao lado mostra de quem é a carteira
  await pagina.click('.lista-tabela tbody tr td:nth-child(5) >> nth=0');
  await pagina.waitForSelector('.ficha-lateral:not([hidden])');
  assert.match(await pagina.locator('.ficha-lateral').innerText(), new RegExp(nomeAgente), 'só a carteira escolhida');
  assert.ok(cartoes.length > 0, 'filtro em cascata: só aparece representante com prospects na lista');
  await foto('09d-lista-filtros-gestao');

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
  await pagina.waitForSelector('.explorar');           // abre no Explorar, já na carteira dele
  assert.match(await pagina.locator('.exp-caminho').innerText(), /Minha carteira/, 'representante abre já na própria carteira');
  await pagina.evaluate(() => { location.hash = '#/inicio'; });
  await pagina.waitForSelector('h1:text("Sua carteira")');
  assert.equal(await pagina.locator('#painel-supervisor').count(), 0, 'vendedor não escolhe supervisor');
  await foto('10a-inicio-vendedor');
  assert.match(await pagina.locator('#usuario-lateral').innerText(), /Vendedor/);
  assert.equal(await pagina.locator('#menu a[title="Base de prospects"]').count(), 0, 'vendedor não vê o menu de administração');
  await pagina.goto(`${base}#/admin/usuarios`);
  await pagina.waitForSelector('text=exclusiva do administrador');

  // 8. lista principal do vendedor (com visão por rota) → ficha → registrar atendido
  await pagina.goto(`${base}#/inicio`);
  await pagina.waitForSelector('.painel-web');
  await foto('10b-inicio-vendedor');
  // celular: a Lista do representante espera uma cidade (ou busca) antes de ler; o Explorar não tem representante × vendedor
  await pagina.setViewportSize({ width: 390, height: 844 });
  await pagina.goto(`${base}#/carteira?visao=lista`);
  await pagina.waitForSelector('#escolher-cidade a.grupo');
  assert.equal(await pagina.locator('.cartao-prospect').count(), 0, 'nada lido antes de escolher a cidade');
  await pagina.click('#escolher-cidade a.grupo >> nth=0');
  await pagina.waitForFunction(() => location.hash.includes('cidadeBusca='));
  await pagina.waitForSelector('.cartao-prospect');
  await foto('10c-lista-celular');
  await pagina.goto(`${base}#/explorar`);
  await pagina.waitForSelector('#grafico-contactados');
  assert.equal(await pagina.locator('.exp-tipo').count(), 0, 'vendedor não escolhe representante × vendedor');
  assert.doesNotMatch(await texto(), /sem os sem interesse/);
  const [largExp, janExp] = await pagina.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(largExp <= janExp, `Explorar mais largo que o celular: ${largExp}`);
  // níveis no celular: lista com liga/desliga e setas (sem arrastar)
  assert.equal(await pagina.locator('.exp-niveis').isVisible(), false, 'no celular os níveis não são arrastáveis');
  const antes = await pagina.locator('.exp-niveis-cel .ordem').innerText();
  await pagina.click('#mudar-niveis');
  await pagina.click('.exp-niveis-cel-lista li.ligado .setas button[aria-label^="Descer"] >> nth=0');
  await pagina.waitForFunction((a) => document.querySelector('.exp-niveis-cel .ordem')?.textContent !== a, antes);
  await foto('10d-explorar-celular');
  // Acompanhamento no celular: a mesma tela, e os níveis pelo botão Mudar
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await pagina.waitForSelector('#acf-fluxo');
  await pagina.waitForSelector('#acompanhamento .exp-niveis-cel');
  const [largAc, janAc] = await pagina.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(largAc <= janAc, `Acompanhamento mais largo que o celular: ${largAc}`);
  await foto('10e-acompanhamento-celular');
  await pagina.setViewportSize({ width: 1280, height: 900 });
  await pagina.goto(`${base}#/inicio`);
  await pagina.waitForSelector('.painel-web');
  await pagina.click('#menu a[title="Lista principal"]');
  await pagina.waitForSelector('.lista-tabela tbody tr');
  assert.ok(await pagina.locator('#agrupar option[value=rota]').count(), 'vendedor agrupa por rota');
  await foto('11-lista-principal');
  const primeiro = (await pagina.locator('.lista-tabela a.nome').first().innerText()).trim();
  await pagina.fill('#busca', primeiro.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  await pagina.click('.lista-busca button[type=submit]');
  await pagina.waitForFunction(() => location.hash.includes('busca='));
  await telaPronta();
  await pagina.waitForSelector('.lista-tabela tbody tr');
  assert.ok((await pagina.locator('.lista-tabela tbody tr').count()) >= 1, 'busca sem acento encontra o prospect');
  // clicar na linha abre a ficha ao lado; o nome abre a ficha completa
  await pagina.click('.lista-tabela tbody tr td:nth-child(5) >> nth=0');
  await pagina.waitForSelector('.ficha-lateral:not([hidden]) .ficha-historico li');
  await pagina.click('.lista-tabela a.nome >> nth=0');
  await pagina.waitForSelector('text=Histórico de movimentação');
  await pagina.click('a:text("Registrar atendimento")');
  await pagina.waitForSelector('text=Não atendeu? Não precisa registrar.');
  await pagina.click('label.opcao:has-text("Sem interesse")');
  await pagina.click('button:text("Gravar registro")');
  await pagina.waitForSelector('text=motivo obrigatório');                // validação antes de enviar
  assert.equal(await pagina.locator('label[for="observacao"]').innerText(), 'Observação');   // opcional por padrão
  await pagina.selectOption('#motivo', { label: 'Outro (descrever na observação)' });
  assert.equal(await pagina.locator('label[for="observacao"]').innerText(), 'Observação *');  // obrigatória: sem interesse + "Outro"
  assert.equal(await pagina.getAttribute('#observacao', 'placeholder'), 'Obrigatória: descreva o motivo');
  await pagina.click('label.opcao:has-text("Atendido")');
  assert.equal(await pagina.getAttribute('#observacao', 'placeholder'), 'Opcional');
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
  await pagina.waitForSelector('.lista-tabela tbody tr');
  await pagina.fill('#busca', cnpjAtendido);
  await pagina.click('.lista-busca button[type=submit]');
  await pagina.waitForSelector(`text=Nada encontrado para "${cnpjAtendido}"`);   // atendido saiu da lista principal
  await pagina.goto(`${base}#/carteira`);
  await pagina.waitForSelector('.lista-tabela tbody tr');
  await pagina.check('.lista-tabela input[data-lote] >> nth=0');
  await pagina.check('.lista-tabela input[data-lote] >> nth=1');
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
  await pagina.waitForSelector('#acf-fluxo');                             // lê a própria carteira, sem pedir filtro
  await foto('15-acompanhamento');
  await pagina.click('#etapa-encerrados');                                // sem interesse fica em Encerrados, e pode ser reaberto; só é lido ao clicar
  await pagina.waitForSelector('#grid-acomp');
  assert.equal(await pagina.locator('#grid-acomp tbody tr:not(.ped-grupo)').count(), 2);
  await pagina.click('#grid-acomp td.rz a >> nth=0');
  await pagina.waitForSelector('text=Histórico de movimentação');
  assert.match(await texto(), /(Preço acima do praticado|Já tem fornecedor)/);
  assert.ok(await pagina.locator('a:text("Registrar atendimento")').count(), 'sem interesse pode ser reaberto');
  await pagina.click('a:text("Registrar atendimento")');
  await pagina.waitForSelector('label.opcao:has-text("pedido identificado")');

  // 11. menu lateral: recolher e expandir (a preferência fica no navegador)
  await pagina.goto(`${base}#/carteira?aba=acompanhamento`);
  await pagina.waitForSelector('#acf-fluxo');
  assert.equal(await pagina.locator('#menu a.ativo').innerText(), 'Acompanhamento');
  await pagina.click('#botao-menu');
  await pagina.waitForSelector('#casca.recolhido');
  await pagina.waitForFunction(() => document.getElementById('lateral').getBoundingClientRect().width < 100); // só os ícones (após a animação)
  await foto('17-menu-recolhido');
  await pagina.click('#botao-menu');
  await pagina.waitForSelector('#casca:not(.recolhido)');

  // 12. analista financeiro: console de crédito → libera o cliente em análise → corrige a liberação
  await pagina.click('.menu-sair');
  await pagina.waitForSelector('#login');
  await pagina.fill('#login', 'analista');
  await pagina.fill('#senha', senhaAnalista);
  await pagina.click('button:text("Entrar")');
  await pagina.waitForSelector('h1:text("Console de crédito")');       // o analista cai direto no console
  assert.equal(await pagina.locator('#menu a[title="Lista principal"]').count(), 0, 'financeiro vê só a análise de crédito (perfil do sistema)');
  assert.equal(await pagina.locator('#menu a[title="Usuários"]').count(), 0, 'analista não vê administração');
  assert.match(await texto(), /1\s+em análise/);                       // o 2º CNPJ do arquivo de cadastro
  await foto('19-console-credito');
  await pagina.click('a:text("Liberar crédito")');
  await pagina.waitForSelector('text=Forma de pagamento');
  await pagina.click('label.opcao:has-text("Boleto")');
  await pagina.fill('#prazo', '28');
  await pagina.click('label.opcao:has-text("Sem restrição")');
  await pagina.click('button:text("Liberar crédito")');
  await pagina.waitForSelector('text=informe o limite de crédito');      // boleto sem limite é recusado na tela
  await pagina.fill('#limite', '12.500,00');
  await foto('20-liberar-credito');
  await pagina.click('button:text("Liberar crédito")');
  await pagina.waitForSelector('text=passou para Aguardando pedido');
  await pagina.waitForSelector('text=Nenhum cliente aguardando análise.');
  await pagina.click('.filtrantes [data-filtro="liberados"]');
  await pagina.waitForSelector('td:has-text("Boleto · 28 dias · R$ 12.500,00")');
  await foto('21-liberados');
  await pagina.click('a:text("Corrigir") >> nth=0');
  await pagina.waitForSelector('text=Corrigir liberação de crédito');
  await pagina.click('label.opcao:has-text("À vista")');
  await pagina.fill('#limite', '5000');
  await pagina.click('label.opcao:has-text("Com restrição")');
  await pagina.click('button:text("Gravar nova liberação")');
  await pagina.waitForSelector('text=passou para Aguardando pedido');
  await pagina.click('.filtrantes [data-filtro="liberados"]');
  await pagina.waitForSelector('td:has-text("com restrição")');
  await pagina.click('td a >> nth=0');
  await pagina.waitForSelector('text=Histórico de movimentação');
  assert.match(await texto(), /Restrição de crédito\s+com restrição/);

  // 13. gerente comercial: painel completo, age em qualquer carteira, sem console de crédito nem administração
  await pagina.click('.menu-sair');
  await pagina.waitForSelector('#login');
  await pagina.fill('#login', 'gerente');
  await pagina.fill('#senha', senhaGerente);
  await pagina.click('button:text("Entrar")');
  await pagina.waitForSelector('.explorar');
  await pagina.evaluate(() => { location.hash = '#/inicio'; });
  await pagina.waitForSelector('#painel-supervisor');
  assert.match(await pagina.locator('#usuario-lateral').innerText(), /Gerente comercial/);
  assert.equal(await pagina.locator('#menu a[title="Console de crédito"]').count(), 0);
  assert.equal(await pagina.locator('#menu a[title="Usuários"]').count(), 0);
  await pagina.click('.lista-agentes a >> nth=0');                           // agente → carteira dele
  await pagina.waitForSelector('.lista-tabela tbody tr');
  await pagina.click('.lista-tabela a.nome >> nth=0');
  await pagina.click('a:text("Registrar atendimento")');
  await pagina.click('label.opcao:has-text("Atendido")');
  await pagina.click('button:text("Gravar registro")');
  await pagina.waitForSelector('text=Atendido registrado.');
  await pagina.goto(`${base}#/financeiro`);
  await pagina.waitForSelector('text=Seu perfil não tem acesso a esta tela.');
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
  await cel.waitForFunction(() => document.getElementById('conteudo').dataset.pronto === '#/explorar');
  await cel.evaluate(() => { location.hash = '#/inicio'; });
  await cel.waitForSelector('h1:text("Dashboard de acompanhamento")');
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
