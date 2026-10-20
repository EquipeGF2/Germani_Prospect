-- 0008 — Perfis de acesso e telas por perfil.  docs/03 §11 · shared/perfis.mjs
-- Cada perfil tem um TIPO-BASE (o perfil técnico de usuarios.perfil: decide o escopo dos dados e as regras do banco) e a
-- lista de TELAS que acessa. Os cinco perfis do sistema já vêm cadastrados; o administrador cria outros na tela Usuários
-- → Perfis. usuarios.perfil_id NULL = perfil do sistema do mesmo tipo-base.

CREATE TABLE perfis (
  id            INTEGER PRIMARY KEY,
  nome          TEXT NOT NULL UNIQUE,
  base          TEXT NOT NULL CHECK (base IN ('administrador','gerente','supervisor','vendedor','financeiro')),
  sistema       INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0,1)),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- um único perfil do sistema por tipo-base
CREATE UNIQUE INDEX ux_perfis_sistema ON perfis (base) WHERE sistema = 1;
CREATE INDEX ix_perfis_base ON perfis (base);

CREATE TABLE perfil_telas (
  perfil_id INTEGER NOT NULL REFERENCES perfis(id),
  tela      TEXT NOT NULL,
  PRIMARY KEY (perfil_id, tela)
) WITHOUT ROWID;

INSERT INTO perfis (nome, base, sistema) VALUES
  ('Administrador', 'administrador', 1), ('Gerente comercial', 'gerente', 1), ('Supervisor', 'supervisor', 1),
  ('Vendedor / representante', 'vendedor', 1), ('Analista financeiro', 'financeiro', 1);

-- telas iniciais = o que cada perfil já acessava (financeiro: só a análise de crédito)
INSERT INTO perfil_telas (perfil_id, tela)
SELECT p.id, t.tela FROM perfis p JOIN (
  SELECT 'administrador' AS base, 'inicio' AS tela UNION ALL SELECT 'administrador', 'lista' UNION ALL SELECT 'administrador', 'acompanhamento'
  UNION ALL SELECT 'administrador', 'registrar' UNION ALL SELECT 'administrador', 'credito' UNION ALL SELECT 'administrador', 'admin_base'
  UNION ALL SELECT 'administrador', 'admin_tipos' UNION ALL SELECT 'administrador', 'admin_erp' UNION ALL SELECT 'administrador', 'admin_credito'
  UNION ALL SELECT 'administrador', 'admin_importacoes' UNION ALL SELECT 'administrador', 'admin_usuarios' UNION ALL SELECT 'administrador', 'admin_parametros'
  UNION ALL SELECT 'administrador', 'admin_feriados'
  UNION ALL SELECT 'gerente', 'inicio' UNION ALL SELECT 'gerente', 'lista' UNION ALL SELECT 'gerente', 'acompanhamento' UNION ALL SELECT 'gerente', 'registrar'
  UNION ALL SELECT 'supervisor', 'inicio' UNION ALL SELECT 'supervisor', 'lista' UNION ALL SELECT 'supervisor', 'acompanhamento' UNION ALL SELECT 'supervisor', 'registrar'
  UNION ALL SELECT 'vendedor', 'inicio' UNION ALL SELECT 'vendedor', 'lista' UNION ALL SELECT 'vendedor', 'acompanhamento' UNION ALL SELECT 'vendedor', 'registrar'
  UNION ALL SELECT 'financeiro', 'credito'
) t ON t.base = p.base WHERE p.sistema = 1;

-- o Administrador do sistema nunca perde telas (sem restrição)
CREATE TRIGGER trg_perfil_telas_admin_fixo
BEFORE DELETE ON perfil_telas
WHEN (SELECT sistema = 1 AND base = 'administrador' FROM perfis WHERE id = OLD.perfil_id)
BEGIN
  SELECT RAISE(ABORT, 'o perfil Administrador tem sempre todas as telas');
END;
CREATE TRIGGER trg_perfis_sistema_base
BEFORE UPDATE OF base ON perfis
WHEN OLD.sistema = 1 AND NEW.base <> OLD.base
BEGIN
  SELECT RAISE(ABORT, 'o tipo-base de um perfil do sistema não muda');
END;

-- perfil do usuário: o tipo-base do perfil tem de ser o perfil técnico do usuário
ALTER TABLE usuarios ADD COLUMN perfil_id INTEGER REFERENCES perfis(id);
CREATE INDEX ix_usuarios_perfil_id ON usuarios (perfil_id) WHERE perfil_id IS NOT NULL;
CREATE TRIGGER trg_usuarios_perfil_base_ins
BEFORE INSERT ON usuarios
WHEN NEW.perfil_id IS NOT NULL AND (SELECT base FROM perfis WHERE id = NEW.perfil_id) IS NOT NEW.perfil
BEGIN
  SELECT RAISE(ABORT, 'o tipo-base do perfil não corresponde ao usuário');
END;
CREATE TRIGGER trg_usuarios_perfil_base_upd
BEFORE UPDATE OF perfil_id, perfil ON usuarios
WHEN NEW.perfil_id IS NOT NULL AND (SELECT base FROM perfis WHERE id = NEW.perfil_id) IS NOT NEW.perfil
BEGIN
  SELECT RAISE(ABORT, 'o tipo-base do perfil não corresponde ao usuário');
END;
