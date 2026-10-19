# ADR-0001 — Turso acessado diretamente pelo app no GitHub Pages (sem servidor)

- **Data:** 2026-10-19
- **Situação:** aceita (decisão do dono do sistema)
- **Sistema:** GERMANI

## Contexto

O app precisa de custo de hospedagem próximo de zero e manutenção por uma pessoa. O dono já opera outros
projetos com **frontend estático no GitHub Pages falando direto com o Turso**, sem servidor intermediário
(sem Render), e quer repetir o modelo. O repositório será **público**.

## Decisão

1. **Um único banco Turso de produção** (`germaniprospec`). Não há banco de desenvolvimento no Turso;
   os testes rodam em SQLite em memória e o desenvolvimento local usa um arquivo `file:` (ver docs/06).
2. **Nenhum servidor.** Componentes: GitHub (código, Actions, Pages, Secrets) + Turso.
3. **Regras de negócio no banco** (CHECKs e triggers): quem grava um contato não consegue deixar o
   prospect inconsistente, mesmo sem servidor validando.
4. **Dois tokens, com poderes diferentes** (permissões finas do Turso, `turso db tokens create -p`):

| Token | Onde fica | Permissões |
|---|---|---|
| **Administrativo** | `.env` da máquina do administrador + Secret `TURSO_AUTH_TOKEN` do GitHub (migrações) | total |
| **App** (fase do app) | embutido no site publicado | `all:data_read`, `contatos:data_add`, `transferencias:data_add`, `rotas:data_add,data_update`, `rota_paradas:data_add,data_update,data_delete`, `liberacoes_credito:data_add` (+ o mínimo que os triggers exigirem — ver "Verificar") |

O token do app **não tem** `schema_*` (não derruba trigger), `data_delete` fora de `rota_paradas` (o plano de
rota é editável; o histórico não) nem `data_update` em `usuarios`/`parametros`/`contatos`.

## Consequência que precisa estar clara

> **GitHub Secrets protegem o token dentro do repositório, não dentro do site publicado.**
> Tudo o que o navegador usa para falar com o Turso fica visível para quem abrir o site
> (ferramentas do desenvolvedor do navegador). Com o token do app, essa pessoa consegue:
>
> - **ler** toda a base (prospects, telefones, nomes de vendedores, hashes de senha);
> - **incluir** contatos em nome de qualquer usuário (o `usuario_id` é informado pelo app).
>
> Ela **não** consegue apagar, alterar histórico, mudar parâmetros, mudar senhas nem a estrutura.

O login por representante/vendedor funciona como **controle de uso do app** (cada um vê e registra só a
própria carteira na interface), não como barreira de segurança contra quem tem o token.

### Mitigações adotadas

- Senhas **geradas pelo administrador** (10 caracteres aleatórios, ~58 bits) e guardadas com
  PBKDF2-SHA256 210.000 iterações → quebrar o hash lido do banco é impraticável. Não há senha escolhida
  pelo usuário (seria fraca e exigiria `data_update` em `usuarios` no token do app).
- Triggers validam se o usuário pode registrar naquele prospect (carteira própria / equipe / admin) e se
  o usuário está ativo — desligar um vendedor bloqueia novos registros dele.
- Histórico append-only (UPDATE/DELETE bloqueados por trigger) → nada registrado se perde.
- Rotação: `turso db tokens invalidate` invalida **todos** os tokens do banco; gerar novos (admin e app),
  atualizar o Secret e republicar o site (docs/06-operacao.md).

## Operação 100% pela tela (decisão de 2026-10-19)

O dono decidiu que **nada será feito direto no banco**: carga da base, lista de representantes/vendedores,
arquivos do ERP, baixados, usuários/senhas, parâmetros e liberação de crédito serão feitos **por telas**.
Isso pede um terceiro nível de acesso sem embutir nada perigoso no site público:

| Token | Onde fica | Para quê |
|---|---|---|
| App | embutido no site (permissões restritas acima) | vendedor, representante, supervisor, analista |
| **Administração** | **digitado pelo administrador na tela de administração**, guardado só na memória da sessão daquele navegador — nunca no código, no repositório nem no site | importações, usuários, parâmetros |
| Administrativo total | `.env` do administrador + Secret do GitHub | só migrações de estrutura (workflow) |

O token de administração tem `data_add`/`data_update` nas tabelas de cadastro e importação, mas **não**
`schema_*` nem `data_delete`. A lógica das importações já está em `shared/importar-*.mjs` (sem dependência
de Node), então a tela usa exatamente o mesmo código testado. Os scripts de linha de comando ficam como
contingência.

## Alternativas (registradas para revisão futura)

- **JWKS do Turso + provedor de login** (Clerk/Auth0 gratuitos): cada pessoa recebe um token próprio
  e de curta duração; nada fixo no site. Continua sem servidor, mas adiciona um fornecedor.
- **Função serverless gratuita** (ex.: Cloudflare Workers) entre o app e o Turso: o token sai do
  navegador e o filtro "só a própria carteira" passa a valer de verdade. Um componente a mais.

O banco já foi desenhado para as três opções: o app só faz `SELECT` em views, `INSERT` em `contatos` /
`transferencias` e edita o plano de rotas — trocar o transporte não muda o modelo.

## Verificar antes do app

- [ ] Confirmar se o Turso aplica as permissões finas também às escritas feitas **pelos triggers**
      (atualização de `prospects` e inclusão em `movimentacoes`). Se aplicar, acrescentar ao token do app
      `prospects:data_update` e `movimentacoes:data_add` — e aceitar que o token também consegue
      editar dados cadastrais de `prospects` diretamente.
- [ ] Confirmar que `PRAGMA foreign_keys = ON` vale nas conexões HTTP do Turso.
