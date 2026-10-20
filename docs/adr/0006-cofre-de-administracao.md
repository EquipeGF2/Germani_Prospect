# ADR-0006 — Cofre de administração: o administrador entra só com usuário e senha

- **Data:** 2026-10-20
- **Situação:** aceita (decisão do dono do sistema: "não precisa de token, basta bater usuário e senha")
- **Sistema:** GERMANI

## Contexto

Pelo ADR-0001 o site fala direto com o Turso. O token do app (público, embutido no site) só lê e registra
atendimentos; as telas de administração precisavam de um token mais forte, que o administrador **colava na tela**.
O dono não quer token nenhum: o perfil do usuário deve bastar. Pôr permissão de escrita no token público deixaria
qualquer pessoa que abrir o site criar administradores, trocar senhas e alterar a base.

## Decisão

1. A **chave de administração** (token do Turso com as permissões da docs/06 §3, sem estrutura) fica gravada em
   `usuarios.cofre_admin` (migração 0005) **cifrada com a senha do próprio administrador**: AES-GCM 256, chave
   derivada por PBKDF2-SHA256 (600 mil iterações, sal próprio) — `shared/cofre.mjs`.
2. **Login** (`web/js/sessao.js`): senha conferida → se o perfil é administrador e há cofre, a mesma senha abre o
   cofre e a chave fica só na aba (sessionStorage). Nenhuma tela pede token.
3. **Primeiro administrador:** o workflow "Criar administrador" gera a chave com a chave de API do Turso
   (`scripts/gerar-token-app.sh admin`) e a tranca com a senha do Secret `ADMIN_SENHA_INICIAL`.
4. **Outros administradores:** quem já está logado como administrador tranca a chave aberta na aba com a senha do
   novo administrador (tela Usuários — criar ou definir senha).
5. **Trocar a senha** regrava o cofre com a nova senha; sem a chave à mão, o cofre é **apagado** (nunca sobra um
   cofre que abre com a senha antiga). Só o perfil administrador recebe cofre.
6. **Senha de administrador:** ao menos **8 caracteres** (decisão do dono em 2026-10-20; a proposta era 12 com letras e
   números). Risco aceito: o hash de login é legível com o token
   do app (ADR-0001) e serve de ponto de ataque por força bruta; senha curta abriria o cofre.

## Consequências

- O administrador entra só com usuário e senha. Quem lê o banco com o token do app vê só texto cifrado.
- A segurança da administração = força da senha dos administradores. Senha fraca é recusada.
- A tela "Acesso de administração" (colar token) continua como contingência (ex.: administrador sem cofre).
- Para revogar tudo: `turso db tokens invalidate germaniprospec` (invalida todas as chaves), rodar "Criar administrador"
  de novo (novo cofre) e republicar o site (novo token do app).
