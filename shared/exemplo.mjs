// Dados de exemplo para o MODO DEMONSTRAÇÃO (banco temporário do navegador). Nunca usar em produção.
// Usa as mesmas rotinas da operação real — importação da base, lista de tipos, registro de atendimento,
// arquivos do ERP e console de crédito — para que regras, status e histórico de movimentação sejam os de verdade.
// Sorteio com semente fixa: o mesmo resultado em toda carga.
import { importarBase } from './importar-base.mjs';
import { importarTipos } from './importar-tipos.mjs';
import { importarEventos } from './importar-eventos.mjs';
import { comandoRegistrarContato, listarMotivos } from './registro.mjs';
import { comandoLiberarCredito } from './financeiro.mjs';
import { somarDias } from './datas.mjs';
import { normalizarBusca } from './texto.mjs';

export const SENHA_EXEMPLO = 'demo1234';

function sorteio(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const util = (iso) => { const d = new Date(`${iso}T12:00:00Z`).getUTCDay(); return d !== 0 && d !== 6; };
function proximoUtil(iso, n) {
  let d = iso;
  for (let k = 0; k < n || !util(d); ) { d = somarDias(d, 1); if (util(d)) k++; }
  return d;
}

/**
 * @param linhasBase  planilha base fictícia (exemplos/base-ficticia.xlsx) já lida
 * @param mapaStatus  config/mapa-status-planilha.json normalizado
 * @param gerarHash   gerarHashSenha (shared/senha.mjs)
 * @returns resumo do que foi gerado
 */
export async function carregarExemplo(db, { linhasBase, mapaStatus, hoje, gerarHash }) {
  if (Number((await db.execute('SELECT count(*) n FROM prospects')).rows[0].n)) throw new Error('a base já tem prospects: os dados de exemplo só entram num banco vazio');
  const quem = 'dados de exemplo';
  await importarBase(db, { linhas: linhasBase, arquivoNome: 'base-ficticia.xlsx (exemplo)', arquivoSha256: 'exemplo', executadoPor: quem, mapaStatus, hoje });

  // vendedores × representantes (alternados) e acesso de todos com a mesma senha
  const vend = (await db.execute("SELECT codigo_erp FROM usuarios WHERE perfil = 'vendedor' ORDER BY codigo_erp")).rows;
  await importarTipos(db, { linhas: [['COD', 'TIPO'], ...vend.map((v, i) => [v.codigo_erp, i % 2 ? 'Representante' : 'Vendedor'])],
    arquivoNome: 'tipos (exemplo)', arquivoSha256: 'exemplo', executadoPor: quem });
  const hash = await gerarHash(SENHA_EXEMPLO);
  await db.execute({ sql: "UPDATE usuarios SET senha_hash = ?, senha_provisoria = 0 WHERE perfil IN ('vendedor','supervisor')", args: [hash] });
  for (const [perfil, login, nome] of [['gerente', 'gerente', 'Gerente Comercial (exemplo)'], ['financeiro', 'financeiro', 'Analista Financeiro (exemplo)']]) {
    await db.execute({ sql: 'INSERT INTO usuarios (perfil, nome, nome_busca, login, senha_hash, senha_provisoria) VALUES (?, ?, ?, ?, ?, 0)',
      args: [perfil, nome, normalizarBusca(nome), login, hash] });
  }
  const analista = { id: Number((await db.execute("SELECT id FROM usuarios WHERE login = 'financeiro'")).rows[0].id), perfil: 'financeiro' };

  // janela da campanha: do início (parâmetro) até hoje; se a campanha ainda não começou, as últimas 3 semanas
  const inicioParam = (await db.execute("SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'")).rows[0]?.valor;
  const inicio = inicioParam && inicioParam < hoje ? inicioParam : somarDias(hoje, -21);
  const dias = [];
  for (let d = inicio; d <= hoje; d = somarDias(d, 1)) if (util(d)) dias.push(d);
  const r = sorteio(20261001);
  const escolher = (lista) => lista[Math.floor(r() * lista.length)];
  const motivos = (await listarMotivos(db)).filter((m) => !Number(m.exige_observacao));

  // 1) atendimentos e "sem interesse" registrados pelos próprios vendedores
  const lista = (await db.execute("SELECT id, cnpj, tentativas, dt_ultimo_contato, vendedor_id FROM vw_prospects WHERE na_lista = 1 ORDER BY id")).rows;
  const atendidos = [];
  let contatos = 0;
  for (const p of lista) {
    if (r() < 0.42) continue;   // continua sem contato
    let data = escolher(dias);
    if (p.dt_ultimo_contato && data < p.dt_ultimo_contato) data = p.dt_ultimo_contato > hoje ? hoje : p.dt_ultimo_contato;
    const semInteresse = r() < 0.36;
    await db.execute(comandoRegistrarContato({
      usuario: { id: Number(p.vendedor_id) }, prospect: p, canal: escolher(['visita', 'visita', 'telefone', 'whatsapp']),
      resultado: semInteresse ? 'sem_interesse' : 'atendido', motivoId: semInteresse ? Number(escolher(motivos).id) : null,
      dataContato: data, dataHoraDispositivo: `${data}T14:00:00.000Z`,
    }));
    contatos++;
    if (!semInteresse) atendidos.push({ ...p, data });
  }

  // 2) arquivo de cadastro do ERP (parte dos atendidos) → Análise financeira
  const cadastrados = [];
  for (const p of atendidos) {
    if (r() >= 0.62) continue;
    const data = proximoUtil(p.data, 2 + Math.floor(r() * 4));
    if (data <= hoje) cadastrados.push({ ...p, data, codigo: `C${String(p.id).padStart(5, '0')}` });
  }
  if (cadastrados.length) {
    await importarEventos(db, { tipo: 'cadastro', linhas: [['CNPJ', 'DATA', 'CODIGO'], ...cadastrados.map((c) => [c.cnpj, c.data, c.codigo])],
      colunas: { cnpj: 'CNPJ', data: 'DATA', documento: 'CODIGO' }, hoje, arquivoNome: 'cadastro (exemplo)', arquivoSha256: 'exemplo', executadoPor: quem });
  }

  // 3) OK do financeiro no console → Aguardando pedido
  const liberados = [];
  for (const c of cadastrados) {
    if (r() >= 0.7) continue;
    const data = proximoUtil(c.data, 1 + Math.floor(r() * 3));
    if (data > hoje) continue;
    const forma = escolher(['boleto', 'boleto', 'a_vista', 'antecipado']);
    await db.execute(comandoLiberarCredito({ usuario: analista, prospectId: Number(c.id), formaPagamento: forma, prazoDias: forma === 'boleto' ? escolher([14, 21, 28]) : 0,
      comRestricao: r() < 0.15, limiteCredito: forma === 'boleto' ? escolher([3000, 5000, 8000, 12000]) : 0, dataLiberacao: data }));
    liberados.push({ ...c, data });
  }

  // 4) arquivo de pedidos do ERP → Venda realizada
  const pedidos = [];
  for (const l of liberados) {
    if (r() >= 0.66) continue;
    const data = proximoUtil(l.data, 1 + Math.floor(r() * 4));
    if (data <= hoje) pedidos.push({ ...l, data, numero: `P${String(l.id).padStart(6, '0')}` });
  }
  if (pedidos.length) {
    await importarEventos(db, { tipo: 'pedido', linhas: [['CNPJ', 'DATA', 'PEDIDO'], ...pedidos.map((x) => [x.cnpj, x.data, x.numero])],
      colunas: { cnpj: 'CNPJ', data: 'DATA', documento: 'PEDIDO' }, hoje, arquivoNome: 'pedidos (exemplo)', arquivoSha256: 'exemplo', executadoPor: quem });
  }
  return { prospects: lista.length, contatos, atendidos: atendidos.length, cadastrados: cadastrados.length, liberados: liberados.length, vendas: pedidos.length };
}
