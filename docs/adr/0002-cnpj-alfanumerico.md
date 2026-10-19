# ADR-0002 — CNPJ alfanumérico desde o início

- **Data:** 2026-10-19 · **Situação:** aceita · **Sistema:** GERMANI

## Contexto
A IN RFB 2.229/2024 introduz o CNPJ alfanumérico a partir de julho/2026. Prospects são, em boa parte,
empresas novas — exatamente as que recebem o formato novo.

## Decisão
- CNPJ guardado como `TEXT` de 14 posições: 12 em `[0-9A-Z]` + 2 DVs numéricos.
- DV pelo módulo 11 com valor do caractere = código ASCII − 48 (vale para o numérico também).
- Zeros à esquerda só são completados em valores puramente numéricos (perda típica do Excel).
- `cnpj_raiz` (8 posições) guardado para identificar matriz/filiais.

Implementação e testes: `shared/cnpj.mjs`, `test/cnpj.test.mjs` (inclui o exemplo oficial `12.ABC.345/01DE-35`).
