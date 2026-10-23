-- 0019 — Erros do app: cada erro que aparece na tela de um usuário fica registrado para o administrador
-- (Administração → Erros do app), com a tela, a versão do site e a mensagem — sem precisar que o usuário anote o código.
-- Somente inclusão. O token do APP precisa de erros_app:data_add (scripts/gerar-token-app.sh); sem ele o registro
-- falha em silêncio e o erro continua aparecendo na tela, com o botão "Copiar detalhes".
CREATE TABLE erros_app (
  id            INTEGER PRIMARY KEY,
  registrado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  usuario_id    INTEGER REFERENCES usuarios(id),
  login         TEXT,
  tela          TEXT,
  versao        TEXT,
  tipo          TEXT,
  mensagem      TEXT NOT NULL CHECK (length(mensagem) <= 1000),
  detalhe       TEXT CHECK (detalhe IS NULL OR length(detalhe) <= 4000),
  navegador     TEXT CHECK (navegador IS NULL OR length(navegador) <= 300),
  online        INTEGER CHECK (online IS NULL OR online IN (0,1))
);
CREATE INDEX ix_erros_app_data ON erros_app (registrado_em);
CREATE TRIGGER trg_erros_app_imutavel_upd BEFORE UPDATE ON erros_app BEGIN SELECT RAISE(ABORT, 'erros_app é somente inclusão'); END;
