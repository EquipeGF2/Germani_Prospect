# CLAUDE.md — GERMANI Prospect

Sistema **GERMANI** (guarda-chuva GERMANI), estado **ativo**. Português do Brasil; datas ISO AAAA-MM-DD.

## Antes de mudar qualquer coisa
- Leia `docs/03-regras-negocio.md` e `docs/02-modelo-dados.md`.
- Regras de status vivem nos **triggers** de `db/migrations/`. Mudou regra → nova migração `NNNN_*.sql`
  (nunca edite uma migração aplicada) + teste em `test/regras-banco.test.mjs` + doc 03.
- `shared/` não pode depender de Node (é usado também pelo app no navegador).

## Não fazer
- Commitar planilhas, relatórios, `.env` ou tokens (repositório público).
- UPDATE/DELETE em contatos, eventos_erp, historico_status, transferencias, importacao_linhas, auditoria.
- Alterar `prospects.status_atual` fora dos triggers.
- Inventar layout de arquivo do ERP: colunas vêm por parâmetro até a amostra real chegar.

## Comandos
`npm test` · `npm run migrate` · `npm run importar:base` · `npm run importar:eventos` · `npm run usuarios`
