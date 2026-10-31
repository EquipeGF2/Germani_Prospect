# 03 — Regras de negócio e indicadores

## 1. Status

| Status | Origem | Na lista de prospects? | Aceita novo contato? | Conta como contactado | Carteira válida |
|---|---|---|---|---|---|
| Não contactado | carga inicial | **sim** | sim | não | sim |
| Em prospecção | importação inicial: contato na planilha (DT 1o/2o) sem resultado | **sim** | sim | sim | sim |
| Aguardando cadastro | app (**atendido** ou **pedido identificado**) — "Aguardando cadastro · atendido em dd/mm/aaaa" ou "· pedido informado em dd/mm/aaaa"; aguarda o CNPJ aparecer nos arquivos de cadastro/pedido | não (acompanhamento) | sim | sim | sim |
| Sem interesse | app ("sem interesse", com justificativa) | não | sim | sim | sim |
| Análise financeira | arquivo de **cadastro** do Senior | não | sim (só registra; status não muda) | sim | sim |
| Aguardando pedido | **relatório de crédito** do ERP ou **OK do analista** no console (forma, prazo, limite) | não | sim (só registra) | sim | sim |
| Aguardando pedido válido | arquivo de pedidos: houve pedido de venda, nenhum válido (digitado ou cancelado) — §14 | não | sim (só registra; status não muda) | sim | sim |
| Venda realizada | arquivo de pedidos do Senior: ao menos um pedido em carteira ou faturado. Sai só se todos os válidos forem cancelados — §14 | não | não | sim | sim |
| Inválido (baixado) | arquivo de CNPJs baixados | não — **congelado** | não | não | **não** |

O vendedor nunca escolhe "inválido", "cadastrado" ou "venda": não existem como resultado de contato.

> **Lista de prospects × acompanhamento × indicadores.**
> - A **lista de prospects** mostra só *Não contactado* e *Em prospecção* (`vw_prospects.na_lista = 1`).
> - O **acompanhamento por status** (visão `status` da carteira) mostra **toda** a carteira do vendedor,
>   inclusive o que saiu da lista, para ele seguir o andamento.
> - **Tudo o que acontece na base conta nos indicadores** — por vendedor, por equipe (supervisor) e geral.
>   Sair da lista nunca tira um registro do painel.

## 2. Registro de contato (app)

Campos: **canal** (visita · telefone · WhatsApp) → **resultado** → campos condicionais. Mesmo formulário para
representante e vendedor. **Só existem três registros**: Atendido, Sem interesse e Reabrir com pedido.
**"Não atendido" não gera registro** — o prospect simplesmente continua na lista principal.

| Resultado | Campo obrigatório | Efeito |
|---|---|---|
| **Atendido** | — (data de retorno opcional) | → **Aguardando cadastro** (sai da lista principal); "atendido em" = data do 1º atendimento; o CNPJ passa a ser procurado nos arquivos de **cadastro** e **pedido** do ERP; abre o **prazo de cadastro** = data + `prazo_cadastro_dias` (15) |
| **Sem interesse do cliente** | motivo **do cliente** (lista) + observação ("Outro" exige observação) | → **Sem interesse** na hora (sai da lista principal) — "Sem interesse · cliente" |
| **Sem interesse do representante** | motivo **do representante** (lista) + observação ("Outro" exige observação) | → **Sem interesse** na hora (sai da lista principal) — "Sem interesse · representante" |
| **Reabrir: pedido identificado** | **data de entrada do pedido** (≤ data do registro) | → **Aguardando cadastro · pedido informado em dd/mm** (acompanhamento) até o arquivo de pedidos do ERP confirmar a **Venda realizada** |

Regras:
- **Contatos sem limite.** Qualquer prospect que não seja Venda realizada nem Inválido aceita novos registros.
- **Dias corridos** contam **sempre do 1º registro**, seja ele atendido, sem interesse ou a data de contato
  da planilha base
  (`dt_primeiro_contato`), em qualquer status, inclusive fora da lista (`vw_prospects.dias_corridos`).
- **Reabertura:** quando aparece um pedido de um cliente que estava *Sem interesse*, o vendedor/representante
  registra "pedido identificado" com a data de entrada do pedido. Não marca como "convertido sem registro".
- **Motivo final** de "Sem interesse" = o do último "sem interesse" registrado.
- **Lista principal** (Não contactado / Em prospecção) está sempre pendente — não há agenda de retorno nela.
- **Data de retorno** (opcional) só existe na negociação e aparece **só no acompanhamento**.
- **Data do aparelho manda.** Única trava: não pode ser anterior ao último registro do prospect.
- **Observação** é livre; a versão sem acento (`observacao_busca`) alimenta o ranking de palavras-chave.
- **Correção** = novo registro. Nada é editado.
- O que fazer depois com os "Sem interesse" será decidido (ver 07).

**Na tela** (`#/registrar`, [`web/js/telas/registrar.js`](../web/js/telas/registrar.js) +
[`shared/registro.mjs`](../shared/registro.mjs)): o botão **Registrar atendimento** aparece na ficha de todo cliente
que aceita registro. "Reabrir: pedido identificado" só aparece para quem está **Sem interesse**; "Retornar em"
só aparece em Atendido / pedido identificado. Data padrão = hoje no aparelho, limitada entre o último registro e hoje.
Depois de gravar, volta para a ficha, que já mostra o novo status e o movimento na linha do tempo.

### 2.1 Registro em lote

Implementação: [`shared/lote.mjs`](../shared/lote.mjs) · testes: [`test/lote.test.mjs`](../test/lote.test.mjs).

- O usuário seleciona vários prospects (da lista ou de uma visão cidade/bairro) e registra de uma vez —
  uso principal: **sem interesse**; também vale para atendido.
- **Justificativa do lote** (motivo + observação) vale para todos; **justificativa individual** substitui a do
  lote naquele prospect. Pode misturar: lote com "Preço" e um item com "Outro: loja vai fechar".
- Cada item vira um registro normal (mesmas regras do banco) com o mesmo `lote_id`.
- Item inválido (sem motivo, outra carteira, baixado…) é devolvido com o motivo; **os demais gravam**.
- "Pedido identificado" não entra em lote: cada pedido tem a sua data.
- **Na tela** (`#/lote`): marca-se os clientes na lista principal (a seleção fica só nesta aba do navegador) →
  **Sem interesse em lote** → motivo/observação do lote e, se quiser, por cliente → grava. O resultado mostra
  gravados × recusados (com o motivo); os recusados continuam selecionados. Atendido em lote existe em
  `shared/lote.mjs`, mas a tela oferece só sem interesse.

### Sem interesse: do cliente × do representante (migração 0015)

- **Um status só** (Sem interesse); **a origem vem do motivo** (`motivos_sem_interesse.origem` = cliente | representante).
  O registro é o mesmo (resultado `sem_interesse` + motivo); vale o motivo do **último** sem interesse. Nenhum registro é
  alterado: os sem interesse anteriores à 0015 usam motivos do cliente.
