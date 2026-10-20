-- 0006 — Índices para o volume de produção (~50 mil CNPJs). Medidos com scripts/medir-consultas.mjs.
-- Só índices: nenhuma consulta muda de resultado, só de caminho (menos linhas lidas no Turso).
CREATE INDEX IF NOT EXISTS ix_contatos_prospect_data ON contatos (prospect_id, data_contato);
CREATE INDEX IF NOT EXISTS ix_prospects_ultimo_contato ON prospects (dt_ultimo_contato);
CREATE INDEX IF NOT EXISTS ix_prospects_status ON prospects (status_atual);
CREATE INDEX IF NOT EXISTS ix_prospects_razao ON prospects (razao_social);

-- Busca por pedaço de texto (nome, fantasia, CNPJ, cidade, bairro) sem varrer a tabela: índice FTS5 "trigram"
-- sobre prospects.busca. Responde ao mesmo LIKE '%termo%' (sem diferenciar maiúsculas) que a consulta já usava —
-- o resultado é o mesmo, só lê menos linhas. Mantido em dia pelos gatilhos abaixo.
CREATE VIRTUAL TABLE prospects_busca USING fts5(busca, content='prospects', content_rowid='id', tokenize='trigram');
INSERT INTO prospects_busca (prospects_busca) VALUES ('rebuild');

CREATE TRIGGER trg_prospects_busca_ins AFTER INSERT ON prospects BEGIN
  INSERT INTO prospects_busca (rowid, busca) VALUES (NEW.id, NEW.busca);
END;
CREATE TRIGGER trg_prospects_busca_upd AFTER UPDATE OF busca ON prospects BEGIN
  INSERT INTO prospects_busca (prospects_busca, rowid, busca) VALUES ('delete', OLD.id, OLD.busca);
  INSERT INTO prospects_busca (rowid, busca) VALUES (NEW.id, NEW.busca);
END;
CREATE TRIGGER trg_prospects_busca_del AFTER DELETE ON prospects BEGIN
  INSERT INTO prospects_busca (prospects_busca, rowid, busca) VALUES ('delete', OLD.id, OLD.busca);
END;
