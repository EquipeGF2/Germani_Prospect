// Registro em lote: Atendido ou Sem interesse (do cliente / do representante). docs/03 §2.1
// Sem interesse: justificativa para o lote todo e/ou por cliente. Atendido: sem motivo, com retorno opcional.
// Cada item vira um registro normal (mesmas regras do banco); se um for recusado, os outros ficam gravados.
import { bancoApp } from '../db.js';
import { ajustarFicha, consultaFicha } from '../../shared/carteira.mjs';
import { listarMotivos } from '../../shared/registro.mjs';
import { prepararLote, registrarLote } from '../../shared/lote.mjs';
import { motivosDaOrigem, ORIGENS_SEM_INTERESSE, ROTULOS_RESULTADO } from '../../shared/status.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { h, montar, mensagem, comEspera, formatar, numeros } from '../ui.js';
import { gravarLote, lerLote } from './_carteira.js';
import { campoCanal, campoMotivo } from './registrar.js';

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
    return montar(conteudo, h('h1', {}, 'Registro em lote'),
      mensagem('Nenhum prospect selecionado. Marque os clientes na lista principal.', 'info'), h('a', { class: 'botao', href: '#/carteira' }, 'Ir para a lista'));
  }
  const motivos = await listarMotivos(db);
  const porId = Object.fromEntries(motivos.map((m) => [m.id, { exige_observacao: Number(m.exige_observacao) }]));
  const hoje = hojeSaoPaulo();
  const ultimo = prospects.map((p) => p.dt_ultimo_contato).filter(Boolean).sort().pop() ?? null;
  // registro do lote todo: atendido ou sem interesse (cada origem tem os seus motivos); começa sem escolha
  const registro = h('select', { id: 'registro-lote', 'aria-label': 'Registro', required: true, onchange: () => trocarRegistro() },
    h('option', { value: '' }, 'Escolha o registro'),
    h('option', { value: 'atendido' }, ROTULOS_RESULTADO.atendido),
    Object.entries(ORIGENS_SEM_INTERESSE).map(([o, d]) => h('option', { value: `sem_interesse:${o}` }, d.rotulo)));
  const [resultadoDe, origemDe] = [() => registro.value.split(':')[0], () => registro.value.split(':')[1] ?? 'cliente'];
  const opcoesMotivo = (vazio) => [h('option', { value: '' }, vazio),
    motivosDaOrigem(motivos, origemDe()).map((m) => h('option', { value: m.id }, m.descricao))];
  const motivo = campoMotivo(motivosDaOrigem(motivos, 'cliente'), { id: 'motivo-lote', vazio: 'Motivo do lote' });
  const observacao = h('input', { id: 'obs-lote', maxlength: 500, placeholder: 'Observação para todos (opcional)' });
  const canal = campoCanal('canal-lote');
  const data = h('input', { type: 'date', id: 'data-lote', value: hoje, max: hoje, min: ultimo });
  const retorno = h('input', { type: 'date', id: 'retorno-lote', min: hoje });
  const individuais = new Map(prospects.map((p) => [Number(p.id), {
    motivo: campoMotivo(motivosDaOrigem(motivos, 'cliente'), { id: `motivo-${p.id}`, vazio: '(o do lote)' }),
    observacao: h('input', { maxlength: 500, placeholder: '(a do lote)', 'aria-label': `Observação ${p.razao_social}` }),
  }]));
  const blocoMotivo = h('div', { class: 'campo oculto' }, h('label', { for: 'motivo-lote' }, 'Motivo do lote'), motivo);
  const blocoRetorno = h('div', { class: 'campo oculto' }, h('label', { for: 'retorno-lote' }, 'Retornar em (opcional)'), retorno);
  const explicacao = h('p', { class: 'ajuda', style: 'margin-top:0' }, 'Escolha o registro que vale para todos os clientes marcados.');
  // atendido não tem motivo: some o motivo (do lote e de cada cliente) e aparece o retorno
  function trocarRegistro() {
    const semInteresse = resultadoDe() === 'sem_interesse';
    montar(motivo, opcoesMotivo('Motivo do lote'));
    for (const c of individuais.values()) { montar(c.motivo, opcoesMotivo('(o do lote)')); c.motivo.classList.toggle('oculto', !semInteresse); }
    blocoMotivo.classList.toggle('oculto', !semInteresse);
    blocoRetorno.classList.toggle('oculto', resultadoDe() !== 'atendido');
    explicacao.textContent = !registro.value ? 'Escolha o registro que vale para todos os clientes marcados.'
      : semInteresse ? 'O motivo e a observação do lote valem para todos; o que for informado no cliente vale só para ele.'
        : 'Todos passam para Aguardando cadastro. A observação do cliente vale só para ele.';
    botao.disabled = !registro.value;
  }
  const resultado = h('div');
  const botao = h('button', { type: 'submit', disabled: true }, `Gravar ${prospects.length} registro(s)`);
  for (const c of individuais.values()) c.motivo.classList.add('oculto');

  async function gravar(ev) {
    ev.preventDefault();
    const ind = {};
    for (const [id, c] of individuais) {
      const item = {};
      if (c.motivo.value && resultadoDe() === 'sem_interesse') item.motivoId = Number(c.motivo.value);
      if (c.observacao.value.trim()) item.observacao = c.observacao.value.trim();
      if (Object.keys(item).length) ind[id] = item;
    }
    const preparado = prepararLote({
      usuario, prospects: prospects.map((p) => ({ id: Number(p.id), tentativas: p.tentativas })), individuais: ind, motivos: porId,
      comum: { resultado: resultadoDe(), canal: canal.value, dataContato: data.value,
        motivoId: resultadoDe() === 'sem_interesse' && motivo.value ? Number(motivo.value) : null,
        dataRetorno: resultadoDe() === 'atendido' && retorno.value ? retorno.value : null,
        observacao: observacao.value, dataHoraDispositivo: new Date().toISOString() },
    });
    const invalidos = preparado.itens.filter((i) => i.erros.length);
    if (invalidos.length) {
      return montar(resultado, mensagem(invalidos.map((i) => `${prospects.find((p) => Number(p.id) === i.prospectId).razao_social}: ${i.erros.join('; ')}`).join(' · '), 'erro'));
    }
    const gravadoComo = resultadoDe() === 'atendido' ? 'Aguardando cadastro' : 'Sem interesse';
    const r = await comEspera(botao, () => registrarLote(db, preparado));
    if (!r) return;
    const recusados = new Set(r.recusados.map((x) => x.prospectId));
    gravarLote([...recusados]);
    montar(conteudo, h('h1', {}, 'Lote gravado'),
      numeros([['gravados', r.gravados, 'ok'], ['recusados', r.recusados.length, r.recusados.length ? 'erro' : '']]),
      r.recusados.length ? mensagem(r.recusados.map((x) => `${prospects.find((p) => Number(p.id) === x.prospectId)?.razao_social}: ${x.erros.join('; ')}`).join(' · '), 'erro') : null,
      h('p', { class: 'ajuda' }, `Os clientes gravados saíram da lista principal e aparecem no Acompanhamento como "${gravadoComo}".`),
      h('div', { class: 'acoes' }, h('a', { class: 'botao', href: '#/carteira' }, 'Voltar à lista'),
        h('a', { class: 'botao secundario', href: '#/carteira?aba=acompanhamento' }, 'Ver no Acompanhamento')));
  }

  montar(conteudo,
    h('a', { href: '#/carteira', class: 'voltar' }, '‹ Voltar à lista'),
    h('h1', { style: 'margin-top:8px' }, 'Registro em lote'),
    h('form', { onsubmit: gravar },
      h('div', { class: 'cartao' },
        explicacao,
        h('div', { class: 'linha-campos' },
          h('div', { class: 'campo' }, h('label', { for: 'registro-lote' }, 'Registro'), registro),
          blocoMotivo, blocoRetorno,
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
