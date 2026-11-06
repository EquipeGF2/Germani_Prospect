-- 0029 — Apagar uma importação da base de prospects (ex.: base carregada por engano).  docs/03 §17 · ADR-0008
--   * base_exclusoes: o administrador apaga os clientes que ENTRARAM por aquela importação (prospects.importacao_id), com o
--     histórico que a própria planilha gerou (entrada na base e tentativas DT 1o/2o). Segunda exceção à regra de "somente
--     inclusão" (a primeira é pedido_exclusoes, 0022); fica o registro permanente de quem apagou o quê.
--   * Recusa se algum desses clientes já foi trabalhado: atendimento no app, evento do ERP, crédito, transferência, rota,
--     expurgo ou pedido. Nada que alguém registrou é apagado.
--   * Clientes que já existiam e só tiveram o cadastro atualizado pela importação ficam (não entraram por ela).
--   * Representante e supervisor criados pela importação, sem acesso liberado e sem nenhum cliente restante, são desativados.
--   * As linhas da importação (importacao_linhas) ficam como estão: são o registro do que o arquivo trouxe.

CREATE TABLE base_exclusoes (
  id                  INTEGER PRIMARY KEY,
  importacao_id       INTEGER NOT NULL UNIQUE REFERENCES importacoes(id),
  usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
  qtd_prospects       INTEGER,
  qtd_contatos        INTEGER,
  qtd_atualizados     INTEGER,     -- já existiam: o cadastro foi atualizado pela importação e não volta
  qtd_usuarios        INTEGER,     -- representantes e supervisores desativados
  concluida           INTEGER NOT NULL DEFAULT 0 CHECK (concluida IN (0,1)),
  registrado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- clientes de uma importação já trabalhados (o mesmo critério da tela, shared/importar-base.mjs)
CREATE VIEW vw_base_trabalhados AS
SELECT p.importacao_id, p.id AS prospect_id
  FROM prospects p
 WHERE p.importacao_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = p.id AND c.origem <> 'importacao')
    OR EXISTS (SELECT 1 FROM eventos_erp e WHERE e.prospect_id = p.id)
    OR EXISTS (SELECT 1 FROM liberacoes_credito l WHERE l.prospect_id = p.id)
    OR EXISTS (SELECT 1 FROM transferencias t WHERE t.prospect_id = p.id)
    OR EXISTS (SELECT 1 FROM rota_paradas r WHERE r.prospect_id = p.id)
    OR EXISTS (SELECT 1 FROM expurgos x WHERE x.prospect_id = p.id)
    OR EXISTS (SELECT 1 FROM pedidos_erp d WHERE d.prospect_id = p.id)
    OR EXISTS (SELECT 1 FROM pedido_aplicacoes a WHERE a.prospect_id = p.id));

CREATE TRIGGER trg_base_exclusoes_validar
BEFORE INSERT ON base_exclusoes
BEGIN
  SELECT RAISE(ABORT, 'só o administrador apaga uma importação da base')
  WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.usuario_id AND perfil = 'administrador');
  SELECT RAISE(ABORT, 'esta importação não é uma base de prospects concluída')
  WHERE NOT EXISTS (SELECT 1 FROM importacoes WHERE id = NEW.importacao_id AND tipo = 'base_prospects' AND situacao = 'concluida');
  SELECT RAISE(ABORT, 'há clientes desta importação já trabalhados (atendimento, cadastro, crédito, pedido, transferência, rota ou expurgo): não dá para apagar')
  WHERE EXISTS (SELECT 1 FROM vw_base_trabalhados WHERE importacao_id = NEW.importacao_id);
END;