- **Do cliente** — o cliente recusou a proposta. **Do representante** — o representante não vai trabalhar o cliente.
- **E-commerce (0020)**: todo cliente marcado **sem interesse do representante** (qualquer motivo dessa origem, também em
  lote) vai **na hora** para a carteira do representante E-commerce — o usuário escolhido em Parâmetros
  (`vendedor_ecommerce_id`; 0 = desligado). Chega como está ("Sem interesse · representante"); o E-commerce registra um
  atendimento quando for trabalhar. A ida fica em `transferencias` e no histórico ("X → E-commerce: sem interesse do
  representante (motivo)"). Sem interesse **do cliente** não transfere; o próprio E-commerce marcando não transfere de novo.
- Onde aparece: selo/status "Sem interesse · cliente" / "· representante" (ficha, listas, PDF); filtro de situação da
  Lista/Acompanhamento com as duas opções; Explorar com as duas fatias em "Da totalidade" e as colunas S. int. cliente /
  S. int. repr. (resumo: `resumo_carteira.si_representante`); no lote, escolhe-se a origem e os motivos dela.
- Cobertura e conversão contam os dois como contactados (como antes).

### Motivos do cliente (lista inicial, editável)

Preço acima do praticado · Já tem fornecedor/contrato · Mix não atende · Pedido mínimo alto ·
Prazo/condição de pagamento · Frequência ou dia de entrega · Não vende a categoria/baixo giro ·
Sem espaço na gôndola · Compra centralizada (rede/matriz) · Outro (observação obrigatória).

### Motivos do representante

Fora do perfil (porte / tipo de negócio) · Estabelecimento fechado ou não localizado · Fora da rota / acesso difícil ·
Risco de crédito / histórico de inadimplência · Já atendido por outro canal da Germani · Volume potencial muito baixo ·
Cadastro duplicado (mesmo dono) · Outro (observação obrigatória). Na tela, o campo Observação só aparece como obrigatório ("Observação *") quando o resultado é Sem interesse e o motivo é "Outro"; nos demais casos é opcional.

Do sistema (não aparece no app): Não informado (importação inicial).

## 3. Eventos do ERP e baixados (importação)

| Arquivo | Evento | Efeito |
|---|---|---|
| Cadastro de clientes (Senior) | `cadastro` | → **Análise financeira**; guarda código do cliente; `analise_financeira_ate` = data + `prazo_analise_financeira_dias` (10) |
| Pedidos (Senior) — **hoje pelo §14**; este evento fica para os pedidos já importados e o modo demonstração | `pedido` | → **Venda realizada** (final); guarda nº do pedido e, se o arquivo tiver a coluna, o **valor do pedido** ("1.234,56" ou 1234.56; vazio = sem valor, com aviso; inválido/negativo = linha rejeitada). Vale em qualquer etapa (o ERP prevalece) |
| CNPJs baixados | `baixa` | → Inválido; `situacao_cadastral = baixada`; prospect **congelado**: histórico preservado como estava, sem novos contatos, sem cadastro/pedido ("impossibilitado de faturamento") |

- **Os arquivos do ERP prevalecem sobre o status do app:** cadastro leva a **Análise financeira** e pedido leva a
  **Venda realizada** para qualquer cliente da base — inclusive **Sem interesse** e **Não contactado**. A mudança
  fica no histórico de movimentação (ex.: Sem interesse → Análise financeira).
- **No atendimento e nas datas, o registro do representante sempre prevalece — o ERP nunca sobrepõe o que ele informou**
  (migrações 0013 e 0014). O ERP decide só a fase (acima).
- **Atendimento automático** só quando o representante/vendedor **não registrou nada** no app (nem atendido, nem sem
  interesse, nem pedido identificado): o cadastro (ou pedido) vira o atendimento — "atendido em" e o **1º registro** passam a
  ser a data do arquivo, os dias corridos contam dela, e o histórico ganha o movimento "atendido" (origem ERP, sem usuário:
  "atendimento automático via importação do cadastro (código) — sem registro do representante").
- **Com registro do representante** (ex.: **sem interesse**) e o cadastro chega: considera a **próxima etapa** (Análise
  financeira; pedido → Venda realizada) e as datas dele ficam como estão — nenhum atendimento automático é criado.
- **Todo movimento do ERP registra que veio da importação** no histórico: "via importação do cadastro (C123)", "via
  importação do pedido (P9)", "via importação de CNPJs baixados".
- Cadastro/pedido sem "atendido" (nem "pedido identificado") registrado pelo representante → `convertido_sem_registro = 1`
  (alerta para o supervisor). A ficha diz se foi atendimento automático ou só avanço de etapa.
- **O representante continua registrando:**
  - Registrou o atendimento **antes** do cadastro: fluxo normal (Aguardando cadastro → Análise financeira), sem alerta.
  - Registrou **depois** do automático: a fase não muda (só registra) e vale **sempre a primeira data** — a dele, se for
    anterior à importação; a da importação, se ele informar data **posterior**, e então o histórico registra
    "representante informou data posterior à importação (atendimento considerado em dd/mm/aaaa)". O alerta "convertido sem
    registro" sai (ele informou).
- **Nenhum registro é substituído — sempre incluído.** O atendimento automático da importação e cada registro do
  representante ficam no histórico, um por linha (contatos, eventos e movimentações só aceitam inclusão). O que muda é só a
  posição do cliente ("atendido em", 1º registro), que segue a primeira data.
- Cadastro posterior a um pedido não rebaixa a venda.
- Reimportar o mesmo arquivo não duplica eventos (índice único por prospect + tipo + documento). O valor entra junto
  com o pedido e não é alterado depois (eventos são só de inclusão).

## 4. Alertas (para o painel)

| Alerta | Regra |
|---|---|
| Prazo de cadastro vencido | Aguardando cadastro e `prazo_cadastro_ate` < hoje |
| Retorno pendente | `retorno_pendente`: data de retorno hoje ou vencida (inclui Aguardando cadastro) |
| Análise financeira vencida | `analise_financeira_vencida`: em análise e sem OK do analista após 10 dias |
| Vendedor sem lançar | `vw_ultimo_lancamento.dias_sem_lancar` > `dias_alerta_sem_lancamento` |
| Prospect parado | `vw_prospects.parado`: ativo e último contato (ou entrada na base) há mais de `dias_alerta_sem_movimento` |
| Convertido sem registro | `convertido_sem_registro = 1` |

## 5. Indicadores

Implementação: [`shared/indicadores.mjs`](../shared/indicadores.mjs). Conferidos contra conta manual em
[`test/indicadores.test.mjs`](../test/indicadores.test.mjs).

### Posição (foto da carteira numa data — padrão: hoje)

| Indicador | Fórmula |
|---|---|
| Carteira válida | total − inválidos |
| Contactados | status diferente de Não contactado e de Inválido |
| % contactado | contactados ÷ carteira válida |
| % cadastro | (cadastrados no ERP + vendas) ÷ contactados |
| % conversão | vendas ÷ contactados |
| Funil | Aguardando cadastro → Análise financeira → Aguardando pedido → Venda realizada (quantos em cada etapa na data) |

Numa data passada D, o status de cada prospect é o da última linha de `movimentacoes` com
`data_evento ≤ D`. Por vendedor/supervisor, vale a carteira **atual**.

### Atividade (o que aconteceu entre início e fim) — lida do **histórico de movimentação**
Cada movimento conta para o vendedor dono da carteira **no dia** do movimento.
Registros · atendidos · sem interesse · pedidos identificados · prospects trabalhados · primeiros registros ·
entradas em cada etapa (aguardando cadastro, análise financeira, aguardando pedido, venda) · liberações de
crédito · arquivos de cadastro/pedido · baixas · transferências.

Mais a **execução de rotas** (planejadas × atendidas, §7). Todos contam **toda a base** (dentro e fora da lista) e podem ser agrupados por **total geral, vendedor,
supervisor (= equipe), cidade, bairro, onda e rota** e filtrados por
vendedor, supervisor, cidade, bairro, onda e UF. O agrupamento por **rota considera só prospects de vendedores**
(representante não tem rota).

> Mudança em relação à especificação original: "conversão declarada" (venda informada pelo vendedor)
> deixou de existir — a venda só é registrada pelo arquivo de pedidos do ERP.

## 6. Lista de prospects e acompanhamento — representante × vendedor

Implementação: [`shared/carteira.mjs`](../shared/carteira.mjs) · testes: [`test/carteira.test.mjs`](../test/carteira.test.mjs).

Todos os registros da base são **prospects** — para representante e para vendedor.

| Lista | Conteúdo |
|---|---|
| **Principal (prospects)** | Não contactado · Em prospecção — é onde se vai atrás do cliente |
| **Secundária (acompanhamento da efetivação do pedido)** | Aguardando cadastro → Análise financeira → Aguardando pedido → Venda realizada, Sem interesse e Inválido status para consulta |

Entrar em negociação **tira o cliente da lista principal e o leva para o acompanhamento**. Toda essa
movimentação conta sempre nos indicadores.

| | Representante | Vendedor | Supervisor / admin |
|---|---|---|---|
| Papel no app | **filtro e consulta** + registro das datas de atendimento / sem interesse | o mesmo + **montagem de rotas** (§7) | gestão |
| Visões | Lista · Cidade · Bairro · **Onda** · Status | Lista · Cidade · Bairro · **Onda** · Status · **Rota** (rota/subrota) | todas |
| Rota / subrota | **nunca** (não agrupa, não filtra, não recebe as colunas, não monta rota) | sim | consulta as rotas da equipe |
| Escopo | própria carteira | própria carteira | equipe / tudo |

- A forma de trabalho vem de `usuarios.tipo_atuacao` (`representante` | `vendedor`), informada pelo
  administrador numa **lista** (`npm run importar:tipos`, ver 05 §3) ou individualmente
  (`npm run usuarios -- tipo <login> representante|vendedor`). Sem definição = representante.
- **Lista principal:** ordenada por pendentes de hoje, retornos, próxima ação, cidade, bairro, nome.
  Filtros: pendentes hoje, retornos pendentes, cidade, bairro, **onda**, UF, rota/subrota (vendedor).
  Busca por nome, CNPJ (com ou sem pontuação), cidade ou bairro, **sem acento**.
- **Acompanhamento:** só o que está **em andamento** (aguardando cadastro, análise financeira, aguardando pedido, aguardando pedido válido); sem interesse, inválido e expurgado ficam em **Encerrados**, um filtro na própria tela, e a venda fica em Explorar pedidos (docs/03 §14). Visão Status: quantidade, retornos pendentes, prazos de cadastro
  vencidos e média de dias corridos, **na ordem do processo** (aguardando cadastro → análise financeira → aguardando
  pedido → venda realizada; sem interesse e inválido por último). Tocar num status abre a lista daquele status.
- **Onda:** coluna ONDA da planilha base — visão agrupada e filtro para os dois perfis, também nos indicadores
  (`agrupar: 'onda'`, `filtros.onda`) e no histórico de movimentação.
- **Cidade / Bairro:** para os dois perfis. Total, pendentes hoje, não contactados, em prospecção, atendidos
  e o centro do grupo para **abrir no mapa**. **Nenhuma distância é calculada** (ADR-0005).
- Cada linha traz `dias_corridos` (desde o 1º atendimento) e `status_descricao`.

**Nas telas** ([`web/js/telas/carteira.js`](../web/js/telas/carteira.js)):
- `#/carteira` = **Lista principal**; `#/carteira?aba=acompanhamento` = **Acompanhamento** (`filtros.foraDaLista`:
  só quem saiu da lista principal; abre nos cartões por status).
- Visões em botões; tocar num grupo (cidade, bairro, onda, rota, status) abre a lista já filtrada. Os filtros
  ativos aparecem como etiquetas removíveis. Administrador, gerente comercial e financeiro filtram por **supervisor** e por
  **vendedor/representante** (a lista de vendedores se restringe à equipe do supervisor escolhido; cada opção mostra
  se é vendedor ou representante); o supervisor filtra por vendedor/representante da equipe. Para a gestão, cada
  cartão mostra de quem é a carteira.
- Cada cartão: razão social, selo do status, CNPJ, fantasia, bairro/cidade, onda, rota (só vendedor),
  "atendido em…", dias corridos, retorno vencido e prazo de cadastro vencido. 50 por página.
- **Celular — a Lista principal não lê nada antes de um filtro ou busca** (`precisaFiltro(…, { celular: true })`), também
  para o representante/vendedor: a tela mostra as **cidades da carteira com quantos ainda estão na lista** (do resumo pronto,
  em cache — sem ler a carteira) e só lê a lista depois de escolher uma cidade (ou bairro, onda, segmento, rota,
  "só retornos") ou de buscar. UF sozinha não basta para ele. As visões Cidade/Bairro/Onda/Rota continuam lendo só o resumo
  (sem os cartões de totais no topo: só a lista de grupos).
- **Celular — Acompanhamento = a tela do computador** (`renderComputador(…, { celular: true })`): mesmos filtros (num painel
  que abre e fecha; aberto enquanto a lista não foi lida), mesmo botão Buscar, mesmo período opcional e a mesma leitura única. Situação em faixa que rola para o lado, ordem numa lista, cada prospect num
  cartão (status, Registrar, último registro, próxima ação, dias) e a ficha sobe por baixo ao tocar no cartão.
- **Computador** (Lista principal e Acompanhamento — [`_lista.js`](../web/js/telas/_lista.js); o celular não muda):
  **sempre em lista** (tabela; sem cards e sem visões). Filtros em grupos, cada um em cascata (`opcoesEmCascata`):
  **Equipe** (supervisor / representante) · **Local** (UF / cidade / **bairro**, este só aparece com a cidade escolhida) ·
  **Carteira** (onda / segmento) · **Período** (só no Acompanhamento). Abaixo, a **busca**: prospect, CNPJ, cidade, bairro e
  o **representante** dono da carteira (nome sem acento ou código do ERP).
  - **Os filtros só valem no botão Buscar** (`?ver=1`): escolher um filtro só refaz as opções em cascata no navegador
    (do resumo já lido, em cache) — nenhuma leitura da lista até clicar em Buscar. O representante já entra com a
    própria carteira. Links do Início (agente) e do Explorar já chegam aplicados.
  - As opções de equipe, local e carteira valem para a carteira toda, nas duas abas (o Acompanhamento começa quase vazio
    e não pode ficar sem opções); só um status escolhido as restringe.
  - **Obrigatórios** (`faltaParaLista`): na **Lista principal**, **supervisor e representante** (o vendedor já é o seu) —
    a lista é a carteira de um representante. No Acompanhamento, quem vê todas as equipes escolhe a **equipe**
    (supervisor ou representante; uma busca também basta); supervisor e vendedor já têm a sua. O **período** do
    último registro é opcional: Este mês, Último mês ou Período (de · até) — `datasDoPeriodo`. Sem ele, aparece tudo o que está em processo.
  - **Aberta pelo Explorar** ("Abrir na Lista principal" de um ramo, `de=explorar`): o filtro do ramo (cidade, segmento,
    onda, rota, supervisor ou representante) já estreita a lista e **dispensa supervisor e representante** — a lista abre
    lida, com o filtro do ramo. Pela própria Lista, continuam obrigatórios. A **Lista principal não tem período** (não contactados não têm data nenhuma). Até escolher,
    a tela pede a escolha e **não lê a lista**.
  - **Situação**: atalhos com contagem por status da aba (Lista: Não contactado, Em prospecção; Acompanhamento: os
    demais, na ordem do processo), da mesma consulta por status com os filtros escolhidos — e o total da lista.
  - **A lista vem inteira numa leitura só** (sem páginas; limite de segurança de 5.000 — acima disso pede para refinar).
    **Situação, ordem (clique no título da coluna) e agrupamento mudam no navegador**, sem voltar ao banco.
  - **Agrupar por** (só na Lista principal, na linha dos filtros): cidade, bairro (só com cidade), onda, segmento, rota
    (vendedor) — sem representante, que já é obrigatório. Os grupos vêm **recolhidos**, com a contagem; um clique abre.
  - **Gerar PDF** (Lista principal e Acompanhamento): relatório da lista **exatamente como está na tela** (filtros
    aplicados, situação, ordem e grupos) para enviar ao representante — `web/js/relatorio.js`, jsPDF + AutoTable
    carregados só ao gerar. A4 paisagem; logotipo à esquerda, título e subtítulo (representante e supervisor)
    centralizados, emissão à direita; resumo numa linha (prospects e cada status) e os filtros; colunas Razão social,
    Fantasia, CNPJ, Endereço, Bairro, Cidade/UF, Telefone, Onda, Segmento, Status (situação atual), Tent., 1º registro
    em e Dias (as numéricas centralizadas); rótulos centralizados e **repetidos em cada página**; um prospect nunca
    se divide entre páginas; rodapé "uso interno" e **Página X de N**.
  - Colunas: prospect (CNPJ), cidade · bairro, onda, segmento, rota (só vendedor), representante (gestão, com o código),
    status; na Lista: tentativas, **1º registro em** (data do 1º registro) e dias; no Acompanhamento: último registro, próxima ação (retorno)
    e dias; e Registrar. Rótulos centralizados; status, tentativas, datas e dias centralizados. Uma linha por prospect (textos longos cortados). O **rótulo da coluna ordena** (▲, ▼, volta à
    ordem de trabalho). Na Lista não há coluna Representante (ele é o filtro); no Acompanhamento há.
  - **Clicar na linha abre a ficha ao lado** (dados, últimos 5 movimentos, Registrar e Abrir ficha completa) sem sair
    da lista. Marcar prospects (Lista principal) mostra a barra flutuante "Sem interesse em lote".
- **Ficha** (`#/ficha`): situação (status, dias corridos, registros, datas, prazos, motivo, cadastro e pedido do
  ERP), crédito liberado (forma, prazo, limite e se veio do grupo, restrição), **histórico de movimentação**
  (data, status antes → depois, detalhe, quem fez, origem, carteira da época) e cadastro com Ligar / WhatsApp
  (telefone com DDD) / Ver no mapa (coordenadas da base). Ficha fora do escopo do usuário não abre.

- **Lista principal da gestão só depois de um filtro** (administrador, gerente, supervisor, financeiro): supervisor,
  representante, cidade, segmento (TIPOLOGIA GTM), onda, rota, status, datas ou uma busca. Sem filtro, a tela pede a
  escolha e não lê a base. Representante/vendedor vê direto a própria carteira. Os números de toda a base ficam nas
  visões Cidade / Bairro / Onda e no Início.

## 7. Montagem de rotas (somente vendedor)

Implementação: [`shared/rotas.mjs`](../shared/rotas.mjs) · testes: [`test/rotas.test.mjs`](../test/rotas.test.mjs).

1. O vendedor cria a rota do dia (`comandoCriarRota`) — o banco recusa representante e supervisor.
2. Escolhe os prospects (da própria carteira, da lista principal ou em negociação) a partir das visões
   cidade/bairro/rota; a **ordem sugerida** agrupa cidade → bairro → rota/subrota da planilha → endereço
   (`sugerirOrdem`). Ele reordena à mão (`comandosSalvarParadas`).
3. No dia, abre cada parada no mapa do celular (`linkMapa`) e registra o contato normalmente.
4. Conclui ou cancela a rota (`comandoEncerrarRota`); a partir daí ela fica travada.

**Execução** (`vw_rotas_execucao`, `consultaExecucaoRotas`): paradas planejadas × atendidas (contato do vendedor
no prospect na data da rota), por vendedor, equipe e geral — rotas canceladas ficam fora.

## 8. Análise financeira → Aguardando pedido (duas possibilidades)

A importação do arquivo de **cadastro** coloca o cliente em **Análise financeira** (prazo de 10 dias = alerta).
A análise termina, e o cliente vai para **Aguardando pedido**, de uma destas formas — ambas gravam em
`liberacoes_credito` e no histórico de movimentação. **A liberação sempre ocorre.**

### 8.1 Relatório de cadastro e crédito do ERP (rotina) — `shared/importar-credito.mjs`
Um relatório só traz o **cadastro** e o **crédito liberado**. Layout real do ERP: **Cliente · CPF / CNPJ · Razão Social ·
Cond. Pgto · Descrição · Forma Pgto · Descrição · (coluna vazia) · Créd. Cliente · Créd. Grupo · Dt. Cadastro**
("Descrição" repetida: vale a da coluna seguinte à condição/forma). O layout antigo (CNPJ · Cód interno · … · Limite de
crédito CNPJ/grupo · Data de cadastro) continua aceito.

| Regra | Como funciona |
|---|---|
| Quem recebe os dados | **só os CNPJs da base de prospects.** CPF (pessoa física, ≤ 11 dígitos — inclusive sem os zeros à esquerda) e CNPJ fora da base são **ignorados**: o relatório não cadastra prospects novos. |
| Limite | **Créd. Cliente preenchido → vale ele** (mesmo 0). **Vazio → vale o Créd. Grupo**, que é o **limite global de todas as empresas da mesma raiz de CNPJ** (8 primeiros dígitos): o mesmo valor aparece em cada empresa e **não é somado** (ex.: duas filiais com R$ 2.000 = limite do grupo R$ 2.000). Na importação de pedidos, os pedidos do grupo serão somados e comparados com esse limite. A origem (cliente / grupo) fica registrada. |
| 9.999.999 · 0 | **9.999.999 = sem limite** (`sem_limite = 1`; o histórico diz "sem limite"). **0 = sem crédito** (só à vista ou antecipado) — a forma continua a do ERP; boleto com 0 é avisado (0017: "boleto exige limite" vale só no console). |
| Condição e forma | gravadas **como vieram do ERP** (código + descrição). A **forma vem unicamente da Forma Pgto** (Depósito e Pix com prazo continua Depósito e Pix). O **prazo sai da descrição da condição, limpo**: "14/21/28 DD BOLETO" → `prazo_parcelas` "14/21/28"; "A VISTA" e "ANTECIPADO" → prazo 1. O **código da condição é o prazo médio** ("21B" → 21, em `prazo_pagamento_dias`); sem número no código, a média dos dias. |
| Filtro rápido (`prospects.forma_filtro`, 0018) | **antecipado · à vista · boleto · depósito e Pix**, só para filtrar: a forma do ERP é mapeada na tela (sugestões: Boleto, Convênio → boleto; Depósito e Pix → depósito e Pix; A vista, E-Commerce, Bonificação, Confissão de dívida → à vista; Antecipado → antecipado). `prospects.forma_pagamento` mantém as 3 opções antigas (depósito conta como boleto/a prazo). Valor não mapeado = linha rejeitada. |
| Grupo com valores diferentes | Créd. Grupo diferente entre empresas da mesma raiz: **aviso** em todas as linhas do grupo (confira no ERP); cada empresa grava o valor que veio. |
| Já era cliente | Dt. Cadastro anterior ao início da campanha: aviso "já era cliente" (contado na prévia). |
| Cliente ainda sem cadastro | (Não contactado, Em prospecção, Aguardando cadastro, Sem interesse) o relatório registra **também o cadastro** (Dt. Cadastro + código do cliente; regra 0014 do atendimento automático) e em seguida a liberação. |
| Já em Aguardando pedido | crédito diferente (inclusive condição/forma do ERP) = nova liberação (correção); igual = ignorado. |
| Venda realizada | ignorado (o status não muda). · CNPJ baixado: rejeitado. · Sem Dt. Cadastro ("00/00/0000"): rejeitado. |
| Data da liberação | dia da importação (nunca antes do cadastro). |

### 8.2 Console do analista (casos pontuais) — `shared/financeiro.mjs`
Fila com os clientes em Análise financeira (mais antigos primeiro, dias em análise, prazo vencido). O analista
(perfil **financeiro** ou administrador) informa **forma de pagamento**, **prazo (dias)**, **restrição de crédito
sim/não** e **limite**. Boleto exige limite maior que zero.

**Na tela** (menu *Financeiro → Console de crédito*, `#/financeiro`; o analista entra direto nela):
- **os cards são o filtro** (sem abas): em análise · fora do prazo (10 dias) · liberados aguardando pedido — clicar no card mostra
  esses clientes; cards e busca na mesma linha, a lista com o destaque;
- abas **Em análise** (mais antigos primeiro, dias em análise, prazo; vencido em vermelho) e **Liberados · aguardando
  pedido** (mais recentes primeiro, com a condição: forma · prazo · limite · restrição); busca por cliente, CNPJ,
  cód. ERP, cidade ou vendedor;
- **Liberar crédito** (`#/financeiro/liberar`): forma (antecipado / à vista / boleto — três cards lado a lado, sem quebra), prazo em dias, limite (R$,
  aceita "12.500,00"), data (entre o cadastro no ERP e hoje), restrição sim/não, observação. Grava e o cliente
  vai para Aguardando pedido;
- **Corrigir** (aba Liberados): mesma tela; grava uma **nova** liberação, a anterior fica no histórico.

Em ambos: correção = nova liberação; nada é apagado.

## 9. Histórico de movimentação

Toda mudança — e todo registro, mesmo sem mudança de status — gera uma linha em `movimentacoes` (ver 02).
É a fonte da linha do tempo da ficha, dos filtros (`consultaMovimentacoes`) e dos indicadores de atividade.

## 10. Início — dashboard de acompanhamento

Implementação: [`shared/painel.mjs`](../shared/painel.mjs) · tela [`web/js/telas/inicio.js`](../web/js/telas/inicio.js) ·
testes: [`test/painel.test.mjs`](../test/painel.test.mjs).

| Bloco | Conteúdo |
|---|---|
| Geral | **Total de prospects** (carteira válida: sem inválidos) · **Não contactado** · **Sem interesse** · **Crédito liberado** · **Venda realizada**, cada um com % da base |
| Valores | **Dias úteis da campanha** (seg–sex desde `data_inicio_campanha` até hoje, menos os `feriados` cadastrados) · **Potencial do pipeline de abertura** = total × `percentual_pipeline`% × `valor_medio_cliente` · **Valor de conversão** = vendas × `valor_medio_cliente` (estimado) · **Valor dos pedidos** = soma real de `eventos_erp.valor` dos pedidos importados |
| Visão por supervisor | seletor de supervisor (lembrado na aba) → os mesmos cards + agentes de vendas (vendedores × representantes) |
| Consolidado por agente | agente, tipo, total, não contactado, sem interesse, crédito liberado, venda realizada, **% contactado** = (total − não contactado) ÷ total, **% conversão** = vendas ÷ contactados; total do supervisor; tocar no agente abre a carteira dele. No celular, um cartão por agente. |

- **Crédito liberado** = clientes que já tiveram crédito liberado (console ou relatório), mesmo que depois virem venda.
  Não separa com ou sem restrição.
- **Escopo:** administrador, **gerente comercial** e analista financeiro veem tudo e escolhem o supervisor;
  **supervisor** vê só a própria equipe (sem seletor); vendedor/representante vê só a própria carteira.
- **Feriados** (Administração → Feriados): os **nacionais são automáticos** para qualquer ano (datas fixas + Sexta-feira
  Santa calculada pela Páscoa) — ninguém precisa lançar o ano seguinte. Estaduais e municipais são cadastrados na tela;
  marcando **repete todo ano** valem para todos os anos. Todos saem da contagem de dias úteis.
- **Gerente comercial** (perfil `gerente`): vê tudo e age em qualquer carteira (registro, lote, transferência);
  **não libera crédito** (trigger de `liberacoes_credito`) e não acessa a administração.

### 10.1 Visualizações (computador) e período

- **Celular:** o Início não muda — layout de cartões, sempre a posição atual.
- **Computador:** três visualizações, escolhidas por cada usuário numa lista de seleção (guardada no navegador):
  - **Executivo** — faixa com vendas (número de destaque) e % de conversão, cobertura da base (barra), valor de conversão, valor dos pedidos e
    pipeline; funil em barras horizontais; agentes ordenados por vendas com a barra de % contactado.
  - **Arrojado** — faixa escura com valor de conversão, valor dos pedidos, pipeline e dias úteis; linha de 5 indicadores; funil em colunas;
    ranking de agentes (3 primeiros em destaque).
  - **Equipe** — linha fina de indicadores (inclui valor de conversão e valor dos pedidos); um cartão por supervisor com o valor em pedidos (clicar abre a equipe); barras por agente
    (carteira × contactados × atendidos) e o funil da equipe.
- **Funil** (cumulativo, nunca cresce): base → contactados → atendidos → cadastrados no ERP → crédito liberado → venda;
  o **% de cada etapa é sempre sobre a base de prospects** (`pctBase`);
- **Valor de conversão** (estimado: vendas × `valor_medio_cliente`) e, ao lado, **Valor dos pedidos** = soma real do valor
  dos pedidos importados do ERP (`eventos_erp.valor`; com período, pedidos com data no período). No celular aparece no
  detalhe do cartão Valor de conversão.
- Filtros do Início (período, supervisor, **visualização em lista de seleção**) ficam na linha do título, inclusive com o
  período personalizado aberto;
  "sem interesse" fica fora do funil. Uma só cor (vermelho GERMANI, do claro ao escuro).
- **Período** (só no computador): *Posição atual* (padrão — foto da carteira hoje) · desde o início (da campanha) · hoje ·
  esta semana · este mês · últimos 30 dias · personalizado (de/até). Com período, contam os **eventos no período**:
  contactado = algum registro no período (ou avanço de etapa); atendido, cadastro, crédito e venda pela data do evento,
  de forma cumulativa; sem interesse = encerrado no período. Total e não contactado continuam sendo a posição atual;
  dias úteis = dentro do período (limitados à campanha e a hoje). O período fica no endereço (`#/inicio?periodo=…`).

### 10.2 Dados de exemplo (modo demonstração)

No modo demonstração, o administrador vê no Início **Carregar dados de exemplo** enquanto o banco do navegador está vazio
([`shared/exemplo.mjs`](../shared/exemplo.mjs)). Ele importa a base fictícia, define vendedores/representantes, libera o
acesso de todos com a senha `demo1234` (inclusive `gerente` e `financeiro`) e simula a campanha com as **rotinas reais**:
atendimentos e sem interesse dos vendedores, arquivo de cadastro do ERP, liberações no console e arquivo de pedidos —
com o histórico de movimentação completo. Sorteio com semente fixa; nunca roda em produção (só existe no modo demonstração).

## 12. Explorar carteira (migração 0012 · `shared/explorar.mjs`)

- **É a página inicial do app** (depois do login e no endereço vazio); sem o Explorar no perfil, abre a primeira tela
  permitida (Início, Lista, Console de crédito…). O Início **saiu do menu** (os números estão no Explorar; evita leitura à toa) — continua só pelo endereço `#/inicio` (no modo demonstração, o botão "Carregar dados de exemplo" fica lá).
- Abre **no escopo** de quem entrou: representante/vendedor na própria carteira; supervisor na sua equipe; supervisor que
  vê todas as equipes (ex.: Julio), gerente e administrador na base toda.
- Árvore **do total até o cliente** com níveis livres, em qualquer ordem: Supervisor, Representante, Cidade, Segmento
  (TIPOLOGIA GTM), Onda, Rota, Subrota. Os níveis são cartões **arrastáveis** (ordenar, incluir, tirar); a ordem fica
  guardada no navegador. Cada nível aberto mostra **todos** os itens, do maior para o menor.
- O ramo escolhido mostra dois gráficos (no lugar dos cards, de "Clientes por status" e do funil):
  - **Da totalidade**: barra de 100% em 4 partes que somam os prospects do ramo — Contactados (sem os sem interesse),
    Sem interesse, Não contactados e Inativos (inválidos/baixados) — e a **Cobertura** = contactados (com os sem
    interesse) ÷ base válida (sem inativos), com os números.
  - **Dos contactados**: onde estão os que seguem no processo (contactados sem os sem interesse) — Aguardando cadastro,
    Aguardando financeiro, Aguardando pedido e Pedido realizado, cada um com % — e Valor dos pedidos, Potencial (em
    aberto × % do pipeline × valor médio) e Conversão (vendas ÷ contactados). "Em prospecção" (contato da planilha,
    sem resultado) não é etapa do processo: só conta entre os contactados da totalidade.
- Grade por ramo: Prospects, **Contactados**, Cobertura, Sem interesse, Ag. cadastro, Ag. financeiro, Ag. pedido,
  Pedido realizado, Pedidos (R$) e Potencial (R$).
- Filtro **Todos / Representantes / Vendedores** (tipo de atuação de quem é dono da carteira) — só para quem vê mais de
  uma carteira (supervisor, gerente, administrador); o representante/vendedor logado não o vê.
- **Celular — níveis**: sem arrastar (não funciona no toque). Uma linha mostra os níveis ("Cidade › Segmento") e o botão
  **Mudar** abre a lista de todos os níveis possíveis: marcar liga/desliga, ↑ ↓ mudam a ordem. Tudo no navegador.
- **Celular**: os dois gráficos ocupam a largura do cartão (etapas com a barra abaixo do nome; Valor dos pedidos, Potencial
  e Conversão um por linha, valor à direita) e a grade vira **um cartão por ramo**: nome e prospects na 1ª linha;
  abaixo, uma grade 4 × 2 rotulada — Ag. cadastro, Ag. financeiro, Ag. pedido, Pedidos / Sem interesse, Inativos,
  Cobertura, Valor dos pedidos — sem rolagem para o lado. O potencial de cada ramo aparece no gráfico ao escolher o ramo.
- Escopo: gestão vê tudo (supervisor com "vê todas as equipes" também); **supervisor só a própria equipe, sem o nível
  Supervisor**; vendedor só a própria carteira (sem Supervisor nem Representante).
- **Abrir na Lista principal** só com um ramo escolhido (nunca a base inteira): a lista abre com os filtros do caminho.
- Tela: níveis e disponíveis numa linha só; o caminho do ramo fica abaixo dos níveis, também numa linha (etapa longa é
  cortada, o nome inteiro aparece ao passar o mouse); a linha da árvore sob o mouse fica preenchida.
- **Filtros em cascata da Lista principal e do Acompanhamento** (`opcoesEmCascata`): cada filtro (supervisor,
  representante, UF, cidade, segmento, onda) mostra só o que existe na carteira com os outros filtros escolhidos — ex.:
  escolher Alpestre deixa só os representantes, supervisores, segmentos e ondas de Alpestre. As opções saem do mesmo
  `resumo_carteira` (lido uma vez, em cache), nunca da carteira. UF e cidade são filtros separados; trocar a UF limpa a
  cidade. Teste prova que as opções = valores distintos da carteira com os mesmos filtros.
- Números vêm de `resumo_carteira` (uma linha por combinação, mantida pelos triggers) e dos pedidos do ERP agrupados —
  nunca da carteira inteira. Teste prova que o resumo bate com a base em todo o processo e que a raiz bate com o Início.

## 11. Perfis de acesso e telas (migração 0008 · `shared/perfis.mjs`)

- **Perfil** = nome + **tipo-base** + **telas**. O tipo-base é o perfil técnico do usuário e decide **quais dados** ele vê e
  as regras do banco; as telas decidem **o que aparece no menu** e o que pode ser aberto.

| Tipo-base | Dados | Telas possíveis |
|---|---|---|
| Administrador | tudo, sem restrição | todas (o perfil Administrador do sistema tem sempre todas) |
| Gerente comercial | todos os dados; não libera crédito | Início, Lista principal, Acompanhamento, Registrar |
| Supervisor | só a equipe dele | Início, Lista principal, Acompanhamento, Registrar |
| Vendedor / representante | só a própria carteira | Início, Lista principal, Acompanhamento, Registrar |
| Analista financeiro | só a análise de crédito | Console de crédito (+ Início, Lista, Acompanhamento, se marcados) |

- **Supervisor que também é gerente** (ex.: Julio): tipo-base **Supervisor** (mantém a equipe dele) com um perfil marcado
  **"vê todas as equipes"** e as telas do gerente. Ele **abre como o gerente** (base toda, todas as equipes) e vê a
  equipe dele separada escolhendo-se no filtro/nível Supervisor; registra só na equipe dele. Os demais supervisores não
  mudam (já veem só a própria equipe).
- Os **5 perfis do sistema** vêm prontos com as telas de hoje (financeiro: só o Console de crédito). O administrador cria
  outros em **Usuários → Perfis e telas de acesso** (ex.: "Supervisor regional" sem Acompanhamento) e escolhe o perfil de
  cada usuário na coluna Perfil da lista de usuários.
- **Novo usuário** (tela Usuários): qualquer perfil. Supervisor e vendedor/representante pedem o **código do ERP** (a
  importação da base reconhece o mesmo usuário por ele e não o duplica) e o vendedor, também o **supervisor** da equipe.
- **Trocar o perfil de um usuário** (coluna Perfil): supervisor e vendedor escolhem só entre perfis do próprio tipo-base
  (dependem de código do ERP e equipe). Administrador, gerente e analista financeiro trocam entre si —
  isso muda também o tipo-base (o escopo dos dados). Quem deixa de ser administrador perde o cofre de administração; quem
  passa a ser precisa ter a senha definida na tela para receber o cofre (ADR-0006). Ninguém troca o tipo do próprio usuário.
- Lista de usuários numa linha por usuário: Nome · Login · **Perfil** · Acesso · Ações. O seletor de Perfil mostra
  **todos** os perfis cadastrados, agrupados por tipo; os que não servem para aquele usuário aparecem desabilitados com o
  motivo. Para vendedor, o perfil do sistema aparece como **Representante (sem rota)** e **Vendedor (com rota)** — a
  escolha grava o tipo de atuação.
- **Supervisor que também é gerente** (ex.: o supervisor 2): perfil de tipo-base Supervisor com **"Vê os dados de todas
  as equipes"** marcado (migração 0009). Ele continua dono da própria equipe (os representantes ligados a ele) e passa a
  ver lista, acompanhamento, Início e indicadores de todas as equipes, com o seletor de supervisor. Registrar atendimento
  continua só na própria equipe (regra do banco; na ficha de outra equipe o botão não aparece).
- **Representante × vendedor de quem já foi importado:** tela Representantes / vendedores — arquivo ou **lista colada do
  Excel** (colunas COD e TIPO); altera o tipo de quem já tinha outro.
- O login carrega as telas do perfil; o menu mostra só elas e o endereço de uma tela não liberada mostra "Seu perfil não
  tem acesso a esta tela" (ou "Esta área é exclusiva do administrador"). Sem o Início no perfil, o usuário entra na
  primeira tela permitida. Mudança de perfil vale no próximo login.
- Telas de administração só servem ao tipo-base Administrador (gravam com a chave do cofre — ADR-0006). Alterar perfis
  exige a chave de administração com as permissões `perfis` e `perfil_telas` (docs/06 §3).


## 13. Grupos de CNPJ e expurgo (migração 0021 · `shared/grupos.mjs`)

- Tela **Administração → Grupos de CNPJ** (só administrador): carrega um arquivo do ERP com a coluna **CPF / CNPJ** (o
  relatório de cadastro serve) e cruza com a base **só pela raiz do CNPJ** (8 primeiros dígitos). CPF e CNPJ inválido do
  arquivo ficam fora. O arquivo é lido no navegador; nada é gravado até aplicar.
- Para cada grupo do arquivo que também está na base: as empresas da base (CNPJ, situação, carteira) e, de cada uma, se o
  **mesmo CNPJ** está no arquivo (código e data de cadastro) ou se é **filial nova** do grupo. Relatório completo em CSV.
- **Sugestão** por empresa (o administrador decide):
  - **Expurgar** — mesmo CNPJ no arquivo, cadastro anterior ao início da campanha (ou sem data) e ainda não trabalhado
    (Não contactado / Em prospecção, sem atendimento): já era cliente, não é prospect;
  - **Manter** — cadastro feito na campanha (conversão) ou prospect já trabalhado (atendido, cadastro, crédito, pedido,
    sem interesse…);
  - **Decidir** — filial nova de grupo que já é cliente, ainda sem atendimento.
- **Expurgo**: nada é apagado. O prospect passa à situação **Expurgado (já cliente)** — fora da carteira válida e das contas
  (como o inválido: `conta_carteira = 0`; no Explorar entra em "Inativos"), sem aceitar registro. Fica em `expurgos`
  (somente inclusão) com quem, quando e o motivo, e aparece no histórico da ficha. **Desfazer** (na mesma tela) devolve a
  situação anterior. O banco só aceita expurgar quem não foi trabalhado e só pelo administrador.

## 14. Pedidos do ERP (migração 0022 · `shared/importar-pedidos.mjs`, `shared/pedidos.mjs`)

Importação: docs/05 §6. Tela: **Explorar pedidos** (`#/pedidos`), o que foi vendido, numa tela só, sem abas.

**Cada tela responde a uma pergunta.** Explorar carteira: como está a base? · Lista principal: quem procurar? · Acompanhamento: o que está em andamento? · Explorar pedidos: o que foi vendido?

**Ver por Empresa ou Grupo** (chave em Explorar pedidos e no Acompanhamento, guardada no navegador; Explorar carteira e Lista principal não têm): grupo são as empresas da mesma raiz de CNPJ. Por grupo, elas ficam numa linha que abre, e a empresa sem grupo fica solta.
A chave muda como se vê e conta clientes: o grupo conta uma vez se ao menos uma empresa comprou. Em Explorar pedidos, Ver por Grupo soma também os pedidos das filiais fora da base; os valores das empresas da base não mudam. Status, atendimento e crédito continuam de cada empresa. Cada um vê só as empresas do seu escopo.

**Só entram os pedidos dos CNPJs da base.** O relatório traz todos os clientes do ERP, mas a campanha olha só a base:

| CPF / CNPJ da linha | O que acontece |
|---|---|
| CNPJ na base | Entra: vincula ao cliente, conta em tudo |
| Outro CNPJ com a raiz de um cliente da base (filial do grupo) | Entra só na **visão do grupo**: em Explorar pedidos com **Ver por Grupo**, na ficha e na conta do limite do grupo. Não muda status, não entra no Início, no Explorar carteira nem em Ver por Empresa. A filial fica com o dono da empresa da base naquele grupo |
| CNPJ fora da base e CPF | **Ignorado**: não é gravado como pedido; fica só na contagem e nas linhas da importação |

Se o CNPJ entrar na base depois, o pedido passa a entrar no próximo arquivo.

**Classificação** (tabelas `pedido_transacoes` e `pedido_situacoes`, escolhidas na importação; código novo para a importação e pergunta):

| Código do ERP | Conta como |
|---|---|
| Transação 90100 Pedido de Venda | Venda |
| Transação 90106 Pedido de Bonificação | Investimento: conta à parte, por cliente; não soma nem desconta da venda |
| Situação 9 Não Fechado | Digitado internamente, ainda fora da carteira |
| Situação 1 Aberto Total · 2 Aberto Parcial · 4 Liquidado | Em carteira · faturado em parte · faturado |
| Situação 5 Desistência | Cancelado |

**Venda válida** = venda em carteira, parcial ou faturada. **Em carteira** = pedido − faturado da venda válida. O "Valor dos pedidos" do Início, do Explorar e da ficha
é a venda válida (`vw_valor_pedidos`), mais os pedidos antigos de `eventos_erp` que ainda não vieram neste relatório.

**Status do cliente**, recalculado a cada arquivo olhando o conjunto dos pedidos (trigger de `pedido_aplicacoes`):

| Pedidos do cliente | Status |
|---|---|
| Ao menos um em carteira ou faturado | Venda realizada |
| Só digitado ou desistência (também quando era venda e os válidos foram cancelados) | Aguardando pedido válido |
| Só bonificação (exceção) | Não muda; alerta |
| Cliente expurgado | Não muda: o pedido só fica registrado |
| CNPJ baixado | Linha rejeitada: impossibilitado de faturamento |

Vale a regra do atendimento automático (§3): sem registro do representante no app, o pedido vira o atendimento.
"Bloqueado no financeiro" chega do ERP igual a Não Fechado: para separar, o relatório precisa trazer o motivo.

**Representante:** o cliente fica com o dono da carteira e a venda vai para quem a realizou (coluna Rep. ligada a `usuarios.codigo_erp`; o nome vem do cadastro, então incluir o código depois
não exige importar de novo). O cliente aparece na lista de cada representante que vendeu para ele, com o valor de cada um. É só informação, sem alerta: a carteira nunca muda sozinha.
O valor não duplica (cada pedido tem um representante); o total de clientes usa os distintos.

**Alertas** (faixa no topo de Explorar pedidos; prazos em Parâmetros): Aguardando pedido válido além de `prazo_pedido_valido_dias` (10) · bonificação sem venda · representante sem código no cadastro ·
desistências a partir de `alerta_desistencias_cliente` (5) · pedido em carteira além de `dias_alerta_pedido_aberto` (30) · em carteira do grupo, com as filiais, acima do Créd. Grupo (só pedidos em aberto: sem os títulos a receber, é uma visão parcial).

**Explorar pedidos** (`shared/pedidos.mjs`, `web/js/telas/_pedidos-analise.js`), como o Explorar carteira:
- **Hierarquia, sem listas de filtro:** árvore do total até o pedido, com níveis livres em qualquer ordem: Supervisor, Quem vendeu, Dono da carteira, Na lista?, Cidade, Segmento, Onda, Grupo, Cliente, Tipo, Situação e Mês. Os níveis se arrastam (no celular, botão Mudar) e a ordem fica guardada no navegador.
- **Filtro** na linha da frase, abaixo da chave Empresa ou Grupo: **Pedidos de venda, Pedidos de bonificação ou Ambos**.
- Clicar numa linha da hierarquia escolhe o que se vê: os seis valores, os gráficos e a lista "Pedidos de …" (com CSV) seguem essa linha. A **busca** procura só nessa lista: pedido, razão social, CNPJ ou representante. Tudo é calculado sobre os pedidos já lidos: filtrar, abrir linha ou mudar nível não volta ao banco.
- **Leitura:** os pedidos só são lidos de novo quando há arquivo novo ou apagado (`consultaVersaoPedidos`, poucas linhas) ou depois de 30 minutos. A ficha lê só os pedidos do cliente e do grupo dele, pelo índice do CNPJ.
- **Alertas** numa faixa no topo, que abre ao clicar.

**Quem vê:** administrador, gerente e quem vê todas as equipes, tudo; supervisor, a equipe; vendedor, os pedidos da carteira dele e os que ele mesmo fez.

**Apagar um arquivo** (Administração → Importações): tira os pedidos, as linhas e o histórico que o arquivo trouxe e volta o cliente ao que era antes, considerando os atendimentos registrados depois.
Mantém atendimentos, cadastro, crédito e baixados. Vai do arquivo mais novo para o mais antigo, só pelo administrador, digitando o nome do arquivo; fica o registro de quem apagou o quê. ADR-0007.
