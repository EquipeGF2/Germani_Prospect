-- 0022 — Pedidos do ERP: cada pedido, com a situação de cada arquivo.  docs/03 §14 · docs/05 §6 · ADR-0007
--   * pedidos_erp: uma linha por pedido POR ARQUIVO em que ele mudou (histórico só de inclusão). Situação atual = última linha.
--   * Todo pedido fica vinculado ao arquivo (importacao_id) e, quando o CNPJ está na base, ao cliente (prospect_id).
--   * Transação e situação do ERP são classificadas em tabelas editáveis: venda × investimento; digitado, carteira, parcial,
--     faturado, cancelado. Venda válida = venda em carteira, parcial ou faturada. Bonificação é investimento: conta à parte.
--   * Status novo "Aguardando pedido válido": teve pedido de venda, nenhum válido (digitado ou cancelado). Sem pedido válido,
--     Venda realizada deixa de ser definitiva e vai para este status.
--   * pedido_aplicacoes: o efeito de um arquivo em cada cliente, com a foto dos campos antes dele. Os status mudam só aqui.
--   * pedido_exclusoes: apagar os dados de um arquivo, do mais novo para o mais antigo. Única exceção à regra de "somente
--     inclusão" do histórico e das linhas de importação; fica o registro permanente de quem apagou o quê (ADR-0007).

-- ---------- status novo, entre Aguardando pedido e Venda realizada ----------
UPDATE status SET ordem = 10 WHERE codigo = 'expurgado';
UPDATE status SET ordem = 9 WHERE codigo = 'invalido';
UPDATE status SET ordem = 8 WHERE codigo = 'venda_realizada';
INSERT INTO status (codigo, nome, cor, ordem, origem, aceita_contato, lista_trabalho, conta_contactado, conta_carteira) VALUES
  ('aguardando_pedido_valido', 'Aguardando pedido válido', '#B45309', 7, 'erp', 1, 0, 1, 1);

INSERT INTO parametros (chave, valor, tipo, descricao) VALUES
  ('prazo_pedido_valido_dias', '10', 'inteiro', 'Dias em Aguardando pedido válido até alertar o supervisor'),
  ('alerta_desistencias_cliente', '5', 'inteiro', 'Desistências de um cliente a partir das quais o supervisor é alertado'),
  ('dias_alerta_pedido_aberto', '30', 'inteiro', 'Dias de um pedido em carteira até alertar o supervisor');

-- ---------- classificação dos códigos do ERP ----------
CREATE TABLE pedido_transacoes (
  codigo     TEXT PRIMARY KEY,
  descricao  TEXT NOT NULL,
  conta_como TEXT NOT NULL CHECK (conta_como IN ('venda','investimento','ignorar'))
);
INSERT INTO pedido_transacoes (codigo, descricao, conta_como) VALUES
  ('90100', 'Pedido de Venda', 'venda'),
  ('90106', 'Pedido de Bonificação', 'investimento');

CREATE TABLE pedido_situacoes (
  codigo     TEXT PRIMARY KEY,
  descricao  TEXT NOT NULL,
  conta_como TEXT NOT NULL CHECK (conta_como IN ('digitado','carteira','parcial','faturado','cancelado')),
  ordem      INTEGER NOT NULL DEFAULT 99
);
INSERT INTO pedido_situacoes (codigo, descricao, conta_como, ordem) VALUES
  ('9', 'Não Fechado', 'digitado', 1),
  ('1', 'Aberto Total', 'carteira', 2),
  ('2', 'Aberto Parcial', 'parcial', 3),
  ('4', 'Liquidado', 'faturado', 4),
  ('5', 'Desistência', 'cancelado', 5);

-- ---------- arquivos de pedidos ----------
CREATE TABLE pedido_importacoes (
  importacao_id   INTEGER PRIMARY KEY REFERENCES importacoes(id),
  data_referencia TEXT NOT NULL CHECK (date(data_referencia) = data_referencia),   -- data do dia (diária) ou informada (semanal)
  apagada_em      TEXT,
  apagada_por     TEXT
);
CREATE INDEX ix_pedido_importacoes_ativas ON pedido_importacoes (importacao_id) WHERE apagada_em IS NULL;

