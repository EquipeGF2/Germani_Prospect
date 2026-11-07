// Excel dos rejeitados (tela Rejeitados e aba Exportar): dados cadastrais completos, o tipo, o motivo e a observação do
// registro, numa aba por tipo (Sem interesse do cliente numa aba, do representante em outra…). Lê o detalhe só ao exportar.
import { lerComCache } from '../db.js';
import { consultaRejeitados, NOME_TIPO_REJEICAO, paraExportar, prepararRejeitado, TIPOS_REJEICAO } from '../../shared/rejeitados.mjs';
import { hojeSaoPaulo } from '../../shared/datas.mjs';
import { formatar } from '../ui.js';
import { baixarXlsxAbas } from '../planilhas.js';
import { documento } from './_pedidos.js';

const representante = (codigo, nome) => [codigo, nome].filter(Boolean).join(' - ');
const COLUNAS = [
  { titulo: 'Rejeição', valor: (l) => NOME_TIPO_REJEICAO[l.tipo], largura: 30 }, { titulo: 'Motivo', valor: (l) => l.motivo, largura: 40 },
  { titulo: 'Observação', valor: (l) => l.observacao ?? '', largura: 40 }, { titulo: 'Data', valor: (l) => formatar.data(l.data), largura: 12 },
  { titulo: 'Código', valor: (l) => l.codigo_cliente_erp ?? '', largura: 10 }, { titulo: 'Razão social', valor: (l) => l.razao_social, largura: 40 },
  { titulo: 'Nome fantasia', valor: (l) => l.nome_fantasia ?? '', largura: 30 }, { titulo: 'CNPJ', valor: (l) => documento(l.cnpj), largura: 20 },
  { titulo: 'Endereço', valor: (l) => l.endereco ?? '', largura: 40 }, { titulo: 'Bairro', valor: (l) => l.bairro ?? '', largura: 22 },
  { titulo: 'Cidade', valor: (l) => l.cidade, largura: 22 }, { titulo: 'UF', valor: (l) => l.uf, largura: 6 }, { titulo: 'CEP', valor: (l) => l.cep ?? '', largura: 10 },
  { titulo: 'Telefone', valor: (l) => l.telefone ?? '', largura: 16 }, { titulo: 'Segmento', valor: (l) => l.tipologia_gtm, largura: 22 },
  { titulo: 'Onda', valor: (l) => l.onda, largura: 8 }, { titulo: 'Rota', valor: (l) => l.rota, largura: 10 }, { titulo: 'Subrota', valor: (l) => l.subrota, largura: 10 },
  { titulo: 'Representante', valor: (l) => representante(l.vendedor_codigo, l.vendedor_nome), largura: 32 }, { titulo: 'Supervisor', valor: (l) => l.supervisor_nome ?? '', largura: 24 },
  { titulo: 'Tentativas', valor: (l) => Number(l.tentativas ?? 0), largura: 11 }, { titulo: '1º contato', valor: (l) => formatar.data(l.dt_primeiro_contato), largura: 12 },
];
/** Nome da aba de cada tipo (até 31 letras). */
const ABA = { baixado: 'Baixados', expurgado: 'Expurgados', cliente: 'Sem interesse do cliente', representante: 'Sem interesse do representante' };

/** Lê o detalhe dos rejeitados (em cache) e baixa o Excel dos tipos marcados que passam em `filtro(l)`: uma aba por tipo. Devolve quantos foram. */
export async function exportarRejeitados(db, { usuario, tipos, filtro = () => true }) {
  const todos = (await lerComCache(db, consultaRejeitados({ usuario }), 300)).rows.map(prepararRejeitado).filter(filtro);
  const lista = paraExportar(todos, tipos);
  const abas = TIPOS_REJEICAO.filter((t) => tipos.includes(t)).map((t) => ({ nome: ABA[t], colunas: COLUNAS, linhas: lista.filter((l) => l.tipo === t) }));
  await baixarXlsxAbas(`rejeitados-${hojeSaoPaulo()}.xlsx`, abas);
  return lista.length;
}
