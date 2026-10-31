# CLAUDE.md — GERMANI Prospect

Sistema **GERMANI** (guarda-chuva GERMANI), estado **ativo**. Português do Brasil; datas ISO AAAA-MM-DD.

## Antes de mudar qualquer coisa
- Leia `docs/03-regras-negocio.md` e `docs/02-modelo-dados.md`.
- Regras de status vivem nos **triggers** de `db/migrations/`. Mudou regra → nova migração `NNNN_*.sql`
  (nunca edite uma migração aplicada) + teste em `test/regras-banco.test.mjs` + doc 03.
- Tabela nova (ou coluna usada em filtro, ligação ou ordenação) já nasce com índice; mudança de consulta pesada
  é medida com `node scripts/medir-consultas.mjs 50000 --plano` (volume de produção ~50 mil CNPJs) e nunca muda o resultado.
  Lista principal: ordem em 3 faixas da próxima ação (shared/carteira.mjs) com teste de equivalência; leituras que mudam pouco
  passam por `lerComCache` (web/js/db.js), que se limpa a cada gravação.
- `shared/` não pode depender de Node (é usado também pelo app no navegador).
- Telas em `web/js/telas/`: só textContent (nunca innerHTML com dado do banco); regra de negócio fica em `shared/`.
- Tela nova ou alterada: atualize a ajuda em `shared/ajuda.mjs` (docs/03 §15).

## Não fazer
- Commitar planilhas, relatórios, `.env` ou tokens (repositório público).
- UPDATE/DELETE em contatos, eventos_erp, movimentacoes, transferencias, importacao_linhas, auditoria.
  Única exceção: apagar um arquivo de pedidos (`pedido_exclusoes`, migração 0022, ADR-0007), só pelo trigger.
- Alterar `prospects.status_atual` fora dos triggers.
- Inventar layout de arquivo do ERP: colunas vêm por parâmetro até a amostra real chegar.
- Calcular distância por geolocalização (ADR-0005). Dar rota ao representante.

## Comandos
`npm test` · `npm run test:telas` · `npm run site` · `npm run servir` · `npm run migrate` · `npm run importar:base` · `npm run importar:eventos` · `npm run importar:tipos` · `npm run importar:credito` · `npm run usuarios`
