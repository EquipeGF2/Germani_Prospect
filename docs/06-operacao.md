# 06 — Operação: Turso, GitHub, segredos

## 1. Criar o banco (uma vez)

Com a CLI do Turso (`turso auth login` antes):

```bash
turso db create germani-prospect            # escolha a região mais próxima do RS disponível na conta
turso db show germani-prospect --url        # → TURSO_DATABASE_URL (libsql://...)
turso db tokens create germani-prospect     # → TURSO_AUTH_TOKEN administrativo (acesso total)
```

Guarde o token administrativo num gerenciador de senhas. Ele **nunca** vai para arquivo versionado.

## 2. Credenciais

| Onde | Variáveis | Uso |
|---|---|---|
| `.env` na máquina do administrador (copiar de `.env.example`) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GERMANI_EXECUTADO_POR` | importações, usuários, migração manual |
| GitHub → Settings → Secrets and variables → **Actions** → *Repository secrets* | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | workflow "Migrar banco (produção)" |
| Site publicado (F1) | token **do app**, com permissões restritas | ver ADR-0001 — é visível para quem abre o site |

> **Atenção:** um Secret do GitHub injetado na publicação do Pages acaba dentro do JavaScript público.
> Por isso o site usa **outro** token, com permissões finas, e nunca o administrativo.

Token do app (gerar na F1, depois de concluir os itens "Verificar" do ADR-0001):
```bash
turso db tokens create germani-prospect -p all:data_read -p contatos:data_add -p transferencias:data_add
```

## 3. Aplicar a estrutura do banco

- **Pelo GitHub:** Actions → *Migrar banco (produção)* → *Run workflow* → digitar `MIGRAR`.
  O workflow roda os testes antes e usa os Secrets. (Ele usa o ambiente `producao`; em
  Settings → Environments dá para exigir aprovação manual.)
- **Pela máquina do administrador:** `npm run migrate`.

Migração aplicada nunca é editada: o `migrate` compara o SHA-256 e para se o arquivo mudou.
Mudança de estrutura = novo arquivo `db/migrations/0002_....sql`.

## 4. Primeira carga — roteiro

```bash
npm ci
cp .env.example .env                                 # preencher
npm run migrate
npm run importar:base -- base.xlsx --listar-status   # completar config/mapa-status-planilha.json
npm run importar:base -- base.xlsx --simular         # conferir relatorios/*.csv
npm run importar:base -- base.xlsx
npm run importar:tipos -- tipos.xlsx                 # quem é representante e quem é vendedor
npm run usuarios -- criar-admin genaro "Genaro de Freitas Forratti"
npm run usuarios -- listar
npm run usuarios -- senha 1101                       # para cada vendedor/supervisor que vai usar o app
```

As senhas são geradas aleatoriamente e mostradas **uma vez**; entregue-as por canal privado.

## 5. Desenvolvimento local sem tocar a produção
```bash
TURSO_DATABASE_URL=file:dados/local.db npm run migrate
npm run exemplo:planilha
TURSO_DATABASE_URL=file:dados/local.db npm run importar:base -- exemplos/base-ficticia.xlsx
```
`dados/` está no `.gitignore`. Os testes (`npm test`) usam banco em memória.

## 6. Backup
- Verificar no painel do Turso o restore pontual disponível no plano contratado.
- Cópia manual: `turso db shell germani-prospect .dump > backup-AAAA-MM-DD.sql` — guardar fora do
  repositório (contém dados pessoais).

## 7. Rotação de credenciais (saída de alguém, suspeita de vazamento)
1. `turso db tokens invalidate germani-prospect` — invalida **todos** os tokens do banco.
2. Gerar novo token administrativo e novo token do app.
3. Atualizar o `.env` e o Secret `TURSO_AUTH_TOKEN`; republicar o site com o novo token do app.
4. Desativar o usuário que saiu: `npm run usuarios -- desativar <login>`.
