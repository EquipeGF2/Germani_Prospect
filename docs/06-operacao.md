# 06 — Operação: Turso, GitHub, segredos

## 1. Criar o banco (uma vez)

Com a CLI do Turso (`turso auth login` antes):

```bash
turso db create germaniprospec              # (já criado em 2026-10-19)
turso db show germaniprospec --url        # → TURSO_DATABASE_URL (libsql://...)
turso db tokens create germaniprospec     # → TURSO_AUTH_TOKEN administrativo (acesso total)
```

Guarde o token administrativo num gerenciador de senhas. Ele **nunca** vai para arquivo versionado.

## 2. Credenciais

| Onde | Variáveis | Uso |
|---|---|---|
| `.env` na máquina do administrador (copiar de `.env.example`) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GERMANI_EXECUTADO_POR` | importações, usuários, migração manual |
| GitHub → Settings → Secrets and variables → **Actions** → *Repository secrets* | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | workflows "Migrar banco (produção)" e "Criar administrador" |
| idem | `ADMIN_SENHA_INICIAL` (mín. 8 caracteres) | senha do administrador criado pelo workflow "Criar administrador"; pode ser apagado depois |
| Site publicado (F1) | token **do app**, com permissões restritas | ver ADR-0001 — é visível para quem abre o site |

> **Atenção:** um Secret do GitHub injetado na publicação do Pages acaba dentro do JavaScript público.
> Por isso o site usa **outro** token, com permissões finas, e nunca o administrativo.

Os comandos dos tokens do app e de administração estão na seção 3.

## 3. Tokens: app e administração

**Token do app — jeito 100% web (recomendado):** o GitHub gera o token a cada publicação; ninguém instala o Turso CLI.
1. Painel web do Turso (app.turso.tech) → *Settings* → **API Tokens** → *Create* → copie a chave.
2. GitHub → Settings → Secrets and variables → Actions: **secret** `TURSO_API_TOKEN` = essa chave e **variável**
   `TURSO_DATABASE_URL` = endereço do banco (opcional: variável `TURSO_DB_NAME`, padrão `germaniprospec`).
3. Actions → *Publicar app (GitHub Pages)* → *Run workflow*.

O workflow roda `scripts/gerar-token-app.sh` (Turso CLI no próprio Actions, com as permissões abaixo e validade de
90 dias), mascara o token no log e o embute no site. O site é republicado toda segunda-feira, renovando o token.
A chave de API é poderosa (administra a conta do Turso): fica só no Secret, nunca no site.

**Token do app — à mão** (alternativa, com o Turso CLI no computador):
```bash
turso db tokens create germaniprospec -p all:data_read -p contatos:data_add -p transferencias:data_add \
  -p rotas:data_add,data_update -p rota_paradas:data_add,data_update,data_delete -p liberacoes_credito:data_add
```
Cadastre em GitHub → Settings → Secrets and variables → Actions: **variável** `TURSO_DATABASE_URL` e **secret** `TURSO_APP_TOKEN`.
Se houver `TURSO_API_TOKEN`, o token gerado no Actions tem prioridade sobre o `TURSO_APP_TOKEN`.

**Token de administração** (NÃO vai para o GitHub: o administrador cola na tela "Acesso de administração",
e ele fica só naquela aba do navegador):
```bash
turso db tokens create germaniprospec -p all:data_read \
  -p prospects:data_add,data_update -p usuarios:data_add,data_update -p parametros:data_update \
  -p importacoes:data_add,data_update -p importacao_linhas:data_add -p contatos:data_add \
  -p eventos_erp:data_add -p auditoria:data_add -p liberacoes_credito:data_add -p transferencias:data_add \
  -p feriados:data_add,data_delete
