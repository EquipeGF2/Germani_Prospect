-- O relatório de cadastro e crédito pode chegar depois do arquivo de pedidos. Os pedidos ficam gravados e o cliente,
-- quando o relatório entra, recebe o cadastro e o crédito sem precisar reimportar nada.
--   * liberacoes_credito aceita cliente em Venda realizada e em Aguardando pedido válido;
--   * nesses dois status o crédito é registrado e o status NÃO muda: quem já teve pedido não volta para Aguardando pedido.
-- Inválido e expurgado continuam recusados.

DROP TRIGGER trg_liberacoes_validar;
CREATE TRIGGER trg_liberacoes_validar
BEFORE INSERT ON liberacoes_credito
BEGIN
  SELECT RAISE(ABORT, 'somente o analista financeiro ou o administrador libera crédito')
  WHERE NEW.origem = 'console'
    AND NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.usuario_id AND ativo = 1 AND perfil IN ('financeiro','administrador'));
  SELECT RAISE(ABORT, 'cliente não está em análise financeira (ou aguardando pedido, para correção)')
  WHERE (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) NOT IN ('analise_financeira','aguardando_pedido','aguardando_pedido_valido','venda_realizada');
  SELECT RAISE(ABORT, 'data da liberação anterior ao cadastro no ERP')
  WHERE NEW.data_liberacao < (SELECT dt_cadastro_erp FROM prospects WHERE id = NEW.prospect_id);
END;

DROP TRIGGER trg_liberacoes_aplicar;
CREATE TRIGGER trg_liberacoes_aplicar
AFTER INSERT ON liberacoes_credito
BEGIN
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, usuario_id, vendedor_id, detalhe)
  SELECT p.id, 'liberacao_credito', p.status_atual,
         CASE WHEN p.status_atual IN ('venda_realizada','aguardando_pedido_valido') THEN p.status_atual ELSE 'aguardando_pedido' END,
         NEW.data_liberacao, 'financeiro', CAST(NEW.id AS TEXT),
         NEW.usuario_id, p.vendedor_id,
         COALESCE(NEW.forma_pgto_descricao, CASE NEW.forma_pagamento WHEN 'antecipado' THEN 'antecipado' WHEN 'a_vista' THEN 'à vista' WHEN 'deposito' THEN 'depósito e Pix' ELSE 'boleto' END)
           || CASE
                WHEN NEW.prazo_parcelas GLOB '[0-9]*' THEN ' ' || NEW.prazo_parcelas || ' dias'
                     || CASE WHEN instr(NEW.prazo_parcelas, '/') > 0 THEN ' (médio ' || NEW.prazo_pagamento_dias || ')' ELSE '' END
                WHEN NEW.prazo_parcelas IS NOT NULL THEN
                     CASE WHEN upper(COALESCE(NEW.forma_pgto_descricao, '')) = NEW.prazo_parcelas THEN '' ELSE ' · ' || lower(NEW.prazo_parcelas) END
                WHEN NEW.prazo_pagamento_dias > 0 THEN ' ' || NEW.prazo_pagamento_dias || ' dias'
                ELSE '' END
           || CASE WHEN NEW.sem_limite = 1 THEN ' · sem limite' ELSE ' · limite R$ ' || printf('%.2f', NEW.limite_credito) END
           || CASE NEW.limite_origem WHEN 'cnpj' THEN ' (CNPJ)' WHEN 'grupo' THEN ' (grupo)' ELSE '' END
           || CASE NEW.com_restricao WHEN 1 THEN ' · com restrição de crédito' WHEN 0 THEN ' · sem restrição' ELSE '' END
           || CASE NEW.origem WHEN 'importacao' THEN ' · relatório de crédito' ELSE ' · console' END
           || COALESCE(' — ' || NEW.observacao, '')
    FROM prospects p WHERE p.id = NEW.prospect_id;
  UPDATE prospects SET
    status_atual = CASE WHEN status_atual IN ('venda_realizada','aguardando_pedido_valido') THEN status_atual ELSE 'aguardando_pedido' END,
    dt_liberacao_credito = NEW.data_liberacao,
    forma_pagamento = CASE NEW.forma_pagamento WHEN 'deposito' THEN 'boleto' ELSE NEW.forma_pagamento END,   -- legado: a prazo
    forma_filtro = NEW.forma_pagamento,
    prazo_pagamento_dias = NEW.prazo_pagamento_dias,
    limite_credito = NEW.limite_credito,
    limite_credito_origem = NEW.limite_origem,
    com_restricao_credito = NEW.com_restricao,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;
END;
