// Ajuda do sistema: um único conteúdo para o fluxograma, os capítulos, o botão ? de cada tela e o manual em PDF. docs/03 §15
// Mudou uma tela? Atualize aqui. O teste test/ajuda.test.mjs falha se uma tela do menu ficar sem ajuda.
import { podeTela, veTodasEquipes } from './perfis.mjs';

const REP = 'Representante/vendedor';

// ---------- quem vê cada trecho: o representante/vendedor tem uma visão reduzida (a própria carteira, sem equipe nem
// administração), e o representante não tem rota. Um trecho marcado só aparece para quem o predicado aceita. ----------
/** Gestão: administrador, gerente, supervisor e financeiro (escolhem equipe, veem níveis de equipe). */
export const GESTAO = (u) => u?.perfil !== 'vendedor';
/** Representante/vendedor: a própria carteira. */
export const CARTEIRA = (u) => u?.perfil === 'vendedor';
/** Quem vê todas as equipes (nível Supervisor). */
export const TODAS_EQUIPES = (u) => veTodasEquipes(u);
/** Quem trabalha com rota: a gestão e o vendedor (o representante não tem rota). */
export const COM_ROTA = (u) => u?.perfil !== 'vendedor' || u?.tipo_atuacao === 'vendedor';
/** Quem vê no filtro só as ondas liberadas (0024): representante/vendedor e supervisor. */
export const ONDAS_LIBERADAS = (u) => ['vendedor', 'supervisor'].includes(u?.perfil);
const ONDAS_TODAS = (u) => !ONDAS_LIBERADAS(u);
/** Só administrador. */
export const SO_ADMIN = (u) => u?.perfil === 'administrador';
/** Texto de lista só para quem `para` aceita. */
const P = (para, texto) => Object.freeze({ para, texto });
/** Bloco de capítulo só para quem `para` aceita. */
const S = (para, ...blocos) => ['so', para, blocos];
const vale = (para, u) => !para || !u || para(u);
/** Itens de uma lista que valem para o usuário: texto, P(para, texto) ou par/linha com o predicado no fim. Sem usuário: todos. */
export function filtrarItens(lista, u) {
  return (lista ?? []).filter((x) => (x?.para && !Array.isArray(x) ? vale(x.para, u) : Array.isArray(x) && typeof x.at(-1) === 'function' ? vale(x.at(-1), u) : true))
    .map((x) => (x?.para && !Array.isArray(x) ? x.texto : Array.isArray(x) && typeof x.at(-1) === 'function' ? x.slice(0, -1) : x));
}
const ADM = 'Administrador';
const FIN = 'Analista financeiro';

/** Etapas do fluxo, na ordem da operação. `cap` = capítulo que explica a etapa. */
export const FLUXO = Object.freeze([
  { id: 'base', nome: 'Base de prospects', quem: ADM, tela: 'Administração › Base de prospects', faz: 'Os CNPJs a trabalhar entram no sistema, cada um na carteira de um representante/vendedor.', avanca: 'Importar o arquivo da base.', cap: 8 },
  { id: 'lista', nome: 'Lista principal', quem: REP, tela: 'Prospecção › Lista principal', faz: 'Mostra os clientes Não contactados e Em prospecção: é onde se vai atrás do cliente.', avanca: 'Registrar o atendimento do cliente.', cap: 3 },
  { id: 'atendimento', nome: 'Registrar atendimento', quem: REP, tela: 'Ficha do cliente › Registrar atendimento', faz: 'Registra canal, resultado e, se houver, a data de retorno. Atendido passa para Aguardando cadastro.', avanca: 'Resultado Atendido ou Reabrir: pedido identificado.', cap: 3 },
  { id: 'aguardando', nome: 'Aguardando cadastro', quem: REP, tela: 'Prospecção › Acompanhamento', faz: 'O cliente saiu da lista e aguarda aparecer no relatório de cadastro do ERP.', avanca: 'O CNPJ vir no relatório de cadastro e crédito.', cap: 4 },
  { id: 'analise', nome: 'Análise financeira', quem: FIN, tela: 'Financeiro › Console de crédito', faz: 'O cadastro foi identificado. O financeiro tem prazo para liberar forma, prazo e limite.', avanca: 'Relatório de crédito do ERP ou OK do analista.', cap: 5 },
  { id: 'pedido', nome: 'Aguardando pedido', quem: REP, tela: 'Prospecção › Acompanhamento', faz: 'Crédito liberado: falta o primeiro pedido válido do cliente.', avanca: 'Pedido de venda em carteira no arquivo de pedidos.', cap: 4 },
  { id: 'carteira', nome: 'Pedido em carteira', quem: `${ADM} importa o arquivo`, tela: 'Prospecção › Acompanhamento', faz: 'O primeiro pedido válido está em carteira, ainda sem faturar.', avanca: 'O pedido aparecer faturado no arquivo.', cap: 6 },
  { id: 'faturado', nome: 'Pedido faturado', quem: `${ADM} importa o arquivo`, tela: 'Prospecção › Explorar pedidos', faz: 'O primeiro pedido faturou. Do segundo em diante, o pedido só alimenta a estatística.', avanca: 'Fim do fluxo.', cap: 6 },
]);

/** Desvios do caminho principal. */
export const DESVIOS = Object.freeze([
  { id: 'sem_interesse', nome: 'Sem interesse', quem: REP, tela: 'Ficha do cliente › Registrar atendimento', faz: 'O cliente recusou, ou o representante/vendedor não vai trabalhá-lo, com o motivo. Pode ser reaberto.', avanca: 'Reabrir: pedido identificado.', cap: 3 },
  { id: 'valido', nome: 'Pedido não válido', quem: REP, tela: 'Prospecção › Acompanhamento', faz: 'Houve pedido, mas digitado ou cancelado. O cliente fica em Aguardando pedido válido.', avanca: 'Um pedido entrar em carteira.', cap: 4 },
  { id: 'sem_cadastro', nome: 'Pedido sem cadastro', quem: ADM, tela: 'Prospecção › Acompanhamento', faz: 'O arquivo de pedidos chegou antes do cadastro. Os pedidos ficam guardados.', avanca: 'Importar o relatório de cadastro e crédito.', cap: 4 },
  { id: 'baixado', nome: 'CNPJ baixado', quem: `${ADM} importa o arquivo`, tela: 'Administração › Pedidos · Baixados (ERP)', faz: 'O CNPJ fica inválido e sai das contas da carteira. O status fica congelado.', avanca: 'Fim do fluxo.', cap: 8 },
]);

const ETAPAS_TABELA = ['tabela', ['Etapa', 'O que significa', 'O que faz avançar'], [
  ['Análise financeira', 'Cadastro identificado, aguardando a liberação do crédito', 'Relatório de crédito do ERP ou OK do analista'],
  ['Aguardando pedido', 'Crédito liberado, ainda sem pedido válido', 'Pedido de venda em carteira no arquivo de pedidos'],
  ['Pedido em carteira', 'O primeiro pedido válido ainda não faturou', 'O pedido aparecer faturado no arquivo'],
  ['Pedido faturado', 'O primeiro pedido faturou, inteiro ou em parte', 'Fim do fluxo'],
]];

/**
 * Capítulos, na ordem do processo, escritos para quem não é da área de tecnologia. Blocos:
 *   ['serve', texto]                       · Para que serve, em linguagem simples
 *   ['rapido', passos]                     · Em 30 segundos: o caminho mais curto
 *   ['parte', recorte, título, resumo, itens] · uma parte da tela: recorte pequeno (web/img/ajuda/<recorte>.jpg) e o que é cada item
 *   ['opcoes', caminho]                    · as opções do topo da tela (OPCOES_TOPO)
 *   ['termos', grupo]                      · os termos da tela (TERMOS), com a conta quando houver
 *   ['perguntas', [[pergunta, resposta]]]  · Perguntas comuns
 *   ['p', texto] · ['h', título] · ['lista', itens] · ['passos', itens] · ['tabela', colunas, linhas]
 * Os recortes têm dados fictícios: IMAGENS_AJUDA=web/img/ajuda npm run test:telas gera todos de novo.
 * Item de lista: texto ou [destaque, texto]. `para`: quem vê o capítulo; sem ele, todos.
 */
