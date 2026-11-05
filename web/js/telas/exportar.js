// Exportar (aba da tela Importações): Rejeitados por tipo, a base de prospects e os pedidos, em Excel, e as listas por equipe em PDF.
// Gerente e administrador.
// Cada exportação lê o banco só ao clicar. docs/03 §17
import { bancoApp, lerComCache } from '../db.js';
import { consultaExportarBase } from '../../shared/administracao.mjs';
import { consultaResumoRejeitados, NOME_TIPO_REJEICAO, prepararRejeitado, TIPOS_REJEICAO } from '../../shared/rejeitados.mjs';
import { exportarRejeitados } from './_rejeitados-excel.js';
import { baixarPedidos } from './_pedidos-excel.js';
import { consultaPedidos } from '../../shared/pedidos.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, formatar, comEspera, aviso } from '../ui.js';
import { baixarXlsx } from '../planilhas.js';
import { lerPedidos } from './_pedidos.js';
import { ABRANGENCIAS, consultaContagemListas, consultaListasEquipe, montarListasEquipe } from '../../shared/listas-equipe.mjs';
import { STATUS_ORDEM } from '../../shared/explorar.mjs';
import { montarZip } from '../../shared/zip.mjs';
import { gerarPdfLista } from '../relatorio.js';

const n0 = (x) => formatar.numero(Math.round(Number(x) || 0));
const representante = (codigo, nome) => [codigo, nome].filter(Boolean).join(' - ');

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  // contagens para os tipos e os filtros (leitura leve); os dados de cada cliente são lidos só ao exportar
  const clientes = (await lerComCache(db, consultaResumoRejeitados(), 300)).rows.map(prepararRejeitado);
  const filtro = { tipos: new Set(TIPOS_REJEICAO), supervisor: '', representante: '', onda: '' };
  const unicos = (chave, rotulo) => [...new Map(clientes.filter((l) => l[chave] != null && l[chave] !== '').map((l) => [String(l[chave]), rotulo(l)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR', { numeric: true }));
  const selecao = (id, rotulo, chave, opcoes, todos) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo),
    h('select', { id, onchange: (ev) => { filtro[chave] = ev.target.value; desenharRejeitados(); } }, h('option', { value: '' }, todos), opcoes.map(([v, t]) => h('option', { value: v }, t))));
  const passa = (l) => (!filtro.supervisor || String(l.supervisor_id) === filtro.supervisor) && (!filtro.representante || String(l.vendedor_id) === filtro.representante) && (!filtro.onda || l.onda === filtro.onda);
  const soma = (ls) => ls.reduce((t, l) => t + l.qtd, 0);

  // Rejeitados: um ou mais tipos, com supervisor, representante e onda
  const tiposRej = h('div', { class: 'rej-tipos' });
  // dados cadastrais completos, tipo, motivo e observação; com mais de um tipo, uma aba para cada
  const botaoRej = h('button', { type: 'button', id: 'exportar-rejeitados', onclick: () => comEspera(botaoRej, async () => {
    const n = await exportarRejeitados(db, { tipos: TIPOS_REJEICAO.filter((t) => filtro.tipos.has(t)), filtro: passa });
    aviso(`Rejeitados exportados: ${n0(n)} clientes.`);
  }) });
  function desenharRejeitados() {
    const contar = (t) => soma(clientes.filter((l) => l.tipo === t && passa(l)));
    montar(tiposRej, TIPOS_REJEICAO.map((t) => h('label', { class: 'ped-opcao' },
      h('input', { type: 'checkbox', dados: { tipo: t }, checked: filtro.tipos.has(t), onchange: (ev) => { if (ev.target.checked) filtro.tipos.add(t); else filtro.tipos.delete(t); desenharRejeitados(); } }),
      h('span', {}, `${NOME_TIPO_REJEICAO[t]} (${n0(contar(t))})`))));
    const total = soma(clientes.filter((l) => filtro.tipos.has(l.tipo) && passa(l)));
    botaoRej.disabled = !total;
    botaoRej.textContent = `Exportar Excel · ${n0(total)} clientes`;
  }
  desenharRejeitados();

  // Base de prospects inteira, com status, representante e onda
  const botaoBase = h('button', { type: 'button', id: 'exportar-base', onclick: () => comEspera(botaoBase, async () => {
    const linhas = (await db.execute(consultaExportarBase())).rows;
    await baixarXlsx(`base-prospects-${hojeSaoPaulo()}.xlsx`, [
      { titulo: 'CNPJ', valor: (l) => formatar.cnpj(l.cnpj), largura: 22 }, { titulo: 'Razão social', valor: (l) => l.razao_social, largura: 48 },
      { titulo: 'Cidade', valor: (l) => l.cidade, largura: 28 }, { titulo: 'UF', valor: (l) => l.uf, largura: 6 }, { titulo: 'Onda', valor: (l) => l.onda ?? '', largura: 8 },
      { titulo: 'Segmento', valor: (l) => l.tipologia_gtm ?? '', largura: 22 }, { titulo: 'Status', valor: (l) => l.status_descricao ?? l.status_nome ?? '', largura: 30 },
      { titulo: 'Representante', valor: (l) => representante(l.vendedor_codigo, l.vendedor_nome), largura: 30 }, { titulo: 'Supervisor', valor: (l) => l.supervisor_nome ?? '', largura: 24 },
    ], linhas, { aba: 'Base de prospects' });
    aviso(`Base exportada: ${n0(linhas.length)} prospects.`);
  }) }, 'Exportar Excel');

  // Pedidos importados dos clientes da base
  const tipoPedido = h('select', { id: 'exportar-pedidos-tipo' }, [['', 'Venda e bonificação'], ['venda', 'Só venda'], ['investimento', 'Só bonificação']].map(([v, t]) => h('option', { value: v }, t)));
  const botaoPed = h('button', { type: 'button', id: 'exportar-pedidos', onclick: () => comEspera(botaoPed, async () => {
    const todos = (await lerPedidos(db, consultaPedidos({ usuario, limite: 50000 }))).rows.filter((p) => p.prospect_id !== null);
    const lista = todos.filter((p) => !tipoPedido.value || p.tipo === tipoPedido.value);
    await baixarPedidos(lista);
    aviso(`Pedidos exportados: ${n0(lista.length)}.`);
  }) }, 'Exportar Excel');

  // Listas por equipe: um PDF da Lista por representante (mesmo layout do Gerar PDF), numa pasta por supervisor, num ZIP
  const listas = { abrangencia: 'validos', onda: '', supervisor: '', contagem: [] };
  const lerContagem = async () => { listas.contagem = (await lerComCache(db, consultaContagemListas({ abrangencia: listas.abrangencia }), 300)).rows; };
  await lerContagem();
  const ondasListas = [...new Set(listas.contagem.map((l) => l.onda).filter((o) => o != null && o !== ''))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
  if (ondasListas.includes('1')) listas.onda = '1';
  const supervisoresListas = [...new Map(listas.contagem.filter((l) => l.supervisor_id != null).map((l) => [String(l.supervisor_id), l.supervisor_nome ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  const passaLista = (l) => (!listas.onda || l.onda === listas.onda) && (!listas.supervisor || String(l.supervisor_id) === listas.supervisor);
  const campoLista = (id, rotulo, chave, opcoes, todos) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo),
    h('select', { id, onchange: async (ev) => { listas[chave] = ev.target.value; if (chave === 'abrangencia') await lerContagem(); desenharListas(); } },
      todos ? h('option', { value: '' }, todos) : null, opcoes.map(([v, t]) => h('option', { value: v, selected: listas[chave] === v }, t))));
  const botaoListas = h('button', { type: 'button', id: 'exportar-listas', onclick: () => comEspera(botaoListas, async () => {
    const linhas = (await db.execute(consultaListasEquipe({ abrangencia: listas.abrangencia, onda: listas.onda || null, supervisorId: listas.supervisor || null }))).rows;
    const pdfs = montarListasEquipe(linhas);
    const nomesStatus = new Map(linhas.map((l) => [l.status_atual, l.status_nome ?? l.status_atual]));
    const hoje = hojeSaoPaulo();
    const filtros = [`Onda: ${listas.onda || 'todas'}`, ABRANGENCIAS[listas.abrangencia].nome, 'Ordem: cidade, bairro e segmento'].join(' · ');
    const arquivos = [];
    for (const [i, l] of pdfs.entries()) {
      botaoListas.textContent = `Gerando ${i + 1} de ${pdfs.length}…`;
      const dados = await gerarPdfLista({
        titulo: listas.onda ? `Onda ${listas.onda}` : 'Todas as ondas', baixar: false, emissao: formatar.data(hoje), filtros,
        representante: `Representante ${l.representante}${l.codigo ? ` · cód. ${l.codigo}` : ''}`, supervisor: `Supervisor ${l.supervisor}`,
        resumo: [['Prospects', l.total], ...STATUS_ORDEM.filter((s) => l.porStatus.get(s)).map((s) => [nomesStatus.get(s), l.porStatus.get(s)])],
        blocos: l.blocos.map((b) => ({ grupo: b.grupo, linhas: b.linhas.map((p) => [p.razao_social ?? '', p.nome_fantasia && p.nome_fantasia !== p.razao_social ? p.nome_fantasia : '',
          formatar.cnpj(p.cnpj), p.endereco ?? '', p.bairro ?? '', p.cidade ? `${p.cidade}/${p.uf ?? ''}` : '', p.telefone ?? '', p.onda ?? '', p.tipologia_gtm ?? '',
          p.status_atual === 'sem_interesse' && p.sem_interesse_origem ? `${p.status_nome} · ${p.sem_interesse_origem}` : p.status_nome ?? '',
          String(p.tentativas ?? 0), formatar.data(p.dt_primeiro_contato) || '—', p.dias_corridos != null ? String(p.dias_corridos) : '—']) })),
      });
      arquivos.push({ caminho: `${l.pasta}/${l.arquivo}`, dados });
    }
    const url = URL.createObjectURL(new Blob([montarZip(arquivos)], { type: 'application/zip' }));
    const a = h('a', { href: url, download: `listas-${listas.onda ? `onda-${listas.onda}` : 'todas-ondas'}-${hoje}.zip` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    aviso(`Listas geradas: ${n0(pdfs.length)} representantes, ${n0(linhas.length)} clientes.`);
  }) });
  const filtrosListas = h('div', { class: 'exp-filtros' });
  function desenharListas() {
    const escolhidas = listas.contagem.filter(passaLista);
    const reps = new Set(escolhidas.map((l) => l.vendedor_id)).size;
    const total = escolhidas.reduce((t, l) => t + Number(l.qtd), 0);
    montar(filtrosListas,
      campoLista('exportar-listas-onda', 'Onda', 'onda', ondasListas.map((o) => [o, `Onda ${o}`]), 'Todas'),
      campoLista('exportar-listas-quem', 'Quem entra', 'abrangencia', Object.entries(ABRANGENCIAS).map(([v, a]) => [v, a.nome])),
      campoLista('exportar-listas-supervisor', 'Supervisor', 'supervisor', supervisoresListas, 'Todos'), botaoListas);
    botaoListas.disabled = !total;
    botaoListas.textContent = `Gerar PDFs · ${n0(reps)} rep. · ${n0(total)} clientes`;
  }
  desenharListas();

  montar(conteudo,
    h('section', { class: 'cartao exp-bloco', id: 'exportar-bloco-listas' }, h('h2', {}, 'Listas por equipe (PDF)'),
      h('p', { class: 'ajuda' }, 'Um PDF da Lista por representante, no mesmo layout do Gerar PDF, em ordem de cidade, bairro e segmento. Vem num arquivo ZIP, com uma pasta por supervisor.'),
      filtrosListas),
    h('section', { class: 'cartao exp-bloco', id: 'exportar-bloco-rejeitados' }, h('h2', {}, 'Rejeitados'),
      h('p', { class: 'ajuda' }, 'Clientes que saíram da prospecção, com os dados cadastrais completos, o motivo e a observação. Marque um ou mais tipos: cada tipo vai numa aba da planilha.'), tiposRej,
      h('div', { class: 'exp-filtros' },
        selecao('exportar-supervisor', 'Supervisor', 'supervisor', unicos('supervisor_id', (l) => l.supervisor_nome ?? '—'), 'Todos'),
        selecao('exportar-representante', 'Representante', 'representante', unicos('vendedor_id', (l) => representante(l.vendedor_codigo, l.vendedor_nome)), 'Todos'),
        selecao('exportar-onda', 'Onda', 'onda', unicos('onda', (l) => `Onda ${l.onda}`), 'Todas'), botaoRej)),
    h('section', { class: 'cartao exp-bloco' }, h('div', {}, h('h2', {}, 'Base de prospects'), h('p', { class: 'ajuda' }, 'A base inteira, com o status atual, o representante e a onda de cada cliente.')), botaoBase),
    h('section', { class: 'cartao exp-bloco' }, h('div', {}, h('h2', {}, 'Pedidos'), h('p', { class: 'ajuda' }, 'Os pedidos importados dos clientes da base, com situação, valor e quem vendeu.')),
      h('div', { class: 'exp-filtros' }, h('div', { class: 'campo' }, h('label', { for: 'exportar-pedidos-tipo' }, 'Tipo'), tipoPedido), botaoPed)));
}
