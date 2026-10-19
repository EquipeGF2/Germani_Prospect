// "Sem interesse" em lote: justificativa para o lote todo e/ou por cliente. docs/03 §2.1
// Cada item vira um registro normal (mesmas regras do banco); se um for recusado, os outros ficam gravados.
import { bancoApp } from '../db.js';
import { ajustarFicha, consultaFicha } from '../../shared/carteira.mjs';
import { listarMotivos } from '../../shared/registro.mjs';
import { prepararLote, registrarLote } from '../../shared/lote.mjs';
import { CANAIS } from '../../shared/status.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, comEspera, formatar, numeros } from '../ui.js';
import { gravarLote, lerLote } from './_carteira.js';
import { campoMotivo, NOMES_CANAL } from './registrar.js';

export async function render(conteudo, ctx) {
  const { usuario } = ctx;
  const db = await bancoApp();
  if (usuario.perfil === 'financeiro') return montar(conteudo, mensagem('O analista financeiro não registra atendimentos.', 'erro'));
  const prospects = [];
  for (const id of lerLote()) {
    const p = (await db.execute(consultaFicha({ usuario, prospectId: id }))).rows[0];
    if (p && Number(p.na_lista)) prospects.push(ajustarFicha(usuario, p));
  }
  if (!prospects.length) {
    return montar(conteudo, h('h1', {}, 'Sem interesse em lote'),
      mensagem('Nenhum prospect selecionado. Marque os clientes na lista principal.', 'info'), h('a', { class: 'botao', href: '#/carteira' }, 'Ir para a lista'));
  }
  const motivos = await listarMotivos(db);
  const porId = Object.fromEntries(motivos.map((m) => [m.id, { exige_observacao: Number(m.exige_observacao) }]));
  const hoje = hojeSaoPaulo();
  const ultimo = prospects.map((p) => p.dt_ultimo_contato).filter(Boolean).sort().pop() ?? null;
  const motivo = campoMotivo(motivos, { id: 'motivo-lote', vazio: 'Motivo do lote' });
  const observacao = h('input', { id: 'obs-lote', maxlength: 500, placeholder: 'Observação para todos (opcional)' });
  const canal = h('select', { id: 'canal-lote', 'aria-label': 'Canal' }, CANAIS.map((c) => h('option', { value: c }, NOMES_CANAL[c])));
  const data = h('input', { type: 'date', id: 'data-lote', value: hoje, max: hoje, min: ultimo });
  const individuais = new Map(prospects.map((p) => [Number(p.id), {
    motivo: campoMotivo(motivos, { id: `motivo-${p.id}`, vazio: '(o do lote)' }),
    observacao: h('input', { maxlength: 500, placeholder: '(a do lote)', 'aria-label': `Observação ${p.razao_social}` }),
  }]));
  const resultado = h('div');
  const botao = h('button', { type: 'submit' }, `Gravar ${prospects.length} registro(s)`);

  async function gravar(ev) {
    ev.preventDefault();
    const ind = {};
    for (const [id, c] of individuais) {
      const item = {};
      if (c.motivo.value) item.motivoId = Number(c.motivo.value);
      if (c.observacao.value.trim()) item.observacao = c.observacao.value.trim();
      if (Object.keys(item).length) ind[id] = item;
    }
    const preparado = prepararLote({
      usuario, prospects: prospects.map((p) => ({ id: Number(p.id), tentativas: p.tentativas })), individuais: ind, motivos: porId,
      comum: { resultado: 'sem_interesse', canal: canal.value, dataContato: data.value, motivoId: motivo.value ? Number(motivo.value) : null,
        observacao: observacao.value, dataHoraDispositivo: new Date().toISOString() },
    });
    const invalidos = preparado.itens.filter((i) => i.erros.length);
    if (invalidos.length) {
      return montar(resultado, mensagem(invalidos.map((i) => `${prospects.find((p) => Number(p.id) === i.prospectId).razao_social}: ${i.erros.join('; ')}`).join(' · '), 'erro'));
    }
    const r = await comEspera(botao, () => registrarLote(db, preparado));
    if (!r) return;
    const recusados = new Set(r.recusados.map((x) => x.prospectId));
    gravarLote([...recusados]);
    montar(conteudo, h('h1', {}, 'Lote gravado'),
      numeros([['gravados', r.gravados, 'ok'], ['recusados', r.recusados.length, r.recusados.length ? 'erro' : '']]),
      r.recusados.length ? mensagem(r.recusados.map((x) => `${prospects.find((p) => Number(p.id) === x.prospectId)?.razao_social}: ${x.erros.join('; ')}`).join(' · '), 'erro') : null,
      h('p', { class: 'ajuda' }, 'Os clientes gravados saíram da lista principal e aparecem no acompanhamento como "Sem interesse".'),
      h('div', { class: 'acoes' }, h('a', { class: 'botao', href: '#/carteira' }, 'Voltar à lista'),
        h('a', { class: 'botao secundario', href: '#/carteira?aba=acompanhamento&status=sem_interesse' }, 'Ver sem interesse')));
  }

  montar(conteudo,
    h('a', { href: '#/carteira', class: 'voltar' }, '‹ Voltar à lista'),
    h('h1', { style: 'margin-top:8px' }, 'Sem interesse em lote'),
    h('form', { onsubmit: gravar },
      h('div', { class: 'cartao' },
        h('p', { class: 'ajuda', style: 'margin-top:0' }, 'O motivo e a observação do lote valem para todos; o que for informado no cliente vale só para ele.'),
        h('div', { class: 'linha-campos' },
          h('div', { class: 'campo' }, h('label', { for: 'motivo-lote' }, 'Motivo do lote'), motivo),
          h('div', { class: 'campo' }, h('label', { for: 'canal-lote' }, 'Canal'), canal),
          h('div', { class: 'campo' }, h('label', { for: 'data-lote' }, 'Data do registro'), data)),
        h('div', { class: 'campo' }, h('label', { for: 'obs-lote' }, 'Observação do lote'), observacao)),
      h('div', { class: 'lista-prospects' }, prospects.map((p) => {
        const c = individuais.get(Number(p.id));
        return h('div', { class: 'cartao-prospect lote-item' },
          h('div', { style: 'flex:1;min-width:0' },
            h('b', {}, p.razao_social), h('div', { class: 'ajuda', style: 'margin:2px 0 8px' }, `${formatar.cnpj(p.cnpj)} · ${p.cidade ?? ''}`),
            h('div', { class: 'linha-campos' }, c.motivo, c.observacao)),
          h('button', { type: 'button', class: 'secundario pequeno', 'aria-label': `Tirar ${p.razao_social}`, onclick: () => {
            gravarLote(lerLote().filter((x) => Number(x) !== Number(p.id))); render(conteudo, ctx);
          } }, 'Tirar'));
      })),
      resultado,
      h('div', { class: 'acoes' }, botao)));
}