export const CAPITULOS = Object.freeze([
  { n: 1, nome: 'Visão geral da operação', desc: 'O caminho do cliente, as etapas e quem age em cada uma.', blocos: [
    ['serve', 'Mostrar o caminho que cada cliente da base percorre, do primeiro contato até o primeiro pedido faturado, e quem é responsável por cada passo.'],
    ['rapido', ['Abra Ajuda no fim do menu.', 'Clique numa etapa do fluxograma para ver quem age, em qual tela e o que faz o cliente avançar.', 'Abra o capítulo da etapa para o passo a passo.']],
    ['parte', 'ajuda-fluxograma', 'O fluxograma', 'As etapas na ordem em que acontecem. A seta liga a etapa 4 à etapa 5.', [['Etapa numerada', 'Um passo do caminho do cliente.'], ['Quem age', 'Quem faz o cliente sair daquela etapa.'], ['Desvios do caminho', 'O que tira o cliente do caminho principal, como o sem interesse.']]],
    ['h', 'O caminho do cliente'],
    ['tabela', ['Etapa', 'Quem age', 'Para avançar'], FLUXO.map((e) => [e.nome, e.quem, e.avanca])],
    ['h', 'Desvios do caminho'],
    ['lista', DESVIOS.map((d) => [d.nome, d.faz])],
    ['termos', 'gerais'],
    ['perguntas', [['Por que um cliente do relatório do ERP não aparece?', 'O sistema só considera os clientes da base. A exceção é a filial de um grupo da base, que aparece em Explorar pedidos, em Ver por Grupo.'],
      ['Quem importa os arquivos do ERP?', 'O administrador, em Administração. Cada importação mostra antes o que vai mudar.']]],
  ] },
  { n: 2, nome: 'Acesso e navegação', desc: 'Entrar, usar o menu e o botão de ajuda.', blocos: [
    ['serve', 'Ensinar a entrar no sistema, achar as telas no menu e tirar dúvidas pelo botão ? de cada tela.'],
    ['rapido', ['Informe o login e a senha recebidos do administrador e clique em Entrar.', 'O sistema abre sempre no Explorar carteira.', 'Use o menu à esquerda para trocar de tela e o botão ? para tirar dúvidas.']],
    S(GESTAO, ['parte', 'menu', 'O menu', 'Fica à esquerda no computador. No celular, abre pelo botão com três riscos, no canto de cima.', [['Prospecção', 'As telas do dia a dia: Explorar carteira, Lista principal, Acompanhamento e Explorar pedidos.'], ['Administração', 'Importações, usuários e parâmetros (administrador); Exportar dados (gerente).', GESTAO], ['Ajuda', 'O último item: fluxograma e manual.'], ['Sair', 'Encerra o acesso. Use sempre em computador compartilhado.']]]),
    S(CARTEIRA, ['parte', 'menu-carteira', 'O menu', 'Fica à esquerda no computador. No celular, abre pelo botão com três riscos, no canto de cima.', [['Prospecção', 'As telas do dia a dia: Explorar carteira, Lista principal, Acompanhamento e Explorar pedidos.'], ['Ajuda', 'O último item: fluxograma e manual.'], ['Sair', 'Encerra o acesso. Use sempre em celular ou computador compartilhado.']]]),
    ['parte', 'botao-ajuda', 'O botão ?', 'Fica no canto de cima, à direita, em todas as telas. Abre a ajuda daquela tela sem sair dela.', [['Opções do topo', 'O que cada opção das chaves e filtros do topo mostra.'], ['Significado dos termos', 'Toda palavra e abreviação da tela, em linguagem simples.'], ['Ler o capítulo completo', 'Abre o capítulo do manual sobre aquela tela.']]],
    ['h', 'O que cada perfil enxerga'],
    ['lista', [['Representante/vendedor', 'a própria carteira e os pedidos que fez.'], ['Supervisor', 'a equipe.'], ['Gerente e administrador', 'todas as equipes.'], ['Analista financeiro', 'o Console de crédito.']]],
    ['perguntas', [['Saí da tela e voltei. Perdi o que tinha escolhido?', 'Não. Nesta aba do navegador, cada tela volta como estava: filtros da Lista principal, linha escolhida e linhas abertas. Para recomeçar a lista, use Limpar filtros.'], ['Esqueci a senha. O que faço?', 'Peça ao administrador: ele define uma nova senha em Usuários.'], ['A tela ficou estranha no celular.', 'Nada rola para o lado: o que não cabe vira cartão, com o nome de cada campo. Gire o celular para ver mais colunas.'],
      ['Por que não vejo uma tela que meu colega vê?', 'Cada perfil vê só as telas que usa. Fale com o administrador se precisar de outra.']]],
  ] },
  { n: 3, nome: 'Prospecção', desc: 'Lista principal e registro de atendimento.', para: (u) => podeTela(u, 'lista'), blocos: [
    ['serve', 'Mostrar quem ainda precisa ser procurado (clientes Não contactados e Em prospecção) e registrar o resultado de cada atendimento.'],
    ['rapido', ['Abra Prospecção › Lista principal.', 'Clique em Registrar na linha do cliente.', 'Escolha o resultado e clique em Gravar registro. O canal já vem como Visita.']],
    S(GESTAO, ['parte', 'lista-filtros', 'Os filtros do topo', 'Escolha de quem é a carteira e onde estão os clientes. Supervisor e gestão escolhem a equipe primeiro.', [['Equipe', 'Supervisor e representante/vendedor.'], ['Local', 'UF, cidade e bairro.'], ['Carteira', 'Onda e segmento.'], ['Exibição', 'Agrupar a lista por cidade, onda ou outra opção.']]]),
    S(CARTEIRA, ['parte', 'lista-filtros-carteira', 'Os filtros do topo', 'A lista já abre com a sua carteira. Os filtros ajudam a achar os clientes.', [['Local', 'UF, cidade e bairro.'], ['Carteira', 'Onda e segmento. Só aparecem as ondas que o administrador liberou.'], ['Exibição', 'Agrupar a lista por cidade, onda ou outra opção.']]]),
    ['parte', 'lista-situacao', 'A situação', 'Separa a lista por status, com a quantidade de cada um. Clique para ver só aquele grupo.', [['Todos', 'A lista inteira.'], ['Não contactado', 'Ainda sem nenhum contato.'], ['Em prospecção (contato da planilha)', 'Teve contato na planilha da base, ainda sem resultado no sistema.']]],
    ['parte', 'lista-tabela', 'A lista de clientes', 'Um cliente por linha. Clique no título de uma coluna para ordenar.', [['Tentativas', 'Quantos contatos já foram registrados.'], ['1º registro em', 'Data do primeiro contato.'], ['Dias', 'Dias desde o primeiro registro.'], ['Registrar', 'Abre o registro do atendimento.']]],
    ['parte', 'registrar', 'Registrar atendimento', 'O resultado move o cliente no fluxo.', [['Canal', 'Por enquanto, sempre Visita: o campo fica fixo.'], ['Atendido', 'O cliente aceitou: vai para Aguardando cadastro.'], ['Sem interesse', 'Do cliente ou do representante/vendedor, sempre com o motivo.'], ['Reabrir: pedido identificado', 'Para quem estava em sem interesse e fez pedido.']]],
    ['opcoes', '/carteira'],
    ['termos', 'lista'],
    ['perguntas', [['Por que não vejo todos os meus clientes?', 'O administrador libera as ondas aos poucos: aparecem os clientes das ondas liberadas e todos os já atendidos.', CARTEIRA], ['O cliente não atendeu. Registro?', 'Não. Sem atendimento não há registro: ele continua na lista.'], ['Errei o registro. Como corrijo?', 'Nada é apagado: faça um novo registro.'],
      ['O cliente sumiu da lista.', 'Depois do registro ele sai da lista e passa a ser acompanhado no Acompanhamento.'], ['Como marco vários sem interesse de uma vez?', 'Marque os clientes na lista e clique em Sem interesse em lote.']]],
  ] },
  { n: 4, nome: 'Acompanhamento', desc: 'Do cadastro ao pedido faturado.', para: (u) => podeTela(u, 'acompanhamento'), blocos: [
    ['serve', 'Mostrar em que ponto está cada cliente que aceitou a proposta, do cadastro no sistema da empresa até o pedido faturado. Use para saber quem está parado e com quem falar.'],
    ['rapido', ['Abra Prospecção › Acompanhamento.', 'Clique numa etapa (os quadros com números): a lista embaixo mostra os clientes daquela etapa.', 'Clique no nome do cliente para abrir a ficha dele.']],
    ['parte', 'acomp-chaves', 'As opções do topo', 'Três chaves mudam o que a tela mostra. A opção em vermelho é a escolhida.', [['Fluxo', 'Em que etapa está cada cliente.'], ['Crédito × Pedido', 'Se o pedido cabe no limite de crédito liberado.'], ['Apenas o primeiro pedido', 'Conta clientes conquistados.'], ['Ver por Empresa', 'Cada CNPJ separado; Ver por Grupo junta as empresas do mesmo grupo.']]],
    ['parte', 'acomp-etapas', 'As etapas', 'Cada quadro é uma etapa, na ordem do processo. O número grande é a quantidade de clientes.', [['Cadastros realizados', 'Todos os clientes já cadastrados no ERP.'], ['Texto em vermelho', 'Pede atenção, como análises vencidas.'], ['Quadro com borda', 'É a etapa escolhida: a lista embaixo mostra os clientes dela.']]],
    S(GESTAO, ['parte', 'acomp-hierarquia', 'A hierarquia', 'Os mesmos números, separados por supervisor e representante/vendedor.', [['▶ e ▼', 'Abrem e fecham a linha para ver quem está dentro.'], ['Linha em vermelho', 'É a linha escolhida: etapas e lista seguem ela.']]]),
    S(CARTEIRA, ['h', 'A hierarquia'], ['p', 'Os mesmos números da sua carteira, separados pelos níveis que você escolher: cidade, segmento, onda ou mês do cadastro.'], ['lista', [['▶ e ▼', 'abrem e fecham a linha para ver o que está dentro.'], ['Linha em vermelho', 'é a linha escolhida: etapas e lista seguem ela.']]]),
    S(GESTAO, ['parte', 'acomp-lista', 'A lista de clientes', 'Os clientes da etapa escolhida, agrupados por equipe.', [['Situação', 'No prazo (verde) ou Vencida (vermelho).'], ['Registrar', 'Abre o registro de um novo atendimento.'], ['Gerar PDF e Baixar CSV', 'Levam a lista como está na tela.']]]),
    S(CARTEIRA, ['h', 'A lista de clientes'], ['p', 'Os seus clientes da etapa escolhida.'], ['lista', [['Situação', 'No prazo (verde) ou Vencida (vermelho).'], ['Registrar', 'abre o registro de um novo atendimento.'], ['Gerar PDF e Baixar CSV', 'levam a lista como está na tela.']]]),
    ['h', 'As etapas'],
    ETAPAS_TABELA,
    ['opcoes', '/carteira?aba=acompanhamento'],
    ['termos', 'acompanhamento'],
    ['perguntas', [['O cliente não aparece. Por quê?', 'Ele ainda não foi atendido (está na Lista principal) ou o cadastro não chegou do ERP: veja Aguardando cadastro, embaixo das etapas.'],
      ['O que faço com uma análise vencida?', 'Avise o financeiro: o cliente está esperando a liberação do crédito.'],
      ['Apareceu Pedido sem cadastro.', 'O arquivo de pedidos chegou antes do cadastro. Peça a importação do relatório de cadastro e crédito: os pedidos não precisam ser importados de novo.']]],
  ] },
  { n: 5, nome: 'Crédito', desc: 'Console de crédito e Crédito × Pedido.', para: (u) => podeTela(u, 'credito') || (podeTela(u, 'acompanhamento') && u.perfil !== 'vendedor'), blocos: [
    ['serve', 'Liberar o crédito dos clientes cadastrados e conferir se os pedidos cabem no limite liberado.'],
    ['rapido', ['Abra Financeiro › Console de crédito: os clientes mais antigos vêm primeiro.', 'Clique no cliente e informe forma de pagamento, prazo, limite e restrição.', 'Clique em gravar: o cliente vai para Aguardando pedido.']],
    ['parte', 'credito-cards', 'Os cards do topo', 'Funcionam como filtro: clique num deles para ver só aqueles clientes.', [['em análise', 'Aguardando a liberação do crédito.'], ['fora do prazo', 'Passaram do prazo da análise.'], ['liberados aguardando pedido', 'Já liberados, para corrigir uma liberação.']]],
    ['parte', 'credito-fila', 'A fila de clientes', 'Um cliente por linha, do mais antigo para o mais novo.', [['Cadastro ERP', 'Data do cadastro no ERP.'], ['Dias em análise', 'Há quantos dias espera.'], ['Prazo', 'Data limite da análise.']]],
    ['parte', 'credito-pedido', 'Crédito × Pedido', 'No Acompanhamento, compara o limite liberado com os pedidos em carteira.', [['Dentro do limite', 'O pedido cabe no limite.'], ['Acima do limite', 'O pedido passou do limite.'], ['Sem limite', 'Não há limite para comparar.']]],
    ['opcoes', '/financeiro'],
    ['termos', 'credito'],
    ['perguntas', [['Errei a liberação. Como corrijo?', 'Em liberados aguardando pedido, clique em Corrigir: a correção é uma nova liberação, e a anterior fica no histórico.'],
      ['O uso do limite é exato?', 'É uma estimativa: títulos faturados e não pagos também usam limite no ERP e não vêm nos relatórios.']]],
  ] },
  { n: 6, nome: 'Pedidos', desc: 'Explorar pedidos, primeiro pedido e bonificação.', para: (u) => podeTela(u, 'pedidos'), blocos: [
    ['serve', 'Analisar o que foi vendido: quanto, por quem, quanto já faturou e quanto se deu em bonificação.'],
    ['rapido', ['Abra Prospecção › Explorar pedidos.', 'Escolha no topo Pedidos de venda, de bonificação ou Ambos.', 'Clique numa linha da hierarquia: os números e a lista seguem aquela linha.']],
    ['parte', 'pedidos-chaves', 'As opções do topo', 'Escolha que pedidos entram nos números e se as empresas aparecem separadas ou por grupo.', [['Pedidos de venda', 'Só venda. No celular, Venda.'], ['Pedidos de bonificação', 'Só bonificação. No celular, Bonificação.'], ['Ver por Grupo', 'Junta as empresas com a mesma raiz de CNPJ.']]],
    ['parte', 'pedidos-cards', 'Os números da linha escolhida', 'Oito cards com os números da linha escolhida na hierarquia.', [['Venda válida', 'Pedidos em carteira ou faturados.'], ['Faturado', 'O que já saiu nota fiscal.'], ['Investimento', 'Bonificação: fica à parte da venda.'], ['Próprio e Outro', 'Venda de quem é dono do cliente e de outro representante/vendedor.']]],
    ['parte', 'pedidos-graficos', 'Os dois gráficos', 'Faturamento da venda olha só a venda válida. O que aconteceu com os pedidos de venda olha todos, inclusive os que não viraram venda.', [['Faturado e Em carteira', 'Quanto da venda já faturou e quanto falta.'], ['Digitado, fora da carteira', 'Pedido parado: ainda não conta como venda.'], ['Desistência', 'Pedido cancelado.']]],
    S(GESTAO, ['parte', 'pedidos-hierarquia', 'A hierarquia', 'Os números pelos mesmos níveis do Explorar carteira: Supervisor, Rep., Cidade, Cliente e outros. Supervisor e Rep. são os da carteira do cliente. Sem espaço para as colunas, cada linha vira um cartão.', [['▶ e ▼', 'Abrem e fecham a linha.'], ['Vendas fora da carteira', 'Só os pedidos em que quem vendeu não é o dono da carteira do cliente: Rep. do pedido › Rep. da carteira › Cliente. Voltar à hierarquia desfaz.'], ['Valores em R$', 'Todos os valores da hierarquia são em reais.'], ['Excel', 'Baixa os pedidos da linha escolhida.']]]),
    S(CARTEIRA, ['h', 'A hierarquia'], ['p', 'Os pedidos da sua carteira e os que você fez, separados pelos níveis que você escolher: Cidade, Cliente e outros. Sem espaço para as colunas, cada linha vira um cartão.'], ['lista', [['▶ e ▼', 'abrem e fecham a linha.'], ['Vendas fora da carteira', 'só os pedidos em que quem vendeu não é o dono da carteira do cliente: Rep. do pedido › Rep. da carteira › Cliente.'], ['Valores em R$', 'todos os valores da hierarquia são em reais.']]]),
    ['opcoes', '/pedidos'],
    ['termos', 'pedidos'],
    ['perguntas', [['Um cliente comprou de outro representante. É erro?', 'Não. O cliente fica com o dono da carteira, e a venda vai para quem vendeu: as colunas Próprio e Outro mostram isso, e Vendas fora da carteira mostra quem vendeu para quem.'],
      ['Por que o pedido do arquivo não aparece?', 'O CNPJ não está na base. Se for filial de um grupo da base, aparece em Ver por Grupo.'],
      ['O que é o primeiro pedido?', 'O primeiro pedido de venda válido do cliente. Do segundo em diante, o pedido só alimenta a estatística.']]],
  ] },
  { n: 7, nome: 'Indicadores', desc: 'Explorar carteira e os números da base.', para: (u) => podeTela(u, 'explorar'), blocos: [
    ['serve', 'Mostrar como está a base inteira (sem baixados e expurgados), do total até o cliente: quanto já foi trabalhado, quanto está sem interesse e em que etapa estão os clientes.'],
    ['rapido', ['Abra Prospecção › Explorar carteira (é a tela inicial).', P(GESTAO, 'Arraste os níveis para montar a hierarquia: supervisor, representante/vendedor, cidade, segmento, onda.'), P(CARTEIRA, 'Arraste os níveis para montar a hierarquia da sua carteira: cidade, segmento e onda.'), 'Clique numa linha para ver os números daquela parte.']],
    ['parte', 'carteira-niveis', 'Os níveis', 'Montam a hierarquia, na ordem que você quiser. No celular, use o botão Mudar.', [['Níveis', 'Os que estão em uso, na ordem.'], ['Disponíveis', 'Clique ou arraste para incluir.']]],
    ['parte', 'carteira-graficos', 'Os gráficos', 'Da totalidade mostra como a base se divide. Dos contactados mostra em que etapa estão os que seguem no processo.', [['Rejeitados', 'No card, a base inteira: sem interesse, baixados e expurgados juntos.'], ['Prospects', 'Na hierarquia, só os válidos: sem baixados e expurgados.'], ['Cobertura', 'Quanto da base já foi trabalhado.'], ['Potencial', 'Estimativa do que os clientes em andamento podem vender.']]],
    ['parte', 'carteira-arvore', 'A hierarquia', 'Os números de cada linha. Clique numa linha para os gráficos seguirem ela.', [['Prospects', 'Clientes da base na linha.'], ['Ag. cadastro, Ag. financeiro, Ag. pedido', 'Quantos estão em cada etapa.']]],
    ['opcoes', '/explorar'],
    ['termos', 'carteira'],
    S((u) => podeTela(u, 'rejeitados'), ['h', 'Rejeitados (gerente e administrador)'], ['parte', 'rejeitados', 'A tela Rejeitados', 'Quem saiu da prospecção e por quê, com a hierarquia de níveis. Escolha uma linha e um tipo: tudo abaixo segue a escolha.', [['Cards do topo', 'Baixados, expurgados, sem interesse do cliente e do representante.'], ['Motivos', 'Aparecem só para o sem interesse escolhido.'], ['Excel', 'Baixa o que está na tela, com os dados cadastrais completos, o motivo e a observação; uma aba por tipo.']]], ['opcoes', '/rejeitados'], ['termos', 'rejeitados']),
    ['perguntas', [['Por que a soma das etapas não dá o total?', 'O total inclui os não contactados e os rejeitados, que não estão em etapa nenhuma.'],
      ['Como vejo os clientes de uma linha?', 'Escolha a linha e clique em Abrir na Lista principal.']]],
  ] },
  { n: 8, nome: 'Administração', desc: 'Importações, usuários, perfis e parâmetros.', para: (u) => u.perfil === 'administrador', blocos: [
    ['serve', 'Trazer para o sistema os arquivos do ERP, exportar as bases em Excel, cadastrar as pessoas e ajustar prazos, alertas e as ondas liberadas.'],
    ['rapido', ['Abra Administração › Importações, no computador.', 'Siga as abas numeradas, na ordem: Base de prospects, Grupos de CNPJ, Cadastro e crédito, Pedidos e Baixados.', 'Em cada aba, confira a simulação: nada é gravado antes da confirmação.']],
    ['parte', 'admin-importacoes', 'A tela Importações', 'Uma aba por arquivo, na ordem do processo, mais Exportar e Histórico. Cada aba já sabe o tipo do arquivo. As abas de importação são só no computador.', [['Abas numeradas', 'Os 5 passos da importação, na ordem.'], ['Exportar', 'Listas por equipe em PDF; rejeitados por tipo, a base e os pedidos em Excel (também para o gerente).'], ['Histórico', 'Tudo o que foi importado; o arquivo de pedidos mais novo e uma importação da base ainda não trabalhada podem ser apagados.']]],
    ['opcoes', '/importacoes'],
    ['parte', 'admin-usuarios', 'Usuários', 'Cadastro das pessoas, senhas e perfis.', [['Cód. ERP', 'Código do ERP: liga o usuário ao representante dos arquivos de pedidos; não faz parte do login.'], ['Perfil', 'O que a pessoa acessa.']]],
    ['parte', 'admin-ondas', 'Ondas liberadas', 'Em Parâmetros: as ondas que o representante/vendedor vê para prospectar. Quem já foi atendido aparece sempre.', [['Na lista', 'Clientes da onda ainda não atendidos.'], ['Marcar todas', 'Libera a base inteira.']]],
    ['p', 'Se os pedidos chegarem antes do cadastro, nada se perde: os pedidos ficam guardados, e o relatório de cadastro e crédito completa o cliente depois, sem reimportar.'],
    ['termos', 'importar-credito'],
    ['termos', 'importar-pedidos'],
    ['perguntas', [['Importei o arquivo errado.', 'Em Importações, apague o arquivo de pedidos (do mais novo ao mais antigo) e importe o certo.'],
      ['Um administrador não abre a Administração.', 'Defina a senha dele em Usuários, estando logado como administrador.']]],
  ] },
]);

