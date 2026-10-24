import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { importarBase } from '../../shared/importar-base.mjs';
import { contarDatasPlanilha, contarStatusPlanilha, localizarCabecalho, mapearCabecalho, normalizarMapaStatus } from '../../shared/importacao-base.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso, tabela, formatar } from '../ui.js';
import { blocoResultado } from './_resultado.js';
import { baixarXlsx } from '../planilhas.js';
import { consultaExportarBase } from '../../shared/administracao.mjs';

const OPCOES = [
  ['sem_contato', 'Não contactado (sem datas de contato)'],
  ['contato_planilha', 'Em prospecção (houve contato, sem resultado)'],
  ['atendido', 'Atendido → Aguardando cadastro'],
  ['sem_interesse', 'Sem interesse'],
  ['', '— rejeitar estas linhas —'],
];
const ETAPAS = ['Arquivo', 'Datas e status da planilha', 'Simulação', 'Gravação'];

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const padrao = normalizarMapaStatus(await (await fetch('config/mapa-status-planilha.json')).json());
  const ja = Number((await db.execute('SELECT count(*) n FROM prospects')).rows[0].n);
  const area = h('div');
  let planilha = null;
  let mapa = {};
  let considerarDatas = false;

  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-base' });
  const bLer = h('button', { onclick: async () => {
    planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0]));
    if (planilha) etapaDatas();
  } }, 'Ler arquivo');

  // DT 1o / DT 2o: considerar ou não (padrão = só se a planilha tiver alguma data)
  function etapaDatas() {
    const comData = contarDatasPlanilha(planilha.linhas);
    considerarDatas = comData > 0;
    const marca = h('input', { type: 'checkbox', id: 'considerar-datas', checked: considerarDatas, onchange: (ev) => { considerarDatas = ev.target.checked; } });
    montar(area, passos(ETAPAS, 1), h('div', { class: 'cartao' }, cabecalhoInfo(),
      h('h2', {}, 'Datas de contato da planilha'),
      h('p', {}, comData ? `${formatar.numero(comData)} linha(s) com DT 1o.contato ou DT 2o.contato preenchida.` : 'As colunas DT 1o.contato e DT 2o.contato estão vazias em todas as linhas.'),
      h('label', { class: 'marcador', for: 'considerar-datas' }, marca, ' Considerar DT 1o / DT 2o contato e o Status Atual'),
      h('p', { class: 'ajuda' }, 'Desmarcado: as duas datas e o Status Atual são ignorados e todos os prospects entram como Não contactado (sem histórico de contato da planilha). Marcado: as datas viram registros "contato da planilha" e o Status Atual é aplicado à última data.'),
      h('div', { class: 'acoes' },
        h('button', { id: 'continuar-datas', onclick: (ev) => (considerarDatas ? etapaStatus() : simular(ev.currentTarget)) }, 'Continuar'),
        h('button', { class: 'secundario', onclick: () => render(conteudo, ctx) }, 'Trocar arquivo'))));
  }

  function cabecalhoInfo() {
    const inicio = localizarCabecalho(planilha.linhas);
    const m = mapearCabecalho(planilha.linhas[inicio] ?? []);
    return h('div', {},
      h('p', {}, `${planilha.nome} · ${planilha.observacao} · cabeçalho na linha ${inicio + 1} · ${formatar.numero(planilha.linhas.length - inicio - 1)} linhas abaixo dele`),
      m.faltandoObrigatorias.length ? mensagem(`Colunas obrigatórias ausentes: ${m.faltandoObrigatorias.join(', ')}. Confira o arquivo.`, 'erro') : null,
      m.faltandoOpcionais.length ? mensagem(`Colunas opcionais ausentes (ficam vazias): ${m.faltandoOpcionais.join(', ')}`, 'info') : null,
      m.naoReconhecidas.length ? mensagem(`Colunas não reconhecidas (ignoradas): ${m.naoReconhecidas.join(', ')}`, 'info') : null);
  }

  function etapaStatus() {
    const valores = contarStatusPlanilha(planilha.linhas);
    mapa = Object.fromEntries(valores.map((v) => [v.chave, padrao[v.chave] ?? '']));
    const bSimular = h('button', { onclick: () => simular(bSimular) }, 'Simular importação');
    montar(area, passos(ETAPAS, 1), h('div', { class: 'cartao' }, cabecalhoInfo(),
      h('p', {}, 'Datas de contato: ', h('b', {}, 'consideradas'), ' · ', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); etapaDatas(); } }, 'alterar')),
      h('h2', {}, 'Como tratar cada valor de "Status Atual"'),
      h('p', { class: 'ajuda' }, 'Vale para a ÚLTIMA data de contato da linha (DT 2o ou, se vazia, DT 1o). Valores marcados para rejeitar viram linhas rejeitadas no relatório — nada é adivinhado.'),
      tabela([
        { titulo: 'Valor na planilha', valor: (v) => v.valor === '' ? '(vazio)' : v.valor },
        { titulo: 'Linhas', valor: (v) => formatar.numero(v.quantidade), classe: 'num' },
        { titulo: 'Tratar como', valor: (v) => h('select', { 'aria-label': `status ${v.valor}`, onchange: (ev) => { mapa[v.chave] = ev.target.value; } },
          OPCOES.map(([valor, texto]) => h('option', { value: valor, selected: (mapa[v.chave] ?? '') === valor }, texto))) },
      ], valores),
      h('div', { class: 'acoes' }, bSimular, h('button', { class: 'secundario', onclick: () => render(conteudo, ctx) }, 'Trocar arquivo'))));
  }

  const parametros = () => ({
    linhas: planilha.linhas, arquivoNome: planilha.nome, arquivoSha256: planilha.sha256, executadoPor: ctx.usuario.login,
    mapaStatus: Object.fromEntries(Object.entries(mapa).filter(([, v]) => v)), hoje: hojeSaoPaulo(), considerarDatas,
  });
  const paraTela = (resultados) => resultados.map((r) => ({ numeroLinha: r.numeroLinha, resultado: r.dados ? 'aceita' : 'rejeitada',
    cnpj: r.dados?.prospect.cnpj ?? r.bruto.cnpj ?? null, mensagens: r.dados ? r.avisos : r.erros }));

  async function simular(botao) {
    const r = await comEspera(botao, () => importarBase(db, { ...parametros(), simular: true }));
    if (!r) return;
    const bGravar = h('button', { onclick: () => gravar(bGravar) }, `Confirmar e gravar ${formatar.numero(r.resumo.novos + r.resumo.atualizados)} linhas`);
    montar(area, passos(ETAPAS, 2),
      mensagem(r.resumo.considerarDatas ? 'Datas de contato (DT 1o / DT 2o) e Status Atual: considerados.' : 'Datas de contato (DT 1o / DT 2o) e Status Atual: ignorados — todos os novos entram como Não contactado.', 'info'),
      mensagem(`Simulação: ${formatar.numero(r.resumo.novos)} prospects novos e ${formatar.numero(r.resumo.atualizados)} já existentes (só dados cadastrais são atualizados; status, histórico e vendedor não mudam). Nada foi gravado ainda.`, 'info'),
      blocoResultado({ titulo: 'Resultado da simulação', resumo: { ...r.resumo, aceitas: r.resumo.novos + r.resumo.atualizados }, resultados: paraTela(r.resultados), nomeRelatorio: `simulacao-base-${hojeSaoPaulo()}.csv` }),
      h('div', { class: 'acoes' }, bGravar, h('button', { class: 'secundario', onclick: () => (considerarDatas ? etapaStatus() : etapaDatas()) }, considerarDatas ? 'Voltar e ajustar o status' : 'Voltar')));
  }

  async function gravar(botao) {
    // andamento: grava em lotes de 100 linhas; a aba precisa ficar aberta até o fim (reimportar é seguro: não duplica)
    const ETAPA = { equipe: 'Cadastrando supervisores e vendedores', prospects: 'Gravando prospects', relatorio: 'Gravando o relatório da importação' };
    const barra = h('progress', { max: 1, value: 0, style: 'width:100%' });
    const texto = h('p', { class: 'ajuda' }, 'Preparando…');
    const caixa = h('div', { class: 'cartao', id: 'andamento-importacao' }, h('b', {}, 'Importando — não feche nem troque esta aba'), barra, texto);
    botao.after(caixa);
    const segurar = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    addEventListener('beforeunload', segurar);
    const aoProgredir = ({ etapa, feitos, total }) => {
      barra.max = total || 1; barra.value = feitos;
      texto.textContent = `${ETAPA[etapa]}: ${formatar.numero(feitos)} de ${formatar.numero(total)}`;
    };
    const r = await comEspera(botao, () => importarBase(db, { ...parametros(), aoProgredir })).finally(() => removeEventListener('beforeunload', segurar));
    caixa.remove();
    if (!r) return;
    aviso('Importação gravada.');
    montar(area, passos(ETAPAS, 4),
      mensagem(`Importação nº ${r.importacaoId} concluída. Representante ou vendedor veio da coluna TIPO; confira e ajuste em Usuários e libere o acesso da equipe.`, 'ok'),
      blocoResultado({ titulo: `Importação nº ${r.importacaoId}`, resumo: r.resumo, resultados: paraTela(r.resultados), nomeRelatorio: `importacao-${r.importacaoId}-base.csv` }),
      h('div', { class: 'acoes' }, h('a', { class: 'botao', href: '#/admin/usuarios' }, 'Usuários e senhas')));
  }

  montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-base' }, 'Planilha base (.xlsx ou .csv)'), arquivo),
    h('p', { class: 'ajuda' }, 'Layout: CNPJ, Razão social, Nome Fantasia, Endereço, Bairro, Cidade, Estado, Código Postal, Latitude, Longitude, TIPOLOGIA GTM, Telefone, ONDA, CNPJ, TIPO, COD SUP, SUPERVISOR, COD, NOME, ROTA, SUBROTA, OBS, DT 1o.contato, DT 2o.contato, Status Atual, # Dias Corridos.'),
    bLer,
    h('p', { class: 'ajuda', style: 'margin-top:12px' }, 'Para testar: ', h('a', { href: 'exemplos/base-ficticia.xlsx', download: true }, 'baixe a planilha fictícia'), '.')));

  // exportar a base inteira (CNPJ, razão social, cidade, UF) em Excel — uma leitura só, ao clicar
  const bExportar = h('button', { class: 'secundario', id: 'exportar-base', onclick: () => comEspera(bExportar, async () => {
    const linhas = (await db.execute(consultaExportarBase())).rows;
    await baixarXlsx(`base-prospects-${hojeSaoPaulo()}.xlsx`, [
      { titulo: 'CNPJ', valor: (l) => formatar.cnpj(l.cnpj), largura: 22 },
      { titulo: 'Razão social', valor: (l) => l.razao_social, largura: 48 },
      { titulo: 'Cidade', valor: (l) => l.cidade, largura: 28 },
      { titulo: 'UF', valor: (l) => l.uf, largura: 6 },
    ], linhas, { aba: 'Base de prospects' });
    aviso(`Base exportada: ${formatar.numero(linhas.length)} prospects.`);
  }) }, 'Exportar base (Excel)');
  montar(conteudo, h('h1', {}, 'Base de prospects'),
    ja ? mensagem(`A base já tem ${formatar.numero(ja)} prospects. Reimportar só atualiza dados cadastrais — status, histórico e vendedor não mudam.`, 'info') : null,
    ja ? h('div', { class: 'cartao' }, h('p', { style: 'margin-top:0' }, 'Exportar a base inteira em Excel: CNPJ, razão social, cidade e UF.'), bExportar) : null,
    area);
}
