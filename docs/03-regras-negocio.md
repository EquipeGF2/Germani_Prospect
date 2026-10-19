# 03 — Regras de negócio e indicadores

## 1. Status

| Status | Origem | Na fila do vendedor? | Conta como contactado | Conta na carteira válida |
|---|---|---|---|---|
| Não contactado | carga inicial | sim | não | sim |
| Em prospecção | app (qualquer atendimento antes do limite; ou "com interesse" no limite) | sim, a partir de `data_proxima_acao` — **até o 2º atendimento**; com interesse no limite aguarda o cadastro no ERP fora da lista | sim | sim |
| Sem interesse | app (limite de atendimentos sem interesse) | **não** — sai da fila | sim | sim |
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
| Com interesse | — (data de retorno opcional) | continua **Em prospecção**; marca `dt_interesse` e abre o **prazo de cadastro** = data + `prazo_cadastro_dias` (15), contado do 1º interesse |
| Sem interesse | motivo (lista); "Outro" exige observação | antes do limite → Em prospecção; no limite → **Sem interesse** |
| Sem conclusão | — (não atendeu, retornar) | igual a "sem interesse" para contagem de tentativas; motivo final = "Sem retorno após as tentativas" |

Regras:
- **Atendimentos:** `tentativas_maximas` = 2. No 2º atendimento o prospect **sai da lista** em qualquer resultado:
  sem interesse/sem conclusão → **Sem interesse**; com interesse → continua **Em prospecção** aguardando o
  cadastro no ERP (o prazo de cadastro segue valendo). Um 3º registro é recusado pelo banco.
  O que fazer depois com os "Sem interesse" será decidido (ver 07).
- **Não existe status "Em negociação".** O interesse é um marcador (`dt_interesse`) e não muda o status.
- **Próxima ação:** a data de retorno informada ou, sem ela, data do contato + `dias_entre_tentativas` (7).
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

- Cadastro/pedido de prospect **sem nenhum "com interesse" registrado** → `convertido_sem_registro = 1`
  (alerta para o supervisor: alguém vendeu sem lançar).
- Cadastro posterior a um pedido não rebaixa a venda.
- Reimportar o mesmo arquivo não duplica eventos (índice único por prospect + tipo + documento).

## 4. Alertas (para o painel)

| Alerta | Regra |
|---|---|
| Prazo de cadastro vencido | Em prospecção com interesse e `prazo_cadastro_ate` < hoje |
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
| Com interesse aguardando cadastro | Em prospecção com interesse registrado até a data |

Numa data passada D, o status de cada prospect é o da última linha de `historico_status` com
`data_evento ≤ D`. Por vendedor/supervisor, vale a carteira **atual**.

### Atividade (o que aconteceu entre início e fim)
Contatos registrados · contatos com interesse · prospects contactados · primeiros contatos · encerrados sem interesse ·
cadastros no ERP · pedidos · baixas.

Ambos podem ser agrupados por **total geral, vendedor, supervisor, cidade, bairro e rota** e filtrados por
vendedor, supervisor, cidade, bairro e UF. O agrupamento por **rota considera só prospects de vendedores**
(representante não tem rota).

> Mudança em relação à especificação original: "conversão declarada" (venda informada pelo vendedor)
> deixou de existir — a venda só é registrada pelo arquivo de pedidos do ERP.

## 6. Lista de prospects — representante × vendedor

Implementação: [`shared/carteira.mjs`](../shared/carteira.mjs) · testes: [`test/carteira.test.mjs`](../test/carteira.test.mjs).

| | Representante | Vendedor | Supervisor / admin |
|---|---|---|---|
| Forma de trabalho | visita a carteira | atendimento mais amplo (telefone, WhatsApp, visita) | gestão |
| Visões | **Lista · Cidade · Bairro** | Lista · Cidade · Bairro · **Rota** (rota/subrota) | todas |
| Rota / subrota | **nunca** (não agrupa, não filtra, não recebe as colunas) | sim | só nos prospects de vendedores |
| Escopo | própria carteira | própria carteira | equipe / tudo |

- A forma de trabalho vem de `usuarios.tipo_atuacao` (`representante` | `vendedor`), definida pelo
  administrador: `npm run usuarios -- tipo <login> representante|vendedor`. Sem definição = representante.
- **Lista:** só prospects com `na_lista = 1`, ordenados por pendentes de hoje, próxima ação, cidade, bairro, nome.
  Filtros: pendentes hoje, status, cidade, bairro, UF, rota/subrota (vendedor). Busca por nome, CNPJ
  (com ou sem pontuação), cidade ou bairro, **sem acento**. `incluirForaDaLista` mostra também os encerrados.
- **Cidade / Bairro / Rota:** agrupamentos com total, pendentes hoje, não contactados, em prospecção, com interesse
  e o centro geográfico (lat/long média) para abrir no mapa. Tocar num grupo abre a lista filtrada.
- Sair da lista não tira o prospect dos indicadores (§5).
