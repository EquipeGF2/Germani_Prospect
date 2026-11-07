// Avisos da equipe: o que passou do prazo configurado em Parâmetros, numa grade só, quebrada pelos níveis do topo (padrão:
// representante) para saber o que cobrar e de quem. Cards de seleção múltipla escolhem os tipos; Excel e PDF de pendências
// saem do que está escolhido. Tela inicial de administrador, gerente e supervisor (este só a equipe). docs/03 §18
import { bancoApp, lerComCache } from '../db.js';
import { consultaAvisos, consultaParametrosAvisos, consultaParaConferir, contarAvisos, montarGradeAvisos, NIVEIS_AVISOS, pendenciasPorRepresentante,
  prepararAviso, rotuloDesde, textoParametro, TIPO_AVISO, TIPOS_AVISO } from '../../shared/avisos.mjs';
import { niveisPossiveis } from '../../shared/explorar.mjs';
import { veTodasEquipes } from '../../shared/perfis.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, formatar, comEspera, aviso, semRolagem } from '../ui.js';
import { blocoNiveis, documento } from './_pedidos.js';
import { baixarXlsx } from '../planilhas.js';
import { gerarPdfPendencias } from '../relatorio.js';
import { memoriaDaTela } from '../memoria.js';

const CHAVE_NIVEIS = 'germani.avisosNiveis';
const n0 = (x) => formatar.numero(Number(x) || 0);
const plural = (n, um, varios) => `${n0(n)} ${n === 1 ? um : varios}`;
const dias = (a) => (a.atraso == null ? 'nunca registrou' : plural(a.atraso, 'dia', 'dias'));
const representante = (l) => [l.vendedor_codigo, l.vendedor_nome].filter(Boolean).join(' - ');

function lerNiveis(possiveis, padrao) {
  try { const s = JSON.parse(localStorage.getItem(CHAVE_NIVEIS) ?? 'null'); if (Array.isArray(s)) return s.filter((n) => possiveis.includes(n)); } catch { /* padrão */ }
  return padrao;
}

