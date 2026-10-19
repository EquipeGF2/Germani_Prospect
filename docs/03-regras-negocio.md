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
| Venda realizada | arquivo de pedidos do Senior (**final**) | não | não | sim | sim |
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
| **Sem interesse** | justificativa: motivo (lista) + observação ("Outro" exige observação) | → **Sem interesse** na hora (sai da lista principal) |
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

### Motivos de recusa (lista inicial, editável)

Preço acima do praticado · Já tem fornecedor/contrato · Mix não atende · Pedido mínimo alto ·
Prazo/condição de pagamento · Frequência ou dia de entrega · Não vende a categoria/baixo giro ·
Sem espaço na gôndola · Compra centralizada (rede/matriz) · Outro (observação obrigatória).

Do sistema (não aparece no app): Não informado (importação inicial).

## 3. Eventos do ERP e baixados (importação)

| Arquivo | Evento | Efeito |
|---|---|---|
| Cadastro de clientes (Senior) | `cadastro` | → **Análise financeira**; guarda código do cliente; `analise_financeira_ate` = data + `prazo_analise_financeira_dias` (10) |
| Pedidos (Senior) | `pedido` | → **Venda realizada** (final); guarda nº do pedido. Vale em qualquer etapa (o ERP prevalece) |
| CNPJs baixados | `baixa` | → Inválido; `situacao_cadastral = baixada`; prospect **congelado**: histórico preservado como estava, sem novos contatos, sem cadastro/pedido ("impossibilitado de faturamento") |

- **Os arquivos do ERP prevalecem sobre o status do app:** cadastro leva a **Análise financeira** e pedido leva a
  **Venda realizada** para qualquer cliente da base — inclusive **Sem interesse** e **Não contactado**. A mudança
  fica no histórico de movimentação (ex.: Sem interesse → Análise financeira).
- Cadastro/pedido de prospect **sem nenhum "atendido" nem "pedido identificado" registrado** → `convertido_sem_registro = 1`
  (alerta para o supervisor: alguém vendeu sem lançar).
- Cadastro posterior a um pedido não rebaixa a venda.
- Reimportar o mesmo arquivo não duplica eventos (índice único por prospect + tipo + documento).

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
- **Acompanhamento (visão Status):** todos os status com quantidade, retornos pendentes, prazos de cadastro
  vencidos e média de dias corridos. Tocar num status abre a lista daquele status.
- **Onda:** coluna ONDA da planilha base — visão agrupada e filtro para os dois perfis, também nos indicadores
  (`agrupar: 'onda'`, `filtros.onda`) e no histórico de movimentação.
- **Cidade / Bairro:** para os dois perfis. Total, pendentes hoje, não contactados, em prospecção, atendidos
  e o centro do grupo para **abrir no mapa**. **Nenhuma distância é calculada** (ADR-0005).
- Cada linha traz `dias_corridos` (desde o 1º atendimento) e `status_descricao`.

**Nas telas** ([`web/js/telas/carteira.js`](../web/js/telas/carteira.js)):
- `#/carteira` = **Lista principal**; `#/carteira?aba=acompanhamento` = **Acompanhamento** (`filtros.foraDaLista`:
  só quem saiu da lista principal; abre nos cartões por status).
- Visões em botões; tocar num grupo (cidade, bairro, onda, rota, status) abre a lista já filtrada. Os filtros
  ativos aparecem como etiquetas removíveis. Supervisor e administrador escolhem o vendedor da equipe.
- Cada cartão: razão social, selo do status, CNPJ, fantasia, bairro/cidade, onda, rota (só vendedor),
  "atendido em…", dias corridos, retorno vencido e prazo de cadastro vencido. 50 por página.
- **Ficha** (`#/ficha`): situação (status, dias corridos, registros, datas, prazos, motivo, cadastro e pedido do
  ERP), crédito liberado (forma, prazo, limite e se veio do grupo, restrição), **histórico de movimentação**
  (data, status antes → depois, detalhe, quem fez, origem, carteira da época) e cadastro com Ligar / WhatsApp
  (telefone com DDD) / Ver no mapa (coordenadas da base). Ficha fora do escopo do usuário não abre.

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

