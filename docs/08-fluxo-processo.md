# 08 — Fluxo completo do processo

**Situação:** implementado no banco (2026-10-19). Versão de uma página para conferência:
[`fluxo-processo.pdf`](fluxo-processo.pdf).

```mermaid
flowchart TD
    BASE([Planilha base — carga inicial]) --> NC[Não contactado]
    BASE --> EP["Em prospecção<br/>(DT 1o/2o na planilha)"]
    subgraph LP [" LISTA PRINCIPAL — prospecção (representante e vendedor) "]
        NC
        EP
    end
    NC -- "Sem interesse + justificativa<br/>(individual ou lote)" --> SI[Sem interesse]
    EP -- "Sem interesse" --> SI
    NC -- "Atendido (mobile)" --> AC
    EP -- "Atendido (mobile)" --> AC
    subgraph ACOMP [" LISTA DE ACOMPANHAMENTO — efetivação do pedido "]
        AC["1 · Aguardando cadastro<br/>prazo 15 dias"]
        AF["2 · Análise financeira<br/>prazo 10 dias"]
        AP["3 · Aguardando pedido"]
        VR(["4 · Venda realizada — final"])
        SI
    end
    AC -- "importação: arquivo de CADASTRO (ERP)" --> AF
    AF -- "console do analista (liberação sempre ocorre):<br/>à vista/antecipado ou a prazo · restrição sim/não · limite" --> AP
    AP -- "importação: arquivo de PEDIDOS (ERP)" --> VR
    AC -. "pedido no ERP antes" .-> VR
    AF -. "pedido no ERP antes do OK" .-> VR
    SI -- "Pedido identificado<br/>(data de entrada do pedido)" --> AC
    SI -. "arquivo de CADASTRO" .-> AF
    SI -. "arquivo de PEDIDOS" .-> VR
    BX([Arquivo de CNPJs baixados]) --> INV[Inválido — congelado]
```

## Etapas

| # | Etapa | Lista | Entra quando | Quem | Prazo / alerta |
|---|---|---|---|---|---|
| 0 | Não contactado / Em prospecção | principal | carga inicial | — | parado > 30 dias |
| 1 | **Aguardando cadastro** | acompanhamento | "Atendido" no mobile (ou "Pedido identificado") | representante / vendedor | **15 dias** para o cadastro |
| 2 | **Análise financeira** | acompanhamento | CNPJ no arquivo de **cadastro** do ERP | importação (administrador) | **10 dias** para o OK |
| 3 | **Aguardando pedido** | acompanhamento | OK no console: **à vista/antecipado ou a prazo**, **restrição de crédito sim/não**, **limite estipulado** | analista financeiro | — |
| 4 | **Venda realizada** | acompanhamento | CNPJ no arquivo de **pedidos** do ERP | importação | final |
| — | Sem interesse | acompanhamento | registro com justificativa | representante / vendedor | reabre com "Pedido identificado" |
| — | Inválido | — | CNPJ no arquivo de baixados (a qualquer momento) | importação | congelado |

## Histórico de movimentação

**Todo movimento** gera uma linha em `movimentacoes`: entrada na base, contato da planilha, atendido,
sem interesse, pedido identificado, cadastro, liberação de crédito, pedido, baixa e transferência de carteira.
Cada linha guarda data, status antes → depois, **quem fez**, **de quem era a carteira naquele dia** e o detalhe
(motivo, nº do documento, limite liberado). É a base de:

- **linha do tempo** da ficha do cliente (`vw_movimentacoes`);
- **filtros** de consulta e relatório (`consultaMovimentacoes`: período, tipo, status, vendedor, equipe, cidade, bairro);
- **indicadores** de atividade e funil por vendedor, equipe e geral (`consultaAtividade`).

## Regras gerais
- **Os arquivos do ERP prevalecem:** cadastro → Análise financeira e pedido → Venda realizada para qualquer cliente
  da base, inclusive Sem interesse e Não contactado (alerta "convertido sem registro" quando não houve atendimento).
- "Não atendido" não gera registro; dias corridos contam sempre do 1º registro.
- Saiu da lista principal → continua no acompanhamento e **em todos os indicadores**.
- Representante: filtro, consulta e registros. Vendedor: também monta rotas. Nenhuma distância é calculada.
