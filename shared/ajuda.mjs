// Ajuda do sistema: um único conteúdo para o fluxograma, os capítulos, o botão ? de cada tela e o manual em PDF. docs/03 §15
// Mudou uma tela? Atualize aqui. O teste test/ajuda.test.mjs falha se uma tela do menu ficar sem ajuda.
import { podeTela } from './perfis.mjs';

const REP = 'Representante/vendedor';
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
 * Capítulos, na ordem do processo. Blocos: ['p', texto] · ['h', título] · ['lista', itens] · ['passos', itens] · ['tabela', colunas, linhas] · ['img', arquivo, legenda].
 * As imagens ficam em web/img/ajuda, com dados fictícios: IMAGENS_AJUDA=web/img/ajuda npm run test:telas gera todas de novo.
 * Item de lista: texto ou [destaque, texto]. `para`: quem vê o capítulo; sem ele, todos.
 */
export const CAPITULOS = Object.freeze([
  { n: 1, nome: 'Visão geral da operação', desc: 'O fluxo, as etapas e quem age em cada uma.', blocos: [
    ['p', 'O sistema acompanha cada cliente da base, do primeiro contato ao primeiro pedido faturado. O cliente segue um caminho único, e cada etapa tem um responsável.'],
    ['h', 'O caminho do cliente'],
    ['tabela', ['Etapa', 'Quem age', 'Para avançar'], FLUXO.map((e) => [e.nome, e.quem, e.avanca])],
    ['h', 'Desvios do caminho'],
    ['lista', DESVIOS.map((d) => [d.nome, d.faz])],
    ['h', 'Só clientes da base'],
    ['p', 'O que estiver nos arquivos do ERP e não estiver na base é ignorado. A exceção é a filial de um grupo da base, com a mesma raiz de CNPJ: ela aparece em Explorar pedidos, em Ver por Grupo.'],
  ] },
  { n: 2, nome: 'Acesso e navegação', desc: 'Entrar, usar o menu e o botão de ajuda.', blocos: [
    ['h', 'Entrar e sair'],
    ['passos', ['Abra o sistema e informe o login e a senha recebidos do administrador.', 'O sistema abre no Explorar carteira ou, se o seu perfil não tiver essa tela, na primeira tela permitida.', 'Ao terminar, clique em Sair, principalmente em computador compartilhado.']],
    ['img', 'menu.jpg', 'O menu à esquerda, o botão ? no canto superior direito e a tela inicial.'],
    ['h', 'O que cada perfil enxerga'],
    ['lista', [['Representante/vendedor', 'a própria carteira e os pedidos que fez.'], ['Supervisor', 'a equipe.'], ['Gerente e administrador', 'todas as equipes.'], ['Analista financeiro', 'o Console de crédito.']]],
    ['h', 'Botão de ajuda'],
    ['p', 'O botão ? fica no topo de todas as telas. Ele abre o objetivo da tela, como ela funciona, o significado de cada campo e o que analisar. No celular, a ajuda abre em tela cheia.'],
    ['h', 'No celular'],
    ['lista', [['Níveis', 'mude pelo botão Mudar, porque arrastar não funciona no toque.'], ['Menu', 'abre pelo botão no canto superior esquerdo.']]],
  ] },
  { n: 3, nome: 'Prospecção', desc: 'Lista principal e registro de atendimento.', para: (u) => podeTela(u, 'lista'), blocos: [
    ['p', 'A Lista principal mostra quem ainda precisa ser procurado: os clientes Não contactados e Em prospecção. Depois do registro, o cliente sai da lista.'],
    ['h', 'Passo a passo'],
    ['passos', ['Abra a Lista principal. Supervisor e gestão escolhem o supervisor e o representante/vendedor e clicam em Buscar.', 'Clique em Registrar na linha do cliente ou abra a ficha dele.', 'Informe o canal, o resultado e a data do registro.', 'Grave: a ficha mostra o novo status e o movimento no histórico.']],
    ['img', 'lista-principal.jpg', 'Lista principal de um representante/vendedor.'],
    ['h', 'Os resultados do atendimento'],
    ['tabela', ['Resultado', 'O que pede', 'O que acontece'], [
      ['Atendido', 'Data de retorno, opcional', 'Vai para Aguardando cadastro'],
      ['Sem interesse', 'Motivo, do cliente ou do representante/vendedor', 'Vai para Sem interesse, e pode ser reaberto'],
      ['Reabrir: pedido identificado', 'Data de entrada do pedido', 'Vai para Aguardando cadastro, com o pedido informado'],
    ]],
    ['img', 'registrar.jpg', 'Registrar atendimento.'],
    ['p', 'Cliente que não atendeu não gera registro: ele continua na lista. Não há limite de contatos, e uma correção é feita com um novo registro.'],
    ['h', 'Sem interesse em lote'],
    ['p', 'Marque os clientes na Lista principal e clique em Sem interesse em lote. Informe um motivo para todos e, se precisar, um motivo diferente para algum deles.'],
  ] },
  { n: 4, nome: 'Acompanhamento', desc: 'Do cadastro ao pedido faturado.', para: (u) => podeTela(u, 'acompanhamento'), blocos: [
    ['p', 'Mostra onde está cada cliente da base, do cadastro identificado ao pedido faturado. Use para saber quem depende de quem e o que está parado.'],
    ['h', 'As etapas'],
    ETAPAS_TABELA,
    ['p', 'Cadastros realizados é a soma das quatro etapas. Um cliente cadastrado não volta para a Lista principal.'],
    ['h', 'Passo a passo'],
    ['passos', ['Clique numa etapa nos cards do topo: a lista abaixo mostra quem está nela, com quem está há mais tempo primeiro.', 'Use os níveis para ver por supervisor, representante/vendedor, cidade ou mês do cadastro.', 'Recolha ou reexiba a lista em cascata pelas setas de cada linha.', 'Clique no cliente para abrir a ficha e registrar um novo atendimento.']],
    ['img', 'acompanhamento.jpg', 'Acompanhamento no computador: os cards do fluxo, a hierarquia e a lista.'],
    ['img', 'acompanhamento-celular.jpg', 'Acompanhamento no celular.'],
    ['h', 'O que analisar'],
    ['lista', [['Análise vencida', 'o prazo de análise passou e falta o crédito. Cobre o financeiro.'], ['Pedido não válido', 'houve pedido digitado ou cancelado. Veja com o cliente o que faltou.'],
      ['Apenas o primeiro pedido × Todos os pedidos', 'o primeiro mostra clientes conquistados; todos mostra o valor vendido. Dez pedidos para o mesmo cliente somam valor, mas contam um cliente só.']]],
    ['h', 'Situações comuns'],
    ['lista', [['O cliente não aparece', 'se ainda não foi atendido, está na Lista principal; se foi atendido, veja Aguardando cadastro, fora do fluxo.'],
      ['Apareceu Pedido sem cadastro', 'o arquivo de pedidos chegou antes do cadastro. Peça a importação do relatório de cadastro e crédito; não é preciso importar os pedidos de novo.']]],
  ] },
  { n: 5, nome: 'Crédito', desc: 'Console de crédito e Crédito × Pedido.', para: (u) => podeTela(u, 'credito') || (podeTela(u, 'acompanhamento') && u.perfil !== 'vendedor'), blocos: [
    ['p', 'Depois do cadastro identificado, o cliente fica em Análise financeira até o crédito ser liberado. Há duas formas: o relatório de cadastro e crédito do ERP, na rotina, e o Console de crédito, nos casos pontuais.'],
    ['h', 'Liberar pelo Console de crédito'],
    ['passos', ['Abra o Console de crédito: os clientes mais antigos vêm primeiro.', 'Clique no cliente e informe forma de pagamento, prazo, limite e restrição.', 'Grave: o cliente vai para Aguardando pedido. A correção é uma nova liberação.']],
    ['img', 'console-credito.jpg', 'Console de crédito.'],
    ['h', 'Crédito × Pedido'],
    ['p', 'No Acompanhamento, a visão Crédito × Pedido compara o limite liberado com os pedidos em carteira.'],
    ['img', 'credito-pedido.jpg', 'Visão Crédito × Pedido, no Acompanhamento.'],
    ['lista', [['Limite do CNPJ', 'compara com os pedidos do cliente.'], ['Limite do grupo', 'é global: compara com todas as empresas da mesma raiz de CNPJ.'],
      ['Sem limite', '9.999.999 no ERP ou limite não informado: não há o que comparar.'], ['Limite zero', 'sem crédito: qualquer pedido em carteira fica acima do limite.']]],
    ['p', 'O uso do limite é uma estimativa: títulos faturados e não pagos também consomem limite no ERP e não vêm nos relatórios. A comparação de forma e prazo entra quando o relatório de pedidos trouxer esses dados.'],
  ] },
  { n: 6, nome: 'Pedidos', desc: 'Explorar pedidos, primeiro pedido e bonificação.', para: (u) => podeTela(u, 'pedidos'), blocos: [
    ['p', 'Explorar pedidos analisa o que foi vendido: valores, quem vendeu e bonificação. A importação do arquivo de pedidos é o que alimenta esta tela.'],
    ['img', 'explorar-pedidos.jpg', 'Explorar pedidos.'],
    ['h', 'Os números'],
    ['tabela', ['Número', 'O que é'], [
      ['Venda válida', 'Pedidos de venda em carteira, parciais ou faturados'],
      ['Faturado', 'O que já faturou da venda válida'],
      ['Em carteira', 'A faturar: pedido menos faturado'],
      ['Digitado', 'Pedido digitado internamente, ainda fora da carteira'],
      ['Desistência', 'Pedido de venda cancelado'],
      ['Investimento', 'Bonificação. Não entra na venda: mostra o investimento em cada cliente'],
    ]],
    ['h', 'Quem vendeu'],
    ['p', 'O cliente fica com o dono da carteira, e a venda vai para quem a realizou. Cliente vendido por outro representante/vendedor não é erro: as colunas Próprio e Outro mostram essa divisão.'],
    ['h', 'Primeiro pedido'],
    ['p', 'A etapa do cliente segue o primeiro pedido de venda válido: o que apareceu antes num arquivo e, no empate, o de menor número. Pedido cancelado não conta. Do segundo em diante, o pedido só alimenta a estatística.'],
    ['h', 'Empresa ou grupo'],
    ['p', 'Grupo são as empresas com a mesma raiz de CNPJ, os 8 primeiros dígitos. Ver por Grupo conta o grupo uma vez e soma também as filiais fora da base; Ver por Empresa mostra só os CNPJs da base.'],
  ] },
  { n: 7, nome: 'Indicadores', desc: 'Explorar carteira e os números da base.', para: (u) => podeTela(u, 'explorar'), blocos: [
    ['p', 'O Explorar carteira é a tela inicial e mostra como está a base inteira, em todos os status, do total até o cliente.'],
    ['h', 'Como usar'],
    ['passos', ['Arraste os níveis para montar a hierarquia: supervisor, representante/vendedor, cidade, segmento, onda, rota e subrota.', 'Abra as linhas pelas setas e clique numa delas para ver os números daquela parte.', 'Use os números para decidir onde agir e abra a lista daquela parte.']],
    ['img', 'explorar-carteira.jpg', 'Explorar carteira.'],
    ['h', 'O que analisar'],
    ['lista', [['Cobertura', 'contactados ÷ base válida. Mostra quanto da base já foi trabalhado.'], ['Da totalidade', 'como a base se divide entre contactados, sem interesse, não contactados e inativos.'], ['Dos contactados', 'em que etapa estão os que seguem no processo.']]],
  ] },
  { n: 8, nome: 'Administração', desc: 'Importações, usuários, perfis e parâmetros.', para: (u) => u.perfil === 'administrador', blocos: [
    ['p', 'Os arquivos do ERP movem o fluxo. Toda importação mostra primeiro uma simulação, e nada é gravado antes da confirmação.'],
    ['h', 'A ordem das importações'],
    ['passos', ['Base de prospects: os clientes a trabalhar, cada um na carteira de um representante/vendedor.', 'Cadastro e crédito (ERP): registra o cadastro e o crédito liberado.', 'Pedidos · Baixados (ERP): o arquivo de pedidos move o cliente até o faturado; o de baixados inativa CNPJs.']],
    ['p', 'Se os pedidos chegarem antes do cadastro, nada se perde: os pedidos ficam guardados, e o relatório de cadastro e crédito completa o cliente depois, sem reimportar.'],
    ['h', 'Apagar um arquivo de pedidos'],
    ['p', 'Em Importações, os arquivos de pedidos podem ser apagados, do mais novo ao mais antigo. Isso devolve cada cliente ao que era antes e não pode ser desfeito.'],
    ['img', 'importacoes.jpg', 'Importações.'],
    ['h', 'Usuários e perfis'],
    ['p', 'Em Usuários, cadastre as pessoas e defina as senhas. Em Perfis, escolha quais telas cada perfil acessa. O código do ERP liga o usuário ao representante dos arquivos de pedidos.'],
    ['img', 'usuarios.jpg', 'Usuários.'],
    ['h', 'Parâmetros, feriados e erros'],
    ['p', 'Parâmetros guarda prazos e limites dos alertas. Feriados entram na conta de dias úteis. Erros do app mostra as falhas registradas, com a tela e o usuário.'],
  ] },
]);