/** Um capítulo em blocos simples (p, h, passos, img, tabela), para o manual em PDF. A tela desenha os blocos ricos. */
export function blocosSimples(capitulo, usuario = null) {
  let parte = 0;
  const conta = (t) => (t.conta ? `${t.significado} Conta: ${t.conta}.` : t.significado);
  return capitulo.blocos.flatMap((b) => {
    if (b[0] === 'serve') return [['destaque', `Para que serve: ${b[1]}`]];
    if (b[0] === 'rapido') return [['h', 'Em 30 segundos'], ['passos', b[1]]];
    if (b[0] === 'parte') { parte += 1; return [['h', `${parte}. ${b[2]}`], ['img', `${b[1]}.jpg`, b[3]], ['tabela', ['Item', 'O que é'], b[4]]]; }
    if (b[0] === 'opcoes') { const o = opcoesPara(b[1], usuario); return o.length ? [['h', 'Opções do topo'], ['tabela', ['Opção', 'O que mostra'], o.flatMap((g) => g.opcoes.map((x) => [x.opcao, x.significado]))]] : []; }
    if (b[0] === 'termos') { const g = termosPara(b[1], usuario); return g ? [['h', `Termos: ${g.nome}`], ['tabela', ['Termo', 'Significado'], g.termos.map((t) => [t.termo, conta(t)])]] : []; }
    if (b[0] === 'perguntas') return [['h', 'Perguntas comuns'], ['tabela', ['Pergunta', 'Resposta'], b[1]]];
    return [b];
  });
}