CREATE TABLE pedidos_erp (
  id               INTEGER PRIMARY KEY,
  numero           TEXT NOT NULL,
  importacao_id    INTEGER NOT NULL REFERENCES importacoes(id),
  data_situacao    TEXT NOT NULL CHECK (date(data_situacao) = data_situacao),
  cpf_cnpj         TEXT NOT NULL,
  prospect_id      INTEGER REFERENCES prospects(id),   -- NULL = fora da base (cliente antigo ou CPF)
  codigo_cliente   TEXT,
  razao_social     TEXT,
  transacao_codigo TEXT NOT NULL REFERENCES pedido_transacoes(codigo),
  situacao_codigo  TEXT NOT NULL REFERENCES pedido_situacoes(codigo),
  rep_codigo       TEXT,
  valor_pedido     REAL NOT NULL CHECK (valor_pedido >= 0),
  valor_faturado   REAL NOT NULL DEFAULT 0 CHECK (valor_faturado >= 0),
  registrado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (numero, importacao_id)
);
CREATE INDEX ix_pedidos_erp_numero     ON pedidos_erp (numero, id);
CREATE INDEX ix_pedidos_erp_prospect   ON pedidos_erp (prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX ix_pedidos_erp_importacao ON pedidos_erp (importacao_id);
CREATE INDEX ix_pedidos_erp_rep        ON pedidos_erp (rep_codigo);
CREATE INDEX ix_pedidos_erp_documento  ON pedidos_erp (cpf_cnpj);
CREATE INDEX ix_pedidos_erp_transacao  ON pedidos_erp (transacao_codigo);
CREATE INDEX ix_pedidos_erp_situacao   ON pedidos_erp (situacao_codigo);

-- Situação atual de cada pedido, já classificada, com o representante do pedido e o dono da carteira.
CREATE VIEW vw_pedidos AS
SELECT pe.id, pe.numero, pe.importacao_id, pe.data_situacao,
       (SELECT MIN(x.data_situacao) FROM pedidos_erp x WHERE x.numero = pe.numero) AS data_primeira,
       pe.cpf_cnpj, pe.prospect_id, pe.codigo_cliente, COALESCE(pr.razao_social, pe.razao_social) AS razao_social,
       pe.transacao_codigo, t.descricao AS transacao_descricao, t.conta_como AS tipo,
       pe.situacao_codigo, s.descricao AS situacao_descricao, s.conta_como AS fase,
       pe.rep_codigo, r.id AS rep_id, r.nome AS rep_nome, r.supervisor_id AS rep_supervisor_id,
       pe.valor_pedido, pe.valor_faturado,
       CASE WHEN t.conta_como = 'venda' AND s.conta_como IN ('carteira','parcial','faturado') THEN 1 ELSE 0 END AS valida,
       CASE WHEN t.conta_como = 'venda' AND s.conta_como IN ('carteira','parcial','faturado')
            THEN MAX(pe.valor_pedido - pe.valor_faturado, 0) ELSE 0 END AS saldo,
       pr.vendedor_id AS dono_id, d.nome AS dono_nome, d.codigo_erp AS dono_codigo, d.supervisor_id AS dono_supervisor_id,
       pr.status_atual, COALESCE(pr.cnpj_raiz, substr(pe.cpf_cnpj, 1, 8)) AS raiz, pr.limite_credito, pr.limite_credito_origem,
       CASE WHEN length(pe.cpf_cnpj) = 11 THEN 'cpf'
            WHEN pr.id IS NULL THEN 'fora_base'
            WHEN r.id = pr.vendedor_id THEN 'propria'
            ELSE 'outra' END AS relacao
  FROM pedidos_erp pe
  JOIN pedido_transacoes t ON t.codigo = pe.transacao_codigo
  JOIN pedido_situacoes s ON s.codigo = pe.situacao_codigo
  LEFT JOIN prospects pr ON pr.id = pe.prospect_id
  LEFT JOIN usuarios d ON d.id = pr.vendedor_id
  LEFT JOIN usuarios r ON r.id = (SELECT u.id FROM usuarios u WHERE u.codigo_erp = pe.rep_codigo AND u.perfil IN ('vendedor','supervisor')
                                   ORDER BY u.perfil = 'vendedor' DESC LIMIT 1)
 WHERE NOT EXISTS (SELECT 1 FROM pedidos_erp n WHERE n.numero = pe.numero AND n.id > pe.id);

-- "Valor dos pedidos" do Início, do Explorar e da ficha: venda válida + pedidos antigos (eventos_erp) ainda não reimportados.
CREATE VIEW vw_valor_pedidos AS
SELECT v.prospect_id, v.data_primeira AS data_evento, v.valor_pedido AS valor, v.numero AS documento
  FROM vw_pedidos v WHERE v.valida = 1 AND v.prospect_id IS NOT NULL
UNION ALL
SELECT e.prospect_id, e.data_evento, e.valor, e.documento
  FROM eventos_erp e
 WHERE e.tipo = 'pedido' AND NOT EXISTS (SELECT 1 FROM pedidos_erp p WHERE p.numero = e.documento AND p.prospect_id = e.prospect_id);

-- ---------- efeito de um arquivo em cada cliente ----------
CREATE TABLE pedido_aplicacoes (
  id                        INTEGER PRIMARY KEY,
  importacao_id             INTEGER NOT NULL REFERENCES importacoes(id),
  prospect_id               INTEGER NOT NULL REFERENCES prospects(id),
  data_evento               TEXT NOT NULL CHECK (date(data_evento) = data_evento),
  status_anterior           TEXT REFERENCES status(codigo),   -- os campos abaixo são preenchidos pelo trigger
  status_novo               TEXT REFERENCES status(codigo),
  motivo_invalido           TEXT CHECK (motivo_invalido IN ('digitado','cancelado')),
  antes_dt_pedido           TEXT,
  antes_numero_pedido       TEXT,
  antes_convertido          INTEGER,
  antes_dt_atendido         TEXT,
  antes_dt_primeiro_contato TEXT,
  antes_data_proxima_acao   TEXT,
  registrado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (importacao_id, prospect_id)
);
CREATE INDEX ix_pedido_aplicacoes_prospect ON pedido_aplicacoes (prospect_id, id);

CREATE TRIGGER trg_pedido_aplicacoes_aplicar
AFTER INSERT ON pedido_aplicacoes
BEGIN
  UPDATE pedido_aplicacoes SET
    status_anterior = (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id),
    antes_dt_pedido = (SELECT dt_pedido FROM prospects WHERE id = NEW.prospect_id),
    antes_numero_pedido = (SELECT numero_pedido FROM prospects WHERE id = NEW.prospect_id),
    antes_convertido = (SELECT convertido_sem_registro FROM prospects WHERE id = NEW.prospect_id),
    antes_dt_atendido = (SELECT dt_atendido FROM prospects WHERE id = NEW.prospect_id),
    antes_dt_primeiro_contato = (SELECT dt_primeiro_contato FROM prospects WHERE id = NEW.prospect_id),
    antes_data_proxima_acao = (SELECT data_proxima_acao FROM prospects WHERE id = NEW.prospect_id),
    motivo_invalido = CASE
      WHEN EXISTS (SELECT 1 FROM vw_pedidos v WHERE v.prospect_id = NEW.prospect_id AND v.valida = 1) THEN NULL
      WHEN EXISTS (SELECT 1 FROM vw_pedidos v WHERE v.prospect_id = NEW.prospect_id AND v.tipo = 'venda' AND v.fase = 'digitado') THEN 'digitado'
      WHEN EXISTS (SELECT 1 FROM vw_pedidos v WHERE v.prospect_id = NEW.prospect_id AND v.tipo = 'venda' AND v.fase = 'cancelado') THEN 'cancelado'
    END,
    status_novo = (SELECT CASE
      WHEN p.status_atual IN ('invalido','expurgado') THEN p.status_atual     -- congelado: o pedido só fica registrado
      WHEN EXISTS (SELECT 1 FROM vw_pedidos v WHERE v.prospect_id = NEW.prospect_id AND v.valida = 1) THEN 'venda_realizada'
      WHEN EXISTS (SELECT 1 FROM vw_pedidos v WHERE v.prospect_id = NEW.prospect_id AND v.tipo = 'venda') THEN 'aguardando_pedido_valido'
      ELSE p.status_atual END                                                 -- só bonificação: o status não muda
      FROM prospects p WHERE p.id = NEW.prospect_id)
  WHERE id = NEW.id;

  -- nenhum registro do representante no app: o pedido vira o atendimento (mesma regra do cadastro, 0014)
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, 'atendido', p.status_atual, p.status_atual, NEW.data_evento, 'erp', 'atendimento:a' || a.id, p.vendedor_id,
         'atendimento automático via importação do pedido — sem registro do representante'
    FROM prospects p JOIN pedido_aplicacoes a ON a.id = NEW.id
   WHERE p.id = NEW.prospect_id AND a.status_novo <> a.status_anterior AND p.dt_atendido IS NULL
     AND p.status_atual <> 'venda_realizada'
     AND NOT EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = p.id AND c.origem = 'app');

  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, 'pedido', a.status_anterior, a.status_novo, NEW.data_evento, 'erp', 'aplicacao:' || a.id, p.vendedor_id,
         CASE WHEN a.status_novo = 'venda_realizada'
              THEN 'via importação do pedido (' || (SELECT v.numero FROM vw_pedidos v WHERE v.prospect_id = p.id AND v.valida = 1 ORDER BY CAST(v.numero AS INTEGER) LIMIT 1) || ')'
              ELSE 'pedido ' || a.motivo_invalido || ', sem pedido válido, via importação do pedido' END
    FROM prospects p JOIN pedido_aplicacoes a ON a.id = NEW.id
   WHERE p.id = NEW.prospect_id AND a.status_novo <> a.status_anterior;

  UPDATE prospects SET
    status_atual = (SELECT a.status_novo FROM pedido_aplicacoes a WHERE a.id = NEW.id),
    convertido_sem_registro = CASE WHEN status_atual <> 'venda_realizada' AND dt_atendido IS NULL THEN 1 ELSE convertido_sem_registro END,
    dt_atendido = CASE WHEN EXISTS (SELECT 1 FROM movimentacoes WHERE origem = 'erp' AND referencia = 'atendimento:a' || NEW.id) THEN NEW.data_evento ELSE dt_atendido END,
    dt_primeiro_contato = CASE WHEN EXISTS (SELECT 1 FROM movimentacoes WHERE origem = 'erp' AND referencia = 'atendimento:a' || NEW.id)
      THEN COALESCE(MIN(dt_primeiro_contato, NEW.data_evento), NEW.data_evento) ELSE dt_primeiro_contato END,
    dt_pedido = CASE WHEN (SELECT a.status_novo FROM pedido_aplicacoes a WHERE a.id = NEW.id) = 'venda_realizada' THEN COALESCE(dt_pedido, NEW.data_evento) ELSE NULL END,
    numero_pedido = CASE WHEN (SELECT a.status_novo FROM pedido_aplicacoes a WHERE a.id = NEW.id) = 'venda_realizada'
      THEN COALESCE(numero_pedido, (SELECT v.numero FROM vw_pedidos v WHERE v.prospect_id = NEW.prospect_id AND v.valida = 1 ORDER BY CAST(v.numero AS INTEGER) LIMIT 1)) ELSE NULL END,
    data_proxima_acao = NULL,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id
    AND EXISTS (SELECT 1 FROM pedido_aplicacoes a WHERE a.id = NEW.id AND a.status_novo <> a.status_anterior);
