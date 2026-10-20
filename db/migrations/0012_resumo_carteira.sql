-- 0012 — Resumo da carteira, já pronto no banco.  docs/02 · shared/explorar.mjs · shared/painel.mjs
-- Uma linha por combinação vendedor × cidade × segmento × onda × rota × subrota × status, com a quantidade de prospects e
-- as etapas do funil já alcançadas. A tela Explorar carteira e o Início leem este resumo (alguns milhares de linhas) em vez
-- dos ~23 mil prospects. Mantido SOMENTE pelos triggers abaixo: toda inclusão ou mudança de prospect (importação,
-- atendimento, eventos do ERP, crédito, transferência) já ajusta o resumo na mesma transação.
-- Valores ausentes viram '' (a chave única não aceita NULL como igual). Linhas que chegam a zero ficam (qtd = 0).

CREATE TABLE resumo_carteira (
  vendedor_id   INTEGER NOT NULL REFERENCES usuarios(id),
  cidade_busca  TEXT NOT NULL,
  uf            TEXT NOT NULL,
  tipologia_gtm TEXT NOT NULL,
  onda          TEXT NOT NULL,
  rota          TEXT NOT NULL,
  subrota       TEXT NOT NULL,
  status_atual  TEXT NOT NULL REFERENCES status(codigo),
  cidade        TEXT,                                   -- nome para exibir (o da última inclusão)
  qtd           INTEGER NOT NULL DEFAULT 0,
  atendidos     INTEGER NOT NULL DEFAULT 0,              -- chegou a atendido (ou etapa posterior) — mesma regra do Início
  cadastrados   INTEGER NOT NULL DEFAULT 0,              -- cadastrado no ERP (ou posterior)
  credito       INTEGER NOT NULL DEFAULT 0               -- crédito liberado (ou venda)
);
CREATE UNIQUE INDEX ux_resumo_carteira ON resumo_carteira (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual);
CREATE INDEX ix_resumo_carteira_status ON resumo_carteira (status_atual);

-- carga inicial a partir da base atual
INSERT INTO resumo_carteira (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual, cidade, qtd, atendidos, cadastrados, credito)
SELECT vendedor_id, COALESCE(cidade_busca, ''), COALESCE(uf, ''), COALESCE(tipologia_gtm, ''), COALESCE(onda, ''), COALESCE(rota, ''), COALESCE(subrota, ''),
       status_atual, MAX(cidade), COUNT(*),
       SUM(dt_atendido IS NOT NULL OR dt_cadastro_erp IS NOT NULL OR dt_liberacao_credito IS NOT NULL OR status_atual = 'venda_realizada'),
       SUM(dt_cadastro_erp IS NOT NULL OR dt_liberacao_credito IS NOT NULL OR status_atual = 'venda_realizada'),
       SUM(dt_liberacao_credito IS NOT NULL OR status_atual = 'venda_realizada')
  FROM prospects
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;

CREATE TRIGGER trg_resumo_carteira_ins AFTER INSERT ON prospects BEGIN
  INSERT INTO resumo_carteira (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual, cidade, qtd, atendidos, cadastrados, credito)
  VALUES (NEW.vendedor_id, COALESCE(NEW.cidade_busca, ''), COALESCE(NEW.uf, ''), COALESCE(NEW.tipologia_gtm, ''), COALESCE(NEW.onda, ''),
          COALESCE(NEW.rota, ''), COALESCE(NEW.subrota, ''), NEW.status_atual, NEW.cidade, 1,
          NEW.dt_atendido IS NOT NULL OR NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada')
  ON CONFLICT (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual) DO UPDATE SET
    qtd = qtd + 1, atendidos = atendidos + excluded.atendidos, cadastrados = cadastrados + excluded.cadastrados,
    credito = credito + excluded.credito, cidade = COALESCE(excluded.cidade, cidade);
END;

-- prospects não são apagados (trg_prospects_sem_delete); qualquer mudança que mexe no resumo tira da linha antiga e põe na nova
CREATE TRIGGER trg_resumo_carteira_upd
AFTER UPDATE OF vendedor_id, cidade_busca, uf, cidade, tipologia_gtm, onda, rota, subrota, status_atual, dt_atendido, dt_cadastro_erp, dt_liberacao_credito ON prospects
BEGIN
  UPDATE resumo_carteira SET
    qtd = qtd - 1,
    atendidos = atendidos - (OLD.dt_atendido IS NOT NULL OR OLD.dt_cadastro_erp IS NOT NULL OR OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    cadastrados = cadastrados - (OLD.dt_cadastro_erp IS NOT NULL OR OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    credito = credito - (OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada')
  WHERE vendedor_id = OLD.vendedor_id AND cidade_busca = COALESCE(OLD.cidade_busca, '') AND uf = COALESCE(OLD.uf, '')
    AND tipologia_gtm = COALESCE(OLD.tipologia_gtm, '') AND onda = COALESCE(OLD.onda, '') AND rota = COALESCE(OLD.rota, '')
    AND subrota = COALESCE(OLD.subrota, '') AND status_atual = OLD.status_atual;
  INSERT INTO resumo_carteira (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual, cidade, qtd, atendidos, cadastrados, credito)
  VALUES (NEW.vendedor_id, COALESCE(NEW.cidade_busca, ''), COALESCE(NEW.uf, ''), COALESCE(NEW.tipologia_gtm, ''), COALESCE(NEW.onda, ''),
          COALESCE(NEW.rota, ''), COALESCE(NEW.subrota, ''), NEW.status_atual, NEW.cidade, 1,
          NEW.dt_atendido IS NOT NULL OR NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada')
  ON CONFLICT (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual) DO UPDATE SET
    qtd = qtd + 1, atendidos = atendidos + excluded.atendidos, cadastrados = cadastrados + excluded.cadastrados,
    credito = credito + excluded.credito, cidade = COALESCE(excluded.cidade, cidade);
END;

-- tela nova Explorar carteira: entra nos perfis do sistema que veem prospects
INSERT INTO perfil_telas (perfil_id, tela)
SELECT id, 'explorar' FROM perfis WHERE sistema = 1 AND base IN ('administrador', 'gerente', 'supervisor', 'vendedor');