/** Os blocos de um capítulo que valem para o usuário: trechos marcados para outro perfil saem, e as listas ficam só com o que ele vê. */
export function blocosDoUsuario(blocos, u) {
  return blocos.flatMap((b) => (b[0] === 'so' ? (vale(b[1], u) ? blocosDoUsuario(b[2], u) : []) : [b])).map((b) => {
    if (['lista', 'passos', 'rapido', 'perguntas'].includes(b[0])) return [b[0], filtrarItens(b[1], u)];
    if (b[0] === 'parte') return [b[0], b[1], b[2], b[3], filtrarItens(b[4], u)];
    if (b[0] === 'tabela') return [b[0], b[1], filtrarItens(b[2], u)];
    return b;
  });
}

/** Capítulos que o usuário vê: só o que ele usa, e dentro de cada um só o que vale para o perfil dele. */
export const capitulosDoUsuario = (usuario) => CAPITULOS.filter((c) => !c.para || c.para(usuario)).map((c) => ({ ...c, blocos: blocosDoUsuario(c.blocos, usuario) }));

const F = (campo, significado, para = null) => (para ? [campo, significado, para] : [campo, significado]);

/** Ajuda de cada tela: objetivo, como funciona, campos, o que analisar, situações comuns e próximo passo. */
export const AJUDA_TELAS = Object.freeze({
  '/ajuda': { titulo: 'fluxograma e manual', cap: 1, objetivo: 'Explicar a operação, do prospect ao pedido faturado, e reunir o manual.',
    como: ['Clique numa etapa do fluxograma para ver quem age e em qual tela.', 'Abra um capítulo para ler aquela parte do processo.', 'Use Baixar manual em PDF para ter tudo num arquivo.'],
    campos: [F('Fluxograma', 'As etapas do cliente, na ordem'), F('Desvios', 'O que tira o cliente do caminho principal'), F('Capítulos', 'As partes do processo que o seu perfil usa')],
    analisar: ['Comece pelo capítulo 1, se for o seu primeiro acesso.'], comuns: [F('Falta um capítulo', 'Você vê só o que o seu perfil usa.')], proximo: 'Volte às telas de trabalho pelo menu e use o botão ? quando tiver dúvida.' },
  '/explorar': { titulo: 'Explorar carteira', cap: 7, objetivo: 'Ver como está a base inteira, em todos os status, do total até o cliente.',
    como: [P(GESTAO, 'Arraste os níveis para montar a hierarquia: supervisor, representante/vendedor, cidade e outros.'), P(CARTEIRA, 'Arraste os níveis para montar a hierarquia da sua carteira: cidade, segmento e onda.'), 'Abra as linhas pelas setas.', 'Clique numa linha para ver os gráficos daquela parte.', 'Abra a lista daquela parte para ver os clientes.'],
    campos: [F('Prospects', 'Quantidade de clientes da base naquela linha'), F('Contactados', 'Clientes com ao menos um contato'), F('Cobertura', 'Contactados ÷ base válida'), F('S. int. cliente', 'Sem interesse por decisão do cliente'), F('Fora da base', 'Baixados e expurgados: não contam nos prospects'), F('Valor dos pedidos', 'Soma dos pedidos importados daquela parte')],
    analisar: ['Onde a cobertura está baixa, ainda há clientes a procurar.', 'Em Dos contactados, veja em que etapa os clientes estão parando.'], comuns: [F('Um nível sumiu', 'Clique nele em Disponíveis para incluir de novo.')], proximo: 'Abra a Lista principal para procurar os clientes não contactados.' },
  '/inicio': { titulo: 'Início', cap: 7, objetivo: 'Ver o painel da campanha: funil, ranking e períodos.',
    como: ['Escolha o período, o supervisor e a visualização.', 'Clique num representante/vendedor para abrir a carteira dele.'],
    campos: [F('Funil', 'Base, contactados, atendidos, cadastrados, crédito liberado e venda'), F('% de cada etapa', 'Sempre sobre a base de prospects'), F('Posição atual', 'Foto da carteira hoje')],
    analisar: ['Compare o funil entre equipes para ver onde a campanha trava.'], comuns: [F('A tela não está no menu', 'Os mesmos números estão no Explorar carteira.')], proximo: 'Use o Explorar carteira para descer até o cliente.' },
  '/carteira': { titulo: 'Lista principal', cap: 3, objetivo: 'Mostrar quem ainda precisa ser procurado: Não contactados e Em prospecção.',
    como: [P(GESTAO, 'Supervisor e gestão escolhem o supervisor e o representante/vendedor e clicam em Buscar.'), P(CARTEIRA, 'A lista já abre com a sua carteira: use os filtros para achar os clientes.'), 'Clique em Registrar para gravar o atendimento.', 'Clique no título de uma coluna para ordenar.', 'Marque clientes para o Sem interesse em lote.'],
    campos: [F('Prospect', 'Razão social e CNPJ'), F('Onda', 'Grupo de trabalho da campanha'), F('Segmento', 'Tipologia do cliente'), F('Tentativas', 'Contatos já registrados'), F('1º registro em', 'Data do primeiro contato'), F('Dias', 'Dias desde o primeiro registro'), F('Agrupar por', 'Junta a lista por cidade, onda ou outra opção')],
    analisar: ['Clientes com mais dias e sem avanço pedem prioridade.', 'Use Gerar PDF para levar a lista como está na tela.'], comuns: [F('O cliente sumiu', 'Depois do registro, ele sai da lista: veja o Acompanhamento.'), F('O cliente não atendeu', 'Não gera registro: ele continua na lista.')], proximo: 'Depois do atendimento, acompanhe o cliente no Acompanhamento.' },
  '/carteira?aba=acompanhamento': { titulo: 'Acompanhamento', cap: 4, objetivo: 'Ver onde está cada cliente da base, do cadastro identificado ao pedido faturado, e o que está parado.',
    como: ['Clique numa etapa para listar os clientes dela.', P(GESTAO, 'Use os níveis para ver por equipe, cidade ou mês do cadastro.'), P(CARTEIRA, 'Use os níveis para ver por cidade, segmento, onda ou mês do cadastro.'), 'Recolha ou reexiba a cascata pelas setas.', 'Troque entre Fluxo e Crédito × Pedido no topo.', 'Clique no cliente para abrir a ficha.'],
    campos: [F('Cadastros realizados', 'Soma das quatro etapas seguintes'), F('Dias na etapa', 'Dias desde a entrada do cliente na etapa'), F('Prazo da análise', 'Data limite da análise financeira'), F('Ordem', '1º, 2º, 3º pedido válido do cliente'), F('Quem vendeu', 'Representante/vendedor que fez o pedido'), F('Uso do limite', 'Pedidos em carteira ÷ limite liberado'), F('Forma e prazo', 'O que o financeiro liberou')],
    analisar: ['Análise vencida: cobre o financeiro.', 'Pedido não válido: veja com o cliente o que faltou.', 'Apenas o primeiro pedido × Todos os pedidos: clientes conquistados × valor vendido.', 'Acima do limite: o pedido em carteira passou do crédito liberado.'],
    comuns: [F('O cliente não aparece', 'Veja a Lista principal ou Aguardando cadastro.'), F('Pedido sem cadastro', 'Falta importar o relatório de cadastro e crédito; os pedidos já estão guardados.', GESTAO), F('Pedido sem cadastro', 'Avise o administrador: falta importar o relatório de cadastro e crédito. Os pedidos já estão guardados.', CARTEIRA)], proximo: 'Com o pedido faturado, analise os valores em Explorar pedidos.' },
  '/pedidos': { titulo: 'Explorar pedidos', cap: 6, objetivo: 'Analisar o que foi vendido: valores, quem vendeu e bonificação.',
    como: ['Escolha Pedidos de venda, Pedidos de bonificação ou Ambos.', 'Escolha Ver por Empresa ou Ver por Grupo.', 'Monte os níveis e clique numa linha: cards, gráficos e lista seguem aquela linha.', 'Clique em Excel para baixar os pedidos da linha escolhida (do tipo marcado no topo).', 'Sem espaço para as colunas (celular ou tela estreita), cada linha vira um cartão com os números rotulados.'],
    campos: [F('Clientes', 'Clientes diferentes com venda válida'), F('Válidos', 'Pedidos em carteira, faturados em parte ou faturados'), F('Venda válida', 'Em carteira, parcial ou faturada'), F('Faturado', 'O que já faturou da venda válida'), F('Em carteira', 'A faturar'), F('Digitado', 'Pedido digitado, ainda fora da carteira'), F('Desistência', 'Pedido de venda cancelado'), F('Invest.', 'Bonificação: não entra na venda'), F('Invest. ÷ venda', 'Bonificação para cada real vendido, em %'), F('Próprio', 'Venda de quem é dono do cliente'), F('Outro', 'Venda de outro representante/vendedor'), F('Venda na própria carteira?', 'Nível: se quem vendeu é o dono da carteira do cliente')],
    analisar: ['Abra a faixa de alertas: bonificação sem venda, limite do grupo e pedido parado.', 'A coluna Outro mostra quem vende fora da própria lista.'], comuns: [F('Por empresa não aparece nada', 'Pode ser pedido de filial do grupo: use Ver por Grupo.'), F('Pedido do arquivo não aparece', 'CNPJ fora da base é ignorado na importação.')], proximo: 'Veja a situação do primeiro pedido de cada cliente no Acompanhamento.' },
  '/importacoes?aba=exportar': { titulo: 'Exportar', cap: 8, objetivo: 'Gerar as listas de cada representante em PDF e baixar em Excel os rejeitados (por tipo), a base de prospects e os pedidos.',
    como: ['Em Listas por equipe, escolha a onda, quem entra e, se quiser, um supervisor; clique em Gerar PDFs.', 'Abra o ZIP: uma pasta por supervisor, com um PDF por representante.', 'Em Rejeitados, marque um ou mais tipos e, se quiser, o supervisor, o representante e a onda: cada tipo vai numa aba da planilha.', 'Clique em Exportar Excel no bloco que quer baixar.'],
    campos: [F('Listas por equipe', 'Um PDF da Lista por representante, em ordem de cidade, bairro e segmento'), F('Clientes válidos', 'Todos, menos baixados e expurgados'), F('Só a Lista principal', 'Não contactado e Em prospecção'), F('Rejeitados', 'Baixados, expurgados e sem interesse do cliente e do representante'), F('Base de prospects', 'Todos os clientes, com status, representante e onda'), F('Pedidos', 'Os pedidos dos clientes da base')],
    analisar: ['O número no botão mostra quantos representantes e clientes vão no arquivo.'], comuns: [F('O botão está apagado', 'Nenhum cliente com os tipos e filtros marcados.'), F('Gerar PDFs demora', 'Cada representante é um PDF; o botão mostra quantos já foram.')], proximo: 'Abra o arquivo no Excel ou envie o PDF a cada representante.' },
  '/rejeitados': { titulo: 'Rejeitados', cap: 7, objetivo: 'Ver quem saiu da prospecção (baixados, expurgados e sem interesse), por que saiu, e exportar essa base em Excel.',
    como: ['Monte os níveis da hierarquia, como no Explorar carteira.', 'Clique numa linha da hierarquia e num card de tipo: tudo abaixo segue a escolha.', 'Clique em Excel para baixar o que está na tela: a linha escolhida e o tipo do card, com os dados cadastrais completos (uma aba por tipo).'],
    campos: [F('Na base', 'Todos os prospects da linha'), F('Rejeitados', 'Baixados, expurgados e sem interesse'), F('% da base', 'Rejeitados ÷ Na base')],
    analisar: ['Onde o sem interesse do representante é alto, veja os motivos antes de liberar outra onda.', 'Motivos de preço e prazo repetidos pedem conversa com o comercial.'],
    comuns: [F('Não aparecem os motivos', 'Eles só aparecem com o card Sem interesse do cliente ou do representante escolhido.'), F('Na base aparece —', 'Pelo mês da rejeição não há Na base: a base não tem mês.')],
    proximo: 'Baixe o Excel e combine com o comercial o que fazer com cada tipo.' },
  '/ficha': { titulo: 'Ficha do cliente', cap: 3, objetivo: 'Reunir os dados do cliente, o status, o crédito, os pedidos e o histórico.',
    como: ['Confira o status e os dados do cliente.', 'Clique em Registrar atendimento para gravar um contato.', 'Veja no histórico tudo o que aconteceu.'],
    campos: [F('Carteira', 'Representante/vendedor dono do cliente'), F('Dias corridos', 'Dias desde o primeiro registro'), F('Prazo para o cadastro', 'Data limite em Aguardando cadastro'), F('Limite', 'Crédito liberado'), F('Filiais fora da base', 'Empresas do mesmo grupo que não estão na base')],
    analisar: ['Veja se o limite cobre os pedidos em carteira do grupo.'], comuns: [F('Não aparece Registrar atendimento', 'Venda realizada e CNPJ baixado não aceitam registro.')], proximo: 'Depois de registrar, a ficha mostra o novo status.' },
  '/registrar': { titulo: 'Registrar atendimento', cap: 3, objetivo: 'Gravar o contato com o cliente e movê-lo no fluxo.',
    como: ['O canal vem fixo em Visita.', 'Escolha o resultado.', 'Preencha os campos que aparecem e grave.'],
    campos: [F('Canal', 'Como foi o contato'), F('Data do registro', 'Vem com a data de hoje, e não pode ser anterior ao último registro'), F('Motivo', 'Obrigatório em Sem interesse'), F('Retornar em', 'Opcional: quando voltar a falar com o cliente'), F('Data de entrada do pedido', 'Obrigatória ao reabrir com pedido identificado'), F('Observação', 'Texto livre; o motivo Outro exige')],
    analisar: ['Escolha entre sem interesse do cliente e do representante/vendedor: os dois contam separados.'], comuns: [F('Errei o registro', 'Nada é editado: faça um novo registro.')], proximo: 'Atendido vai para Aguardando cadastro, no Acompanhamento.' },
  '/lote': { titulo: 'Sem interesse em lote', cap: 3, objetivo: 'Registrar vários clientes como Sem interesse de uma vez.',
    como: ['Marque os clientes na Lista principal.', 'Informe o canal, a data e o motivo do lote.', 'Troque o motivo de um cliente, se for diferente.', 'Clique em Gravar.'],
    campos: [F('Motivo do lote', 'Vale para todos os clientes marcados'), F('Sem interesse', 'Motivo individual de cada cliente'), F('Observação do lote', 'Texto para todos')],
    analisar: ['Confira a lista antes de gravar: não há como editar depois, só registrar de novo.'], comuns: [F('Perdi a seleção', 'A seleção fica só nesta aba do navegador.')], proximo: 'Os clientes aparecem em Encerrados, no Acompanhamento.' },
  '/financeiro': { titulo: 'Console de crédito', cap: 5, objetivo: 'Liberar o crédito dos clientes em Análise financeira.',
    como: ['Em Em análise, os mais antigos vêm primeiro.', 'Clique no cliente para liberar.', 'Em Liberados · aguardando pedido, corrija uma liberação, se precisar.'],
    campos: [F('Cadastro ERP', 'Data do cadastro no ERP'), F('Dias em análise', 'Dias desde o cadastro'), F('Prazo', 'Data limite da análise; vencido fica em vermelho'), F('Condição', 'Forma, prazo, limite e restrição liberados')],
    analisar: ['Comece pelos prazos vencidos.'], comuns: [F('O cliente não está na fila', 'Ele ainda não tem cadastro, ou o relatório de crédito já liberou.')], proximo: 'Liberado, o cliente vai para Aguardando pedido.' },
  '/financeiro/liberar': { titulo: 'Liberar crédito', cap: 5, objetivo: 'Informar as condições de crédito de um cliente.',
    como: ['Preencha forma, prazo, limite e restrição.', 'Confira a data e grave.'],
    campos: [F('Forma de pagamento', 'Antecipado, à vista, boleto ou depósito e Pix'), F('Prazo de pagamento', 'Em dias'), F('Limite de crédito', 'Boleto a prazo exige limite'), F('Restrição de crédito', 'Se o cliente tem restrição'), F('Data da liberação', 'Não pode ser anterior ao cadastro no ERP')],
    analisar: ['Em empresas do mesmo grupo, confira o limite global.'], comuns: [F('Errei a liberação', 'A correção é uma nova liberação, e a anterior fica no histórico.')], proximo: 'O cliente vai para Aguardando pedido.' },
  '/admin/importar/base': { titulo: 'Base de prospects', cap: 8, objetivo: 'Importar os clientes a trabalhar, cada um na carteira de um representante/vendedor.',
    como: ['Escolha a planilha.', 'Confira a simulação e como tratar cada Status Atual.', 'Confirme a gravação.'],
    campos: [F('Status Atual', 'Valor da planilha e como ele será tratado'), F('DT 1º / 2º contato', 'Datas de contato da planilha, se forem consideradas'), F('Resultado da simulação', 'Linhas aceitas, rejeitadas e ignoradas')],
    analisar: ['Leia os motivos das linhas rejeitadas antes de gravar.'], comuns: [F('Linha rejeitada', 'O motivo aparece na própria linha da simulação.')], proximo: 'Depois, os clientes aparecem na Lista principal.' },
  '/admin/importar/credito': { titulo: 'Cadastro e crédito (ERP)', cap: 8, objetivo: 'Registrar o cadastro e o crédito liberado dos clientes da base.',
    como: ['Escolha o relatório do ERP.', 'Confira as colunas e a simulação.', 'Confirme a gravação.'],
    campos: [F('Créd. Cliente', 'Limite do CNPJ; preenchido, ele vale, mesmo 0'), F('Créd. Grupo', 'Limite global da raiz, usado quando o do cliente está vazio'), F('9.999.999', 'Sem limite'), F('Forma Pgto', 'Forma de pagamento, como vem do ERP'), F('Dt. Cadastro', 'Data do cadastro; obrigatória')],
    analisar: ['Avisos de Créd. Grupo diferente entre empresas pedem conferência no ERP.', 'Cadastro anterior à campanha indica quem já era cliente.'], comuns: [F('Linha ignorada', 'CNPJ fora da base, CPF ou cliente que já tem cadastro e crédito.'), F('Tinha pedido sem cadastro', 'O relatório completa o cliente, e os pedidos não precisam ser reimportados.')], proximo: 'Importe o arquivo de pedidos.' },
  '/admin/importar/erp': { titulo: 'Pedidos · Baixados (ERP)', cap: 8, objetivo: 'Importar os arquivos do ERP que movem o cliente: pedidos, cadastro de clientes e CNPJs baixados.',
    como: ['Escolha o tipo de arquivo.', 'Informe a data, se o arquivo não tiver essa coluna.', 'Confira a simulação e grave.'],
    campos: [F('Tipo de arquivo', 'Pedidos, cadastro de clientes ou CNPJs baixados'), F('Data para todas as linhas', 'Usada quando o arquivo não traz a data')],
    analisar: ['Em CNPJs baixados, o cliente sai das contas da carteira.'], comuns: [F('Importei o arquivo errado', 'Veja em Importações o que pode ser apagado.')], proximo: 'Confira o resultado em Importações.' },
  '/admin/importar/pedidos': { titulo: 'Importar pedidos', cap: 8, objetivo: 'Importar o relatório de pedidos do ERP e vincular cada pedido ao cliente da base.',
    como: ['Arquivo: escolha o relatório, a frequência e a data.', 'Classificação: confira como cada transação e situação conta.', 'Vínculo: veja os clientes do arquivo.', 'Simulação: confira os pontos e as mudanças de status.', 'Gravação: confirme.'],
    campos: [F('Conta como', 'Venda, investimento ou não considerado'), F('Situação', 'Digitado, carteira, parcial, faturado ou cancelado'), F('Frequência', 'Diária usa a data do dia; semanal pede a data'), F('Depois', 'Status do cliente após a importação')],
    analisar: ['Leia Pontos para conferir: falta de cadastro, representante sem código e bonificação sem venda.', 'Veja quantos clientes ficam fora da base.'], comuns: [F('Cliente sem registro de cadastro', 'O pedido fica guardado; importe o relatório de cadastro e crédito.'), F('Código novo', 'Classifique a transação ou situação para seguir.')], proximo: 'Veja o resultado em Explorar pedidos e no Acompanhamento.' },
  '/admin/importar/tipos': { titulo: 'Representantes e vendedores', cap: 8, objetivo: 'Definir por lista quem é representante e quem é vendedor.',
    como: ['Escolha o arquivo ou cole a lista com o cabeçalho.', 'Confira a simulação e grave.'],
    campos: [F('Representante', 'Sem rota'), F('Vendedor', 'Com rota e subrota')], analisar: ['Confira quem ficou sem tipo.'], comuns: [F('A tela não está no menu', 'O cadastro do dia a dia fica em Usuários.')], proximo: 'Veja o resultado em Usuários.' },
  '/admin/grupos': { titulo: 'Grupos de CNPJ', cap: 8, objetivo: 'Cruzar a base com o cadastro do ERP pelo CNPJ e pela raiz, e expurgar quem já é cliente.',
    como: ['Carregue o arquivo com a coluna CPF / CNPJ.', 'Veja a sugestão de cada empresa.', 'Escolha a ação, informe o motivo e aplique.'],
    campos: [F('Raiz', 'Os 8 primeiros dígitos do CNPJ'), F('Sugestão', 'Expurgar ou Manter'), F('No arquivo', 'Se o mesmo CNPJ está no arquivo'), F('Cadastro no ERP', 'Data do cadastro')],
    analisar: ['Basta estar cadastrado no ERP, pelo mesmo CNPJ ou pelo grupo: não se olha faturamento. Quem já foi trabalhado fica.'], comuns: [F('Expurguei errado', 'Carregue o mesmo arquivo, clique em Desfazer todos os expurgados (vale o filtro) e em Aplicar: nada é apagado.'), F('Importei baixados como grupo', 'Os do arquivo já baixados não voltam; Desfazer todos os expurgados devolve as filiais do grupo.')], proximo: 'O expurgado sai da carteira válida e das contas.' },
  '/admin/importacoes': { titulo: 'Importações', cap: 8, objetivo: 'Ver o que foi importado e apagar um arquivo de pedidos, se precisar.',
    como: ['Veja a lista de importações.', 'Abra uma para ver as linhas.', 'Em Arquivos de pedidos, apague do mais novo ao mais antigo.'],
    campos: [F('Lidas', 'Linhas do arquivo'), F('Aceitas', 'Linhas gravadas'), F('Ignoradas', 'Fora da base, por exemplo, ou sem mudança'), F('Rejeitadas', 'Linhas com erro'), F('Clientes afetados', 'Quem muda ao apagar o arquivo')],
    analisar: ['Antes de apagar, leia o que acontece com cada coisa.'], comuns: [F('Não consigo apagar', 'Só o arquivo mais recente pode ser apagado; é preciso digitar o nome dele.')], proximo: 'Depois de apagar, importe o arquivo correto.' },
  '/admin/usuarios': { titulo: 'Usuários', cap: 8, objetivo: 'Cadastrar as pessoas, definir as senhas e os perfis.',
    como: ['Preencha nome, login, perfil e supervisor.', 'Defina a senha, com ao menos 6 caracteres (administrador: 8).', 'Em Alterar login, troque o login de alguém, por exemplo pelo que a pessoa já usa em outro sistema.', 'Use Perfis para escolher as telas de cada perfil.'],
    campos: [F('Cód. ERP', 'Código do ERP: liga o usuário ao representante dos arquivos de pedidos; não faz parte do login'), F('Perfil', 'O que a pessoa acessa'), F('Supervisor', 'A equipe da pessoa'), F('Acesso', 'Se a senha já foi definida')],
    analisar: ['Representante sem código aparece nos alertas de pedidos.'], comuns: [F('Administrador sem acesso à Administração', 'Defina a senha dele aqui, estando logado como administrador.')], proximo: 'Avise a pessoa do login e da senha.' },
  '/admin/perfis': { titulo: 'Perfis', cap: 8, objetivo: 'Escolher quais telas cada perfil acessa.',
    como: ['Crie ou abra um perfil.', 'Escolha o tipo-base e marque as telas.', 'Grave e atribua o perfil em Usuários.'],
    campos: [F('Tipo-base', 'Define quais dados a pessoa vê'), F('Telas', 'O que aparece no menu')], analisar: ['Confira se o perfil abre pelo menos uma tela de trabalho.'], comuns: [F('Tela indisponível', 'Ela não serve para aquele tipo-base.')], proximo: 'Atribua o perfil em Usuários.' },
  '/admin/parametros': { titulo: 'Parâmetros', cap: 8, objetivo: 'Ajustar prazos e limites dos alertas e liberar as ondas para os representantes/vendedores.',
    como: ['Altere o valor e grave.', 'Em Ondas liberadas, marque as ondas que o representante/vendedor pode ver e clique em Salvar.'], campos: [F('Ondas liberadas', 'Ondas da base que o representante/vendedor vê na Lista principal e no Explorar carteira; quem já foi atendido aparece sempre'), F('na lista', 'Clientes da onda ainda não atendidos'), F('Parâmetro', 'O que o valor controla'), F('Valor', 'Dias, quantidade ou data'), F('Última alteração', 'Quando e quem mudou')], analisar: ['Prazo muito curto gera alerta demais.'], comuns: [F('O alerta não mudou', 'Recarregue a página.')], proximo: 'Confira os alertas em Explorar pedidos.' },
  '/admin/feriados': { titulo: 'Feriados', cap: 8, objetivo: 'Manter os feriados usados na conta de dias úteis.',
    como: ['Escolha o ano.', 'Inclua a data, a descrição e a abrangência.', 'Marque se repete todo ano.'], campos: [F('Abrangência', 'Nacional, estadual ou municipal'), F('Local', 'UF ou cidade do feriado'), F('Origem', 'De onde veio o feriado')], analisar: ['Confira os feriados municipais das cidades da campanha.'], comuns: [F('Feriado errado', 'Remova e inclua de novo.')], proximo: 'Os dias úteis entram no painel.' },
  '/admin/erros': { titulo: 'Erros do app', cap: 8, objetivo: 'Ver as falhas registradas, para corrigir o que atrapalha o uso.',
    como: ['Escolha o período.', 'Veja os mais frequentes.', 'Abra a lista para ver os detalhes.'], campos: [F('Código', 'Identifica o erro'), F('Tela', 'Onde aconteceu'), F('Vezes', 'Quantas vezes ocorreu'), F('Aparelho', 'Computador ou celular'), F('Versão', 'Versão do site')], analisar: ['Comece pelos mais frequentes.'], comuns: [F('O erro é de rede', 'Costuma ser a internet do aparelho.')], proximo: 'Envie o código do erro ao suporte.' },
});

