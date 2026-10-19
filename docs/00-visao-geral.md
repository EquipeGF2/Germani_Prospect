# 00 — Visão geral

**Sistema:** GERMANI · **Estado:** ativo · **Atualizado em:** 2026-10-19

## O que é
App de **controle de prospecção de novos clientes** da GERMANI Alimentos (Santa Cruz do Sul/RS, ERP Senior).
Cada CNPJ que ainda não é cliente vira um ponto de controle: o representante/vendedor registra as
atendimentos e as faltas de interesse, e o supervisor acompanha cobertura e conversão.

## Fluxo do prospect (resumo)

```
 LISTA PRINCIPAL                         LISTA DE ACOMPANHAMENTO
 Não contactado / Em prospecção ──(atendido)──► 1 Aguardando cadastro (15 dias)
          │                                          │ arquivo de CADASTRO (ERP)
          │                                          ▼
          │                                    2 Análise financeira (10 dias)
          │                                          │ OK do analista: condição + restrição + limite
          │                                          ▼
          │                                    3 Aguardando pedido
          │                                          │ arquivo de PEDIDOS (ERP)
          │                                          ▼
          │                                    4 Venda realizada (final)
          └──(sem interesse)──► Sem interesse ──(pedido identificado)──► 1
 arquivo de CNPJs baixados ──► Inválido (congelado)       Fluxo de 1 página: docs/fluxo-processo.pdf
```

A **lista de prospects** mostra só Não contactado e Em prospecção. Todo o resto continua visível no
**acompanhamento por status** do vendedor e **sempre conta nos indicadores** de cada equipe e no geral.
Contatos não têm limite; os dias corridos contam sempre do 1º registro.

Detalhe completo: [03-regras-negocio.md](03-regras-negocio.md).

## Quem faz o quê

| Perfil | No app | Por importação (administrador) |
|---|---|---|
| Representante | **filtro e consulta**: lista principal por lista, cidade e bairro (**sem rota**) + acompanhamento; registra **atendido / sem interesse** (também em lote) e reabre com pedido identificado | — |
| Vendedor | o mesmo + **montagem de rotas** e visão por rota/subrota | — |
| Analista financeiro | console de crédito: libera sempre, informando à vista/antecipado ou a prazo, restrição de crédito e limite | — |
| Supervisor | o mesmo, para a sua equipe; acompanha painel; redistribui carteira | — |
| Administrador | tudo | base inicial de prospects; cadastro de clientes do ERP; pedidos do ERP; CNPJs baixados; usuários e senhas |

O vendedor **não** marca inválido nem venda: inválido vem do arquivo de baixados; cadastro e venda vêm dos
arquivos do ERP.

## Fases

| Fase | Conteúdo | Situação |
|---|---|---|
| **Backend** | estrutura do repositório, banco, vínculos, regras, importações, testes, documentação | **esta entrega** |
| F1 — App · parte 1 | login; **administração pela tela**: base de prospects (com mapeamento do Status Atual), representantes/vendedores, cadastro/pedidos/baixados, histórico de importações, usuários e senhas, parâmetros; modo demonstração; publicação no GitHub Pages | **pronta** |
| F1 — App · partes 2 e 3 | lista principal e acompanhamento (lista/cidade/bairro/onda/status/rota); busca e filtros; ficha com histórico de movimentação; registrar atendido / sem interesse / reabrir com pedido; sem interesse em lote | **pronta** (2026-10-19) |
| F1 — App · parte 4 | console de crédito do analista financeiro (liberar e corrigir); menu lateral recolhível | **pronta** (2026-10-19) |
| F1 — App · parte 5 | painel e indicadores; rotas do vendedor; exportação XLSX | a fazer |
| F2 — Campo | modo offline (rotas já estão no backend; sem cálculo de distância — ADR-0005) | a fazer |
| F3 — Financeiro | pedidos cancelados por restrição financeira (processo a definir) | a definir |

## Índice
- [01 — Arquitetura](01-arquitetura.md)
- [02 — Modelo de dados](02-modelo-dados.md)
- [03 — Regras de negócio e indicadores](03-regras-negocio.md)
- [04 — Contrato de acesso a dados do app](04-acesso-dados.md)
- [05 — Importações](05-importacao.md)
- [06 — Operação (Turso, GitHub, segredos)](06-operacao.md)
- [07 — Pendências e dúvidas](07-pendencias.md)
- [08 — Fluxo completo do processo (validação)](08-fluxo-processo.md)
- [ADRs](adr/)