/** Capítulos que o usuário vê: só o que ele usa. */
export const capitulosDoUsuario = (usuario) => CAPITULOS.filter((c) => !c.para || c.para(usuario));

const F = (campo, significado) => [campo, significado];

/** Ajuda de cada tela: objetivo, como funciona, campos, o que analisar, situações comuns e próximo passo. */
export const AJUDA_TELAS = Object.freeze({
  '/ajuda': { titulo: 'fluxograma e manual', cap: 1, objetivo: 'Explicar a operação, do prospect ao pedido faturado, e reunir o manual.',
    como: ['Clique numa etapa do fluxograma para ver quem age e em qual tela.', 'Abra um capítulo para ler aquela parte do processo.', 'Use Baixar manual em PDF para ter tudo num arquivo.'],
    campos: [F('Fluxograma', 'As etapas do cliente, na ordem'), F('Desvios', 'O que tira o cliente do caminho principal'), F('Capítulos', 'As partes do processo que o seu perfil usa')],
    analisar: ['Comece pelo capítulo 1, se for o seu primeiro acesso.'], comuns: [F('Falta um capítulo', 'Você vê só o que o seu perfil usa.')], proximo: 'Volte às telas de trabalho pelo menu e use o botão ? quando tiver dúvida.' },
  '/explorar': { titulo: 'Explorar carteira', cap: 7, objetivo: 'Ver como está a base inteira, em todos os status, do total até o cliente.',
    como: ['Arraste os níveis para montar a hierarquia.', 'Abra as linhas pelas setas.', 'Clique numa linha para ver os gráficos daquela parte.', 'Abra a lista daquela parte para ver os clientes.'],
    campos: [F('Prospects', 'Quantidade de clientes da base naquela linha'), F('Contactados', 'Clientes com ao menos um contato'), F('Cobertura', 'Contactados ÷ base válida'), F('S. int. cliente', 'Sem interesse por decisão do cliente'), F('Inativos', 'CNPJs baixados, fora da base válida'), F('Valor dos pedidos', 'Soma dos pedidos importados daquela parte')],
    analisar: ['Onde a cobertura está baixa, ainda há clientes a procurar.', 'Em Dos contactados, veja em que etapa os clientes estão parando.'], comuns: [F('Um nível sumiu', 'Clique nele em Disponíveis para incluir de novo.')], proximo: 'Abra a Lista principal para procurar os clientes não contactados.' },
  '/inicio': { titulo: 'Início', cap: 7, objetivo: 'Ver o painel da campanha: funil, ranking e períodos.',
    como: ['Escolha o período, o supervisor e a visualização.', 'Clique num representante/vendedor para abrir a carteira dele.'],
    campos: [F('Funil', 'Base, contactados, atendidos, cadastrados, crédito liberado e venda'), F('% de cada etapa', 'Sempre sobre a base de prospects'), F('Posição atual', 'Foto da carteira hoje')],
    analisar: ['Compare o funil entre equipes para ver onde a campanha trava.'], comuns: [F('A tela não está no menu', 'Os mesmos números estão no Explorar carteira.')], proximo: 'Use o Explorar carteira para descer até o cliente.' },
  '/carteira': { titulo: 'Lista principal', cap: 3, objetivo: 'Mostrar quem ainda precisa ser procurado: Não contactados e Em prospecção.',
    como: ['Supervisor e gestão escolhem o supervisor e o representante/vendedor e clicam em Buscar.', 'Clique em Registrar para gravar o atendimento.', 'Clique no título de uma coluna para ordenar.', 'Marque clientes para o Sem interesse em lote.'],
    campos: [F('Prospect', 'Razão social e CNPJ'), F('Onda', 'Grupo de trabalho da campanha'), F('Segmento', 'Tipologia do cliente'), F('Tentativas', 'Contatos já registrados'), F('1º registro em', 'Data do primeiro contato'), F('Dias', 'Dias desde o primeiro registro'), F('Agrupar por', 'Junta a lista por cidade, onda ou outra opção')],
    analisar: ['Clientes com mais dias e sem avanço pedem prioridade.', 'Use Gerar PDF para levar a lista como está na tela.'], comuns: [F('O cliente sumiu', 'Depois do registro, ele sai da lista: veja o Acompanhamento.'), F('O cliente não atendeu', 'Não gera registro: ele continua na lista.')], proximo: 'Depois do atendimento, acompanhe o cliente no Acompanhamento.' },
  '/carteira?aba=acompanhamento': { titulo: 'Acompanhamento', cap: 4, objetivo: 'Ver onde está cada cliente da base, do cadastro identificado ao pedido faturado, e o que está parado.',
    como: ['Clique numa etapa para listar os clientes dela.', 'Use os níveis para ver por equipe, cidade ou mês do cadastro.', 'Recolha ou reexiba a cascata pelas setas.', 'Troque entre Fluxo e Crédito × Pedido no topo.', 'Clique no cliente para abrir a ficha.'],
    campos: [F('Cadastros realizados', 'Soma das quatro etapas seguintes'), F('Dias na etapa', 'Dias desde a entrada do cliente na etapa'), F('Prazo da análise', 'Data limite da análise financeira'), F('Ordem', '1º, 2º, 3º pedido válido do cliente'), F('Quem vendeu', 'Representante/vendedor que fez o pedido'), F('Uso do limite', 'Pedidos em carteira ÷ limite liberado'), F('Forma e prazo', 'O que o financeiro liberou')],
    analisar: ['Análise vencida: cobre o financeiro.', 'Pedido não válido: veja com o cliente o que faltou.', 'Apenas o primeiro pedido × Todos os pedidos: clientes conquistados × valor vendido.', 'Acima do limite: o pedido em carteira passou do crédito liberado.'],
    comuns: [F('O cliente não aparece', 'Veja a Lista principal ou Aguardando cadastro.'), F('Pedido sem cadastro', 'Falta importar o relatório de cadastro e crédito; os pedidos já estão guardados.')], proximo: 'Com o pedido faturado, analise os valores em Explorar pedidos.' },
  '/pedidos': { titulo: 'Explorar pedidos', cap: 6, objetivo: 'Analisar o que foi vendido: valores, quem vendeu e bonificação.',
    como: ['Escolha Pedidos de venda, Pedidos de bonificação ou Ambos.', 'Escolha Ver por Empresa ou Ver por Grupo.', 'Monte os níveis e clique numa linha: cards, gráficos e lista seguem aquela linha.', 'Use a busca para achar um pedido na lista.'],
    campos: [F('Venda válida', 'Em carteira, parcial ou faturada'), F('Faturado', 'O que já faturou da venda válida'), F('Em carteira', 'A faturar'), F('Digitado', 'Pedido digitado, ainda fora da carteira'), F('Desistência', 'Pedido de venda cancelado'), F('Invest.', 'Bonificação: não entra na venda'), F('Próprio', 'Venda de quem é dono do cliente'), F('Outro', 'Venda de outro representante/vendedor'), F('Na lista?', 'Se o cliente é da lista de quem vendeu')],
    analisar: ['Abra a faixa de alertas: bonificação sem venda, limite do grupo e pedido parado.', 'A coluna Outro mostra quem vende fora da própria lista.'], comuns: [F('Por empresa não aparece nada', 'Pode ser pedido de filial do grupo: use Ver por Grupo.'), F('Pedido do arquivo não aparece', 'CNPJ fora da base é ignorado na importação.')], proximo: 'Veja a situação do primeiro pedido de cada cliente no Acompanhamento.' },
  '/ficha': { titulo: 'Ficha do cliente', cap: 3, objetivo: 'Reunir os dados do cliente, o status, o crédito, os pedidos e o histórico.',
    como: ['Confira o status e os dados do cliente.', 'Clique em Registrar atendimento para gravar um contato.', 'Veja no histórico tudo o que aconteceu.'],
    campos: [F('Carteira', 'Representante/vendedor dono do cliente'), F('Dias corridos', 'Dias desde o primeiro registro'), F('Prazo para o cadastro', 'Data limite em Aguardando cadastro'), F('Limite', 'Crédito liberado'), F('Filiais fora da base', 'Empresas do mesmo grupo que não estão na base')],
    analisar: ['Veja se o limite cobre os pedidos em carteira do grupo.'], comuns: [F('Não aparece Registrar atendimento', 'Venda realizada e CNPJ baixado não aceitam registro.')], proximo: 'Depois de registrar, a ficha mostra o novo status.' },
  '/registrar': { titulo: 'Registrar atendimento', cap: 3, objetivo: 'Gravar o contato com o cliente e movê-lo no fluxo.',
    como: ['Escolha o canal: visita, telefone ou WhatsApp.', 'Escolha o resultado.', 'Preencha os campos que aparecem e grave.'],
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
  '/admin/grupos': { titulo: 'Grupos de CNPJ', cap: 8, objetivo: 'Cruzar a base com um arquivo do ERP pela raiz do CNPJ e decidir quem expurgar.',
    como: ['Carregue o arquivo com a coluna CPF / CNPJ.', 'Veja a sugestão de cada empresa.', 'Escolha a ação, informe o motivo e aplique.'],
    campos: [F('Raiz', 'Os 8 primeiros dígitos do CNPJ'), F('Sugestão', 'Expurgar, Manter ou Decidir'), F('No arquivo', 'Se o mesmo CNPJ está no arquivo'), F('Cadastro no ERP', 'Data do cadastro')],
    analisar: ['Expurgar serve a quem já era cliente e ainda não foi trabalhado.'], comuns: [F('Expurguei errado', 'Use Desfazer, na mesma tela: nada é apagado.')], proximo: 'O expurgado sai da carteira válida e das contas.' },
  '/admin/importacoes': { titulo: 'Importações', cap: 8, objetivo: 'Ver o que foi importado e apagar um arquivo de pedidos, se precisar.',
    como: ['Veja a lista de importações.', 'Abra uma para ver as linhas.', 'Em Arquivos de pedidos, apague do mais novo ao mais antigo.'],
    campos: [F('Lidas', 'Linhas do arquivo'), F('Aceitas', 'Linhas gravadas'), F('Ignoradas', 'Fora da base, por exemplo, ou sem mudança'), F('Rejeitadas', 'Linhas com erro'), F('Clientes afetados', 'Quem muda ao apagar o arquivo')],
    analisar: ['Antes de apagar, leia o que acontece com cada coisa.'], comuns: [F('Não consigo apagar', 'Só o arquivo mais recente pode ser apagado; é preciso digitar o nome dele.')], proximo: 'Depois de apagar, importe o arquivo correto.' },
  '/admin/usuarios': { titulo: 'Usuários', cap: 8, objetivo: 'Cadastrar as pessoas, definir as senhas e os perfis.',
    como: ['Preencha nome, login, perfil e supervisor.', 'Defina a senha, com ao menos 8 caracteres.', 'Use Perfis para escolher as telas de cada perfil.'],
    campos: [F('Código do ERP', 'Liga o usuário ao representante dos arquivos de pedidos'), F('Perfil', 'O que a pessoa acessa'), F('Supervisor', 'A equipe da pessoa'), F('Acesso', 'Se a senha já foi definida')],
    analisar: ['Representante sem código aparece nos alertas de pedidos.'], comuns: [F('Administrador sem acesso à Administração', 'Defina a senha dele aqui, estando logado como administrador.')], proximo: 'Avise a pessoa do login e da senha.' },
  '/admin/perfis': { titulo: 'Perfis', cap: 8, objetivo: 'Escolher quais telas cada perfil acessa.',
    como: ['Crie ou abra um perfil.', 'Escolha o tipo-base e marque as telas.', 'Grave e atribua o perfil em Usuários.'],
    campos: [F('Tipo-base', 'Define quais dados a pessoa vê'), F('Telas', 'O que aparece no menu')], analisar: ['Confira se o perfil abre pelo menos uma tela de trabalho.'], comuns: [F('Tela indisponível', 'Ela não serve para aquele tipo-base.')], proximo: 'Atribua o perfil em Usuários.' },
  '/admin/parametros': { titulo: 'Parâmetros', cap: 8, objetivo: 'Ajustar prazos e limites dos alertas.',
    como: ['Altere o valor e grave.'], campos: [F('Parâmetro', 'O que o valor controla'), F('Valor', 'Dias, quantidade ou data'), F('Última alteração', 'Quando e quem mudou')], analisar: ['Prazo muito curto gera alerta demais.'], comuns: [F('O alerta não mudou', 'Recarregue a página.')], proximo: 'Confira os alertas em Explorar pedidos.' },
  '/admin/feriados': { titulo: 'Feriados', cap: 8, objetivo: 'Manter os feriados usados na conta de dias úteis.',
    como: ['Escolha o ano.', 'Inclua a data, a descrição e a abrangência.', 'Marque se repete todo ano.'], campos: [F('Abrangência', 'Nacional, estadual ou municipal'), F('Local', 'UF ou cidade do feriado'), F('Origem', 'De onde veio o feriado')], analisar: ['Confira os feriados municipais das cidades da campanha.'], comuns: [F('Feriado errado', 'Remova e inclua de novo.')], proximo: 'Os dias úteis entram no painel.' },
  '/admin/erros': { titulo: 'Erros do app', cap: 8, objetivo: 'Ver as falhas registradas, para corrigir o que atrapalha o uso.',
    como: ['Escolha o período.', 'Veja os mais frequentes.', 'Abra a lista para ver os detalhes.'], campos: [F('Código', 'Identifica o erro'), F('Tela', 'Onde aconteceu'), F('Vezes', 'Quantas vezes ocorreu'), F('Aparelho', 'Computador ou celular'), F('Versão', 'Versão do site')], analisar: ['Comece pelos mais frequentes.'], comuns: [F('O erro é de rede', 'Costuma ser a internet do aparelho.')], proximo: 'Envie o código do erro ao suporte.' },
});

/** Ajuda da tela pelo endereço. Sem ajuda própria: null. */
export function ajudaDaTela(caminho, consulta = '') {
  if (caminho === '/carteira' && new URLSearchParams(consulta).get('aba') === 'acompanhamento') return AJUDA_TELAS['/carteira?aba=acompanhamento'];
  return AJUDA_TELAS[caminho] ?? null;
}

/** Telas sem botão de ajuda: a entrada e a confirmação de senha. */
export const TELAS_SEM_AJUDA = Object.freeze(['/entrar', '/admin/acesso']);

/** A Ajuda abre sozinha só no primeiro acesso de cada usuário, neste navegador. */
export const chaveAjudaVista = (usuario) => `germani.ajudaVista.${usuario.id}`;