/**
 * Significado dos termos: tudo o que aparece nas telas, inclusive as abreviações. Só entra termo que existe no sistema:
 * test/ajuda.test.mjs confere cada um no código das telas. `tela` = permissão que mostra o grupo; `caminho` = tela do botão ?.
 */
const T = (termo, significado, conta = null, para = null) => Object.freeze({ termo, significado, conta, para });
export const TERMOS = Object.freeze([
  { id: 'pedidos', nome: 'Explorar pedidos', tela: 'pedidos', caminho: '/pedidos', termos: [
    T('Clientes', 'Clientes diferentes com venda válida na linha. Um cliente com 10 pedidos conta uma vez.'),
    T('Válidos', 'Pedidos de venda em carteira, faturados em parte ou faturados.'),
    T('Faturamento da venda', 'Gráfico que olha só a venda válida: quanto já faturou e quanto falta faturar.'),
    T('O que aconteceu com os pedidos de venda', 'Gráfico que olha todos os pedidos de venda, inclusive os que não viraram venda: venda válida, digitado e desistência, com a quantidade de pedidos e o valor.'),
    T('Venda válida', 'Valor dos pedidos válidos. Na hierarquia, a coluna Venda. Não inclui digitado, desistência nem bonificação.'),
    T('Faturado', 'Parte da venda válida que o ERP já faturou.', '% da venda = faturado ÷ venda válida'),
    T('Em carteira', 'Venda válida que ainda falta faturar.', 'em carteira = venda válida − faturado'),
    T('ticket médio', 'Valor médio de cada pedido válido.', 'ticket médio = venda válida ÷ válidos'),
    T('Digitado', 'Pedido de venda digitado e ainda fora da carteira (situação 9, Não Fechado, no ERP). Não conta como venda.'),
    T('Desistência', 'Pedido de venda cancelado (situação 5 no ERP). Não conta como venda.'),
    T('Invest.', 'Investimento: valor dos pedidos de bonificação, sem os cancelados e os digitados. Fica à parte: não soma nem desconta da venda.'),
    T('Invest. ÷ venda', 'Investimento dividido pela venda válida: quanto se deu em bonificação para cada real vendido. Ex.: 3,5% = R$ 3,50 de bonificação a cada R$ 100,00 vendidos.', 'investimento ÷ venda válida × 100'),
    T('Próprio', 'Venda válida feita pelo representante/vendedor que tem o cliente na própria lista.'),
    T('Outro', 'Venda válida feita por um representante/vendedor que não tem o cliente na lista. O cliente continua com o dono da carteira.'),
    T('Rep.', 'Representante/vendedor. Na hierarquia, o dono da carteira do cliente.'),
    T('Rep. do pedido', 'Em Vendas fora da carteira: quem fez o pedido. No Excel: Representante do pedido.'),
    T('Rep. da carteira', 'Em Vendas fora da carteira: o dono da carteira do cliente. No Excel: Representante da carteira.'),
    T('Vendas fora da carteira', 'Pedidos válidos ou não em que o Rep. do pedido não é o Rep. da carteira do cliente. O cliente continua com o dono da carteira.'),
    T('Venda na própria carteira?', 'Coluna do Excel: Sim, quando quem vendeu é o dono da carteira do cliente; Não, quando é de outra carteira; Filial do grupo, filial fora da base.'),
    T('Ag. pedido válido', 'Aguardando pedido válido. Alerta: o cliente teve pedido digitado ou cancelado e nenhum válido, além do prazo dos Parâmetros.'),
    T('Bonificação sem venda', 'Alerta: o cliente recebeu bonificação e não tem pedido de venda.'),
    T('Muita desistência', 'Alerta: o cliente tem desistências demais entre os pedidos.'),
    T('Aberto há muito tempo', 'Alerta: pedido válido em carteira há mais dias que o prazo dos Parâmetros.'),
    T('Limite do grupo', 'Alerta: o valor em carteira do grupo passou do limite de crédito.'),
    T('Rep. sem código', 'Representante sem código: o código do arquivo não está em nenhum usuário. Inclua o código em Usuários.', null, SO_ADMIN),
  ] },
  { id: 'lista', nome: 'Lista principal', tela: 'lista', caminho: '/carteira', termos: [
    T('Prospect', 'Cliente da base: razão social e CNPJ.'),
    T('Cidade · bairro', 'Onde fica o cliente.'),
    T('Onda', 'Grupo de trabalho da campanha. O administrador libera as ondas aos poucos.'),
    T('Segmento', 'Tipo de negócio do cliente (tipologia).'),
    T('Tentativas', 'Quantos contatos já foram registrados para o cliente.'),
    T('1º registro em', 'Data do primeiro contato registrado.'),
    T('Dias', 'Dias desde o primeiro registro.'),
    T('Não contactado', 'Ainda sem nenhum contato.'),
    T('Em prospecção (contato da planilha)', 'Teve contato na planilha da base, ainda sem resultado no sistema.'),
    T('Canal', 'Como foi o contato. Por enquanto, todo atendimento é Visita; o campo fica na tela para incluir telefone e WhatsApp no futuro.'),
    T('Atendido', 'O cliente aceitou a proposta: vai para Aguardando cadastro.'),
    T('Sem interesse do cliente', 'O cliente recusou a proposta. Pede o motivo.'),
    T('Sem interesse do representante', 'O representante/vendedor não vai trabalhar o cliente. Pede o motivo.'),
    T('Reabrir: pedido identificado', 'Para quem estava em sem interesse e fez pedido: volta ao fluxo.'),
    T('Retornar em (opcional)', 'Data para voltar a falar com o cliente.'),
  ] },
  { id: 'rejeitados', nome: 'Rejeitados', tela: 'rejeitados', caminho: '/rejeitados', termos: [
    T('Na base', 'Todos os prospects da linha da hierarquia, em qualquer situação.'),
    T('Baixados', 'CNPJ baixado na Receita: não pode mais ser faturado.'),
    T('Expurgados', 'Tirados da base por já serem clientes (grupo de CNPJ), pelo administrador.'),
    T('Sem int. cliente', 'Sem interesse do cliente: ele recusou a proposta.'),
    T('Sem int. repr.', 'Sem interesse do representante: o representante/vendedor não vai trabalhar o cliente.'),
    T('% da base', 'Parte da linha que foi rejeitada.', 'rejeitados ÷ na base × 100'),
    T('Mês da rejeição', 'Nível da hierarquia: o mês do sem interesse, da baixa ou do expurgo.'),
  ] },
  { id: 'credito', nome: 'Console de crédito', tela: 'credito', caminho: '/financeiro', termos: [
    T('Cadastro ERP', 'Data em que o cliente foi cadastrado no ERP.'),
    T('Dias em análise', 'Há quantos dias o cliente espera a liberação do crédito.'),
    T('Prazo', 'Data limite para liberar o crédito. Fora do prazo fica em vermelho.'),
    T('Condição', 'Forma, prazo, limite e restrição liberados.'),
    T('Forma de pagamento *', 'Antecipado, à vista, boleto ou depósito e Pix.'),
    T('Prazo de pagamento (dias)', 'Em quantos dias o cliente paga.'),
    T('Limite de crédito (R$) *', 'Quanto o cliente pode dever ao mesmo tempo. Boleto a prazo exige limite.'),
    T('Restrição de crédito *', 'Com restrição ou Sem restrição.'),
    T('Liberado em', 'Data da liberação do crédito.'),
  ] },
  { id: 'acompanhamento', nome: 'Acompanhamento', tela: 'acompanhamento', caminho: '/carteira?aba=acompanhamento', termos: [
    T('Cadastros realizados', 'Clientes com cadastro identificado no ERP. É a soma das quatro etapas seguintes. Na hierarquia, a coluna Cadastros.'),
    T('Análise financeira', 'Cadastro identificado, esperando a liberação do crédito.'),
    T('Aguardando pedido', 'Crédito liberado, ainda sem pedido válido.'),
    T('Pedido em carteira', 'O primeiro pedido válido ainda não faturou. Na hierarquia, a coluna Em carteira.'),
    T('Pedido faturado', 'O primeiro pedido faturou, inteiro ou em parte. Na hierarquia, a coluna Faturado.'),
    T('dos cadastros', 'Parte dos cadastros realizados que está na etapa.', 'clientes da etapa ÷ cadastros realizados × 100'),
    T('Vencida', 'A análise financeira passou do prazo. Em Aguardando cadastro, Vencido: o cadastro passou do prazo.'),
    T('No prazo', 'Ainda dentro do prazo da etapa.'),
    T('Pedido não válido', 'Em Aguardando pedido: houve pedido, mas digitado ou cancelado.'),
    T('Sem pedido', 'Em Aguardando pedido: nenhum pedido ainda.'),
    T('Aguardando cadastro', 'Fora do fluxo: o cliente foi atendido e o cadastro ainda não apareceu no relatório do ERP.'),
    T('Pedido sem cadastro', 'Fora do fluxo: chegou pedido de cliente sem registro de cadastro. Falta importar o relatório de cadastro e crédito.'),
    T('Encerrados', 'Fora do fluxo: sem interesse, inválido ou expurgado.'),
    T('Etapa atual', 'Etapa em que o cliente está hoje.'),
    T('Ordem', 'Posição do pedido válido entre os pedidos do cliente: 1º, 2º, 3º.'),
    T('Quem vendeu', 'Representante/vendedor que fez o pedido. Pode não ser o dono da carteira.'),
    T('Prazo do cadastro', 'Data limite para o cadastro aparecer no ERP.'),
    T('Prazo da análise', 'Data limite para o financeiro liberar o crédito.'),
    T('Dias no fluxo', 'Dias desde o cadastro identificado.'),
    T('Dias aguardando', 'Dias desde o atendimento, esperando o cadastro.'),
    T('Dias sem cadastro', 'Dias desde o primeiro pedido de um cliente ainda sem cadastro.'),
    T('Dias na etapa', 'Dias desde que o cliente entrou na etapa.'),
    T('Dias em carteira', 'Dias desde o pedido, ainda sem faturar.'),
    T('Dias do cadastro ao faturamento', 'Dias entre o cadastro identificado e o faturamento do pedido.'),
    T('Forma e prazo', 'Forma e prazo de pagamento liberados no crédito.'),
    T('Com pedido em carteira', 'Crédito × Pedido: clientes com pedido em carteira para comparar com o limite. Na hierarquia, a coluna Com pedido.'),
    T('Dentro do limite', 'O valor em carteira cabe no limite de crédito.'),
    T('Acima do limite', 'O valor em carteira passou do limite de crédito.'),
    T('Sem limite', 'O cliente não tem limite para comparar (ou tem o valor 9.999.999 do ERP).'),
    T('Uso do limite', 'Quanto do limite o pedido em carteira ocupa.', 'em carteira ÷ limite × 100'),
    T('Forma liberada', 'Forma de pagamento liberada no crédito.'),
    T('Prazo liberado', 'Prazo de pagamento liberado no crédito, em dias.'),
  ] },
  { id: 'carteira', nome: 'Explorar carteira', tela: 'explorar', caminho: '/explorar', termos: [
    T('Ramo', 'Uma linha da hierarquia: um supervisor, um representante/vendedor, uma cidade e assim por diante.', null, GESTAO),
    T('Ramo', 'Uma linha da hierarquia: uma cidade, um segmento, uma onda e assim por diante.', null, CARTEIRA),
    T('Prospects', 'Coluna da hierarquia: clientes válidos da linha, sem os baixados e os expurgados.'),
    T('Contactados', 'Prospects que já tiveram contato.'),
    T('Cobertura', 'Quanto da base já foi trabalhado. No celular, Cobert.', 'contactados (com sem interesse) ÷ prospects válidos (sem baixados e expurgados)'),
    T('S. int. cliente', 'Sem interesse do cliente: o cliente recusou a proposta. No celular, S.I. cli.'),
    T('S. int. repr.', 'Sem interesse do representante: o representante/vendedor não vai trabalhar o cliente. No celular, S.I. rep.'),
    T('Ag. cadastro', 'Aguardando cadastro: o cliente foi atendido e falta o cadastro aparecer no ERP. No celular, Ag. cad.'),
    T('Ag. financeiro', 'Aguardando financeiro: o crédito está em análise financeira. No celular, Ag. fin.'),
    T('Ag. pedido', 'Aguardando pedido: crédito liberado, falta o pedido. No celular, Ag. ped.'),
    T('Pedido realizado', 'Clientes com ao menos um pedido válido. No celular, Pedidos.'),
    T('Pedidos (R$)', 'Valor da venda válida dos clientes do ramo. No celular, Valor.'),
    T('Potencial (R$)', 'Estimativa do que os clientes em andamento podem vender.', 'em aberto × % do pipeline × valor médio dos pedidos'),
    T('Contactados, seguem no processo', 'Contactados que não estão em sem interesse: estão em alguma etapa do fluxo.'),
    T('na base', 'Total do card Da totalidade: a base inteira da linha, inclusive baixados e expurgados.'),
    T('Rejeitados', 'No card Da totalidade: sem interesse do cliente, sem interesse do representante, baixados e expurgados, juntos.'),
    T('Fora da base', 'No celular, na hierarquia: baixados e expurgados, que não contam na coluna Prospects.'),
    T('Conversão', 'Parte dos contactados que virou venda.', 'vendas ÷ contactados × 100'),
  ] },
  { id: 'importar-pedidos', nome: 'Importar pedidos', tela: 'admin_erp', caminho: '/admin/importar/pedidos', termos: [
    T('Digit.', 'Digitados: pedidos de venda digitados, ainda fora da carteira.'),
    T('Desist.', 'Desistências: pedidos de venda cancelados.'),
    T('Venda válida (R$)', 'Valor dos pedidos em carteira, faturados em parte ou faturados.'),
    T('Rep. sem código', 'Representante sem código: o código do arquivo não está em nenhum usuário.'),
  ] },
  { id: 'importar-credito', nome: 'Cadastro e crédito (ERP)', tela: 'admin_credito', caminho: '/admin/importar/credito', termos: [
    T('Créd. Cliente', 'Crédito do cliente: limite do CNPJ. Preenchido, ele vale, mesmo 0.'),
    T('Créd. Grupo', 'Crédito do grupo: limite global da raiz, usado quando o do cliente está vazio.'),
    T('9.999.999', 'Valor do ERP que significa sem limite.'),
    T('Forma Pgto', 'Forma de pagamento, como vem do ERP.'),
    T('Dt. Cadastro', 'Data do cadastro no ERP. Obrigatória.'),
  ] },
  { id: 'gerais', nome: 'Termos gerais', tela: null, caminho: '/ajuda', termos: [
    T('CNPJ', 'Número que identifica cada empresa.'),
    T('raiz', 'Raiz do CNPJ: os 8 primeiros dígitos. A matriz e as filiais têm a mesma raiz.'),
    T('ERP', 'Sistema da empresa de onde vêm os relatórios de cadastro, crédito e pedidos.'),
    T('Representante/vendedor', 'Quem atende o cliente.'),
    T('Supervisor', 'Responsável por uma equipe de representantes/vendedores.'),
    T('(R$)', 'Valores em reais.'),
  ] },
]);

