-- 0020 — Representante E-commerce.  docs/03 §2
--   Todo cliente que o representante marcar "sem interesse do representante" (qualquer motivo de origem representante)
--   vai para a carteira do E-commerce — o usuário escolhido em Parâmetros (vendedor_ecommerce_id; 0 = desligado).
--   Ele chega como está: "Sem interesse · representante"; o E-commerce registra um atendimento quando for trabalhar.
--   A ida fica em transferencias (somente inclusão) e no histórico: "Representante X → E-commerce: sem interesse do
--   representante (motivo)". Sem interesse do CLIENTE não transfere. O próprio E-commerce marcando não transfere de novo.

INSERT INTO parametros (chave, valor, tipo, descricao) VALUES
  ('vendedor_ecommerce_id', '0', 'inteiro', 'Representante E-commerce: recebe os clientes marcados "sem interesse do representante" (0 = desligado)');

-- a transferência automática é feita pelo próprio registro do representante (usuario_id = ele), por isso a validação
-- aceita, além de administrador/gerente/supervisor da equipe, a ida para o E-commerce de quem tem esse registro.
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
                AND u.id = (SELECT COALESCE(supervisor_id, id) FROM usuarios WHERE id = NEW.para_vendedor_id))))
    AND NOT (
      NEW.para_vendedor_id = (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'vendedor_ecommerce_id')
      AND EXISTS (SELECT 1 FROM contatos c JOIN motivos_sem_interesse m ON m.id = c.motivo_id
                   WHERE c.prospect_id = NEW.prospect_id AND c.resultado = 'sem_interesse' AND m.origem = 'representante'
                     AND c.usuario_id = NEW.usuario_id)
    );
END;

CREATE TRIGGER trg_contatos_ecommerce
AFTER INSERT ON contatos
WHEN NEW.resultado = 'sem_interesse' AND NEW.origem = 'app'
BEGIN
  INSERT INTO transferencias (prospect_id, de_vendedor_id, para_vendedor_id, data_transferencia, motivo, usuario_id)
  SELECT p.id, p.vendedor_id, e.id, NEW.data_contato, 'sem interesse do representante (' || m.descricao || ')', NEW.usuario_id
    FROM prospects p
    JOIN motivos_sem_interesse m ON m.id = NEW.motivo_id AND m.origem = 'representante'
    JOIN usuarios e ON e.id = (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'vendedor_ecommerce_id')
                   AND e.ativo = 1 AND e.perfil IN ('vendedor','supervisor')
   WHERE p.id = NEW.prospect_id AND p.vendedor_id <> e.id;
END;
