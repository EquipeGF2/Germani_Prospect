# ADR-0004 — JavaScript (ESM) sem etapa de build, módulos compartilhados

- **Data:** 2026-10-19 · **Situação:** aceita · **Sistema:** GERMANI

## Decisão
- Código em JavaScript moderno (módulos `.mjs`), sem TypeScript e sem bundler no backend.
- `shared/` não depende de Node: roda igual no navegador (o app) e nos scripts (importação).
  Normalização de texto, CNPJ, datas, regras de formulário e SQL dos indicadores existem **uma vez**.
- Testes com o executor nativo `node --test` (zero dependência de teste).
- Dependências mínimas: `@libsql/client` (Turso), `exceljs` + `jszip` (planilhas, só nos scripts).

## Motivo
Manutenção por uma pessoa: menos ferramentas para atualizar, nada para compilar, mesmo código no app
e na importação.