/**
 * Opções do topo de cada tela (chaves e filtros): o que cada uma mostra. Aparecem no botão ? da tela e no PDF.
 * Só entra opção que existe na tela: test/ajuda.test.mjs confere cada uma no código.
 */
const O = (nome, opcoes, para = null) => Object.freeze({ nome, para, opcoes: opcoes.map(([opcao, significado, paraOpcao = null]) => Object.freeze({ opcao, significado, para: paraOpcao })) });
const VER_POR = O('Ver por Empresa | Ver por Grupo', [
  ['Ver por Empresa', 'Cada CNPJ da base separado. Filial fora da base não aparece.'],
  ['Ver por Grupo', 'Junta as empresas pela raiz do CNPJ (os 8 primeiros dígitos) e inclui as filiais que não estão na base.']]);
export const OPCOES_TOPO = Object.freeze({
  '/explorar': [O('Todos | Representantes | Vendedores', [
    ['Todos', 'Toda a carteira que você vê.'], ['Representantes', 'Só as carteiras de representante (sem rota).'], ['Vendedores', 'Só as carteiras de vendedor (com rota e subrota).']], GESTAO)],
  '/carteira': [
    O('Equipe', [['Supervisor', 'Escolhe a equipe (para quem vê todas as equipes).', TODAS_EQUIPES], ['Representante', 'Escolhe a carteira de um representante/vendedor.']], GESTAO),
    O('Local', [['UF', 'Filtra pelo estado.'], ['Cidade', 'Filtra pela cidade.'], ['Bairro', 'Filtra pelo bairro (aparece depois de escolher a cidade).']]),
    O('Carteira', [['Onda', 'Filtra pela onda da campanha.', ONDAS_TODAS], ['Onda', 'Filtra pela onda da campanha. Só aparecem as ondas que o administrador liberou.', ONDAS_LIBERADAS], ['Segmento', 'Filtra pela tipologia do cliente.']]),
    O('Exibição', [['Agrupar por', 'Junta a lista por cidade, onda ou outra opção; Nenhum mostra a lista corrida.']]),
    O('Situação', [['Todos', 'Todos os clientes da lista.'], ['Não contactado', 'Ainda sem nenhum contato.'], ['Em prospecção (contato da planilha)', 'Teve contato na planilha da base, ainda sem resultado no sistema.']]),
    O('No celular: Lista | Cidade | Bairro | Onda | Rota', [['Lista', 'Os clientes um a um.'], ['Cidade', 'Agrupados por cidade.'], ['Bairro', 'Agrupados por bairro.'], ['Onda', 'Agrupados por onda.'], ['Rota', 'Agrupados por rota (só vendedor).', COM_ROTA]])],
  '/carteira?aba=acompanhamento': [
    O('Fluxo | Crédito × Pedido', [
      ['Fluxo', 'Mostra em que etapa está cada cliente, do cadastro ao pedido faturado.'],
      ['Crédito × Pedido', 'Compara o limite de crédito liberado com os pedidos em carteira: dentro do limite, acima do limite ou sem limite.']]),
    O('Apenas o primeiro pedido | Todos os pedidos', [
      ['Apenas o primeiro pedido', 'Conta só o primeiro pedido válido de cada cliente: mostra quantos clientes foram conquistados. No celular, Primeiro pedido.'],
      ['Todos os pedidos', 'Conta todos os pedidos válidos: mostra o valor vendido, inclusive a recompra.']]),
    VER_POR],
  '/pedidos': [
    O('Pedidos de venda | Pedidos de bonificação | Ambos', [
      ['Pedidos de venda', 'Só os pedidos de venda: a venda válida, o digitado e a desistência. No celular, Venda.'],
      ['Pedidos de bonificação', 'Só os pedidos de bonificação, o investimento no cliente. No celular, Bonificação.'],
      ['Ambos', 'Venda e bonificação juntas.']]),
    VER_POR],
  '/importacoes': [O('Abas da tela', [
    ['Base de prospects', '1º passo: os clientes a trabalhar, cada um na carteira de um representante/vendedor.'], ['Grupos de CNPJ', '2º passo: sugere quem expurgar por já ser cliente.'],
    ['Cadastro e crédito', '3º passo: cadastro no ERP e crédito liberado.'], ['Pedidos', '4º passo: pedidos do ERP, ligados a cada cliente.'], ['Baixados', '5º passo: CNPJs baixados na Receita.'],
    ['Exportar', 'Listas por equipe em PDF; rejeitados, base de prospects e pedidos em Excel.'], ['Histórico', 'Tudo o que foi importado; o arquivo de pedidos mais novo e uma importação da base ainda não trabalhada podem ser apagados.']])],
  '/rejeitados': [O('Cards do topo', [
    ['Rejeitados', 'Todos os tipos juntos.'], ['Baixados', 'CNPJ baixado na Receita: não pode mais ser faturado.'], ['Expurgados', 'Tirados da base por já serem clientes (grupo de CNPJ).'],
    ['Sem interesse do cliente', 'O cliente recusou a proposta. Mostra os motivos.'], ['Sem interesse do representante', 'O representante/vendedor não vai trabalhar o cliente. Mostra os motivos.']])],
  '/financeiro': [O('Cards do topo', [
    ['em análise', 'Clientes aguardando a liberação do crédito.'], ['fora do prazo', 'Os que passaram do prazo da análise.'], ['liberados aguardando pedido', 'Já liberados, ainda sem pedido: para corrigir uma liberação.']])],
  '/admin/grupos': [O('Todas | Expurgar | Manter | Expurgados', [
    ['Todas', 'Todas as empresas do arquivo.'], ['Expurgar', 'Sugestão de tirar da base: cadastrado no ERP (mesmo CNPJ ou mesmo grupo) e ainda não trabalhado.'], ['Manter', 'Sugestão de manter na base.'],
    ['Expurgados', 'Os que já foram tirados da base.']])],
});