### 8.1 Relatório de crédito do ERP (rotina) — `shared/importar-credito.mjs`
Colunas: **CNPJ · Cód interno · Razão social · Forma de pagamento · Prazo de pagamento · Limite de crédito CNPJ ·
Limite de crédito grupo · Data de cadastro**.

| Regra | Como funciona |
|---|---|
| Limite | **Limite do CNPJ preenchido → vale o do CNPJ** (o do grupo é ignorado). **CNPJ vazio → vale o do grupo.** Os dois vazios: limite 0 (aviso); boleto sem limite é rejeitado. A origem do limite (CNPJ / grupo) fica registrada. |
| Forma de pagamento | **antecipado · à vista · boleto**. Os valores do arquivo são mapeados na tela (sugestões automáticas para "ANTECIPADO", "A VISTA", "BOLETO"…); valor não mapeado = linha rejeitada. |
| Prazo | só a **quantidade de dias** (ex.: 28). Vazio = 0. |
| Cliente ainda sem cadastro | (Não contactado, Em prospecção, Aguardando cadastro, Sem interesse) o relatório registra **também o cadastro** (data de cadastro + cód. interno) e em seguida a liberação. |
| Já em Aguardando pedido | crédito diferente = nova liberação (correção); igual = ignorado. |
| Venda realizada | ignorado (o status não muda). · CNPJ baixado: rejeitado. · Fora da base: ignorado. |
| Data da liberação | dia da importação (nunca antes do cadastro). |

### 8.2 Console do analista (casos pontuais) — `shared/financeiro.mjs`
Fila com os clientes em Análise financeira (mais antigos primeiro, dias em análise, prazo vencido). O analista
(perfil **financeiro** ou administrador) informa **forma de pagamento**, **prazo (dias)**, **restrição de crédito
sim/não** e **limite**. Boleto exige limite maior que zero.

**Na tela** (menu *Financeiro → Console de crédito*, `#/financeiro`; o analista entra direto nela):
- indicadores: em análise, fora do prazo (10 dias), liberados aguardando pedido;
- abas **Em análise** (mais antigos primeiro, dias em análise, prazo; vencido em vermelho) e **Liberados · aguardando
  pedido** (mais recentes primeiro, com a condição: forma · prazo · limite · restrição); busca por cliente, CNPJ,
  cód. ERP, cidade ou vendedor;
- **Liberar crédito** (`#/financeiro/liberar`): forma (antecipado / à vista / boleto), prazo em dias, limite (R$,
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
| Valores | **Dias úteis da campanha** (seg–sex desde `data_inicio_campanha` até hoje, menos os `feriados` cadastrados) · **Potencial do pipeline de abertura** = total × `percentual_pipeline`% × `valor_medio_cliente` · **Valor de conversão** = vendas × `valor_medio_cliente` |
| Visão por supervisor | seletor de supervisor (lembrado na aba) → os mesmos cards + agentes de vendas (vendedores × representantes) |
| Consolidado por agente | agente, tipo, total, não contactado, sem interesse, crédito liberado, venda realizada, **% contactado** = (total − não contactado) ÷ total, **% conversão** = vendas ÷ contactados; total do supervisor; tocar no agente abre a carteira dele. No celular, um cartão por agente. |

- **Crédito liberado** = clientes que já tiveram crédito liberado (console ou relatório), mesmo que depois virem venda.
  Não separa com ou sem restrição.
- **Escopo:** administrador, **gerente comercial** e analista financeiro veem tudo e escolhem o supervisor;
  **supervisor** vê só a própria equipe (sem seletor); vendedor/representante vê só a própria carteira.
- **Feriados** (Administração → Feriados): todo feriado cadastrado sai da contagem — cadastre os estaduais e
  municipais que valem para a operação.
- **Gerente comercial** (perfil `gerente`): vê tudo e age em qualquer carteira (registro, lote, transferência);
  **não libera crédito** (trigger de `liberacoes_credito`) e não acessa a administração.
