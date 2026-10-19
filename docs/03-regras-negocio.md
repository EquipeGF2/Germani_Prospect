# 03 — Regras de negócio e indicadores

## 1. Status

| Status | Origem | Na lista de prospects? | Aceita novo contato? | Conta como contactado | Carteira válida |
|---|---|---|---|---|---|
| Não contactado | carga inicial | **sim** | sim | não | sim |
| Em prospecção | app (atendido sem interesse/sem conclusão, antes do limite) | **sim**, a partir de `data_proxima_acao` | sim | sim | sim |
| Em negociação | app (**com interesse**) — exibido como "Em negociação · atendido em dd/mm/aaaa"; aguarda o cadastro no ERP | não | sim | sim | sim |
| Sem interesse | app (2 atendimentos sem interesse, ou recusa depois de negociar) | não | sim | sim | sim |
| Cadastrado no ERP | arquivo de cadastro do Senior | não | sim (só registra; status não muda) | sim | sim |
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

Campos: **canal** (visita · telefone · WhatsApp) → **resultado** → campos condicionais.

| Resultado | Campo obrigatório | Efeito |
|---|---|---|
| Com interesse | — (data de retorno opcional) | → **Em negociação**, "atendido em" = data do 1º interesse; abre o **prazo de cadastro** = data + `prazo_cadastro_dias` (15) |
| Sem interesse | motivo (lista); "Outro" exige observação | Não contactado/Em prospecção: antes do limite → Em prospecção; no limite → **Sem interesse**. Em negociação → **Sem interesse** |
| Sem conclusão | — (não atendeu, retornar) | conta como atendimento sem interesse; em negociação mantém Em negociação |

Regras:
- **Contatos sem limite.** Qualquer prospect que não seja Venda realizada nem Inválido aceita novos contatos.
- **Saída da lista:** `tentativas_maximas` = 2 atendimentos sem interesse → **Sem interesse** (sai da lista).
  Um novo "com interesse" depois disso reabre como **Em negociação**.
- **Dias corridos** são **sempre** contados a partir do **1º atendimento** (`dt_primeiro_contato`), em qualquer
  status, inclusive depois de sair da lista (`vw_prospects.dias_corridos`).
- **Motivo final** de "Sem interesse" = o último motivo informado em qualquer atendimento; sem nenhum,
  "Sem retorno após as tentativas".
- **Próxima ação:** a data de retorno informada ou, sem ela, data do contato + `dias_entre_tentativas` (7).
  Vale também para Em negociação (`retorno_pendente`).
- **Data do aparelho manda.** Única trava: não pode ser anterior ao último contato registrado do prospect.
- **Observação** é livre; a versão sem acento (`observacao_busca`) alimenta o ranking de palavras-chave.
- **Correção** = novo contato. Nada é editado.
- O que fazer depois com os "Sem interesse" será decidido (ver 07).

### Motivos de recusa (lista inicial, editável)

Preço acima do praticado · Já tem fornecedor/contrato · Mix não atende · Pedido mínimo alto ·
Prazo/condição de pagamento · Frequência ou dia de entrega · Não vende a categoria/baixo giro ·
Sem espaço na gôndola · Compra centralizada (rede/matriz) · Outro (observação obrigatória).

Do sistema (não aparecem no app): Sem retorno após as tentativas · Não informado (importação inicial).

## 3. Eventos do ERP e baixados (importação)

| Arquivo | Evento | Efeito |
|---|---|---|
| Cadastro de clientes (Senior) | `cadastro` | → Cadastrado no ERP (encerra a Em negociação); guarda código do cliente |
| Pedidos (Senior) | `pedido` | → **Venda realizada** (final); guarda nº do pedido; `analise_financeira_ate` = data + `prazo_analise_financeira_dias` (10) |
| CNPJs baixados | `baixa` | → Inválido; `situacao_cadastral = baixada`; prospect **congelado**: histórico preservado como estava, sem novos contatos, sem cadastro/pedido ("impossibilitado de faturamento") |

- Cadastro/pedido de prospect **sem nenhum "com interesse" registrado** → `convertido_sem_registro = 1`
  (alerta para o supervisor: alguém vendeu sem lançar).
- Cadastro posterior a um pedido não rebaixa a venda.
- Reimportar o mesmo arquivo não duplica eventos (índice único por prospect + tipo + documento).

## 4. Alertas (para o painel)

| Alerta | Regra |
|---|---|
| Prazo de cadastro vencido | Em negociação e `prazo_cadastro_ate` < hoje |
| Retorno pendente | `retorno_pendente`: data de retorno hoje ou vencida (inclui Em negociação) |
| Em análise financeira | Venda realizada e `analise_financeira_ate` ≥ hoje |
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
| Em negociação (aguardando cadastro) | status Em negociação na data |

Numa data passada D, o status de cada prospect é o da última linha de `historico_status` com
`data_evento ≤ D`. Por vendedor/supervisor, vale a carteira **atual**.

### Atividade (o que aconteceu entre início e fim)
Contatos registrados · contatos com interesse · prospects contactados · primeiros contatos · encerrados sem interesse ·
cadastros no ERP · pedidos · baixas.

Ambos contam **toda a base** (dentro e fora da lista) e podem ser agrupados por **total geral, vendedor,
supervisor (= equipe), cidade, bairro e rota** e filtrados por
vendedor, supervisor, cidade, bairro e UF. O agrupamento por **rota considera só prospects de vendedores**
(representante não tem rota).

> Mudança em relação à especificação original: "conversão declarada" (venda informada pelo vendedor)
> deixou de existir — a venda só é registrada pelo arquivo de pedidos do ERP.

## 6. Lista de prospects e acompanhamento — representante × vendedor

Implementação: [`shared/carteira.mjs`](../shared/carteira.mjs) · testes: [`test/carteira.test.mjs`](../test/carteira.test.mjs).

| | Representante | Vendedor | Supervisor / admin |
|---|---|---|---|
| Forma de trabalho | visita a carteira | atendimento mais amplo (telefone, WhatsApp, visita) | gestão |
| Visões | **Lista · Cidade · Bairro · Status** | Lista · Cidade · Bairro · Status · **Rota** (rota/subrota) | todas |
| Rota / subrota | **nunca** (não agrupa, não filtra, não recebe as colunas) | sim | só nos prospects de vendedores |
| Escopo | própria carteira | própria carteira | equipe / tudo |

- A forma de trabalho vem de `usuarios.tipo_atuacao` (`representante` | `vendedor`), definida pelo
  administrador: `npm run usuarios -- tipo <login> representante|vendedor`. Sem definição = representante.
- **Lista:** só Não contactado / Em prospecção, ordenados por pendentes de hoje, retornos, próxima ação,
  cidade, bairro, nome. Filtros: pendentes hoje, retornos pendentes, cidade, bairro, UF, rota/subrota (vendedor).
  Busca por nome, CNPJ (com ou sem pontuação), cidade ou bairro, **sem acento**.
- **Status (acompanhamento):** todos os status com quantidade, retornos pendentes, prazos de cadastro vencidos e
  média de dias corridos. Tocar num status abre a lista daquele status — **inclusive fora da lista de prospects**
  (Em negociação "atendido em", Sem interesse com motivo, Cadastrado, Venda, Inválido).
- **Cidade / Bairro / Rota:** agrupamentos com total, pendentes hoje, não contactados, em prospecção, com interesse
  e o centro geográfico (lat/long média) para abrir no mapa. Tocar num grupo abre a lista filtrada.
- Cada linha traz `dias_corridos` (desde o 1º atendimento) e `status_descricao`.