/** Opções do topo da tela, pelo endereço. */
/**
 * Chave da ajuda de um endereço. Acompanhamento é uma aba da Lista principal; cada aba da tela Importações usa a ajuda
 * da importação que ela traz (a mesma de quando eram telas separadas).
 */
const AJUDA_DA_ABA = Object.freeze({ base: '/admin/importar/base', grupos: '/admin/grupos', credito: '/admin/importar/credito', pedidos: '/admin/importar/pedidos',
  baixados: '/admin/importar/erp', exportar: '/importacoes?aba=exportar', historico: '/admin/importacoes' });
function chaveDaTela(caminho, consulta) {
  const aba = new URLSearchParams(consulta).get('aba');
  if (caminho === '/carteira' && aba === 'acompanhamento') return '/carteira?aba=acompanhamento';
  if (caminho === '/importacoes') return AJUDA_DA_ABA[aba] ?? AJUDA_DA_ABA.base;
  return caminho;
}

/** Opções do topo de uma tela que valem para o usuário (sem usuário: todas). */
export function opcoesPara(chave, usuario = null) {
  return (OPCOES_TOPO[chave] ?? []).filter((g) => vale(g.para, usuario)).map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => vale(o.para, usuario)) })).filter((g) => g.opcoes.length);
}
/** Grupo de termos que vale para o usuário (sem usuário: todos os termos). */
export function termosPara(id, usuario = null) {
  const g = TERMOS.find((x) => x.id === id);
  return g ? { ...g, termos: g.termos.filter((t) => vale(t.para, usuario)) } : null;
}

