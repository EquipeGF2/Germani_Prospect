-- 0009 — Perfil de supervisor que vê todas as equipes.  docs/03 §11 · shared/perfis.mjs (veTodasEquipes)
-- Caso real: o supervisor 2 também é gerente — responde pelos representantes da própria equipe (supervisor_id) e
-- precisa VER os dados de todas as equipes. O tipo-base continua supervisor (equipe, regras do banco ao registrar);
-- o perfil marcado com ve_todos amplia só a leitura (listas, acompanhamento, Início e indicadores).
ALTER TABLE perfis ADD COLUMN ve_todos INTEGER NOT NULL DEFAULT 0 CHECK (ve_todos IN (0,1) AND (ve_todos = 0 OR base = 'supervisor'));
