# 03 — Regras de negócio e indicadores

## 1. Status

| Status | Origem | Na fila do vendedor? | Conta como contactado | Conta na carteira válida |
|---|---|---|---|---|
| Não contactado | carga inicial | sim | não | sim |
| Em prospecção | app (tentativa sem conclusão / sem interesse antes do limite) | sim, a partir de `data_proxima_acao` | sim | sim |
| Em negociação | app (com interesse) | sim, na data de retorno — **até o 2º atendimento**; depois aguarda o cadastro no ERP fora da lista | sim | sim |
| Sem interesse | app (limite de tentativas ou recusa após negociação) | **não** — sai da fila | sim | sim |
| Cadastrado no ERP | arquivo de cadastro do Senior | não | sim | sim |
| Venda realizada | arquivo de pedidos do Senior (**final**) | não | sim | sim |
| Inválido (baixado) | arquivo de CNPJs baixados | não — **congelado** | não | **não** |

O vendedor nunca escolhe "inválido", "cadastrado" ou "venda": não existem como resultado de contato.

> **Lista de trabalho × indicadores.** Com **pedido** (ou cadastro/baixa) **ou** ao completar **2 atendimentos**
> (`tentativas_maximas`), o prospect **deixa de aparecer na lista de prospects do vendedor**
> (`vw_prospects.na_lista = 0`), mas **continua em todos os indicadores** — eles contam a carteira inteira
> pelo status, não pela lista.

## 2. Registro de contato (app)

Campos: **canal** (visita · telefone · WhatsApp) → **resultado** → campos condicionais.

| Resultado | Campo obrigatório | Efeito |
|---|---|---|
| Com interesse | data de retorno (≥ data do contato) | → Em negociação; retorno = data informada; **prazo de cadastro** = data + `prazo_cadastro_dias` (15), contado do 1º interesse |
| Sem interesse | motivo (lista); "Outro" exige observação | antes do limite → Em prospecção (volta em `dias_entre_tentativas`); no limite → **Sem interesse** |
| Sem conclusão | — (não atendeu, retornar) | igual a "sem interesse" para contagem de tentativas; motivo final = "Sem retorno após as tentativas" |

Regras:
- **Atendimentos:** `tentativas_maximas` = 2. No 2º atendimento o prospect **sai da lista** em qualquer resultado:
  sem interesse/sem conclusão → **Sem interesse**; com interesse → continua **Em negociação** aguardando o
  cadastro no ERP (o prazo de cadastro segue valendo). Um 3º registro é recusado pelo banco.
  O que fazer depois com os "Sem interesse" será decidido (ver 07).
- **Em negociação antes do limite:** "sem conclusão" mantém em negociação; "sem interesse" encerra.
- Se `tentativas_maximas` for reduzido depois, prospects que já atingiram o novo limite saem da lista
  mantendo o status que tinham.
- **Data do aparelho manda.** Única trava: não pode ser anterior ao último contato registrado do prospect.
- **Observação** é livre; a versão sem acento (`observacao_busca`) alimenta o ranking de palavras-chave.
- **Correção** = novo contato. Nada é editado.

### Motivos de recusa (lista inicial, editável)

Preço acima do praticado · Já tem fornecedor/contrato · Mix não atende · Pedido mínimo alto ·
Prazo/condição de pagamento · Frequência ou dia de entrega · Não vende a categoria/baixo giro ·
Sem espaço na gôndola · Compra centralizada (rede/matriz) · Outro (observação obrigatória).

Do sistema (não aparecem no app): Sem retorno após as tentativas · Não informado (importação inicial).

## 3. Eventos do ERP e baixados (importação)

| Arquivo | Evento | Efeito |
|---|---|---|
| Cadastro de clientes (Senior) | `cadastro` | → Cadastrado no ERP; guarda código do cliente; sai da fila |
| Pedidos (Senior) | `pedido` | → **Venda realizada** (final); guarda nº do pedido; `analise_financeira_ate` = data + `prazo_analise_financeira_dias` (10) |
| CNPJs baixados | `baixa` | → Inválido; `situacao_cadastral = baixada`; prospect **congelado**: histórico preservado como estava, sem novos contatos, sem cadastro/pedido ("impossibilitado de faturamento") |

- Cadastro/pedido de prospect que **não** tinha interesse registrado no app (não contactado, em prospecção
  ou sem interesse) → `convertido_sem_registro = 1` (alerta para o supervisor: alguém vendeu sem lançar).
- Cadastro posterior a um pedido não rebaixa a venda.
- Reimportar o mesmo arquivo não duplica eventos (índice único por prospect + tipo + documento).

## 4. Alertas (para o painel)

| Alerta | Regra |
|---|---|
| Prazo de cadastro vencido | Em negociação e `prazo_cadastro_ate` < hoje |
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

Numa data passada D, o status de cada prospect é o da última linha de `historico_status` com
`data_evento ≤ D`. Por vendedor/supervisor, vale a carteira **atual**.

### Atividade (o que aconteceu entre início e fim)
Contatos registrados · prospects contactados · primeiros contatos · encerrados sem interesse ·
cadastros no ERP · pedidos · baixas.

Ambos podem ser agrupados por **total geral, vendedor, supervisor e cidade** e filtrados por vendedor,
supervisor, cidade e UF.

> Mudança em relação à especificação original: "conversão declarada" (venda informada pelo vendedor)
> deixou de existir — a venda só é registrada pelo arquivo de pedidos do ERP.
