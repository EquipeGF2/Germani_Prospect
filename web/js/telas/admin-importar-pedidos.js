// Importação de pedidos em etapas: arquivo → classificação → vínculo → simulação → gravação. docs/05 §6
import { bancoAdmin } from '../db.js';
import { lerArquivo } from '../arquivo.js';
import { FASES, TIPOS_TRANSACAO, gravarPedidos, lerClassificacao, lerLinhasPedidos, simularPedidos } from '../../shared/importar-pedidos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, passos, comEspera, aviso, selo, baixarCsv, formatar } from '../ui.js';
import { blocoResultado } from './_resultado.js';
import { cartoes, moeda, valor, razaoSocial, documento, tabelaPedidos } from './_pedidos.js';

const ETAPAS = ['Arquivo', 'Classificação', 'Vínculo', 'Simulação', 'Gravação'];
const FASES_VALIDAS = ['carteira', 'parcial', 'faturado'];

export async function render(conteudo, ctx) {
  const db = await bancoAdmin();
  const area = h('div');
  let planilha = null;
  let lidas = null;      // linhas validadas do arquivo
  let classificacao = await lerClassificacao(db);
  let simulacao = null;
  const hoje = hojeSaoPaulo();
  const dataArquivo = h('input', { id: 'data-arquivo', type: 'date', value: hoje, max: hoje });
  const nomesStatus = Object.fromEntries((await db.execute('SELECT codigo, nome FROM status')).rows.map((s) => [s.codigo, s.nome]));

  function etapaArquivo() {
    const arquivo = h('input', { type: 'file', accept: '.xls,.xlsx,.csv', id: 'arquivo-pedidos' });
    const diaria = h('input', { type: 'radio', name: 'frequencia', value: 'diaria', checked: true, onchange: () => { dataArquivo.value = hoje; } });
    const semanal = h('input', { type: 'radio', name: 'frequencia', value: 'semanal' });
    const bLer = h('button', { id: 'ler-pedidos', onclick: async () => {
      const lido = await comEspera(bLer, async () => {
        const p = await lerArquivo(arquivo.files[0]);
        if (!dataArquivo.value) throw new Error('informe a data do arquivo');
        return { p, l: lerLinhasPedidos(p.linhas, { dataPadrao: dataArquivo.value, hoje }) };
      });
      if (!lido) return;
      planilha = lido.p; lidas = lido.l;
      await conferencia();
    } }, 'Ler arquivo');
    montar(area, passos(ETAPAS, 0), h('div', { class: 'cartao' },
      h('h2', {}, 'Arquivo e data'),
      h('p', { class: 'ajuda' }, 'Nada é gravado até a confirmação na simulação.'),
      h('div', { class: 'campo' }, h('label', { for: 'arquivo-pedidos' }, 'Relatório de pedidos do ERP (.xls, .xlsx ou .csv)'), arquivo),
      h('label', {}, 'Frequência desta importação'),
      h('div', { class: 'linha-campos', style: 'margin-bottom:14px' },
        h('label', { class: 'ped-opcao' }, diaria, h('span', {}, h('b', {}, 'Diária'), h('br'), 'O arquivo entra com a data do dia. Cada mudança de situação fica com o dia certo.')),
        h('label', { class: 'ped-opcao' }, semanal, h('span', {}, h('b', {}, 'Semanal'), h('br'), 'Informe a data aqui, ou traga uma coluna de data no relatório.'))),
      h('div', { class: 'campo', style: 'max-width:240px' }, h('label', { for: 'data-arquivo' }, 'Data deste arquivo'), dataArquivo),
      bLer));
  }

  async function conferencia() {
    const ok = lidas.resultados.filter((r) => r.resultado === 'aceita');
    const numeros = ok.map((r) => Number(r.numero)).filter(Number.isFinite).sort((a, b) => a - b);
    const faltam = [];
    if (numeros.length) for (let n = numeros[0]; n <= numeros.at(-1) && faltam.length < 21; n++) if (!numeros.includes(n)) faltam.push(n);
    const repetido = (await db.execute({ sql: `SELECT i.id FROM importacoes i JOIN pedido_importacoes p ON p.importacao_id = i.id WHERE i.arquivo_sha256 = ? AND p.apagada_em IS NULL LIMIT 1`, args: [planilha.sha256] })).rows[0];
    const reps = new Set((await db.execute("SELECT codigo_erp FROM usuarios WHERE codigo_erp IS NOT NULL AND perfil IN ('vendedor','supervisor')")).rows.map((u) => String(u.codigo_erp)));
    const semCodigo = [...new Set(ok.map((r) => r.rep).filter((r) => r && !reps.has(r)))].sort((a, b) => Number(a) - Number(b));
    const linha = (rotulo, texto, tipo) => h('div', { class: 'ped-linha' }, h('span', {}, rotulo), selo(texto, tipo));
    montar(area, passos(ETAPAS, 0),
      h('div', { class: 'cartao' }, h('h2', {}, `${planilha.nome}`),
        h('p', { class: 'ajuda' }, `${formatar.numero(lidas.resultados.length)} linhas · ${planilha.observacao} · data ${formatar.data(dataArquivo.value)}${lidas.temColunaData ? ' (ou a coluna de data de cada linha)' : ''}`),
        linha('Linhas com erro', String(lidas.resultados.length - ok.length), lidas.resultados.length === ok.length ? 'ok' : 'erro'),
        linha('CPF (pessoa física)', `${ok.filter((r) => r.cpf).length} linha(s)`, ok.some((r) => r.cpf) ? 'alerta' : 'ok'),
        linha('Representantes sem código no cadastro', semCodigo.length ? semCodigo.join(', ') : 'nenhum', semCodigo.length ? 'alerta' : 'ok'),
        linha('Faturado maior que o pedido', String(ok.filter((r) => r.avisos.some((a) => a.includes('faturado maior'))).length), ok.some((r) => r.avisos.some((a) => a.includes('faturado maior'))) ? 'alerta' : 'ok'),
        linha('Números faltando na sequência', faltam.length ? (faltam.length > 20 ? 'mais de 20' : faltam.join(', ')) : 'nenhum', faltam.length ? 'alerta' : 'ok'),
        linha('Este arquivo já foi importado?', repetido ? `sim, nº ${repetido.id}` : 'não', repetido ? 'alerta' : 'ok'),
        semCodigo.length ? mensagem('Sem o código no cadastro, o nome do representante não aparece. Inclua o código em Usuários; o nome passa a aparecer sem precisar importar de novo.', 'info') : null),
      h('div', { class: 'acoes' }, h('button', { id: 'ir-classificar', onclick: etapaClassificacao }, 'Continuar: classificar os pedidos'), h('button', { class: 'secundario', onclick: etapaArquivo }, 'Trocar arquivo')));
  }

  function etapaClassificacao() {
    const ok = lidas.resultados.filter((r) => r.resultado === 'aceita');
    const reunir = (campo, descricao) => { const m = new Map(); for (const r of ok) { const k = r[campo]; if (!m.has(k)) m.set(k, { codigo: k, descricao: r[descricao], qtd: 0, valor: 0 }); m.get(k).qtd++; m.get(k).valor += r.valorPedido; } return [...m.values()]; };
    const transacoes = reunir('transacao', 'transacaoDescricao').sort((a, b) => a.codigo.localeCompare(b.codigo));
    const situacoes = reunir('situacao', 'situacaoDescricao').sort((a, b) => Number(classificacao.situacoes.get(a.codigo)?.ordem ?? 99) - Number(classificacao.situacoes.get(b.codigo)?.ordem ?? 99));
    const escolhas = new Map();
    const select = (grupo, l, opcoes, atual) => { const s = h('select', { 'aria-label': `${l.codigo} conta como`, dados: { grupo, codigo: l.codigo }, onchange: conferir },
      atual ? null : h('option', { value: '' }, 'Escolha…'), Object.entries(opcoes).map(([v, t]) => h('option', { value: v, selected: v === atual }, t))); escolhas.set(`${grupo}:${l.codigo}`, s); return s; };
    const LARG = [12, 28, 12, 16, 32];
    const colunas = (titulo, grupo, opcoes, mapa) => [
      { titulo, campo: 'codigo', classe: 'num' }, { titulo: 'Descrição', campo: 'descricao', classe: 'cen' },
      { titulo: 'Pedidos', valor: (l) => formatar.numero(l.qtd), classe: 'num' }, { titulo: 'Valor', valor: (l) => valor(l.valor), classe: 'num' },
      { titulo: 'Conta como', valor: (l) => select(grupo, l, opcoes, mapa.get(l.codigo)?.conta_como), classe: 'cen' }];
    const painel = h('div', {});
    const bSeguir = h('button', { id: 'ir-vincular', onclick: async () => {
      const nova = { transacoes: new Map(classificacao.transacoes), situacoes: new Map(classificacao.situacoes) };
      for (const l of transacoes) nova.transacoes.set(l.codigo, { codigo: l.codigo, descricao: l.descricao, conta_como: escolhas.get(`t:${l.codigo}`).value });
      for (const l of situacoes) nova.situacoes.set(l.codigo, { codigo: l.codigo, descricao: l.descricao, conta_como: escolhas.get(`s:${l.codigo}`).value });
      classificacao = nova;
      simulacao = await comEspera(bSeguir, () => simularPedidos(db, { linhas: planilha.linhas, dataPadrao: dataArquivo.value, hoje, classificacao }));
      if (simulacao) etapaVinculo();
    } }, 'Continuar: vincular aos clientes');
    function conferir() {
      const tipo = (c) => escolhas.get(`t:${c}`).value; const fase = (c) => escolhas.get(`s:${c}`).value;
      bSeguir.disabled = [...escolhas.values()].some((s) => !s.value);
      const conta = { pedidos: 0, digitado: 0, cancelado: 0, valida: 0, faturado: 0, saldo: 0, investimento: 0, n: { pedidos: 0, digitado: 0, cancelado: 0, valida: 0, investimento: 0 } };
      for (const r of ok) {
        if (tipo(r.transacao) === 'investimento') { conta.investimento += r.valorPedido; conta.n.investimento++; continue; }
        if (tipo(r.transacao) !== 'venda') continue;
        conta.pedidos += r.valorPedido; conta.n.pedidos++;
        const f = fase(r.situacao);
        if (FASES_VALIDAS.includes(f)) { conta.valida += r.valorPedido; conta.n.valida++; conta.faturado += r.valorFaturado; conta.saldo += Math.max(r.valorPedido - r.valorFaturado, 0); }
        else if (f === 'digitado') { conta.digitado += r.valorPedido; conta.n.digitado++; }
        else if (f === 'cancelado') { conta.cancelado += r.valorPedido; conta.n.cancelado++; }
      }
      const l = (t, v, forte) => h('div', { class: 'ped-linha', style: forte ? 'font-weight:700;color:var(--destaque)' : null }, h('span', {}, t), h('span', {}, v));
      montar(painel, h('div', { class: 'cartao' }, h('h2', {}, 'Venda'),
        l(`Pedidos de venda (${conta.n.pedidos})`, valor(conta.pedidos)), l(`Digitado, fora da carteira (${conta.n.digitado})`, `− ${valor(conta.digitado)}`), l(`Desistência (${conta.n.cancelado})`, `− ${valor(conta.cancelado)}`),
        l(`Venda válida (${conta.n.valida})`, valor(conta.valida), true), l('Faturado', valor(conta.faturado)), l('Em carteira, a faturar', valor(conta.saldo))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Investimento'), l(`Bonificação (${conta.n.investimento})`, valor(conta.investimento)),
        h('p', { class: 'ajuda', style: 'margin-bottom:0' }, 'Conta separada: não soma nem desconta da venda.')));
    }
    const tTr = tabelaPedidos(colunas('Código', 't', TIPOS_TRANSACAO, classificacao.transacoes), transacoes, { fixa: LARG });
    const tSi = tabelaPedidos(colunas('Sit.', 's', FASES, classificacao.situacoes), situacoes, { fixa: LARG });
    const temNovos = [...transacoes.map((l) => classificacao.transacoes.has(l.codigo)), ...situacoes.map((l) => classificacao.situacoes.has(l.codigo))].includes(false);
    conferir();
    montar(area, passos(ETAPAS, 1),
      temNovos ? mensagem('Há código novo do ERP neste arquivo: escolha como ele conta para continuar.', 'erro') : null,
      h('div', { class: 'ped-colunas' },
        h('div', { class: 'largo' }, h('div', { class: 'cartao' }, h('h2', {}, 'Transação'), tTr), h('div', { class: 'cartao' }, h('h2', {}, 'Situação, na ordem do processo'), tSi)),
        h('div', { class: 'estreito' }, painel)),
      h('p', { class: 'ajuda' }, 'A classificação é guardada ao confirmar a importação e vale para os próximos arquivos.'),
      h('div', { class: 'acoes' }, bSeguir, h('button', { class: 'secundario', onclick: conferencia }, 'Voltar')));
  }

  function etapaVinculo() {
    const s = simulacao;
    const nomeRep = (c) => `${c} · ${s.nomeRep(c) ?? 'sem cadastro'}`;
    const efeito = (c) => {
      if (c.cpf) return 'Fora da carteira';
      if (c.prospectId == null) return c.filial ? 'Filial do grupo: só informação' : 'Só informação';
      if (c.statusAtual === 'expurgado') return 'Expurgado: só registra';
      if (c.validos) return 'Venda realizada';
      if (c.digitados || c.desistencias) return 'Aguardando pedido válido';
      return 'Exceção: bonificação sem venda';
    };
    const base = (c) => (c.cpf ? selo('CPF') : c.prospectId != null ? selo('Na base', 'ok') : c.filial ? selo('Filial do grupo', 'alerta') : selo('Fora da base'));
    montar(area, passos(ETAPAS, 2),
      h('div', { class: 'ped-kpis compacto' }, [['ok', 'Pedido válido', 'Venda realizada'], ['alerta', 'Sem pedido válido', 'Ag. pedido válido'], ['investimento', 'Só bonificação', 'Exceção, com alerta'], ['', 'Filial do grupo', 'Dica na ficha'], ['', 'Fora da base', 'Só informação'], ['', 'CPF', 'Ignorado'], ['alerta', 'Rep. sem código', 'Incluir o código']]
        .map(([c, t, d]) => h('div', { class: 'ped-kpi' }, selo(t, c), h('span', {}, d)))),
      h('div', { class: 'cartao' }, h('h2', {}, `Os ${formatar.numero(s.clientes.length)} clientes do arquivo`),
        tabelaPedidos([
          { titulo: 'Razão social', valor: (c) => razaoSocial({ codigo: c.cliente, razao: c.razao, doc: c.documento }), classe: 'rz' },
          { titulo: 'Válidos', valor: (c) => formatar.numero(c.validos), classe: 'num' }, { titulo: 'Digit.', valor: (c) => formatar.numero(c.digitados), classe: 'num' },
          { titulo: 'Desist.', valor: (c) => formatar.numero(c.desistencias), classe: 'num' }, { titulo: 'Venda válida (R$)', valor: (c) => valor(c.venda), classe: 'num' },
          { titulo: 'Investimento (R$)', valor: (c) => valor(c.investimento), classe: 'num' }, { titulo: 'Representantes (cód. · nome)', valor: (c) => c.reps.map(nomeRep).join(', ') },
          { titulo: 'Na base?', valor: base, classe: 'cen' }, { titulo: 'Efeito', valor: efeito, classe: 'cen' }], s.clientes, { id: 'clientes-arquivo' })),
      h('div', { class: 'acoes' }, h('button', { id: 'ir-simular', onclick: etapaSimulacao }, 'Continuar: simular'), h('button', { class: 'secundario', onclick: etapaClassificacao }, 'Voltar')));
  }

  function etapaSimulacao() {
    const s = simulacao;
    const t = s.totais;
    const ponto = (tipo, rotulo, texto) => ({ tipo, rotulo, texto });
    const pontos = [
      ponto('alerta', 'Conferir', `Data: os pedidos entram com ${formatar.data(dataArquivo.value)}.`),
      ...s.pontos.soBonificacao.map((c) => ponto('alerta', 'Exceção', `${c.razao}: bonificação de ${moeda(c.investimento)} sem venda.`)),
      ...(s.pontos.semCodigo.length ? [ponto('alerta', 'Conferir', `Representantes sem código no cadastro: ${s.pontos.semCodigo.join(', ')}. Sem o código, não há como trazer o nome.`)] : []),
      ...(s.sumiram ? [ponto('alerta', 'Conferir', `${s.sumiram} pedido(s) em aberto vieram antes e não vieram agora. Não assumo cancelamento: a situação continua a mesma.`)] : []),
      ...s.pontos.muitaDesistencia.map((c) => ponto('alerta', 'Conferir', `${c.razao}: ${c.desistencias} desistências.`)),
      ...(s.pontos.variosRepresentantes ? [ponto('', 'Informação', `${s.pontos.variosRepresentantes} cliente(s) com mais de um representante. O cliente fica com o dono, e a venda vai para quem a realizou.`)] : []),
      ponto('', 'Informação', 'Pode ser desfeito: os dados deste arquivo podem ser apagados depois, em Importações.'),
      ...(s.pontos.cpf.length ? [ponto('', 'Informação', `CPF: ${s.pontos.cpf.length} cliente(s) ficam fora da carteira.`)] : []),
    ];
    const colunasCsv = [{ titulo: 'Linha', texto: (r) => r.numeroLinha }, { titulo: 'Pedido', texto: (r) => r.numero ?? '' }, { titulo: 'CPF/CNPJ', texto: (r) => r.documento ?? '' }, { titulo: 'Razão social', texto: (r) => r.razao ?? '' },
      { titulo: 'Tipo', texto: (r) => TIPOS_TRANSACAO[r.tipo] ?? '' }, { titulo: 'Conta como', texto: (r) => FASES[r.fase] ?? '' }, { titulo: 'Resultado', texto: (r) => r.resultado },
      { titulo: 'Mensagens', texto: (r) => [...r.erros, ...r.avisos].join(' | ') }];
    const bCsv = h('button', { class: 'secundario', onclick: () => baixarCsv(`simulacao-pedidos-${hoje}.csv`, colunasCsv, s.resultados) }, 'Baixar relatório');
    const bGravar = h('button', { id: 'gravar-pedidos', onclick: async () => {
      const g = await comEspera(bGravar, () => gravarPedidos(db, { linhas: planilha.linhas, dataPadrao: dataArquivo.value, hoje, arquivoNome: planilha.nome, arquivoSha256: planilha.sha256, executadoPor: ctx.usuario.login, classificacao }));
      if (!g) return;
      aviso('Arquivo importado.');
      const paraTela = g.resultados.map((r) => ({ numeroLinha: r.numeroLinha, resultado: r.resultado, cnpj: r.documento, mensagens: r.resultado === 'aceita' ? r.avisos : r.erros }));
      montar(area, passos(ETAPAS, 4), mensagem(`Importação nº ${g.importacaoId} concluída. Os dados deste arquivo podem ser apagados em Importações.`, 'ok'),
        blocoResultado({ titulo: `Importação nº ${g.importacaoId}`, resumo: g.resumo, resultados: paraTela, nomeRelatorio: `pedidos-${g.importacaoId}.csv` }),
        h('div', { class: 'acoes' }, h('a', { class: 'botao', href: '#/pedidos' }, 'Ver o acompanhamento de pedidos'), h('a', { class: 'botao secundario', href: '#/admin/importacoes' }, 'Ver importações')));
    } }, 'Confirmar e gravar');
    const rejeitadas = s.resumo.rejeitadas;
    montar(area, passos(ETAPAS, 3),
      cartoes([['Linhas lidas', formatar.numero(s.resumo.linhasLidas), `${formatar.numero(s.resumo.ignoradas)} sem mudança · ${formatar.numero(rejeitadas)} rejeitadas`],
        ['Venda válida', moeda(t.venda.valor), `${formatar.numero(t.venda.qtd)} pedidos`, 'destaque'], ['Digitado', moeda(t.digitado.valor), `${formatar.numero(t.digitado.qtd)} pedidos`],
        ['Desistência', moeda(t.cancelado.valor), `${formatar.numero(t.cancelado.qtd)} pedidos`], ['Investimento', moeda(t.investimento.valor), `${formatar.numero(t.investimento.qtd)} pedidos`, 'investimento']]),
      h('div', { class: 'ped-colunas' },
        h('div', { class: 'estreito' }, h('div', { class: 'cartao' }, h('h2', {}, 'Mudanças nos clientes da base'),
          tabelaPedidos([{ titulo: 'Hoje', valor: (m) => nomesStatus[m.antes] ?? m.antes }, { titulo: 'Depois', valor: (m) => selo(nomesStatus[m.depois] ?? m.depois, m.depois === 'venda_realizada' ? 'ok' : 'alerta'), classe: 'cen' }, { titulo: 'Clientes', valor: (m) => formatar.numero(m.clientes), classe: 'num' }],
            s.movimentos, { vazio: 'Nenhum cliente da base muda de status com este arquivo.', id: 'mudancas' }),
          h('p', { class: 'ajuda', style: 'margin-bottom:0' }, `${formatar.numero(s.clientes.filter((c) => c.prospectId != null).length)} cliente(s) na base · ${formatar.numero(s.pontos.foraDaBase.length)} fora da base · ${formatar.numero(s.pontos.cpf.length)} CPF.`))),
        h('div', { class: 'largo' }, h('div', { class: 'cartao' }, h('h2', {}, 'Pontos para conferir antes de gravar'),
          tabelaPedidos([{ titulo: 'Tipo', valor: (p) => selo(p.rotulo, p.tipo), classe: 'cen' }, { titulo: 'O quê', campo: 'texto' }], pontos)))),
      rejeitadas ? h('div', { class: 'cartao' }, h('h2', {}, `Linhas rejeitadas (${formatar.numero(rejeitadas)})`),
        tabelaPedidos([{ titulo: 'Linha', campo: 'numeroLinha', classe: 'num' }, { titulo: 'CPF / CNPJ', valor: (r) => documento(r.documento), classe: 'num' }, { titulo: 'Motivo', valor: (r) => r.erros.join(' | ') }], s.resultados.filter((r) => r.resultado === 'rejeitada').slice(0, 100))) : null,
      h('div', { class: 'acoes' }, bGravar, bCsv, h('button', { class: 'secundario', onclick: etapaVinculo }, 'Voltar')));
  }

  etapaArquivo();
  montar(conteudo, h('p', {}, h('a', { href: '#/admin/importar/erp' }, '← Pedidos · Baixados (ERP)')), h('h1', {}, 'Importar arquivo de pedidos'), area);
}
