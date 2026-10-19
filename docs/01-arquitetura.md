# 01 — Arquitetura

## Componentes (somente GitHub + Turso)

```
┌──────────────────────── GitHub (repositório público) ───────────────────────┐
│  código + docs        Actions: CI (testes)          Pages: app estático (F1) │
│                       Actions: migrar banco         Secrets: TURSO_*         │
└───────────────┬───────────────────────┬───────────────────────┬─────────────┘
                │ migrações (token admin)│                       │ HTTPS (token do app)
                ▼                        │                       ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                Turso — banco único de produção               │
        │   tabelas + CHECKs + triggers (regras) + views (consultas)   │
        └──────────────────────────────────────────────────────────────┘
                ▲
                │ importações (token admin, máquina do administrador)
        ┌───────┴─────────────┐
        │ npm run importar:*  │  planilhas ficam só na máquina do administrador
        └─────────────────────┘
```

Decisão e riscos: [ADR-0001](adr/0001-turso-direto-github-pages.md).

## Pastas do repositório

```
├── README.md                    como rodar, variáveis, importar, publicar
├── CLAUDE.md                    contexto para sessões de desenvolvimento assistido
├── docs/                        esta documentação + adr/
├── db/migrations/               NNNN_nome.sql — estrutura, regras e views (fonte da verdade)
├── config/mapa-status-planilha.json   tradução da coluna "Status Atual" da planilha base
├── shared/                      módulos puros (rodam no Node e no navegador)
│   ├── texto.mjs                normalização sem acento, busca, palavras-chave
│   ├── cnpj.mjs                 CNPJ numérico e alfanumérico
│   ├── datas.mjs                datas da planilha, "hoje" em São Paulo
│   ├── status.mjs               status, canais, resultados, validação do formulário
│   ├── senha.mjs                hash PBKDF2 (Web Crypto)
│   ├── importacao-base.mjs      layout e validação da planilha base
│   ├── carteira.mjs             lista de prospects: visões lista/cidade/bairro/rota e escopo por usuário
│   └── indicadores.mjs          SQL dos indicadores (posição e atividade)
├── lib/                         código Node usado pelos scripts (banco, planilhas, importações)
├── scripts/                     linha de comando: migrate, importar-base, importar-eventos, usuarios, planilha fictícia
├── test/                        node --test, SQLite em memória
├── exemplos/base-ficticia.xlsx  planilha 100% fictícia no layout real
└── .github/workflows/           ci.yml, migrar-banco.yml
```

A pasta `web/` (app) entra na F1. Ela vai importar `shared/` diretamente, sem duplicar regra.

## Onde cada regra vive

| Regra | Banco (garantia) | `shared/` (antecipa no formulário/importação) |
|---|---|---|
| Motivo obrigatório em "sem interesse" | CHECK em `contatos` | `validarContato` |
| Data de retorno (opcional) não anterior ao contato | CHECK em `contatos` | `validarContato` |
| Representante não usa rota; vendedor usa | coluna `usuarios.tipo_atuacao` | `shared/carteira.mjs` (visões e colunas) |
| Limite de 2 atendimentos / saída da lista | trigger `trg_contatos_validar` + `vw_prospects.na_lista` | `shared/carteira.mjs` |
| 2 tentativas → sai da fila | trigger `trg_contatos_aplicar` + `parametros` | — |
| Vendedor só registra na própria carteira | trigger `trg_contatos_validar` | filtro das telas |
| CNPJ válido (inclusive alfanumérico) | `length = 14` | `analisarCnpj` |
| Histórico imutável | triggers `*_imutavel_*` | — |
| Baixado congelado | trigger `trg_prospects_congelado` | — |

## Datas e fuso
- Datas de negócio em `AAAA-MM-DD`; instantes em UTC ISO-8601 (`...Z`).
- "Hoje" = dia em `America/Sao_Paulo`. No SQL: `date('now','-3 hours')` (sem horário de verão desde 2019).
- **A data do contato é a do aparelho** (`contatos.data_contato`); o servidor grava `recebido_em` à parte.
