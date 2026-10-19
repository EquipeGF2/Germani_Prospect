# GERMANI Prospect

Controle de prospecção de novos clientes da **GERMANI Alimentos**: cada CNPJ que ainda não é cliente vira
um ponto de controle. O representante/vendedor registra os atendimentos; cadastro, pedido e CNPJs
baixados entram por arquivos do ERP Senior; o supervisor acompanha cobertura e conversão.

**Sistema:** GERMANI · **Estado:** ativo · **Fase atual:** backend (banco, regras, importações) — o app vem na F1.

Stack: **Turso (libSQL)** + **GitHub** (Actions, Secrets, Pages). Sem servidor — ver
[ADR-0001](docs/adr/0001-turso-direto-github-pages.md).

## Como rodar (local)

Requisitos: Node.js 22.9+.

```bash
npm ci
npm test                                   # 86 testes, banco SQLite em memória
TURSO_DATABASE_URL=file:dados/local.db npm run migrate
npm run exemplo:planilha                   # gera exemplos/base-ficticia.xlsx (dados fictícios)
TURSO_DATABASE_URL=file:dados/local.db npm run importar:base -- exemplos/base-ficticia.xlsx
```

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://...` (produção) ou `file:dados/local.db` (local) |
| `TURSO_AUTH_TOKEN` | token administrativo do Turso (só `.env` e GitHub Secrets) |
| `GERMANI_EXECUTADO_POR` | nome gravado nas importações e na auditoria |

Copie `.env.example` para `.env`. O `.env` nunca vai para o Git. No GitHub: Settings → Secrets and
variables → Actions → `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`. Detalhes em [docs/06-operacao.md](docs/06-operacao.md).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run migrate` | aplica `db/migrations/*.sql` (também pelo workflow *Migrar banco (produção)*) |
| `npm run importar:base -- arq.xlsx [--listar-status] [--simular]` | carga inicial da planilha base |
| `npm run importar:eventos -- --tipo cadastro\|pedido\|baixa arq [--col-...] [--simular]` | arquivos do ERP e CNPJs baixados |
| `npm run importar:tipos -- arq.xlsx [--col-codigo COD] [--col-tipo TIPO] [--simular]` | lista de quem é representante e quem é vendedor |
| `npm run usuarios -- listar \| criar-admin \| senha \| desativar \| ativar` | usuários e senhas provisórias |
| `npm run exemplo:planilha` | planilha fictícia no layout real |

Como importar as planilhas: [docs/05-importacao.md](docs/05-importacao.md).

## Deploy
- **Banco:** Actions → *Migrar banco (produção)* → digitar `MIGRAR`.
- **App (F1):** GitHub Pages a partir de `web/` — a definir junto com o token do app (ADR-0001).

## Documentação
[Visão geral](docs/00-visao-geral.md) · [Arquitetura](docs/01-arquitetura.md) ·
[Modelo de dados](docs/02-modelo-dados.md) · [Regras e indicadores](docs/03-regras-negocio.md) ·
[Acesso a dados do app](docs/04-acesso-dados.md) · [Importações](docs/05-importacao.md) ·
[Operação](docs/06-operacao.md) · [Pendências](docs/07-pendencias.md) · [Fluxo do processo](docs/08-fluxo-processo.md) · [ADRs](docs/adr/)

## Regras que nunca podem ser quebradas
- Repositório **público**: nenhuma planilha real, relatório, `.env` ou token no Git.
- Histórico só cresce: correção = novo registro. Migração aplicada nunca é editada.
- Nada é descartado em silêncio: toda linha importada fica em `importacao_linhas`.
