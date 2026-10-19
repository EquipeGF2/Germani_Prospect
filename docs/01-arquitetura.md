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

Decisão e riscos: [ADR-0001](adr/0001-turso-direto-github-pages.md). Sem cálculo de distância: [ADR-0005](adr/0005-sem-calculo-de-distancia.md).

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
│   ├── importar-base.mjs        carga da base no banco (usada pela tela e pelo script)
│   ├── importar-eventos.mjs     cadastro / pedidos / baixados
│   ├── importar-tipos.mjs       lista de representantes e vendedores
│   ├── gravacao.mjs             gravação em lotes com isolamento de erro
│   ├── carteira.mjs             lista principal e acompanhamento: visões lista/cidade/bairro/status/rota
│   ├── financeiro.mjs           console do analista: fila de análise e liberação de crédito
│   ├── rotas.mjs                montagem de rotas do vendedor (ordem sugerida sem distância, link do mapa)
│   └── indicadores.mjs          SQL dos indicadores (posição e atividade)
├── lib/                         código só de Node usado pelos scripts (conexão, leitura de planilha, relatório CSV)
├── scripts/                     linha de comando: migrate, importar-base, importar-eventos, usuarios, planilha fictícia
├── test/                        node --test, SQLite em memória
├── exemplos/base-ficticia.xlsx  planilha 100% fictícia no layout real
└── .github/workflows/           ci.yml, migrar-banco.yml
```

### App (`web/`)
```
web/
├── index.html · css/app.css      casca e estilo (paleta do mockup, botões ≥ 44 px, mobile primeiro)
├── js/app.js                     roteador por hash (#/caminho) e controle de perfil
├── js/menu.js                    casca: menu lateral por perfil (recolher/expandir, gaveta no celular), caminho da página
├── js/db.js                      conexões: token do app (embutido) · token de administração (digitado) · demonstração
├── js/sessao.js · js/ui.js       login e utilitários de tela (texto sempre por textContent)
├── js/arquivo.js                 leitura do arquivo escolhido (shared/planilha.mjs)
└── js/telas/                     uma tela por arquivo; importam shared/ diretamente
    ├── entrar · inicio
    ├── carteira.js               lista principal + acompanhamento (shared/carteira.mjs)
    ├── ficha.js                  ficha + linha do tempo (vw_movimentacoes)
    ├── registrar.js              registro individual (shared/registro.mjs)
    ├── lote.js                   sem interesse em lote (shared/lote.mjs)
    ├── financeiro.js             console de crédito (shared/financeiro.mjs)
    ├── financeiro-liberar.js     liberar / corrigir crédito
    ├── _carteira.js              selo de status, seleção do lote (sessionStorage)
    ├── inicio.js                 dashboard de acompanhamento (shared/painel.mjs)
    └── admin-*.js                administração (token de administração), inclusive admin-feriados.js
```
`npm run site` monta `_site/` (web + shared + migrations + bibliotecas do navegador empacotadas com esbuild,
versões travadas no package-lock). `test-telas/` testa as telas num Chromium real, em modo demonstração.

## Onde cada regra vive

| Regra | Banco (garantia) | `shared/` (antecipa no formulário/importação) |
|---|---|---|
| Motivo obrigatório em "sem interesse" | CHECK em `contatos` | `validarContato` |
| Data de retorno (opcional) não anterior ao contato | CHECK em `contatos` | `validarContato` |
| Representante não usa rota; vendedor usa | coluna `usuarios.tipo_atuacao` + trigger `trg_rotas_somente_vendedor` | `shared/carteira.mjs`, `shared/rotas.mjs` |
| Rota encerrada travada; parada só da própria carteira | triggers `trg_rotas_*`, `trg_rota_paradas_*` | — |
| Saída da lista (Aguardando cadastro, 2 sem interesse, ERP) sem sair dos indicadores | `status.lista_trabalho` + `vw_prospects.na_lista` | `shared/carteira.mjs` |
| 2 atendimentos sem interesse → Sem interesse | trigger `trg_contatos_aplicar` + `parametros` | — |
| Vendedor só registra na própria carteira | trigger `trg_contatos_validar` | filtro das telas |
| CNPJ válido (inclusive alfanumérico) | `length = 14` | `analisarCnpj` |
| Histórico imutável | triggers `*_imutavel_*` | — |
| Baixado congelado | trigger `trg_prospects_congelado` | — |

## Datas e fuso
- Datas de negócio em `AAAA-MM-DD`; instantes em UTC ISO-8601 (`...Z`).
- "Hoje" = dia em `America/Sao_Paulo`. No SQL: `date('now','-3 hours')` (sem horário de verão desde 2019).
- **A data do contato é a do aparelho** (`contatos.data_contato`); o servidor grava `recebido_em` à parte.
