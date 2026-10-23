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
| idem | `ADMIN_SENHA_INICIAL` (mín. 8 caracteres; prefira letras e números) | senha do administrador criado pelo workflow "Criar administrador" (abre o cofre de administração — ADR-0006). **Manter** com a senha atual do administrador: a publicação usa para renovar o cofre sozinha |
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
  -p rotas:data_add,data_update -p rota_paradas:data_add,data_update,data_delete -p liberacoes_credito:data_add \
  -p prospects:data_update -p movimentacoes:data_add
```
Cadastre em GitHub → Settings → Secrets and variables → Actions: **variável** `TURSO_DATABASE_URL` e **secret** `TURSO_APP_TOKEN`.
Se houver `TURSO_API_TOKEN`, o token gerado no Actions tem prioridade sobre o `TURSO_APP_TOKEN`.

**Chave de administração** (NÃO vai para o GitHub nem é colada por ninguém): o workflow **Criar administrador** gera e
tranca no cofre do administrador (ADR-0006); o login abre o cofre com a senha. Em outra aba (ou com o navegador
reaberto), a tela **Confirme sua senha** reabre o cofre — só a senha, nunca token. Permissões da chave (referência):
```bash
turso db tokens create germaniprospec -p all:data_read,data_add,data_update \
  -p feriados:data_delete -p perfil_telas:data_delete -p rota_paradas:data_delete \
  -p prospects_busca:data_delete -p prospects_busca_data:data_delete -p prospects_busca_idx:data_delete -p prospects_busca_docsize:data_delete
```
A chave pode incluir e alterar dados em **todas** as tabelas (nunca estrutura), então tabela nova de migração futura já
fica coberta e a chave **não precisa ser renovada** a cada mudança. O que é somente inclusão (contatos, eventos do ERP,
movimentações, transferências, liberações, auditoria, linhas de importação) continua protegido pelos triggers do banco;
apagar, só onde a regra permite.

**Renovação automática do cofre:** a publicação confere o cofre de cada administrador. Se a chave guardada for de versão
antiga (marca `chave` no cofre, `VERSAO_CHAVE_ADMIN` em shared/cofre.mjs) e a senha do Secret `ADMIN_SENHA_INICIAL` abrir
o cofre, ela gera a chave nova uma única vez e regrava o cofre com a mesma senha (`scripts/renovar-cofres.mjs`, auditoria
`cofre_renovado`). Quem trocou a senha não é tocado: o log mostra um aviso, e basta cadastrar a senha atual nesse Secret
e publicar de novo. Falha nesse passo não impede a publicação.

**O Turso aplica as permissões também às gravações feitas pelos triggers** (confirmado na 1ª importação real:
`SQLITE_AUTH: not authorized`). O token do app (gerado a cada publicação) lista as tabelas que o site grava e as que os
triggers gravam por causa delas: `prospects:data_update` e `movimentacoes:data_add` (o registro de atendimento muda o
status) e `resumo_carteira` (0012).

**Migrações automáticas:** a publicação do site (**Publicar app**, a cada mesclagem na `main`) aplica antes as
migrações pendentes e só depois gera o token do app e publica. Ninguém precisa rodar workflow à mão a cada mudança;
**Migrar banco** e **Criar administrador** ficam só para contingência e para cadastrar administrador novo.
Antes da carga real, conferir os itens "Verificar" do ADR-0001 (escritas feitas pelos triggers, como
`movimentacoes`, podem exigir permissão também).

## 4. Publicar o app (GitHub Pages)

1. Settings → Pages → **Source: GitHub Actions** (uma vez).
2. Actions → **Publicar app (GitHub Pages)** → Run workflow (ou automático a cada push na `main`).
3. **Domínio próprio: https://vendas.svoltagf2.com.br** (2026-10-22). Cloudflare (zona `svoltagf2.com.br`): CNAME
   `vendas` → `equipegf2.github.io`, **Somente DNS** (nuvem cinza — com proxy o GitHub não emite o certificado).
   Settings → Pages → Custom domain = `vendas.svoltagf2.com.br`, **Enforce HTTPS** marcado. Publicação por Actions:
   não há arquivo `CNAME` no repositório. O endereço antigo redireciona; a sessão é por endereço (todos entram de novo
   uma vez). O banco não depende do domínio.
4. Sem `TURSO_APP_TOKEN`, o site sai em **modo demonstração**: banco temporário no navegador, login
   `admin` / `demo1234`, planilha fictícia para testar a carga. Com o token, sai em produção.

Local: `npm run site && npm run servir` → http://localhost:8080 (modo demonstração).

## 5. Aplicar a estrutura do banco

- **Pelo GitHub:** Actions → *Migrar banco (produção)* → *Run workflow* → digitar `MIGRAR`.
  O workflow roda os testes antes e usa os Secrets. (Ele usa o ambiente `producao`; em
  Settings → Environments dá para exigir aprovação manual.)
- **Pela máquina do administrador:** `npm run migrate`.

### 5.1 Primeiro administrador (pelo GitHub, sem máquina local)

1. Settings → Secrets and variables → Actions → *New repository secret*: `ADMIN_SENHA_INICIAL` = senha inicial
   (mín. 8 caracteres; prefira letras e números). O valor nunca aparece no log nem no repositório (que é público).
2. Actions → *Criar administrador* → *Run workflow* → login (ex.: `genaro`), nome completo e `CRIAR`.
   O workflow aplica as migrações pendentes, gera a chave de administração (com o Secret `TURSO_API_TOKEN`) e cria o
   administrador com essa senha, trancando a chave no **cofre** dele (ADR-0006): no site ele entra só com usuário e
   senha — nenhuma tela pede token.
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
| `0005_cofre_admin` | coluna `usuarios.cofre_admin`: chave de administração cifrada com a senha do administrador (ADR-0006) |
| `0006_indices_volume` | índices para ~50 mil CNPJs e índice de texto (FTS5 trigram) da busca — mesmo resultado, menos linhas lidas |
| `0007_indices_complementares` | índices de ligação e de relatório em todas as tabelas (movimentação, transferências, eventos do ERP, crédito, auditoria…) |
| `0008_perfis_telas` | perfis de acesso e telas por perfil (5 perfis do sistema já com as telas de hoje); `usuarios.perfil_id`. Depois dela, rode **Criar administrador** de novo: a chave do cofre passa a poder gravar perfis |
| `0009_perfil_ve_todas_equipes` | `perfis.ve_todos`: perfil de supervisor que vê todas as equipes (ex.: supervisor que também é gerente). Aplicada por **Criar administrador** ou **Migrar banco** |
| `0010_indices_lista_principal` | índices parciais da Lista principal (faixa "sem próxima ação" lida já na ordem, geral e por vendedor). Só índice: nada muda no resultado |
| `0011_indice_painel` | índice do Início (vendedor × status com as datas do funil: agrega lendo só o índice) e do segmento (filtro da Lista principal). Só índice |
| `0012_resumo_carteira` | tabela `resumo_carteira` (resumo pronto, mantido por triggers) e a tela **Explorar carteira** nos perfis do sistema. O token do app passa a ter `resumo_carteira:data_add,data_update` (os triggers gravam nela). Aplicada sozinha na publicação |

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
