-- 0025 — Fim da ida automática para o E-commerce (0020). docs/03 §2
--   O cliente rejeitado (sem interesse, baixado, expurgado) fica com o dono da carteira e sai pela tela Rejeitados,
--   exportado por tipo. As transferências já feitas continuam no histórico (somente inclusão).
DROP TRIGGER trg_contatos_ecommerce;

-- a validação das transferências volta a aceitar só administrador, gerente e o supervisor da equipe
DROP TRIGGER trg_transferencias_validar;
CREATE TRIGGER trg_transferencias_validar
BEFORE INSERT ON transferencias
BEGIN
  SELECT RAISE(ABORT, 'de_vendedor_id não é o vendedor atual do prospect')
  WHERE NEW.de_vendedor_id <> (SELECT vendedor_id FROM prospects WHERE id = NEW.prospect_id);
  SELECT RAISE(ABORT, 'destino deve ser vendedor ou supervisor ativo')
  WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.para_vendedor_id AND ativo = 1 AND perfil IN ('vendedor','supervisor'));
  SELECT RAISE(ABORT, 'usuário sem permissão para transferir')
  WHERE NOT EXISTS (
    SELECT 1 FROM usuarios u
     WHERE u.id = NEW.usuario_id AND u.ativo = 1
       AND (u.perfil IN ('administrador','gerente')
            OR (u.perfil = 'supervisor'
                AND u.id = (SELECT COALESCE(supervisor_id, id) FROM usuarios WHERE id = NEW.de_vendedor_id)
                AND u.id = (SELECT COALESCE(supervisor_id, id) FROM usuarios WHERE id = NEW.para_vendedor_id))));
END;

DELETE FROM parametros WHERE chave = 'vendedor_ecommerce_id';

-- tela Rejeitados: gerente e administrador (perfis do sistema)
INSERT INTO perfil_telas (perfil_id, tela)
SELECT id, 'rejeitados' FROM perfis WHERE sistema = 1 AND base IN ('administrador', 'gerente');