export function opcoesDaTela(caminho, consulta = '', usuario = null) {
  const proprias = opcoesPara(chaveDaTela(caminho, consulta), usuario);
  return caminho === '/importacoes' ? [...opcoesPara('/importacoes', usuario), ...proprias] : proprias;
}

/** Grupos de termos que o usuário vê: os gerais e os das telas que o perfil dele abre, só com os termos do perfil dele. */
export const termosDoUsuario = (usuario) => TERMOS.filter((g) => !g.tela || podeTela(usuario, g.tela)).map((g) => termosPara(g.id, usuario));

/** Grupo de termos da tela do botão ?, pelo endereço. */
export function grupoDeTermos(caminho, consulta = '', usuario = null) {
  const c = chaveDaTela(caminho, consulta);
  const g = TERMOS.find((x) => x.caminho === c);
  return g ? termosPara(g.id, usuario) : null;
}

/** Os termos como um capítulo a mais do manual em PDF: uma tabela por grupo. */
export function capituloDeTermos(usuario) {
  const grupos = termosDoUsuario(usuario);
  const telas = Object.entries(OPCOES_TOPO).filter(([c]) => !grupos.some((g) => g.caminho === c) && AJUDA_TELAS[c] && podeVerTela(usuario, c));
  return { n: 9, nome: 'Opções do topo e significado dos termos', desc: 'O que cada opção do topo mostra e tudo o que aparece nas telas, inclusive as abreviações.',
    blocos: [...grupos.flatMap((g) => [['h', g.nome], ...blocosDeOpcoes(opcoesPara(g.caminho, usuario)),
      ['tabela', ['Termo', 'Significado'], g.termos.map((t) => [t.termo, t.conta ? `${t.significado} Conta: ${t.conta}.` : t.significado])]]),
    ...telas.flatMap(([c]) => [['h', AJUDA_TELAS[c].titulo], ...blocosDeOpcoes(opcoesPara(c, usuario))])] };
}
const blocosDeOpcoes = (opcoes) => (opcoes.length ? [['tabela', ['Opção do topo', 'O que mostra'], opcoes.flatMap((o) => o.opcoes.map((x) => [`${x.opcao} (${o.nome})`, x.significado]))]] : []);
const TELA_DO_CAMINHO = { '/importacoes': 'admin_importacoes', '/rejeitados': 'rejeitados', '/explorar': 'explorar', '/carteira': 'lista', '/carteira?aba=acompanhamento': 'acompanhamento', '/pedidos': 'pedidos', '/financeiro': 'credito', '/admin/grupos': 'admin_grupos' };
const podeVerTela = (usuario, c) => !TELA_DO_CAMINHO[c] || podeTela(usuario, TELA_DO_CAMINHO[c]);

/** Significado de um termo (dica do rótulo no computador), ou null. */
export function significadoDe(termo) {
  for (const g of TERMOS) { const t = g.termos.find((x) => x.termo === termo); if (t) return t.significado; }
  return null;
}

/** Procura em termo e significado, sem diferença de acento e maiúscula. */
export function buscarTermos(grupos, texto) {
  const tira = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = tira(texto ?? '').trim();
  if (!q) return grupos;
  return grupos.map((g) => ({ ...g, termos: g.termos.filter((t) => tira(`${t.termo} ${t.significado}`).includes(q)) })).filter((g) => g.termos.length);
}

/** Ajuda da tela pelo endereço. Sem ajuda própria: null. */
export function ajudaDaTela(caminho, consulta = '', usuario = null) {
  const a = AJUDA_TELAS[chaveDaTela(caminho, consulta)];
  if (!a) return null;
  return { ...a, como: filtrarItens(a.como, usuario), campos: filtrarItens(a.campos, usuario), analisar: filtrarItens(a.analisar, usuario), comuns: filtrarItens(a.comuns, usuario) };
}

/** Telas sem botão de ajuda: a entrada e a confirmação de senha. */
export const TELAS_SEM_AJUDA = Object.freeze(['/entrar', '/admin/acesso']);

