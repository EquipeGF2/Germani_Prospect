-- 0017 — Prazo e forma do relatório de cadastro do ERP.  docs/03 §8.1 · docs/02
--   * a FORMA vem unicamente da Forma Pgto do ERP (Depósito e Pix com prazo continua Depósito e Pix); o crédito 0 não
--     muda mais a forma — por isso "boleto exige limite" passa a valer só para o console do analista;
--   * o PRAZO sai da descrição da condição, limpo: "14/21/28 DD BOLETO" → prazo_parcelas "14/21/28"; "A VISTA" e
--     "ANTECIPADO" → prazo 1; o código da condição traz o prazo médio ("21B" → 21) em prazo_pagamento_dias/prazo_medio_dias.
-- SQLite não remove CHECK: a tabela é recriada com as mesmas linhas (somente inclusão continua valendo), índices e triggers.

CREATE TABLE liberacoes_credito_nova (
  id                   INTEGER PRIMARY KEY,
  prospect_id          INTEGER NOT NULL REFERENCES prospects(id),
  origem               TEXT NOT NULL CHECK (origem IN ('console','importacao')),
  usuario_id           INTEGER REFERENCES usuarios(id),
  importacao_id        INTEGER REFERENCES importacoes(id),
  data_liberacao       TEXT NOT NULL CHECK (date(data_liberacao) = data_liberacao),
  forma_pagamento      TEXT NOT NULL CHECK (forma_pagamento IN ('antecipado','a_vista','boleto')),   -- filtro rápido
  prazo_pagamento_dias INTEGER NOT NULL DEFAULT 0 CHECK (prazo_pagamento_dias >= 0),
  limite_cnpj          REAL CHECK (limite_cnpj IS NULL OR limite_cnpj >= 0),
  limite_grupo         REAL CHECK (limite_grupo IS NULL OR limite_grupo >= 0),
  limite_credito       REAL NOT NULL CHECK (limite_credito >= 0),
  limite_origem        TEXT NOT NULL CHECK (limite_origem IN ('cnpj','grupo','informado')),
  com_restricao        INTEGER CHECK (com_restricao IS NULL OR com_restricao IN (0,1)),
  observacao           TEXT,
  registrado_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cond_pgto_codigo     TEXT,
  cond_pgto_descricao  TEXT,
  forma_pgto_codigo    TEXT,
  forma_pgto_descricao TEXT,
  prazo_medio_dias     INTEGER CHECK (prazo_medio_dias IS NULL OR prazo_medio_dias >= 0),
  sem_limite           INTEGER NOT NULL DEFAULT 0 CHECK (sem_limite IN (0,1)),
  prazo_parcelas       TEXT,                                    -- "14/21/28" · "A VISTA" · "ANTECIPADO" (da descrição da condição)
  CHECK (origem <> 'console' OR (usuario_id IS NOT NULL AND com_restricao IS NOT NULL)),
  CHECK (origem <> 'importacao' OR importacao_id IS NOT NULL),
  CHECK (origem <> 'console' OR forma_pagamento <> 'boleto' OR limite_credito > 0),   -- no console, boleto exige limite
  CHECK (limite_origem <> 'cnpj'  OR (limite_cnpj IS NOT NULL AND limite_credito = limite_cnpj)),
  CHECK (limite_origem <> 'grupo' OR (limite_cnpj IS NULL AND limite_grupo IS NOT NULL AND limite_credito = limite_grupo))
);
INSERT INTO liberacoes_credito_nova (id, prospect_id, origem, usuario_id, importacao_id, data_liberacao, forma_pagamento, prazo_pagamento_dias,
       limite_cnpj, limite_grupo, limite_credito, limite_origem, com_restricao, observacao, registrado_em,
       cond_pgto_codigo, cond_pgto_descricao, forma_pgto_codigo, forma_pgto_descricao, prazo_medio_dias, sem_limite)
SELECT id, prospect_id, origem, usuario_id, importacao_id, data_liberacao, forma_pagamento, prazo_pagamento_dias,
       limite_cnpj, limite_grupo, limite_credito, limite_origem, com_restricao, observacao, registrado_em,
       cond_pgto_codigo, cond_pgto_descricao, forma_pgto_codigo, forma_pgto_descricao, prazo_medio_dias, sem_limite
  FROM liberacoes_credito;
DROP TABLE liberacoes_credito;
ALTER TABLE liberacoes_credito_nova RENAME TO liberacoes_credito;

CREATE INDEX ix_liberacoes_prospect ON liberacoes_credito (prospect_id);
CREATE INDEX ix_liberacoes_usuario_data ON liberacoes_credito (usuario_id, data_liberacao) WHERE usuario_id IS NOT NULL;
CREATE INDEX ix_liberacoes_importacao   ON liberacoes_credito (importacao_id) WHERE importacao_id IS NOT NULL;
CREATE INDEX ix_liberacoes_data         ON liberacoes_credito (data_liberacao);

CREATE TRIGGER trg_liberacoes_validar
BEFORE INSERT ON liberacoes_credito
BEGIN
  SELECT RAISE(ABORT, 'somente o analista financeiro ou o administrador libera crédito')
  WHERE NEW.origem = 'console'
    AND NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.usuario_id AND ativo = 1 AND perfil IN ('financeiro','administrador'));
  SELECT RAISE(ABORT, 'cliente não está em análise financeira (ou aguardando pedido, para correção)')
  WHERE (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) NOT IN ('analise_financeira','aguardando_pedido');
  SELECT RAISE(ABORT, 'data da liberação anterior ao cadastro no ERP')
  WHERE NEW.data_liberacao < (SELECT dt_cadastro_erp FROM prospects WHERE id = NEW.prospect_id);
END;

-- Histórico: a forma do ERP ("Depósito e Pix") e o prazo limpo ("14/21/28 dias, médio 21"); sem a descrição, como antes.
CREATE TRIGGER trg_liberacoes_aplicar
AFTER INSERT ON liberacoes_credito
BEGIN
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, usuario_id, vendedor_id, detalhe)
  SELECT p.id, 'liberacao_credito', p.status_atual, 'aguardando_pedido', NEW.data_liberacao, 'financeiro', CAST(NEW.id AS TEXT),
         NEW.usuario_id, p.vendedor_id,
         COALESCE(NEW.forma_pgto_descricao, CASE NEW.forma_pagamento WHEN 'antecipado' THEN 'antecipado' WHEN 'a_vista' THEN 'à vista' ELSE 'boleto' END)
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

CREATE TRIGGER trg_liberacoes_imutavel_upd BEFORE UPDATE ON liberacoes_credito BEGIN SELECT RAISE(ABORT, 'liberacoes_credito é somente inclusão: corrija com nova liberação'); END;
CREATE TRIGGER trg_liberacoes_imutavel_del BEFORE DELETE ON liberacoes_credito BEGIN SELECT RAISE(ABORT, 'liberacoes_credito é somente inclusão'); END;
