import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { COLUNAS_CREDITO, contarFormas, importarCredito, mapearColunasCredito } from '../../shared/importar-credito.mjs';
import { FORMAS_PAGAMENTO } from '../../shared/financeiro.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso, tabela, formatar } from '../ui.js';
import { blocoResultado } from './_resultado.js';

const ETAPAS = ['Arquivo', 'Colunas e formas de pagamento', 'Simulação', 'Gravação'];

const item = (rotulo, valor) => h('div', { class: 'dado' }, h('span', {}, rotulo), h('b', {}, formatar.numero(valor)));

/** O que o arquivo traz: base × fora da base, limite considerado e os pontos para conferir antes de gravar. */
function resumoArquivo(x) {
  const alertas = [
    x.gruposDivergentes ? `${formatar.numero(x.gruposDivergentes)} raiz(es) de CNPJ com Créd. Grupo diferente entre as empresas — o limite do grupo deveria ser o mesmo em todas.` : null,
    x.gruposMistos ? `${formatar.numero(x.gruposMistos)} grupo(s) com empresas de crédito próprio e outras usando o do grupo.` : null,
    x.antesCampanha ? `${formatar.numero(x.antesCampanha)} cliente(s) da base com cadastro anterior ao início da campanha (já eram clientes).` : null,
  ].filter(Boolean);
  return h('div', { class: 'cartao' },
    h('h3', { style: 'margin-top:0' }, 'O que o arquivo traz'),
    h('div', { class: 'dados' },
      item('Linhas', x.linhasLidas), item('Na base de prospects', x.naBase), item('Fora da base (ignoradas)', x.foraBase),
      item('CPF (ignoradas)', x.cpf), item('Grupos (raiz com 2+ empresas)', x.grupos)),
    h('h3', {}, 'Limite considerado (clientes da base)'),
    h('div', { class: 'dados' },
      item('Crédito do cliente', x.limiteCliente), item('Crédito do grupo (cliente vazio)', x.limiteGrupo),
      item('Sem limite (9.999.999)', x.semLimite), item('Sem crédito (0)', x.semCredito)),
    alertas.length ? h('div', {}, h('h3', {}, 'Para conferir'), h('ul', {}, alertas.map((a) => h('li', {}, a)))) : null);
}

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  let planilha = null;
  const arquivo = h('input', { type: 'file', accept: '.xlsx,.csv', id: 'arquivo-credito' });
  const bLer = h('button', { onclick: async () => { planilha = await comEspera(bLer, () => lerArquivo(arquivo.files[0])); if (planilha) configurar(); } }, 'Ler arquivo');

  function configurar() {
    // opções pelo índice da coluna: o relatório do ERP repete o título "Descrição"
    const titulos = Array.from(planilha.linhas[0] ?? [], (c, i) => ({ i, t: String(c ?? '').trim() })).filter((c) => c.t);
    const letra = (i) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
    const auto = mapearColunasCredito(planilha.linhas[0] ?? []).indices;
    const seletores = {};
    for (const c of COLUNAS_CREDITO) {
      seletores[c.campo] = h('select', { id: `col-${c.campo}` }, c.obrigatoria ? null : h('option', { value: '' }, '— não tem —'),
        titulos.map(({ i, t }) => h('option', { value: String(i), selected: auto[c.campo] === i }, `${letra(i)} · ${t}`)));
    }
    const colunas = () => Object.fromEntries(Object.entries(seletores).map(([k, s]) => [k, s.value === '' ? null : Number(s.value)]));
    const areaFormas = h('div');
    let mapa = {};
    function desenharFormas() {
      const { indices, faltando } = mapearColunasCredito(planilha.linhas[0] ?? [], colunas());
      if (faltando.length) return montar(areaFormas, mensagem(`Escolha as colunas obrigatórias: ${faltando.join(', ')}`, 'erro'));
      const formas = contarFormas(planilha.linhas, indices);
      mapa = Object.fromEntries(formas.map((f) => [f.chave, mapa[f.chave] ?? f.sugerida]));
      montar(areaFormas, h('h3', {}, 'Forma de pagamento do ERP → filtro rápido'), h('p', { class: 'ajuda' }, 'A forma do ERP fica gravada como veio; aqui só se escolhe o filtro. Sem crédito (0) vira à vista, salvo antecipado.'),
        tabela([
          { titulo: 'Valor no arquivo', valor: (f) => f.valor || '(vazio)' },
          { titulo: 'Linhas', valor: (f) => formatar.numero(f.quantidade), classe: 'num' },
          { titulo: 'Tratar como', valor: (f) => h('select', { 'aria-label': `forma ${f.valor}`, onchange: (ev) => { mapa[f.chave] = ev.target.value; } },
            h('option', { value: '', selected: !mapa[f.chave] }, '— rejeitar estas linhas —'),
            Object.entries(FORMAS_PAGAMENTO).map(([v, t]) => h('option', { value: v, selected: mapa[f.chave] === v }, t))) },
        ], formas));
    }
    Object.values(seletores).forEach((s) => s.addEventListener('change', desenharFormas));
    const parametros = () => ({ linhas: planilha.linhas, colunas: colunas(), mapaFormas: Object.fromEntries(Object.entries(mapa).filter(([, v]) => v)),
      hoje: hojeSaoPaulo(), arquivoNome: planilha.nome, arquivoSha256: planilha.sha256, executadoPor: ctx.usuario.login });
    const paraTela = (rs) => rs.map((r) => ({ numeroLinha: r.numeroLinha, resultado: r.resultado, cnpj: r.cnpj, dataCadastro: r.dataCadastro ?? null, mensagens: r.resultado === 'aceita' ? r.avisos : r.erros }));
    const bSim = h('button', { onclick: async () => {
      const r = await comEspera(bSim, () => importarCredito(db, { ...parametros(), simular: true }));
      if (!r) return;
      const bGravar = h('button', { onclick: async () => {
        const g = await comEspera(bGravar, () => importarCredito(db, parametros()));
        if (!g) return;
        aviso('Relatório de crédito importado.');
        montar(area, passos(ETAPAS, 4),
          mensagem(`Importação nº ${g.importacaoId}: ${g.resumo.aceitas} cliente(s) passaram para Aguardando pedido${g.resumo.cadastrosRegistrados ? ` (${g.resumo.cadastrosRegistrados} com o cadastro registrado pelo próprio relatório)` : ''}.`, 'ok'),
          blocoResultado({ titulo: `Importação nº ${g.importacaoId}`, resumo: g.resumo, resultados: paraTela(g.resultados), nomeRelatorio: `importacao-${g.importacaoId}-credito.csv` }));
      } }, 'Confirmar e gravar');
      montar(area, passos(ETAPAS, 2),
        mensagem(`Simulação: ${r.resumo.aceitas} liberação(ões) de crédito${r.resumo.cadastrosRegistrados ? `, ${r.resumo.cadastrosRegistrados} com cadastro registrado pelo relatório` : ''}. "Ignoradas" = CPF, fora da base, venda já realizada ou crédito igual ao já registrado — clientes fora da base não são cadastrados.`, 'info'),
        resumoArquivo(r.resumo),
        blocoResultado({ titulo: 'Resultado da simulação', resumo: r.resumo, resultados: paraTela(r.resultados), nomeRelatorio: `simulacao-credito-${hojeSaoPaulo()}.csv` }),
        h('div', { class: 'acoes' }, bGravar, h('button', { class: 'secundario', onclick: configurar }, 'Voltar')));
    } }, 'Simular');
    montar(area, passos(ETAPAS, 1), h('div', { class: 'cartao' },
      h('p', {}, `${planilha.nome} · ${planilha.observacao}`),
      h('div', { class: 'linha-campos' }, COLUNAS_CREDITO.map((c) => h('div', {}, h('label', { for: `col-${c.campo}` }, c.cabecalho + (c.obrigatoria ? ' *' : '')), seletores[c.campo]))),
      areaFormas, h('div', { class: 'acoes' }, bSim, h('button', { class: 'secundario', onclick: () => render(conteudo, ctx) }, 'Trocar arquivo'))));
    desenharFormas();
  }

  montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
    h('div', { class: 'campo' }, h('label', { for: 'arquivo-credito' }, 'Relatório de cadastro do ERP (.xlsx ou .csv)'), arquivo),
    h('p', { class: 'ajuda' }, 'Colunas: Cliente · CPF / CNPJ · Razão Social · Cond. Pgto · Descrição · Forma Pgto · Descrição · Créd. Cliente · Créd. Grupo · Dt. Cadastro.'),
    bLer));
  montar(conteudo, h('h1', {}, 'Relatório de cadastro e crédito'),
    h('p', { class: 'ajuda' }, 'Um relatório só: cadastro do cliente e crédito liberado. Só os CNPJs da base de prospects recebem os dados (CPF e fora da base são ignorados). O cliente passa para Aguardando pedido; sem cadastro ainda, o cadastro é registrado pelo próprio relatório (Dt. Cadastro e código do cliente). Limite: vale o Créd. Cliente; vazio, o Créd. Grupo — o mesmo valor para todas as empresas da raiz do CNPJ. 9.999.999 = sem limite; 0 = sem crédito (à vista ou antecipado). Condição e forma de pagamento ficam gravadas como vieram do ERP. O console do analista continua disponível para casos pontuais.'),
    area);
}
