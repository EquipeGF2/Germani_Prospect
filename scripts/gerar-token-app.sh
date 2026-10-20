#!/usr/bin/env bash
# Gera o token do APP (permissões restritas — ADR-0001) direto no GitHub Actions, sem ninguém rodar o Turso CLI no
# computador. Precisa do Secret TURSO_API_TOKEN (chave de API criada no painel web do Turso: Settings → API Tokens).
# Sem TURSO_API_TOKEN não faz nada (o workflow usa o Secret TURSO_APP_TOKEN, se houver).
# O token gerado nunca aparece no log (::add-mask::) e vai só para o ambiente dos próximos passos (TURSO_APP_TOKEN).
set -euo pipefail
if [ -z "${TURSO_API_TOKEN:-}" ]; then
  echo "TURSO_API_TOKEN não cadastrado: usando o Secret TURSO_APP_TOKEN."
  exit 0
fi
BANCO="${TURSO_DB_NAME:-germaniprospec}"
# chave colada com espaço ou quebra de linha: considera só o texto
TURSO_API_TOKEN="$(printf '%s' "$TURSO_API_TOKEN" | tr -d '[:space:]')"
export TURSO_API_TOKEN
# token de BANCO (botão "Generate token" dentro do banco) no lugar da chave de API da CONTA: o miolo do JWT traz "a" (rw/ro)
MIOLO="$(printf '%s' "$TURSO_API_TOKEN" | cut -d. -f2 | tr '_-' '/+')"
while [ $(( ${#MIOLO} % 4 )) -ne 0 ]; do MIOLO="$MIOLO="; done
if printf '%s' "$MIOLO" | base64 -d 2>/dev/null | grep -q '"a":"r[ow]"'; then
  echo "::error::O Secret TURSO_API_TOKEN contém um token de BANCO (do botão 'Generate token' do banco). Ele precisa ser a chave de API da CONTA: app.turso.tech → Settings (conta/organização) → API Tokens → Create."
  exit 1
fi
curl -sSfL https://get.tur.so/install.sh | bash >/dev/null
export PATH="$HOME/.turso:$PATH"
# validade de 90 dias; o site é republicado toda semana (agenda no pages.yml), então sempre há um token novo
if ! turso db list >/dev/null 2>&1; then
  echo "::error::O Turso recusou a chave do Secret TURSO_API_TOKEN (inválida, revogada ou de outra conta). Crie uma nova em app.turso.tech → Settings → API Tokens → Create e cole só a chave no Secret."
  exit 1
fi
TOKEN="$(turso db tokens create "$BANCO" --expiration 90d \
  -p all:data_read -p contatos:data_add -p transferencias:data_add \
  -p rotas:data_add,data_update -p rota_paradas:data_add,data_update,data_delete -p liberacoes_credito:data_add | tr -d '[:space:]')"
case "$TOKEN" in
  eyJ*) ;;
  *) echo "::error::O Turso não devolveu um token para o banco $BANCO (confira o Secret TURSO_API_TOKEN e o nome do banco)."; exit 1 ;;
esac
echo "::add-mask::$TOKEN"
echo "TURSO_APP_TOKEN_GERADO=$TOKEN" >> "$GITHUB_ENV"
echo "Token do app gerado para o banco $BANCO (válido por 90 dias)."
