-- 0030 — Tela Rejeitados também para o supervisor.  docs/03 §16 · shared/perfis.mjs
-- O supervisor vê só os rejeitados da equipe dele (o mesmo escopo do Explorar carteira); o supervisor marcado "vê todas
-- as equipes" vê a base toda, como o gerente. Entra em todos os perfis de tipo-base supervisor (o do sistema e os criados).
INSERT OR IGNORE INTO perfil_telas (perfil_id, tela)
SELECT id, 'rejeitados' FROM perfis WHERE base = 'supervisor';
