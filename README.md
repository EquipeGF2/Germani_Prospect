# GERMANI Prospect

Controle de prospecção de novos clientes da **GERMANI Alimentos**: cada CNPJ que ainda não é cliente vira
um ponto de controle. O representante/vendedor registra os atendimentos; cadastro, pedido e CNPJs
baixados entram por arquivos do ERP Senior; o supervisor acompanha cobertura e conversão.

**Sistema:** GERMANI · **Estado:** ativo · **Fase atual:** F1 partes 1 a 5a prontas (administração; lista principal, acompanhamento e ficha; registro individual e em lote; console de crédito; Início com o dashboard de acompanhamento; gerente comercial; feriados), com menu lateral.

Stack: **Turso (libSQL)** + **GitHub** (Actions, Secrets, Pages). Sem servidor — ver
[ADR-0001](docs/adr/0001-turso-direto-github-pages.md).

## Como rodar (local)

Requisitos: Node.js 22.9+.

```bash
npm ci
npm test                                   # 113 testes, banco SQLite em memória
TURSO_DATABASE_URL=file:dados/local.db npm run migrate
npm run exemplo:planilha                   # gera exemplos/base-ficticia.xlsx (dados fictícios)
TURSO_DATABASE_URL=file:dados/local.db npm run importar:base -- exemplos/base-ficticia.xlsx
```

## App (telas)

```bash
npm run site        # monta _site/ (modo demonstração sem token)
npm run servir      # http://localhost:8080 — login admin / demo1234; no Início, "Carregar dados de exemplo"
npm run test:telas  # testa as telas num Chromium real (fluxo do administrador e do vendedor)
```

Navegação pelo **menu lateral** (grupos Prospecção e Administração; recolhe para só ícones e vira gaveta no celular). Conteúdo em 95% da largura.

| Tela | Quem | O que faz |
|---|---|---|
| `#/inicio` | todos (escopo do perfil) | **dashboard de acompanhamento** — no computador, 3 visualizações à escolha (Executivo · Arrojado · Equipe) e filtro por período; no celular, cartões |
| `#/carteira` | todos (escopo do perfil) | **lista principal** (não contactado / em prospecção): visões lista · cidade · bairro · onda · rota (só vendedor), busca sem acento, filtros, seleção para lote |
| `#/carteira?aba=acompanhamento` | todos | **acompanhamento**: cartões por status → lista do status |
| `#/ficha?id=` | todos | situação, dias corridos, prazos, crédito, **histórico de movimentação**, cadastro, ligar / WhatsApp / mapa |
| `#/registrar?id=` | vendedor, supervisor, admin | Atendido · Sem interesse (motivo) · Reabrir com pedido identificado |
| `#/lote` | vendedor, supervisor, admin | sem interesse em lote (motivo do lote e/ou por cliente) |
| `#/financeiro` | analista financeiro, admin | **console de crédito**: em análise × liberados, liberar ou corrigir (forma, prazo, limite, restrição) |
| `#/admin/feriados` | administrador | feriados que saem dos dias úteis da campanha |
| `#/admin/...` | administrador | importações, usuários, parâmetros (token de administração) |

Publicação: workflow **Publicar app (GitHub Pages)** — ver [docs/06-operacao.md](docs/06-operacao.md) §3–4.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://...` (produção) ou `file:dados/local.db` (local) |
| `TURSO_AUTH_TOKEN` | token administrativo do Turso (só `.env` e GitHub Secrets) |
| `GERMANI_EXECUTADO_POR` | nome gravado nas importações e na auditoria (scripts) |
| `TURSO_APP_TOKEN` | token do **app** (montagem do site; permissões restritas) |
| `GERMANI_MODO` | `producao` ou `demonstracao` (padrão: produção se houver token do app) |

Copie `.env.example` para `.env`. O `.env` nunca vai para o Git. No GitHub: Settings → Secrets and
variables → Actions → `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`. Detalhes em [docs/06-operacao.md](docs/06-operacao.md).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run migrate` | aplica `db/migrations/*.sql` (também pelo workflow *Migrar banco (produção)*) |
| `npm run importar:base -- arq.xlsx [--listar-status] [--simular] [--com-datas\|--sem-datas]` | carga inicial da planilha base (datas DT 1o/2o: consideradas só se preenchidas, ou conforme a opção) |
| `npm run importar:eventos -- --tipo cadastro\|pedido\|baixa arq [--col-...] [--simular]` | arquivos do ERP e CNPJs baixados |
| `npm run importar:tipos -- arq.xlsx [--col-codigo COD] [--col-tipo TIPO] [--simular]` | lista de quem é representante e quem é vendedor |
| `npm run importar:credito -- arq.xlsx [--simular]` | relatório de crédito (forma, prazo, limite) → Aguardando pedido |
| `npm run usuarios -- listar \| criar-admin \| senha \| desativar \| ativar` | usuários e senhas provisórias |
| `npm run exemplo:planilha` | planilha fictícia no layout real |

Como importar as planilhas: [docs/05-importacao.md](docs/05-importacao.md).

## Deploy
- **Banco:** Actions → *Migrar banco (produção)* → digitar `MIGRAR`.
- **App:** Actions → *Publicar app (GitHub Pages)*; sem token do app, publica em modo demonstração.

## Documentação
[Visão geral](docs/00-visao-geral.md) · [Arquitetura](docs/01-arquitetura.md) ·
[Modelo de dados](docs/02-modelo-dados.md) · [Regras e indicadores](docs/03-regras-negocio.md) ·
[Acesso a dados do app](docs/04-acesso-dados.md) · [Importações](docs/05-importacao.md) ·
[Operação](docs/06-operacao.md) · [Pendências](docs/07-pendencias.md) · [Fluxo do processo](docs/08-fluxo-processo.md) · [ADRs](docs/adr/)

## Regras que nunca podem ser quebradas
- Repositório **público**: nenhuma planilha real, relatório, `.env` ou token no Git.
- Histórico só cresce: correção = novo registro. Migração aplicada nunca é editada.
- Nada é descartado em silêncio: toda linha importada fica em `importacao_linhas`.