export async function render(conteudo, { usuario }) {
  const db = await bancoApp();
  const [linhas, params] = await Promise.all([lerComCache(db, consultaAvisos({ usuario }), 300), lerComCache(db, consultaParametrosAvisos(), 600)]);
  const avisos = linhas.rows.map(prepararAviso);
  const parametros = Object.fromEntries(params.rows.map((p) => [p.chave, p.valor]));
  const tudo = veTodasEquipes(usuario);
  const possiveis = niveisPossiveis(usuario);
  const nome = (n) => NIVEIS_AVISOS[n].nome;
  const estado = { niveis: lerNiveis(possiveis, tudo ? ['supervisor', 'representante'] : ['representante']), tipos: new Set(TIPOS_AVISO.map((t) => t.id)), abertos: new Set(), editarNiveis: false };
  const memoria = memoriaDaTela('avisos', usuario);   // ao voltar da ficha, os tipos marcados continuam; a grade abre sempre recolhida
  const salvo = memoria.ler();
  if (salvo && JSON.stringify(salvo.niveis) === JSON.stringify(estado.niveis)) Object.assign(estado, { tipos: new Set(salvo.tipos ?? []) });
  const cont = contarAvisos(avisos);
  const area = h('div', { id: 'av-tela', class: 'av-tela' });
  const mudarNiveis = (n) => { estado.niveis = n; estado.abertos = new Set(); try { localStorage.setItem(CHAVE_NIVEIS, JSON.stringify(n)); } catch { /* só nesta visita */ } desenhar(); };
  const escolhidos = () => avisos.filter((a) => estado.tipos.has(a.tipo));

  const botaoExcel = h('button', { type: 'button', class: 'secundario', id: 'excel-avisos', onclick: () => comEspera(botaoExcel, async () => {
    const lista = escolhidos();
    await baixarXlsx(`avisos-${hojeSaoPaulo()}.xlsx`, [
      { titulo: 'Supervisor', valor: (l) => l.supervisor_nome ?? '', largura: 24 }, { titulo: 'Representante', valor: representante, largura: 32 },
      { titulo: 'Aviso', valor: (l) => TIPO_AVISO[l.tipo].nome, largura: 30 }, { titulo: 'Código', valor: (l) => l.codigo_cliente_erp ?? '', largura: 10 },
      { titulo: 'Razão social', valor: (l) => l.razao_social ?? '', largura: 40 }, { titulo: 'CNPJ', valor: (l) => documento(l.cnpj), largura: 20 },
      { titulo: 'Cidade', valor: (l) => [l.cidade, l.uf].filter(Boolean).join('/'), largura: 22 }, { titulo: 'Rota', valor: (l) => l.rota ?? '', largura: 16 },
      { titulo: 'Desde', valor: (l) => formatar.data(l.data_ref), largura: 12 }, { titulo: 'O que é a data', valor: (l) => rotuloDesde(l, parametros), largura: 18 },
      { titulo: 'Atraso (dias)', valor: (l) => l.atraso ?? 'nunca registrou', largura: 14 },
    ], lista, { aba: 'Avisos' });
    aviso(`Excel gerado: ${plural(lista.length, 'aviso', 'avisos')}.`);
  }) }, 'Excel');
  // PDF de pendências: resumo da equipe e uma página por representante, com o que cobrar e espaço para o combinado
  const botaoPdf = h('button', { type: 'button', id: 'pdf-avisos', onclick: () => comEspera(botaoPdf, async () => {
    const conferir = (await lerComCache(db, consultaParaConferir({ usuario }), 120)).rows;
    const reps = pendenciasPorRepresentante(escolhidos(), conferir);
    const hoje = hojeSaoPaulo();
    for (const r of reps) for (const a of r.avisos) a.desdeRotulo = rotuloDesde(a, parametros);
    await gerarPdfPendencias({ reps, tipos: TIPOS_AVISO.filter((t) => estado.tipos.has(t.id)).map((t) => ({ ...t, textoParam: textoParametro(t.id, parametros) })),
      equipe: tudo ? 'Todas as equipes' : `Equipe: ${usuario.nome}`, comSupervisor: tudo, emissao: formatar.data(hoje), nomeArquivo: `pendencias-${hoje}.pdf` });
  }) }, 'PDF de pendências');

  function cards() {
    const todos = estado.tipos.size === TIPOS_AVISO.length;
    const cartao = ({ id, titulo, numero, regra, param, ligado, cor, onclick }) => h('button', { type: 'button', class: `av-card${ligado ? ' ligado' : ''}`, id: `av-${id}`, 'aria-pressed': ligado ? 'true' : 'false', onclick },
      h('span', { class: 'av-card-topo' }, h('span', { class: 'caixa', 'aria-hidden': 'true' }, ligado ? '✓' : ''), h('span', { class: 'tit' }, titulo)),
      h('b', { class: cor }, n0(numero)), h('span', { class: 'regra' }, regra), h('span', { class: 'param' }, param));
    return h('section', { class: 'av-cards', id: 'av-cards', 'aria-label': 'Tipos de aviso (escolha um ou mais)' },
      cartao({ id: 'todos', titulo: 'Todos os avisos', numero: cont.total, regra: 'Marca ou desmarca todos os tipos de uma vez.', param: tudo ? 'Todas as equipes' : 'Sua equipe', ligado: todos, cor: '',
        onclick: () => { estado.tipos = todos ? new Set() : new Set(TIPOS_AVISO.map((t) => t.id)); desenhar(); } }),
      TIPOS_AVISO.map((t) => cartao({ id: t.id, titulo: t.curto, numero: cont[t.id], regra: t.regra, param: textoParametro(t.id, parametros), ligado: estado.tipos.has(t.id),
        cor: t.id === 'parado' ? 'medio' : 'alto',
        onclick: () => { if (estado.tipos.has(t.id)) estado.tipos.delete(t.id); else estado.tipos.add(t.id); desenhar(); } })));
  }

  function grade() {
    const lista = escolhidos();
    const tipos = TIPOS_AVISO.filter((t) => estado.tipos.has(t.id));
    const titulo = tipos.length === TIPOS_AVISO.length ? 'Todos os avisos' : tipos.length === 1 ? tipos[0].nome : plural(tipos.length, 'aviso escolhido', 'avisos escolhidos');
    const sub = `${plural(lista.length, 'pendência', 'pendências')}${estado.niveis.length ? ` · por ${estado.niveis.map(nome).join(' › ')}` : ''} · mais atrasados primeiro`;
    botaoExcel.disabled = !lista.length; botaoPdf.disabled = !lista.length;
    const comRep = estado.niveis.includes('representante');
    const linhas = montarGradeAvisos({ avisos: lista, niveis: estado.niveis, abertos: estado.abertos });
    const recuo = (prof) => `padding-left:${12 + prof * 22}px`;
    const corpo = linhas.map((l) => {
      if (l.grupo) {
        const alternar = () => { if (l.aberto) estado.abertos.delete(l.caminho); else estado.abertos.add(l.caminho); desenhar(); };
        return h('tr', { class: `av-grupo${l.prof ? '' : ' raiz'}`, dados: { caminho: l.caminho } }, h('td', { colspan: 6, style: recuo(l.prof) },
          h('button', { type: 'button', class: 'av-abre', 'aria-expanded': l.aberto ? 'true' : 'false', onclick: alternar },
            h('span', { class: 'seta', 'aria-hidden': 'true' }, l.aberto ? '▼' : '▶'), h('b', {}, l.rotulo),
            h('span', { class: 'qtd' }, plural(l.avisos.length, 'aviso', 'avisos')), h('span', { class: 'resumo' }, l.resumo))));
      }
      const a = l.aviso; const t = TIPO_AVISO[a.tipo]; const doRep = a.tipo === 'sem_lancar';
      const sub = doRep ? (comRep ? 'do representante' : representante(a)) : [documento(a.cnpj), comRep ? null : representante(a)].filter(Boolean).join(' · ');
      const acao = doRep
        ? h('a', { href: `#/carteira?${new URLSearchParams({ vendedorId: a.vendedor_id, ...(a.supervisor_id ? { supervisorId: a.supervisor_id } : {}), ver: '1', de: 'explorar' })}` }, 'Ver carteira')
        : h('a', { href: `#/ficha?id=${a.prospect_id}` }, 'Abrir ficha');
      return h('tr', { class: 'av-item', dados: { tipo: a.tipo } },
        h('td', { class: 'rz', 'data-r': 'Cliente', style: recuo(l.prof) }, h('b', { class: 'nome', title: doRep ? '' : a.razao_social }, doRep ? 'Nenhum atendimento lançado' : `${a.codigo_cliente_erp ? `${a.codigo_cliente_erp} - ` : ''}${a.razao_social}`),
          h('small', {}, sub)),
        h('td', { class: 'cen', 'data-r': 'Aviso' }, h('span', { class: `selo av-tipo ${a.tipo}` }, t.curto)),
        h('td', { 'data-r': 'Cidade' }, doRep ? '—' : [a.cidade, a.uf].filter(Boolean).join('/')),
        h('td', { class: 'cen', 'data-r': 'Desde' }, a.data_ref ? formatar.data(a.data_ref) : '—', h('small', {}, rotuloDesde(a, parametros))),
        h('td', { class: 'cen', 'data-r': 'Atraso' }, h('span', { class: 'selo erro' }, dias(a))),
        h('td', { class: 'cen', 'data-r': '' }, acao));
    });
    return h('section', { class: 'cartao av-grade', 'aria-label': 'Avisos escolhidos' },
      h('div', { class: 'av-grade-topo' }, h('h2', {}, titulo), h('span', { class: 'sub' }, sub), h('span', { class: 'espaco' }), botaoExcel, botaoPdf),
      !lista.length ? h('p', { class: 'ajuda av-vazio' }, estado.tipos.size ? 'Nenhum aviso destes tipos: tudo em dia.' : 'Escolha um ou mais avisos nos cards acima.')
        : semRolagem(h('div', { class: 'tabela-wrap' }, h('table', { class: 'av-tabela' },
          h('thead', {}, h('tr', {}, [comRep ? 'Cliente · CNPJ' : 'Cliente · CNPJ · Rep.', 'Aviso', 'Cidade', 'Desde', 'Atraso', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, corpo)))));
  }

  function desenhar() {
    memoria.guardar({ niveis: estado.niveis, tipos: [...estado.tipos] });
    montar(area, ...blocoNiveis({ estado, possiveis, nome, mudarNiveis, desenhar }), cards(), grade());
  }

  desenhar();
  montar(conteudo, h('div', { class: 'exp-topo' }, h('h1', {}, tudo ? 'Avisos' : 'Avisos da equipe')),
    h('p', { class: 'ajuda acf-frase' }, 'O que passou do prazo configurado em Parâmetros. Escolha os níveis e um ou mais avisos: a grade segue a escolha. O aviso some sozinho quando o cliente avança ou o representante registra.'), area);
}