END;

-- ---------- apagar os dados de um arquivo ----------
CREATE TABLE pedido_exclusoes (
  id                INTEGER PRIMARY KEY,
  importacao_id     INTEGER NOT NULL UNIQUE REFERENCES importacoes(id),
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  qtd_pedidos       INTEGER,
  qtd_clientes      INTEGER,
  concluida         INTEGER NOT NULL DEFAULT 0 CHECK (concluida IN (0,1)),
  registrado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TRIGGER trg_pedido_exclusoes_validar
BEFORE INSERT ON pedido_exclusoes
BEGIN
  SELECT RAISE(ABORT, 'só o administrador apaga os dados de um arquivo importado')
  WHERE (SELECT perfil FROM usuarios WHERE id = NEW.usuario_id) <> 'administrador' OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.usuario_id);
  SELECT RAISE(ABORT, 'este arquivo não é uma importação de pedidos que possa ser apagada')
  WHERE NOT EXISTS (SELECT 1 FROM pedido_importacoes WHERE importacao_id = NEW.importacao_id AND apagada_em IS NULL);
  SELECT RAISE(ABORT, 'apague primeiro o arquivo de pedidos mais novo')
  WHERE EXISTS (SELECT 1 FROM pedido_importacoes WHERE importacao_id > NEW.importacao_id AND apagada_em IS NULL);
