# ADR-0003 — Histórico somente-inclusão e regras de status no banco

- **Data:** 2026-10-19 · **Situação:** aceita · **Sistema:** GERMANI

## Contexto
Sem servidor (ADR-0001), qualquer regra que exista só no app pode ser contornada ou esquecida numa
versão futura. O histórico de prospecção não pode ser editado nem apagado.

## Decisão
- Toda mudança de status nasce de um **evento**: `contatos` (app ou importação inicial), `eventos_erp`
  (cadastro, pedido, baixa) ou `transferencias`.
- Triggers `AFTER INSERT` aplicam a regra e atualizam `prospects` + gravam `movimentacoes`.
- Triggers `BEFORE UPDATE/DELETE` bloqueiam alteração dessas tabelas. **Correção = novo registro.**
- `prospects` nunca é apagado; CNPJ baixado vira `invalido` e fica **congelado** (nenhum UPDATE).
- Parâmetros (prazos de cadastro e de análise financeira, alertas) são lidos da tabela `parametros` dentro dos triggers;
  mudanças são auditadas por trigger em `auditoria`.

## Consequências
- O estado do prospect sempre corresponde ao último evento (testado em `test/regras-banco.test.mjs`).
- Mudança de parâmetro **não é retroativa**: vale para os próximos eventos.
- Mudança de regra exige migração SQL nova (nunca editar migração aplicada — o `migrate` recusa).
