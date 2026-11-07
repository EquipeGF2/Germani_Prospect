-- 0035 — E-mail diário de avisos.  docs/03 §18 · scripts/enviar-avisos.mjs · .github/workflows/avisos-email.yml
--   * usuarios.email e usuarios.avisos_email: supervisor, gerente e administrador escolhem receber o e-mail (Administração ›
--     Usuários). O supervisor recebe o PDF da equipe dele; gerente, administrador e supervisor que vê todas as equipes, um
--     anexo por supervisor.
--   * parâmetro avisos_email_copia: e-mails em cópia do e-mail da gerência (ex.: a consultoria), separados por ";".
ALTER TABLE usuarios ADD COLUMN email TEXT;
ALTER TABLE usuarios ADD COLUMN avisos_email INTEGER NOT NULL DEFAULT 0 CHECK (avisos_email IN (0,1));

CREATE TRIGGER trg_usuarios_avisos_email
BEFORE UPDATE OF email, avisos_email ON usuarios
BEGIN
  SELECT RAISE(ABORT, 'receber avisos por e-mail exige o e-mail')
  WHERE NEW.avisos_email = 1 AND COALESCE(trim(NEW.email), '') = '';
  SELECT RAISE(ABORT, 'e-mail inválido')
  WHERE COALESCE(trim(NEW.email), '') <> '' AND NEW.email NOT GLOB '?*@?*.?*';
  SELECT RAISE(ABORT, 'avisos por e-mail são para supervisor, gerente e administrador')
  WHERE NEW.avisos_email = 1 AND NEW.perfil NOT IN ('supervisor', 'gerente', 'administrador');
END;

-- quem recebe: lido uma vez por dia pela rotina
CREATE INDEX IF NOT EXISTS ix_usuarios_avisos_email ON usuarios (perfil) WHERE avisos_email = 1;

INSERT OR IGNORE INTO parametros (chave, valor, tipo, descricao) VALUES
  ('avisos_email_copia', '', 'texto', 'E-mails em cópia do e-mail diário de avisos da gerência (ex.: a consultoria), separados por ";"');
