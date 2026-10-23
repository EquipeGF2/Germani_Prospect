-- 0021 — Expurgo de prospects que já são clientes (tela Grupos de CNPJ).  docs/03 §13
--   Nada é apagado: o prospect ganha a situação "Expurgado" (fora da carteira válida e das contas, como o inválido, e
--   não aceita registro). O expurgo e o desfazer ficam em `expurgos` (somente inclusão) e aparecem no histórico da
--   ficha. Só o administrador aplica, e só em quem ainda não foi trabalhado (Não contactado / Em prospecção).
--   Desfazer devolve a situação que o prospect tinha antes do expurgo.
--   (movimentacoes não recebe o expurgo: seus tipos são fixos no CHECK da 0001; o histórico junta as duas tabelas.)

INSERT INTO status (codigo, nome, cor, ordem, origem, aceita_contato, lista_trabalho, conta_contactado, conta_carteira) VALUES
  ('expurgado', 'Expurgado (já cliente)', '#78716C', 9, 'app', 0, 0, 0, 0);

CREATE TABLE expurgos (
  id              INTEGER PRIMARY KEY,
  prospect_id     INTEGER NOT NULL REFERENCES prospects(id),
  acao            TEXT NOT NULL CHECK (acao IN ('expurgar','desfazer')),
  status_anterior TEXT REFERENCES status(codigo),   -- preenchido pelo trigger (situação antes desta ação)
  status_novo     TEXT REFERENCES status(codigo),   -- idem
  data_expurgo    TEXT NOT NULL CHECK (date(data_expurgo) = data_expurgo),
  motivo          TEXT NOT NULL CHECK (length(trim(motivo)) > 0),
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  vendedor_id     INTEGER REFERENCES usuarios(id),    -- dono da carteira no momento (preenchido pelo trigger)
  registrado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_expurgos_prospect ON expurgos (prospect_id);

CREATE TRIGGER trg_expurgos_validar
BEFORE INSERT ON expurgos
BEGIN
  SELECT RAISE(ABORT, 'só o administrador expurga prospects')
  WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.usuario_id AND ativo = 1 AND perfil = 'administrador');
  SELECT RAISE(ABORT, 'só prospect ainda não trabalhado (Não contactado / Em prospecção) pode ser expurgado')
  WHERE NEW.acao = 'expurgar' AND (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) NOT IN ('nao_contactado','em_prospeccao');
  SELECT RAISE(ABORT, 'prospect não está expurgado')
  WHERE NEW.acao = 'desfazer' AND (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) <> 'expurgado';
END;

-- status anterior/novo e o dono da carteira ficam na própria linha; depois a situação do prospect muda
CREATE TRIGGER trg_expurgos_aplicar
AFTER INSERT ON expurgos
BEGIN
  UPDATE expurgos SET
    status_anterior = (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id),
    status_novo = CASE NEW.acao WHEN 'expurgar' THEN 'expurgado' ELSE
      COALESCE((SELECT e.status_anterior FROM expurgos e WHERE e.prospect_id = NEW.prospect_id AND e.acao = 'expurgar' AND e.id < NEW.id
                 ORDER BY e.id DESC LIMIT 1), 'nao_contactado') END,
    vendedor_id = (SELECT vendedor_id FROM prospects WHERE id = NEW.prospect_id)
  WHERE id = NEW.id;
  UPDATE prospects SET status_atual = (SELECT status_novo FROM expurgos WHERE id = NEW.id),
                       atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = NEW.prospect_id;
END;
-- somente inclusão: só o próprio trigger completa a linha recém-incluída (status e dono, uma única vez)
CREATE TRIGGER trg_expurgos_imutavel_upd BEFORE UPDATE ON expurgos WHEN OLD.status_novo IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'expurgos é somente inclusão'); END;
CREATE TRIGGER trg_expurgos_imutavel_del BEFORE DELETE ON expurgos BEGIN SELECT RAISE(ABORT, 'expurgos é somente inclusão'); END;

-- histórico da ficha e relatório de movimentos: movimentações + expurgos (id negativo para não colidir)
DROP VIEW vw_movimentacoes;
CREATE VIEW vw_movimentacoes AS
SELECT m.id, m.prospect_id, m.tipo, m.data_evento, m.origem, m.referencia, m.detalhe, m.registrado_em,
       m.status_anterior, sa.nome AS status_anterior_nome, m.status_novo, sn.nome AS status_novo_nome, sn.cor AS status_novo_cor,
       m.usuario_id, u.nome AS usuario_nome,
       m.vendedor_id, v.nome AS vendedor_nome, v.tipo_atuacao AS vendedor_tipo_atuacao,
       COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END) AS supervisor_id,
       p.cnpj, p.razao_social, p.nome_fantasia, p.cidade, p.cidade_busca, p.bairro, p.bairro_busca, p.uf, p.onda
  FROM movimentacoes m
  JOIN prospects p ON p.id = m.prospect_id
  JOIN usuarios v ON v.id = m.vendedor_id
  JOIN status sn ON sn.codigo = m.status_novo
  LEFT JOIN status sa ON sa.codigo = m.status_anterior
  LEFT JOIN usuarios u ON u.id = m.usuario_id
UNION ALL
SELECT -e.id, e.prospect_id, CASE e.acao WHEN 'expurgar' THEN 'expurgo' ELSE 'expurgo_desfeito' END, e.data_expurgo, 'administracao',
       CAST(e.id AS TEXT), CASE e.acao WHEN 'expurgar' THEN 'expurgado: ' ELSE 'expurgo desfeito: ' END || e.motivo, e.registrado_em,
       e.status_anterior, sa.nome, e.status_novo, sn.nome, sn.cor,
       e.usuario_id, u.nome,
       e.vendedor_id, v.nome, v.tipo_atuacao,
       COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END),
       p.cnpj, p.razao_social, p.nome_fantasia, p.cidade, p.cidade_busca, p.bairro, p.bairro_busca, p.uf, p.onda
  FROM expurgos e
  JOIN prospects p ON p.id = e.prospect_id
  JOIN usuarios v ON v.id = e.vendedor_id
  JOIN status sn ON sn.codigo = e.status_novo
  LEFT JOIN status sa ON sa.codigo = e.status_anterior
  LEFT JOIN usuarios u ON u.id = e.usuario_id;

-- tela nova Grupos de CNPJ no perfil Administrador do sistema (que tem sempre todas as telas)
INSERT INTO perfil_telas (perfil_id, tela) SELECT id, 'admin_grupos' FROM perfis WHERE sistema = 1 AND base = 'administrador';