```
A permissão `feriados` entrou com a migração 0002 (tela Feriados): quem gerou o token de administração antes
precisa gerar um novo com o comando acima.
Antes da carga real, conferir os itens "Verificar" do ADR-0001 (escritas feitas pelos triggers, como
`movimentacoes`, podem exigir permissão também).

## 4. Publicar o app (GitHub Pages)

1. Settings → Pages → **Source: GitHub Actions** (uma vez).
2. Actions → **Publicar app (GitHub Pages)** → Run workflow (ou automático a cada push na `main`).
3. Sem `TURSO_APP_TOKEN`, o site sai em **modo demonstração**: banco temporário no navegador, login
   `admin` / `demo1234`, planilha fictícia para testar a carga. Com o token, sai em produção.

Local: `npm run site && npm run servir` → http://localhost:8080 (modo demonstração).

## 5. Aplicar a estrutura do banco

- **Pelo GitHub:** Actions → *Migrar banco (produção)* → *Run workflow* → digitar `MIGRAR`.
  O workflow roda os testes antes e usa os Secrets. (Ele usa o ambiente `producao`; em
  Settings → Environments dá para exigir aprovação manual.)
- **Pela máquina do administrador:** `npm run migrate`.

### 5.1 Primeiro administrador (pelo GitHub, sem máquina local)

1. Settings → Secrets and variables → Actions → *New repository secret*: `ADMIN_SENHA_INICIAL` = senha inicial
   (mín. 8 caracteres). O valor nunca aparece no log nem no repositório (que é público).
2. Actions → *Criar administrador* → *Run workflow* → login (ex.: `genaro`), nome completo e `CRIAR`.
   O workflow aplica as migrações pendentes e cria o administrador com essa senha.
3. Entrar no site com o login e a senha. Para mudar a senha depois: Administração → Usuários → *Definir senha*.
4. (Opcional) apagar o Secret `ADMIN_SENHA_INICIAL`. Rodar de novo com o mesmo login **redefine a senha** com a do Secret
   (e reativa o usuário).

O último passo do workflow, **"Conferir o login como o site faz"**, entra no banco com a mesma URL e o mesmo token do site
(variável `TURSO_DATABASE_URL` + secret `TURSO_APP_TOKEN`) e mostra OK/ERRO para: site fora do modo demonstração, site e
workflows no mesmo banco, usuário encontrado pelo token do app e senha conferindo. Nunca imprime senha nem token.

Migração aplicada nunca é editada: o `migrate` compara o SHA-256 e para se o arquivo mudou.
Mudança de estrutura = novo arquivo `db/migrations/NNNN_....sql`. **Depois de cada merge que traz migração nova,
rodar o workflow de novo** (ele só aplica as que faltam).

| Migração | O que traz |
|---|---|
| `0001_inicial` | estrutura completa |
| `0002_gerente_feriados_painel` | perfil gerente comercial, tabela `feriados`, parâmetros do painel (início da campanha, % do pipeline, valor por cliente) |
| `0003_feriados_automaticos` | nacionais passam a ser calculados (saem da tabela); coluna `recorrente` (repete todo ano) |
| `0004_valor_pedido` | coluna `eventos_erp.valor` (valor do pedido, opcional) para o "Valor dos pedidos" do Início |

## 6. Primeira carga — roteiro

> **Definitivo: a carga é feita pela tela de administração** (Administração → Base de prospects →
> Representantes/vendedores → Usuários). O roteiro abaixo é a contingência por linha de comando, na mesma ordem.

```bash
npm ci
cp .env.example .env                                 # preencher
npm run migrate
npm run importar:base -- base.xlsx --listar-status   # completar config/mapa-status-planilha.json
npm run importar:base -- base.xlsx --simular         # conferir relatorios/*.csv
npm run importar:base -- base.xlsx
npm run importar:tipos -- tipos.xlsx                 # quem é representante e quem é vendedor
npm run usuarios -- criar-admin genaro "Genaro de Freitas Forratti"
npm run usuarios -- criar-financeiro analista "Nome do analista"   # console de crédito
npm run usuarios -- listar
npm run usuarios -- senha 1101                       # para cada vendedor/supervisor que vai usar o app
```

Pela tela (Administração → Usuários) o administrador **define a senha de cada usuário** (mín. 8 caracteres) — no cadastro
do novo usuário ou em *Definir senha* / *Liberar acesso* na lista; "Gerar" cria uma aleatória, mostrada **uma vez**.
Pela linha de comando as senhas são geradas aleatoriamente. Entregue-as por canal privado.

## 7. Desenvolvimento local sem tocar a produção
```bash
TURSO_DATABASE_URL=file:dados/local.db npm run migrate
npm run exemplo:planilha
TURSO_DATABASE_URL=file:dados/local.db npm run importar:base -- exemplos/base-ficticia.xlsx
```
`dados/` está no `.gitignore`. Os testes (`npm test`) usam banco em memória.

## 8. Backup
- Verificar no painel do Turso o restore pontual disponível no plano contratado.
- Cópia manual: `turso db shell germaniprospec .dump > backup-AAAA-MM-DD.sql` — guardar fora do
  repositório (contém dados pessoais).

## 9. Rotação de credenciais (saída de alguém, suspeita de vazamento)
1. `turso db tokens invalidate germaniprospec` — invalida **todos** os tokens do banco.
2. Gerar novo token administrativo e novo token do app.
3. Atualizar o `.env` e o Secret `TURSO_AUTH_TOKEN`; republicar o site com o novo token do app.
4. Desativar o usuário que saiu: `npm run usuarios -- desativar <login>`.

## Logotipo

O site usa o arquivo `web/logo-germani.jpg` (se existir) no topo do menu (em placa branca; menu recolhido = sigla "G")
e na tela de entrada. Sem o arquivo, fica a marca em texto. Para trocar: substituir o arquivo (JPG ou mesma extensão) e publicar.
