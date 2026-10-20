-- 0005 — Cofre de administração.  ADR-0006
-- O administrador entra só com usuário e senha: a chave de administração do Turso fica gravada aqui CIFRADA
-- (AES-GCM, chave derivada da senha do próprio usuário por PBKDF2 — shared/cofre.mjs). O site abre o cofre no login;
-- quem lê o banco com o token do app vê só o texto cifrado. Trocar a senha regrava (ou apaga) o cofre.
ALTER TABLE usuarios ADD COLUMN cofre_admin TEXT;