END;

CREATE TRIGGER trg_pedido_exclusoes_aplicar
AFTER INSERT ON pedido_exclusoes
BEGIN
  UPDATE pedido_exclusoes SET
    qtd_pedidos = (SELECT COUNT(*) FROM pedidos_erp WHERE importacao_id = NEW.importacao_id),
    qtd_clientes = (SELECT COUNT(*) FROM pedido_aplicacoes WHERE importacao_id = NEW.importacao_id AND status_novo <> status_anterior)
  WHERE id = NEW.id;

  -- volta cada cliente ao que era antes do arquivo, respeitando o que o representante registrou depois dele
  UPDATE prospects SET
    status_atual = (SELECT CASE
        WHEN a.status_anterior NOT IN ('nao_contactado','em_prospeccao','aguardando_cadastro','sem_interesse') THEN a.status_anterior
        ELSE COALESCE((SELECT CASE c.resultado WHEN 'sem_interesse' THEN 'sem_interesse' ELSE 'aguardando_cadastro' END
                         FROM contatos c WHERE c.prospect_id = a.prospect_id AND c.origem = 'app' AND c.recebido_em > a.registrado_em
                        ORDER BY c.numero_tentativa DESC LIMIT 1), a.status_anterior) END
      FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    dt_pedido = (SELECT a.antes_dt_pedido FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    numero_pedido = (SELECT a.antes_numero_pedido FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    dt_atendido = (SELECT COALESCE(a.antes_dt_atendido, (SELECT MIN(c.data_contato) FROM contatos c WHERE c.prospect_id = a.prospect_id AND c.origem = 'app' AND c.resultado IN ('atendido','pedido_informado')))
                     FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    dt_primeiro_contato = (SELECT COALESCE(a.antes_dt_primeiro_contato, (SELECT MIN(c.data_contato) FROM contatos c WHERE c.prospect_id = a.prospect_id))
                             FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    convertido_sem_registro = (SELECT CASE WHEN EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = a.prospect_id AND c.origem = 'app' AND c.resultado IN ('atendido','pedido_informado'))
                                           THEN 0 ELSE a.antes_convertido END
                                 FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    data_proxima_acao = (SELECT a.antes_data_proxima_acao FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id AND a.prospect_id = prospects.id),
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id IN (SELECT prospect_id FROM pedido_aplicacoes WHERE importacao_id = NEW.importacao_id AND status_novo <> status_anterior);

  DELETE FROM movimentacoes WHERE origem = 'erp' AND referencia IN (
    SELECT 'aplicacao:' || a.id FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id
    UNION ALL SELECT 'atendimento:a' || a.id FROM pedido_aplicacoes a WHERE a.importacao_id = NEW.importacao_id);
  DELETE FROM pedido_aplicacoes WHERE importacao_id = NEW.importacao_id;
  DELETE FROM pedidos_erp WHERE importacao_id = NEW.importacao_id;
  DELETE FROM importacao_linhas WHERE importacao_id = NEW.importacao_id;
  UPDATE pedido_importacoes SET apagada_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         apagada_por = (SELECT login FROM usuarios WHERE id = NEW.usuario_id)
   WHERE importacao_id = NEW.importacao_id;
  UPDATE pedido_exclusoes SET concluida = 1 WHERE id = NEW.id;
END;

-- O pedido e o efeito só saem pela exclusão do arquivo. O histórico e as linhas do arquivo continuam só de inclusão, com
-- essa única exceção: pedido_exclusoes com concluida = 0 só existe dentro da transação do trigger acima.
CREATE TRIGGER trg_pedidos_erp_imutavel_upd BEFORE UPDATE ON pedidos_erp BEGIN SELECT RAISE(ABORT, 'pedidos_erp é somente inclusão'); END;
CREATE TRIGGER trg_pedidos_erp_imutavel_del BEFORE DELETE ON pedidos_erp
WHEN NOT EXISTS (SELECT 1 FROM pedido_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'pedidos_erp só é apagado pela exclusão do arquivo importado'); END;
CREATE TRIGGER trg_pedido_aplicacoes_imutavel_upd BEFORE UPDATE ON pedido_aplicacoes WHEN OLD.status_novo IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'pedido_aplicacoes é somente inclusão'); END;
CREATE TRIGGER trg_pedido_aplicacoes_imutavel_del BEFORE DELETE ON pedido_aplicacoes
WHEN NOT EXISTS (SELECT 1 FROM pedido_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'pedido_aplicacoes só é apagado pela exclusão do arquivo importado'); END;
CREATE TRIGGER trg_pedido_exclusoes_imutavel_upd BEFORE UPDATE ON pedido_exclusoes WHEN OLD.concluida = 1
BEGIN SELECT RAISE(ABORT, 'pedido_exclusoes é somente inclusão'); END;
CREATE TRIGGER trg_pedido_exclusoes_imutavel_del BEFORE DELETE ON pedido_exclusoes
BEGIN SELECT RAISE(ABORT, 'pedido_exclusoes é somente inclusão'); END;

DROP TRIGGER trg_movimentacoes_imutavel_del;
CREATE TRIGGER trg_movimentacoes_imutavel_del BEFORE DELETE ON movimentacoes
WHEN NOT EXISTS (SELECT 1 FROM pedido_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'movimentacoes é somente inclusão'); END;
DROP TRIGGER trg_importacao_linhas_imutavel_del;
CREATE TRIGGER trg_importacao_linhas_imutavel_del BEFORE DELETE ON importacao_linhas
WHEN NOT EXISTS (SELECT 1 FROM pedido_exclusoes WHERE concluida = 0)
BEGIN SELECT RAISE(ABORT, 'importacao_linhas é somente inclusão'); END;

-- ---------- o status novo nos gatilhos de cadastro e de contato: registra, mas não muda a fase ----------
DROP TRIGGER trg_eventos_erp_aplicar;
CREATE TRIGGER trg_eventos_erp_aplicar
AFTER INSERT ON eventos_erp
BEGIN
  -- nenhum registro do representante no app: o cadastro/pedido vira o atendimento (o status não muda neste movimento)
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, 'atendido', p.status_atual, p.status_atual, NEW.data_evento, 'erp', 'atendimento:' || NEW.id, p.vendedor_id,
         'atendimento automático via importação do ' || NEW.tipo || COALESCE(' (' || NEW.documento || ')', '')
           || ' — sem registro do representante'
    FROM prospects p
   WHERE p.id = NEW.prospect_id AND NEW.tipo IN ('cadastro','pedido') AND p.dt_atendido IS NULL
     AND p.status_atual <> 'venda_realizada'
     AND NOT EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = p.id AND c.origem = 'app');

  -- cadastro → Análise financeira · pedido → Venda realizada (final) · baixa → Inválido
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, NEW.tipo, p.status_atual,
         CASE NEW.tipo
           WHEN 'baixa'    THEN 'invalido'
           WHEN 'pedido'   THEN 'venda_realizada'
           WHEN 'cadastro' THEN CASE WHEN p.status_atual IN ('venda_realizada','aguardando_pedido','aguardando_pedido_valido') THEN p.status_atual ELSE 'analise_financeira' END
         END,
         NEW.data_evento, 'erp', CAST(NEW.id AS TEXT), p.vendedor_id,
         CASE NEW.tipo WHEN 'baixa' THEN 'via importação de CNPJs baixados' ELSE 'via importação do ' || NEW.tipo END
           || COALESCE(' (' || NEW.documento || ')', '')
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM movimentacoes WHERE origem = 'erp' AND referencia = CAST(NEW.id AS TEXT)),
    convertido_sem_registro = CASE
      WHEN NEW.tipo IN ('cadastro','pedido') AND status_atual <> 'venda_realizada' AND dt_atendido IS NULL THEN 1
      ELSE convertido_sem_registro END,
    -- só com o atendimento automático criado acima (nenhum registro do representante)
    dt_atendido = CASE
      WHEN EXISTS (SELECT 1 FROM movimentacoes WHERE origem = 'erp' AND referencia = 'atendimento:' || NEW.id) THEN NEW.data_evento
      ELSE dt_atendido END,
    dt_primeiro_contato = CASE
      WHEN EXISTS (SELECT 1 FROM movimentacoes WHERE origem = 'erp' AND referencia = 'atendimento:' || NEW.id)
        THEN COALESCE(MIN(dt_primeiro_contato, NEW.data_evento), NEW.data_evento)
      ELSE dt_primeiro_contato END,
    dt_cadastro_erp    = CASE WHEN NEW.tipo = 'cadastro' THEN COALESCE(dt_cadastro_erp, NEW.data_evento) ELSE dt_cadastro_erp END,
    codigo_cliente_erp = CASE WHEN NEW.tipo = 'cadastro' THEN COALESCE(NEW.documento, codigo_cliente_erp) ELSE codigo_cliente_erp END,
    dt_pedido          = CASE WHEN NEW.tipo = 'pedido' THEN COALESCE(dt_pedido, NEW.data_evento) ELSE dt_pedido END,
    numero_pedido      = CASE WHEN NEW.tipo = 'pedido' THEN COALESCE(numero_pedido, NEW.documento) ELSE numero_pedido END,
    analise_financeira_ate = CASE WHEN NEW.tipo = 'cadastro' AND dt_cadastro_erp IS NULL
      THEN date(NEW.data_evento, '+' || (SELECT valor FROM parametros WHERE chave = 'prazo_analise_financeira_dias') || ' days')
      ELSE analise_financeira_ate END,
    situacao_cadastral = CASE WHEN NEW.tipo = 'baixa' THEN 'baixada' ELSE situacao_cadastral END,
    dt_baixa           = CASE WHEN NEW.tipo = 'baixa' THEN NEW.data_evento ELSE dt_baixa END,
    data_proxima_acao  = NULL,
    atualizado_em      = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;
END;

DROP TRIGGER trg_contatos_aplicar;
CREATE TRIGGER trg_contatos_aplicar
AFTER INSERT ON contatos
BEGIN
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, usuario_id, vendedor_id, detalhe)
  SELECT p.id, NEW.resultado, p.status_atual,
         CASE
           WHEN p.status_atual IN ('analise_financeira','aguardando_pedido','aguardando_pedido_valido') THEN p.status_atual
           WHEN NEW.resultado IN ('atendido','pedido_informado') THEN 'aguardando_cadastro'
           WHEN NEW.resultado = 'sem_interesse' THEN 'sem_interesse'
           WHEN p.status_atual = 'nao_contactado' THEN 'em_prospeccao'
           ELSE p.status_atual
         END,
         NEW.data_contato, 'contato', NEW.id,
         CASE WHEN NEW.origem = 'app' THEN NEW.usuario_id END, p.vendedor_id,
         TRIM(COALESCE((SELECT m.descricao FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id) || ' — ', '')
              || COALESCE(NEW.observacao, '')
              || COALESCE(' · pedido de ' || strftime('%d/%m/%Y', NEW.data_pedido_informado), '')
              -- atendimento informado com data posterior ao automático da importação: fica registrado no histórico
              || CASE WHEN NEW.resultado IN ('atendido','pedido_informado') AND p.convertido_sem_registro = 1
                        AND p.dt_atendido IS NOT NULL AND NEW.data_contato > p.dt_atendido
                        AND EXISTS (SELECT 1 FROM movimentacoes a WHERE a.prospect_id = p.id AND a.origem = 'erp' AND a.tipo = 'atendido')
                      THEN ' · representante informou data posterior à importação (atendimento considerado em '
                           || strftime('%d/%m/%Y', p.dt_atendido) || ')'
                      ELSE '' END, ' —·')
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM movimentacoes WHERE origem = 'contato' AND referencia = NEW.id),
    tentativas = NEW.numero_tentativa,
    -- 1º registro: sempre a primeira data (do representante, da planilha ou do atendimento automático da importação)
    dt_primeiro_contato = COALESCE(MIN(dt_primeiro_contato, NEW.data_contato), NEW.data_contato),
    dt_segundo_contato  = CASE WHEN NEW.numero_tentativa = 2 THEN NEW.data_contato ELSE dt_segundo_contato END,
    dt_ultimo_contato   = NEW.data_contato,
    -- "atendido em": o 1º atendido; sobre o automático da importação, vale a primeira data (a dele, se anterior)
    dt_atendido = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND dt_atendido IS NULL THEN NEW.data_contato
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND convertido_sem_registro = 1 THEN MIN(dt_atendido, NEW.data_contato)
      ELSE dt_atendido END,
    -- quem registra o atendimento tira o alerta "convertido sem registro"
    convertido_sem_registro = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND NEW.origem = 'app' THEN 0
      ELSE convertido_sem_registro END,
    dt_pedido_informado = CASE WHEN NEW.resultado = 'pedido_informado' THEN NEW.data_pedido_informado ELSE dt_pedido_informado END,
    prazo_cadastro_ate = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND dt_atendido IS NULL
        THEN date(NEW.data_contato, '+' || (SELECT valor FROM parametros WHERE chave = 'prazo_cadastro_dias') || ' days')
      ELSE prazo_cadastro_ate END,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;

  UPDATE prospects SET
    -- retorno agendado (opcional) só existe na negociação; a lista principal está sempre pendente
    data_proxima_acao = CASE WHEN status_atual = 'aguardando_cadastro' THEN NEW.data_retorno ELSE NULL END,
    -- motivo final = o do último "sem interesse"
    motivo_sem_interesse_id = CASE WHEN NEW.resultado = 'sem_interesse' THEN NEW.motivo_id ELSE motivo_sem_interesse_id END
  WHERE id = NEW.prospect_id;
END;

-- ---------- tela nova nos perfis do sistema (o financeiro recebe só se o administrador marcar) ----------
INSERT INTO perfil_telas (perfil_id, tela)
SELECT id, 'pedidos' FROM perfis WHERE sistema = 1 AND base <> 'financeiro';