CREATE TRIGGER trg_base_exclusoes_aplicar
AFTER INSERT ON base_exclusoes
BEGIN
  UPDATE base_exclusoes SET
    qtd_prospects = (SELECT COUNT(*) FROM prospects WHERE importacao_id = NEW.importacao_id),
    qtd_contatos = (SELECT COUNT(*) FROM contatos WHERE prospect_id IN (SELECT id FROM prospects WHERE importacao_id = NEW.importacao_id)),
    qtd_atualizados = (SELECT COUNT(DISTINCT l.cnpj) FROM importacao_linhas l
                        WHERE l.importacao_id = NEW.importacao_id AND l.resultado = 'aceita'
                          AND EXISTS (SELECT 1 FROM prospects p WHERE p.cnpj = l.cnpj AND p.importacao_id IS NOT NEW.importacao_id))
  WHERE id = NEW.id;

  DELETE FROM movimentacoes WHERE prospect_id IN (SELECT id FROM prospects WHERE importacao_id = NEW.importacao_id);
  DELETE FROM contatos WHERE prospect_id IN (SELECT id FROM prospects WHERE importacao_id = NEW.importacao_id);
  DELETE FROM prospects WHERE importacao_id = NEW.importacao_id;

  -- quem a importação criou e ficou sem cliente (e nunca teve acesso liberado) é desativado; nada é apagado
  UPDATE usuarios SET ativo = 0, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE ativo = 1 AND perfil = 'vendedor' AND senha_hash IS NULL
     AND criado_em >= (SELECT iniciado_em FROM importacoes WHERE id = NEW.importacao_id)
     AND NOT EXISTS (SELECT 1 FROM prospects p WHERE p.vendedor_id = usuarios.id);
  UPDATE usuarios SET ativo = 0, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE ativo = 1 AND perfil = 'supervisor' AND senha_hash IS NULL
     AND criado_em >= (SELECT iniciado_em FROM importacoes WHERE id = NEW.importacao_id)
     AND NOT EXISTS (SELECT 1 FROM prospects p WHERE p.vendedor_id = usuarios.id)
     AND NOT EXISTS (SELECT 1 FROM usuarios v WHERE v.supervisor_id = usuarios.id AND v.ativo = 1);
  UPDATE base_exclusoes SET
    qtd_usuarios = (SELECT COUNT(*) FROM usuarios WHERE ativo = 0 AND perfil IN ('vendedor','supervisor') AND senha_hash IS NULL
                      AND atualizado_em >= NEW.registrado_em
                      AND criado_em >= (SELECT iniciado_em FROM importacoes WHERE id = NEW.importacao_id)),
    concluida = 1
  WHERE id = NEW.id;
END;

-- resumo da carteira: o cliente apagado sai da linha dele (antes prospects nunca eram apagados)
CREATE TRIGGER trg_resumo_carteira_del AFTER DELETE ON prospects BEGIN
  UPDATE resumo_carteira SET
    qtd = qtd - 1,
    atendidos = atendidos - (OLD.dt_atendido IS NOT NULL OR OLD.dt_cadastro_erp IS NOT NULL OR OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    cadastrados = cadastrados - (OLD.dt_cadastro_erp IS NOT NULL OR OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    credito = credito - (OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada')
  WHERE vendedor_id = OLD.vendedor_id AND cidade_busca = COALESCE(OLD.cidade_busca, '') AND uf = COALESCE(OLD.uf, '')
    AND tipologia_gtm = COALESCE(OLD.tipologia_gtm, '') AND onda = COALESCE(OLD.onda, '') AND rota = COALESCE(OLD.rota, '')
    AND subrota = COALESCE(OLD.subrota, '') AND status_atual = OLD.status_atual;
END;

-- prospects, contatos e movimentações só saem por uma exclusão em andamento (concluida = 0 só existe dentro do trigger)
DROP TRIGGER trg_prospects_sem_delete;
CREATE TRIGGER trg_prospects_sem_delete BEFORE DELETE ON prospects
WHEN NOT EXISTS (SELECT 1 FROM base_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'prospects não são apagados: use baixa (inválido)'); END;

DROP TRIGGER trg_contatos_imutavel_del;
CREATE TRIGGER trg_contatos_imutavel_del BEFORE DELETE ON contatos
WHEN NOT EXISTS (SELECT 1 FROM base_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'contatos é somente inclusão'); END;

DROP TRIGGER trg_movimentacoes_imutavel_del;
CREATE TRIGGER trg_movimentacoes_imutavel_del BEFORE DELETE ON movimentacoes
WHEN NOT EXISTS (SELECT 1 FROM pedido_exclusoes WHERE concluida = 0) AND NOT EXISTS (SELECT 1 FROM base_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'movimentacoes é somente inclusão'); END;

CREATE TRIGGER trg_base_exclusoes_imutavel_upd BEFORE UPDATE ON base_exclusoes WHEN OLD.concluida = 1
BEGIN SELECT RAISE(ABORT, 'base_exclusoes é somente inclusão'); END;
CREATE TRIGGER trg_base_exclusoes_imutavel_del BEFORE DELETE ON base_exclusoes
BEGIN SELECT RAISE(ABORT, 'base_exclusoes é somente inclusão'); END;
