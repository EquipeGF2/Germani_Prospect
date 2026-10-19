// Registro no app: Atendido · Sem interesse (motivo) · Reabrir com pedido identificado. docs/03 §2
// "Não atendido" não gera registro. A data é a do aparelho; o banco confere tudo de novo (triggers).
import { bancoApp } from '../db.js';
import { ajustarFicha, consultaFicha } from '../../shared/carteira.mjs';
import { comandoRegistrarContato, listarMotivos } from '../../shared/registro.mjs';
import { CANAIS, ROTULOS_RESULTADO, validarContato } from '../../shared/status.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { mensagemErro } from '../../shared/gravacao.mjs';
import { h, montar, mensagem, aviso, comEspera, formatar } from '../ui.js';
import { seloStatus } from './_carteira.js';

export const NOMES_CANAL = { visita: 'Visita', telefone: 'Telefone', whatsapp: 'WhatsApp' };

export function campoMotivo(motivos, { id = 'motivo', vazio = 'Selecione o motivo', valor = '' } = {}) {
  return h('select', { id, 'aria-label': 'Motivo' }, h('option', { value: '' }, vazio),
    motivos.map((m) => h('option', { value: m.id, selected: String(m.id) === String(valor) }, m.descricao)));
}

export async function render(conteudo, ctx) {
  const { usuario, parametros, irPara } = ctx;
  const db = await bancoApp();
  const id = Number(parametros.get('id'));
  const linha = id ? (await db.execute(consultaFicha({ usuario, prospectId: id }))).rows[0] : null;
  if (!linha || usuario.perfil === 'financeiro') return montar(conteudo, mensagem('Prospect não encontrado ou fora da sua carteira.', 'erro'));
  const p = ajustarFicha(usuario, linha);
  if (!Number(p.aceita_contato)) {
    return montar(conteudo, mensagem(`${p.status_nome}: este cliente não aceita novo registro.`, 'info'),
      h('a', { href: `#/ficha?id=${id}` }, '‹ Voltar à ficha'));
  }
  const motivos = await listarMotivos(db);
  const hoje = hojeSaoPaulo();
  // reabrir com pedido só faz sentido para quem está "sem interesse"
  const resultados = ['atendido', 'sem_interesse', ...(p.status_atual === 'sem_interesse' ? ['pedido_informado'] : [])];
  let resultado = '';

  const opcoes = h('div', { class: 'opcoes-resultado', role: 'radiogroup' }, resultados.map((r) => h('label', { class: `opcao ${r}` },
    h('input', { type: 'radio', name: 'resultado', value: r, onchange: () => { resultado = r; atualizar(); } }),
    h('span', {}, ROTULOS_RESULTADO[r]))));
  const canal = h('select', { id: 'canal', 'aria-label': 'Canal' }, CANAIS.map((c) => h('option', { value: c }, NOMES_CANAL[c])));
  const data = h('input', { type: 'date', id: 'data-contato', value: hoje, max: hoje, min: p.dt_ultimo_contato ?? null });
  const motivo = campoMotivo(motivos);
  const observacao = h('textarea', { id: 'observacao', rows: 3, maxlength: 500, placeholder: 'Opcional' });
  const rotuloObs = h('label', { for: 'observacao' }, 'Observação');
  const retorno = h('input', { type: 'date', id: 'data-retorno', min: hoje });
  const dataPedido = h('input', { type: 'date', id: 'data-pedido', max: hoje });
  const blocoMotivo = h('div', { class: 'campo oculto' }, h('label', { for: 'motivo' }, 'Motivo *'), motivo);
  const blocoPedido = h('div', { class: 'campo oculto' }, h('label', { for: 'data-pedido' }, 'Data de entrada do pedido *'), dataPedido);
  const blocoRetorno = h('div', { class: 'campo oculto' }, h('label', { for: 'data-retorno' }, 'Retornar em (opcional)'), retorno);
  const erros = h('div');
  const botao = h('button', { type: 'submit', disabled: true }, 'Gravar registro');

  function atualizar() {
    blocoMotivo.classList.toggle('oculto', resultado !== 'sem_interesse');
    blocoPedido.classList.toggle('oculto', resultado !== 'pedido_informado');
    blocoRetorno.classList.toggle('oculto', resultado === 'sem_interesse' || !resultado); // retorno só na negociação
    botao.disabled = !resultado;
    // observação obrigatória só quando não há interesse e o motivo exige descrição ("Outros")
    const m = motivos.find((x) => String(x.id) === motivo.value);
    const exige = resultado === 'sem_interesse' && Boolean(m && Number(m.exige_observacao));
    rotuloObs.textContent = exige ? 'Observação *' : 'Observação';
    observacao.placeholder = exige ? 'Obrigatória: descreva o motivo' : 'Opcional';
  }
  motivo.addEventListener('change', atualizar);

  async function gravar(ev) {
    ev.preventDefault();
    const m = motivos.find((x) => String(x.id) === motivo.value);
    const dados = {
      canal: canal.value, resultado, dataContato: data.value, observacao: observacao.value,
      motivoId: resultado === 'sem_interesse' && m ? Number(m.id) : null, motivoExigeObservacao: Boolean(m && Number(m.exige_observacao)),
      dataRetorno: resultado !== 'sem_interesse' && retorno.value ? retorno.value : null, dataPedido: resultado === 'pedido_informado' ? dataPedido.value || null : null,
    };
    const lista = validarContato(dados);
    if (data.value > hoje) lista.push('a data do registro não pode ser futura');
    if (p.dt_ultimo_contato && data.value < p.dt_ultimo_contato) lista.push(`a data não pode ser anterior ao último registro (${formatar.data(p.dt_ultimo_contato)})`);
    montar(erros, lista.length ? mensagem(lista.join('; '), 'erro') : null);
    if (lista.length) return;
    const ok = await comEspera(botao, async () => {
      try { await db.execute(comandoRegistrarContato({ usuario, prospect: p, ...dados })); }
      catch (e) { throw new Error(mensagemErro(e)); }
      return true;
    });
    if (ok) { aviso(`${ROTULOS_RESULTADO[resultado]} registrado.`); irPara(`/ficha?id=${id}`); }
  }

  montar(conteudo,
    h('a', { href: `#/ficha?id=${id}`, class: 'voltar' }, '‹ Voltar à ficha'),
    h('h1', { style: 'margin-top:8px' }, 'Registrar atendimento'),
    h('div', { class: 'cartao' },
      h('div', { class: 'cartao-prospect-topo' }, h('b', {}, p.razao_social), seloStatus(p)),
      h('div', { class: 'ajuda', style: 'margin:4px 0 0' }, `${formatar.cnpj(p.cnpj)} · ${p.cidade ?? ''} · ${p.status_descricao}`)),
    h('form', { class: 'cartao', onsubmit: gravar },
      h('p', { class: 'ajuda', style: 'margin-top:0' }, 'Não atendeu? Não precisa registrar. Atendido vai para "Aguardando cadastro"; sem interesse sai da lista principal.'),
      opcoes,
      h('div', { class: 'linha-campos' },
        h('div', { class: 'campo' }, h('label', { for: 'canal' }, 'Canal'), canal),
        h('div', { class: 'campo' }, h('label', { for: 'data-contato' }, 'Data do registro'), data),
        blocoRetorno),
      blocoMotivo, blocoPedido,
      h('div', { class: 'campo' }, rotuloObs, observacao),
      erros,
      h('div', { class: 'acoes' }, botao, h('a', { class: 'botao secundario', href: `#/ficha?id=${id}` }, 'Cancelar'))));
}
