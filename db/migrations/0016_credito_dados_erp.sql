-- 0016 — Relatório de cadastro do ERP (cadastro + crédito num arquivo só).  docs/05 §3 · docs/02
--   A liberação guarda a condição e a forma de pagamento como vieram do ERP (código + descrição), o prazo médio da
--   condição e se o crédito é "sem limite" (9.999.999 no ERP). forma_pagamento continua sendo o filtro rápido
--   (antecipado · à vista · boleto/a prazo); crédito 0 = sem crédito → à vista ou antecipado (calculado na importação).
--   O limite do grupo vale para todas as empresas da mesma raiz de CNPJ (o mesmo valor em cada uma, não somado).
ALTER TABLE liberacoes_credito ADD COLUMN cond_pgto_codigo     TEXT;
ALTER TABLE liberacoes_credito ADD COLUMN cond_pgto_descricao  TEXT;
ALTER TABLE liberacoes_credito ADD COLUMN forma_pgto_codigo    TEXT;
ALTER TABLE liberacoes_credito ADD COLUMN forma_pgto_descricao TEXT;
ALTER TABLE liberacoes_credito ADD COLUMN prazo_medio_dias     INTEGER CHECK (prazo_medio_dias IS NULL OR prazo_medio_dias >= 0);
ALTER TABLE liberacoes_credito ADD COLUMN sem_limite           INTEGER NOT NULL DEFAULT 0 CHECK (sem_limite IN (0,1));

-- última liberação de cada prospect (ficha) e as empresas do mesmo grupo (raiz) já usam ix_liberacoes_prospect e ix_prospects_raiz.

-- Histórico da liberação: "sem limite" em vez de R$ 9.999.999,00 (o resto igual à 0001; a condição do ERP vem na observação).
DROP TRIGGER trg_liberacoes_aplicar;
CREATE TRIGGER trg_liberacoes_aplicar
AFTER INSERT ON liberacoes_credito
BEGIN
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, usuario_id, vendedor_id, detalhe)
  SELECT p.id, 'liberacao_credito', p.status_atual, 'aguardando_pedido', NEW.data_liberacao, 'financeiro', CAST(NEW.id AS TEXT),
         NEW.usuario_id, p.vendedor_id,
         CASE NEW.forma_pagamento WHEN 'antecipado' THEN 'antecipado' WHEN 'a_vista' THEN 'à vista' ELSE 'boleto' END
           || CASE WHEN NEW.prazo_pagamento_dias > 0 THEN ' ' || NEW.prazo_pagamento_dias || ' dias' ELSE '' END
           || CASE WHEN NEW.sem_limite = 1 THEN ' · sem limite' ELSE ' · limite R$ ' || printf('%.2f', NEW.limite_credito) END
           || CASE NEW.limite_origem WHEN 'cnpj' THEN ' (CNPJ)' WHEN 'grupo' THEN ' (grupo)' ELSE '' END
           || CASE NEW.com_restricao WHEN 1 THEN ' · com restrição de crédito' WHEN 0 THEN ' · sem restrição' ELSE '' END
           || CASE NEW.origem WHEN 'importacao' THEN ' · relatório de crédito' ELSE ' · console' END
           || COALESCE(' — ' || NEW.observacao, '')
    FROM prospects p WHERE p.id = NEW.prospect_id;
  UPDATE prospects SET
    status_atual = 'aguardando_pedido',
    dt_liberacao_credito = NEW.data_liberacao,
    forma_pagamento = NEW.forma_pagamento,
    prazo_pagamento_dias = NEW.prazo_pagamento_dias,
    limite_credito = NEW.limite_credito,
    limite_credito_origem = NEW.limite_origem,
    com_restricao_credito = NEW.com_restricao,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;
END;
