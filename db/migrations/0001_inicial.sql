-- =====================================================================
-- GERMANI Prospect — migração 0001 (estrutura inicial)
-- Banco: Turso / libSQL (SQLite). Documentação: docs/02-modelo-dados.md
--
-- Princípios aplicados aqui (não só no código):
--   * Histórico append-only: contatos, eventos_erp, historico_status,
--     transferencias e importacao_linhas não aceitam UPDATE nem DELETE.
--   * Toda mudança de status nasce de um evento (contato, evento ERP,
--     transferência) e é aplicada por trigger — quem grava o evento não
--     consegue deixar o prospect inconsistente.
--   * Parâmetros (prazos, nº de tentativas) vêm da tabela parametros,
--     nunca de constantes no código.
--   * "Hoje" = dia em America/Sao_Paulo = date('now','-3 hours')
--     (Brasil sem horário de verão desde 2019).
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Parâmetros editáveis pelo administrador
-- ---------------------------------------------------------------------
CREATE TABLE parametros (
  chave        TEXT PRIMARY KEY,
  valor        TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('inteiro','texto')),
  descricao    TEXT NOT NULL,
  alterado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  alterado_por TEXT,
  CHECK (tipo <> 'inteiro' OR (valor GLOB '[0-9]*' AND CAST(valor AS INTEGER) >= 0))
);

INSERT INTO parametros (chave, valor, tipo, descricao) VALUES
  ('tentativas_maximas',            '2',   'inteiro', 'Atendimentos por prospect; ao atingir, sai da lista de trabalho (sem interesse → "Sem interesse"; com interesse → aguarda cadastro no ERP)'),
  ('dias_entre_tentativas',         '7',   'inteiro', 'Dias até o prospect voltar à fila após uma tentativa sem conclusão'),
  ('prazo_cadastro_dias',           '15',  'inteiro', 'Prazo, a partir do interesse declarado, para o cliente aparecer cadastrado no ERP'),
  ('prazo_analise_financeira_dias', '10',  'inteiro', 'Dias de análise financeira após a entrada do pedido'),
  ('dias_alerta_sem_lancamento',    '7',   'inteiro', 'Vendedor sem registrar contato há mais de N dias entra no bloco de atenção'),
  ('dias_alerta_sem_movimento',     '30',  'inteiro', 'Prospect ativo sem movimento há mais de N dias entra no bloco de atenção'),
  ('raio_gps_metros',               '200', 'inteiro', 'Raio para considerar a visita confirmada pelo GPS');

-- ---------------------------------------------------------------------
-- Status (tabela de referência; regras de transição ficam nos triggers)
-- ---------------------------------------------------------------------
CREATE TABLE status (
  codigo             TEXT PRIMARY KEY,
  nome               TEXT NOT NULL,
  cor                TEXT NOT NULL,
  ordem              INTEGER NOT NULL UNIQUE,
  origem             TEXT NOT NULL CHECK (origem IN ('inicial','app','erp')),
  ativo_na_carteira  INTEGER NOT NULL CHECK (ativo_na_carteira IN (0,1)), -- vendedor ainda trabalha o prospect
  conta_contactado   INTEGER NOT NULL CHECK (conta_contactado IN (0,1)),  -- numerador de % contactado
  conta_carteira     INTEGER NOT NULL CHECK (conta_carteira IN (0,1))     -- denominador (inválido = 0)
);

INSERT INTO status (codigo, nome, cor, ordem, origem, ativo_na_carteira, conta_contactado, conta_carteira) VALUES
  ('nao_contactado',  'Não contactado',     '#9CA3AF', 1, 'inicial', 1, 0, 1),
  ('em_prospeccao',   'Em prospecção',      '#0E7490', 2, 'app',     1, 1, 1),
  ('sem_interesse',   'Sem interesse',      '#3F3F46', 3, 'app',     0, 1, 1),
  ('cadastrado_erp',  'Cadastrado no ERP',  '#0F766E', 4, 'erp',     0, 1, 1),
  ('venda_realizada', 'Venda realizada',    '#1D4ED8', 5, 'erp',     0, 1, 1),
  ('invalido',        'Inválido (baixado)', '#D1D5DB', 6, 'erp',     0, 0, 0);

-- ---------------------------------------------------------------------
-- Motivos de "sem interesse" (lista editável)
-- ---------------------------------------------------------------------
CREATE TABLE motivos_sem_interesse (
  id                INTEGER PRIMARY KEY,
  codigo            TEXT NOT NULL UNIQUE,
  descricao         TEXT NOT NULL,
  exige_observacao  INTEGER NOT NULL DEFAULT 0 CHECK (exige_observacao IN (0,1)),
  uso_app           INTEGER NOT NULL DEFAULT 1 CHECK (uso_app IN (0,1)), -- 0 = só uso do sistema/importação
  ativo             INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ordem             INTEGER NOT NULL
);

INSERT INTO motivos_sem_interesse (codigo, descricao, exige_observacao, uso_app, ordem) VALUES
  ('PRECO',            'Preço acima do praticado',                  0, 1, 1),
  ('JA_TEM_FORNECEDOR','Já tem fornecedor / contrato',              0, 1, 2),
  ('MIX_NAO_ATENDE',   'Mix de produtos não atende',                0, 1, 3),
  ('PEDIDO_MINIMO',    'Pedido mínimo alto',                        0, 1, 4),
  ('CONDICAO_PAGTO',   'Prazo / condição de pagamento',             0, 1, 5),
  ('LOGISTICA',        'Frequência ou dia de entrega',              0, 1, 6),
  ('BAIXO_GIRO',       'Não vende a categoria / baixo giro',        0, 1, 7),
  ('SEM_ESPACO',       'Sem espaço na gôndola',                     0, 1, 8),
  ('COMPRA_CENTRAL',   'Compra centralizada (rede / matriz)',       0, 1, 9),
  ('OUTRO',            'Outro (descrever na observação)',           1, 1, 10),
  ('SEM_RETORNO',      'Sem retorno após as tentativas',            0, 0, 90),
  ('NAO_INFORMADO',    'Não informado (importação inicial)',        0, 0, 91);

-- ---------------------------------------------------------------------
-- Usuários (administrador, supervisor, vendedor) — um só cadastro
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id               INTEGER PRIMARY KEY,
  perfil           TEXT NOT NULL CHECK (perfil IN ('administrador','supervisor','vendedor')),
  codigo_erp       TEXT,                         -- COD (vendedor) ou COD SUP (supervisor) da planilha/Senior
  nome             TEXT NOT NULL,
  nome_busca       TEXT NOT NULL,
  login            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash       TEXT,                         -- PBKDF2-SHA256 (shared/senha.mjs); NULL = sem acesso liberado
  senha_provisoria INTEGER NOT NULL DEFAULT 1 CHECK (senha_provisoria IN (0,1)),
  supervisor_id    INTEGER REFERENCES usuarios(id),
  -- representante: visita a carteira, SEM rota · vendedor: atendimento amplo, COM rota/subrota.
  -- NULL até o administrador definir (npm run usuarios -- tipo <login> representante|vendedor);
  -- enquanto NULL, o app aplica a visão de representante (a mais restrita).
  tipo_atuacao     TEXT CHECK (tipo_atuacao IS NULL OR tipo_atuacao IN ('representante','vendedor')),
  ativo            INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  atualizado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (perfil, codigo_erp),
  CHECK (perfil <> 'vendedor' OR supervisor_id IS NOT NULL),
  CHECK (supervisor_id IS NULL OR supervisor_id <> id),
  CHECK (tipo_atuacao IS NULL OR perfil IN ('vendedor','supervisor'))
);

CREATE TRIGGER trg_usuarios_supervisor_valido
BEFORE INSERT ON usuarios
WHEN NEW.supervisor_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM usuarios s WHERE s.id = NEW.supervisor_id AND s.perfil = 'supervisor')
BEGIN
  SELECT RAISE(ABORT, 'supervisor_id deve apontar para um usuário com perfil supervisor');
END;

CREATE TRIGGER trg_usuarios_supervisor_valido_upd
BEFORE UPDATE OF supervisor_id ON usuarios
WHEN NEW.supervisor_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM usuarios s WHERE s.id = NEW.supervisor_id AND s.perfil = 'supervisor')
BEGIN
  SELECT RAISE(ABORT, 'supervisor_id deve apontar para um usuário com perfil supervisor');
END;

-- ---------------------------------------------------------------------
-- Importações (auditoria de toda planilha carregada)
-- ---------------------------------------------------------------------
CREATE TABLE importacoes (
  id                INTEGER PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN ('base_prospects','cadastro_erp','pedido_erp','cnpj_baixado')),
  arquivo_nome      TEXT NOT NULL,
  arquivo_sha256    TEXT NOT NULL,
  executado_por     TEXT NOT NULL,
  iniciado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  concluido_em      TEXT,
  situacao          TEXT NOT NULL DEFAULT 'em_andamento' CHECK (situacao IN ('em_andamento','concluida','falhou')),
  linhas_lidas      INTEGER NOT NULL DEFAULT 0,
  linhas_aceitas    INTEGER NOT NULL DEFAULT 0,
  linhas_rejeitadas INTEGER NOT NULL DEFAULT 0,
  linhas_ignoradas  INTEGER NOT NULL DEFAULT 0,  -- ex.: cliente do ERP que não é prospect; evento já importado
  observacao        TEXT,
  -- critério de aceite: nenhuma linha some
  CHECK (situacao <> 'concluida' OR linhas_lidas = linhas_aceitas + linhas_rejeitadas + linhas_ignoradas)
);

CREATE TABLE importacao_linhas (
  importacao_id  INTEGER NOT NULL REFERENCES importacoes(id),
  numero_linha   INTEGER NOT NULL,           -- linha na planilha (cabeçalho = 1)
  cnpj           TEXT,                       -- normalizado, quando foi possível
  resultado      TEXT NOT NULL CHECK (resultado IN ('aceita','rejeitada','ignorada')),
  mensagens      TEXT NOT NULL DEFAULT '[]', -- JSON: erros (rejeitada), avisos (aceita) ou motivo (ignorada)
  dados_brutos   TEXT NOT NULL,              -- JSON da linha exatamente como veio
  PRIMARY KEY (importacao_id, numero_linha)
);

-- ---------------------------------------------------------------------
-- Prospects (um CNPJ = um ponto de controle)
-- ---------------------------------------------------------------------
CREATE TABLE prospects (
  id                       INTEGER PRIMARY KEY,
  cnpj                     TEXT NOT NULL UNIQUE CHECK (length(cnpj) = 14),
  cnpj_raiz                TEXT NOT NULL CHECK (length(cnpj_raiz) = 8),
  cnpj_secundario          TEXT,            -- 2ª coluna "CNPJ" da planilha, quando diferente da 1ª
  razao_social             TEXT NOT NULL,
  nome_fantasia            TEXT,
  endereco                 TEXT,
  bairro                   TEXT,
  cidade                   TEXT,
  uf                       TEXT CHECK (uf IS NULL OR length(uf) = 2),
  cep                      TEXT CHECK (cep IS NULL OR length(cep) = 8),
  latitude                 REAL CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  longitude                REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  telefone                 TEXT,
  tipologia_gtm            TEXT,
  onda                     TEXT,
  tipo                     TEXT,
  rota                     TEXT,
  subrota                  TEXT,
  obs_planilha             TEXT,
  dt_entrada_base          TEXT NOT NULL DEFAULT (date('now','-3 hours')) CHECK (date(dt_entrada_base) = dt_entrada_base),
  -- busca sem acento (preenchida pela importação via shared/texto.mjs)
  busca                    TEXT NOT NULL,   -- razão + fantasia + CNPJ + cidade + bairro
  cidade_busca             TEXT,
  bairro_busca             TEXT,
  -- carteira
  vendedor_id              INTEGER NOT NULL REFERENCES usuarios(id),
  -- estado derivado (mantido SOMENTE pelos triggers de eventos)
  status_atual             TEXT NOT NULL DEFAULT 'nao_contactado' REFERENCES status(codigo),
  tentativas               INTEGER NOT NULL DEFAULT 0,
  dt_primeiro_contato      TEXT,
  dt_segundo_contato       TEXT,
  dt_ultimo_contato        TEXT,
  data_proxima_acao        TEXT,            -- quando volta a aparecer como pendente
  motivo_sem_interesse_id  INTEGER REFERENCES motivos_sem_interesse(id),
  dt_interesse             TEXT,
  prazo_cadastro_ate       TEXT,
  dt_cadastro_erp          TEXT,
  codigo_cliente_erp       TEXT,
  convertido_sem_registro  INTEGER NOT NULL DEFAULT 0 CHECK (convertido_sem_registro IN (0,1)),
  dt_pedido                TEXT,
  numero_pedido            TEXT,
  analise_financeira_ate   TEXT,
  situacao_cadastral       TEXT NOT NULL DEFAULT 'ativa' CHECK (situacao_cadastral IN ('ativa','baixada')),
  dt_baixa                 TEXT,
  importacao_id            INTEGER REFERENCES importacoes(id),
  criado_em                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  atualizado_em            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (situacao_cadastral = 'ativa' OR status_atual = 'invalido')
);

CREATE INDEX ix_prospects_vendedor_status ON prospects (vendedor_id, status_atual);
CREATE INDEX ix_prospects_proxima_acao    ON prospects (data_proxima_acao);
CREATE INDEX ix_prospects_cidade          ON prospects (cidade_busca, uf, bairro_busca);
CREATE INDEX ix_prospects_rota            ON prospects (rota, subrota);
CREATE INDEX ix_prospects_raiz            ON prospects (cnpj_raiz);

-- O vendedor da carteira precisa ser vendedor ou supervisor ativo.
CREATE TRIGGER trg_prospects_vendedor_valido
BEFORE INSERT ON prospects
WHEN NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = NEW.vendedor_id AND u.perfil IN ('vendedor','supervisor'))
BEGIN
  SELECT RAISE(ABORT, 'vendedor_id deve ser um usuário vendedor ou supervisor');
END;

-- ---------------------------------------------------------------------
-- Histórico de status (foto de cada mudança — base dos filtros por período)
-- ---------------------------------------------------------------------
CREATE TABLE historico_status (
  id               INTEGER PRIMARY KEY,
  prospect_id      INTEGER NOT NULL REFERENCES prospects(id),
  status_anterior  TEXT REFERENCES status(codigo),
  status_novo      TEXT NOT NULL REFERENCES status(codigo),
  data_evento      TEXT NOT NULL,                 -- data de negócio (AAAA-MM-DD)
  origem           TEXT NOT NULL CHECK (origem IN ('importacao','contato','erp')),
  referencia       TEXT,                          -- id do contato / evento ERP
  registrado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Posição numa data D = última linha (maior id) com data_evento <= D. O id preserva a ordem causal.
CREATE INDEX ix_historico_prospect_data ON historico_status (prospect_id, data_evento, id);

CREATE TRIGGER trg_prospects_historico_inicial
AFTER INSERT ON prospects
BEGIN
  INSERT INTO historico_status (prospect_id, status_anterior, status_novo, data_evento, origem, referencia)
  VALUES (NEW.id, NULL, NEW.status_atual, NEW.dt_entrada_base, 'importacao', CAST(NEW.importacao_id AS TEXT));
END;

-- ---------------------------------------------------------------------
-- Contatos / tentativas (registrados no app ou vindos da importação inicial)
-- ---------------------------------------------------------------------
CREATE TABLE contatos (
  id                     TEXT PRIMARY KEY,               -- UUID gerado no aparelho (reenvio offline idempotente)
  prospect_id            INTEGER NOT NULL REFERENCES prospects(id),
  usuario_id             INTEGER NOT NULL REFERENCES usuarios(id),
  numero_tentativa       INTEGER NOT NULL CHECK (numero_tentativa >= 1),
  data_contato           TEXT NOT NULL CHECK (date(data_contato) = data_contato), -- data do APARELHO
  data_hora_dispositivo  TEXT,                           -- ISO com fuso, informada pelo aparelho
  recebido_em            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  canal                  TEXT NOT NULL CHECK (canal IN ('visita','telefone','whatsapp','nao_informado')),
  resultado              TEXT NOT NULL CHECK (resultado IN ('com_interesse','sem_interesse','sem_conclusao')),
  motivo_id              INTEGER REFERENCES motivos_sem_interesse(id),
  observacao             TEXT,
  observacao_busca       TEXT,                           -- sem acento, para palavras-chave
  data_retorno           TEXT CHECK (data_retorno IS NULL OR date(data_retorno) = data_retorno),
  latitude               REAL,
  longitude              REAL,
  distancia_m            REAL,
  gps_confirmado         INTEGER CHECK (gps_confirmado IS NULL OR gps_confirmado IN (0,1)),
  origem                 TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app','importacao')),
  importacao_id          INTEGER REFERENCES importacoes(id),
  CHECK (resultado <> 'sem_interesse' OR motivo_id IS NOT NULL),
  CHECK (data_retorno IS NULL OR data_retorno >= data_contato),  -- retorno é opcional (agenda)
  CHECK (resultado = 'sem_interesse' OR motivo_id IS NULL),
  CHECK (origem <> 'importacao' OR importacao_id IS NOT NULL),
  CHECK (canal <> 'nao_informado' OR origem = 'importacao'),  -- a planilha base não informa o canal
  UNIQUE (prospect_id, numero_tentativa)
);
CREATE INDEX ix_contatos_usuario_data ON contatos (usuario_id, data_contato);
CREATE INDEX ix_contatos_data         ON contatos (data_contato);

-- Validações antes de gravar o contato
CREATE TRIGGER trg_contatos_validar
BEFORE INSERT ON contatos
BEGIN
  SELECT RAISE(ABORT, 'prospect não está mais na carteira ativa (encerrado, cadastrado, vendido ou baixado)')
  WHERE (SELECT s.ativo_na_carteira FROM prospects p JOIN status s ON s.codigo = p.status_atual
         WHERE p.id = NEW.prospect_id) = 0;

  SELECT RAISE(ABORT, 'usuário sem permissão para registrar contato neste prospect')
  WHERE NOT EXISTS (
    SELECT 1
      FROM prospects p
      JOIN usuarios v ON v.id = p.vendedor_id
      JOIN usuarios u ON u.id = NEW.usuario_id AND u.ativo = 1
     WHERE p.id = NEW.prospect_id
       AND (u.id = v.id OR u.perfil = 'administrador' OR (u.perfil = 'supervisor' AND v.supervisor_id = u.id))
  );

  SELECT RAISE(ABORT, 'limite de atendimentos atingido: prospect fora da lista de trabalho')
  WHERE (SELECT tentativas FROM prospects WHERE id = NEW.prospect_id)
        >= (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'tentativas_maximas');

  SELECT RAISE(ABORT, 'numero_tentativa fora de sequência')
  WHERE NEW.numero_tentativa <> (SELECT tentativas + 1 FROM prospects WHERE id = NEW.prospect_id);

  SELECT RAISE(ABORT, 'data do contato anterior ao último contato registrado')
  WHERE NEW.data_contato < COALESCE((SELECT dt_ultimo_contato FROM prospects WHERE id = NEW.prospect_id), '0000-00-00');

  SELECT RAISE(ABORT, 'motivo inativo ou não disponível para o app')
  WHERE NEW.motivo_id IS NOT NULL AND NEW.origem = 'app'
    AND NOT EXISTS (SELECT 1 FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id AND m.ativo = 1 AND m.uso_app = 1);

  SELECT RAISE(ABORT, 'este motivo exige observação')
  WHERE NEW.motivo_id IS NOT NULL AND COALESCE(trim(NEW.observacao), '') = ''
    AND EXISTS (SELECT 1 FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id AND m.exige_observacao = 1);
END;

-- Aplicação da regra de status (docs/03-regras-negocio.md §2)
--   tentativa >= tentativas_maximas e resultado <> com_interesse → sem_interesse
--   demais casos                                               → em_prospeccao
-- "Com interesse" não muda o status: marca dt_interesse e abre o prazo de cadastro no ERP.
-- Ao atingir o limite de atendimentos o prospect SAI DA LISTA em qualquer resultado
-- (data_proxima_acao = NULL; com interesse aguarda o cadastro no ERP). Indicadores continuam contando.
CREATE TRIGGER trg_contatos_aplicar
AFTER INSERT ON contatos
BEGIN
  INSERT INTO historico_status (prospect_id, status_anterior, status_novo, data_evento, origem, referencia)
  SELECT p.id, p.status_atual,
         CASE
           WHEN NEW.resultado <> 'com_interesse'
            AND NEW.numero_tentativa >= (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'tentativas_maximas') THEN 'sem_interesse'
           ELSE 'em_prospeccao'
         END,
         NEW.data_contato, 'contato', NEW.id
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM historico_status WHERE origem = 'contato' AND referencia = NEW.id),
    tentativas = NEW.numero_tentativa,
    dt_primeiro_contato = COALESCE(dt_primeiro_contato, NEW.data_contato),
    dt_segundo_contato  = CASE WHEN NEW.numero_tentativa = 2 THEN NEW.data_contato ELSE dt_segundo_contato END,
    dt_ultimo_contato   = NEW.data_contato,
    dt_interesse = CASE WHEN NEW.resultado = 'com_interesse' AND dt_interesse IS NULL THEN NEW.data_contato ELSE dt_interesse END,
    prazo_cadastro_ate = CASE
      WHEN NEW.resultado = 'com_interesse' AND dt_interesse IS NULL
        THEN date(NEW.data_contato, '+' || (SELECT valor FROM parametros WHERE chave = 'prazo_cadastro_dias') || ' days')
      ELSE prazo_cadastro_ate END,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;

  UPDATE prospects SET
    data_proxima_acao = CASE
      WHEN NEW.numero_tentativa >= (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'tentativas_maximas') THEN NULL
      ELSE COALESCE(NEW.data_retorno,
           date(NEW.data_contato, '+' || (SELECT valor FROM parametros WHERE chave = 'dias_entre_tentativas') || ' days'))
    END,
    motivo_sem_interesse_id = CASE status_atual
      WHEN 'sem_interesse' THEN COALESCE(NEW.motivo_id, (SELECT id FROM motivos_sem_interesse WHERE codigo = 'SEM_RETORNO'))
      ELSE motivo_sem_interesse_id
    END
  WHERE id = NEW.prospect_id;
END;

-- ---------------------------------------------------------------------
-- Eventos do ERP Senior (cadastro, pedido) e CNPJs baixados — via importação
-- ---------------------------------------------------------------------
CREATE TABLE eventos_erp (
  id             INTEGER PRIMARY KEY,
  prospect_id    INTEGER NOT NULL REFERENCES prospects(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('cadastro','pedido','baixa')),
  data_evento    TEXT NOT NULL CHECK (date(data_evento) = data_evento),
  documento      TEXT,                     -- código do cliente (cadastro) / nº do pedido (pedido)
  importacao_id  INTEGER NOT NULL REFERENCES importacoes(id),
  registrado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- reimportar o mesmo arquivo não duplica eventos
CREATE UNIQUE INDEX ux_eventos_erp ON eventos_erp (prospect_id, tipo, COALESCE(documento, ''));

CREATE TRIGGER trg_eventos_erp_validar
BEFORE INSERT ON eventos_erp
BEGIN
  SELECT RAISE(ABORT, 'CNPJ baixado: impossibilitado de faturamento')
  WHERE NEW.tipo IN ('cadastro','pedido')
    AND (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) = 'invalido';
  SELECT RAISE(ABORT, 'CNPJ já registrado como baixado')
  WHERE NEW.tipo = 'baixa'
    AND (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) = 'invalido';
END;

CREATE TRIGGER trg_eventos_erp_aplicar
AFTER INSERT ON eventos_erp
BEGIN
  INSERT INTO historico_status (prospect_id, status_anterior, status_novo, data_evento, origem, referencia)
  SELECT p.id, p.status_atual,
         CASE NEW.tipo
           WHEN 'baixa'    THEN 'invalido'
           WHEN 'pedido'   THEN 'venda_realizada'
           WHEN 'cadastro' THEN CASE WHEN p.status_atual = 'venda_realizada' THEN 'venda_realizada' ELSE 'cadastrado_erp' END
         END,
         NEW.data_evento, 'erp', CAST(NEW.id AS TEXT)
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM historico_status WHERE origem = 'erp' AND referencia = CAST(NEW.id AS TEXT)),
    convertido_sem_registro = CASE
      WHEN NEW.tipo IN ('cadastro','pedido') AND status_atual <> 'venda_realizada' AND dt_interesse IS NULL THEN 1
      ELSE convertido_sem_registro END,
    dt_cadastro_erp    = CASE WHEN NEW.tipo = 'cadastro' THEN COALESCE(dt_cadastro_erp, NEW.data_evento) ELSE dt_cadastro_erp END,
    codigo_cliente_erp = CASE WHEN NEW.tipo = 'cadastro' THEN COALESCE(NEW.documento, codigo_cliente_erp) ELSE codigo_cliente_erp END,
    dt_pedido          = CASE WHEN NEW.tipo = 'pedido' THEN COALESCE(dt_pedido, NEW.data_evento) ELSE dt_pedido END,
    numero_pedido      = CASE WHEN NEW.tipo = 'pedido' THEN COALESCE(numero_pedido, NEW.documento) ELSE numero_pedido END,
    analise_financeira_ate = CASE WHEN NEW.tipo = 'pedido' AND dt_pedido IS NULL
      THEN date(NEW.data_evento, '+' || (SELECT valor FROM parametros WHERE chave = 'prazo_analise_financeira_dias') || ' days')
      ELSE analise_financeira_ate END,
    situacao_cadastral = CASE WHEN NEW.tipo = 'baixa' THEN 'baixada' ELSE situacao_cadastral END,
    dt_baixa           = CASE WHEN NEW.tipo = 'baixa' THEN NEW.data_evento ELSE dt_baixa END,
    data_proxima_acao  = NULL,
    atualizado_em      = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;
END;

-- ---------------------------------------------------------------------
-- Transferências de carteira (redistribuição pelo supervisor/administrador)
-- ---------------------------------------------------------------------
CREATE TABLE transferencias (
  id                INTEGER PRIMARY KEY,
  prospect_id       INTEGER NOT NULL REFERENCES prospects(id),
  de_vendedor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  para_vendedor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  data_transferencia TEXT NOT NULL CHECK (date(data_transferencia) = data_transferencia),
  motivo            TEXT NOT NULL,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),  -- quem fez
  registrado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (de_vendedor_id <> para_vendedor_id)
);

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
       AND (u.perfil = 'administrador'
            OR (u.perfil = 'supervisor'
                AND u.id = (SELECT COALESCE(supervisor_id, id) FROM usuarios WHERE id = NEW.de_vendedor_id)
                AND u.id = (SELECT COALESCE(supervisor_id, id) FROM usuarios WHERE id = NEW.para_vendedor_id)))
  );
END;

CREATE TRIGGER trg_transferencias_aplicar
AFTER INSERT ON transferencias
BEGIN
  UPDATE prospects SET vendedor_id = NEW.para_vendedor_id, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = NEW.prospect_id;
END;

-- ---------------------------------------------------------------------
-- Auditoria de ações administrativas
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY,
  data_hora   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  executado_por TEXT NOT NULL,
  acao        TEXT NOT NULL,
  entidade    TEXT NOT NULL,
  entidade_id TEXT,
  detalhes    TEXT NOT NULL DEFAULT '{}'
);

CREATE TRIGGER trg_parametros_auditoria
AFTER UPDATE OF valor ON parametros
BEGIN
  INSERT INTO auditoria (executado_por, acao, entidade, entidade_id, detalhes)
  VALUES (COALESCE(NEW.alterado_por, 'desconhecido'), 'alterar_parametro', 'parametros', NEW.chave,
          json_object('de', OLD.valor, 'para', NEW.valor));
END;

-- ---------------------------------------------------------------------
-- Imutabilidade do histórico
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_contatos_imutavel_upd          BEFORE UPDATE ON contatos          BEGIN SELECT RAISE(ABORT, 'contatos é somente inclusão: corrija com um novo registro'); END;
CREATE TRIGGER trg_contatos_imutavel_del          BEFORE DELETE ON contatos          BEGIN SELECT RAISE(ABORT, 'contatos é somente inclusão'); END;
CREATE TRIGGER trg_eventos_erp_imutavel_upd       BEFORE UPDATE ON eventos_erp       BEGIN SELECT RAISE(ABORT, 'eventos_erp é somente inclusão'); END;
CREATE TRIGGER trg_eventos_erp_imutavel_del       BEFORE DELETE ON eventos_erp       BEGIN SELECT RAISE(ABORT, 'eventos_erp é somente inclusão'); END;
CREATE TRIGGER trg_historico_imutavel_upd         BEFORE UPDATE ON historico_status  BEGIN SELECT RAISE(ABORT, 'historico_status é somente inclusão'); END;
CREATE TRIGGER trg_historico_imutavel_del         BEFORE DELETE ON historico_status  BEGIN SELECT RAISE(ABORT, 'historico_status é somente inclusão'); END;
CREATE TRIGGER trg_transferencias_imutavel_upd    BEFORE UPDATE ON transferencias    BEGIN SELECT RAISE(ABORT, 'transferencias é somente inclusão'); END;
CREATE TRIGGER trg_transferencias_imutavel_del    BEFORE DELETE ON transferencias    BEGIN SELECT RAISE(ABORT, 'transferencias é somente inclusão'); END;
CREATE TRIGGER trg_importacao_linhas_imutavel_upd BEFORE UPDATE ON importacao_linhas BEGIN SELECT RAISE(ABORT, 'importacao_linhas é somente inclusão'); END;
CREATE TRIGGER trg_importacao_linhas_imutavel_del BEFORE DELETE ON importacao_linhas BEGIN SELECT RAISE(ABORT, 'importacao_linhas é somente inclusão'); END;
CREATE TRIGGER trg_auditoria_imutavel_upd         BEFORE UPDATE ON auditoria         BEGIN SELECT RAISE(ABORT, 'auditoria é somente inclusão'); END;
CREATE TRIGGER trg_auditoria_imutavel_del         BEFORE DELETE ON auditoria         BEGIN SELECT RAISE(ABORT, 'auditoria é somente inclusão'); END;
CREATE TRIGGER trg_prospects_sem_delete           BEFORE DELETE ON prospects         BEGIN SELECT RAISE(ABORT, 'prospects não são apagados: use baixa (inválido)'); END;

-- Prospect baixado fica congelado: dados cadastrais e carteira não mudam mais.
CREATE TRIGGER trg_prospects_congelado
BEFORE UPDATE ON prospects
WHEN OLD.status_atual = 'invalido'
BEGIN
  SELECT RAISE(ABORT, 'prospect baixado está congelado');
END;

-- ---------------------------------------------------------------------
-- Views de consulta (o app e o painel leem daqui)
-- ---------------------------------------------------------------------
CREATE VIEW vw_prospects AS
SELECT p.*,
       s.nome                AS status_nome,
       s.cor                 AS status_cor,
       s.ativo_na_carteira,
       v.nome                AS vendedor_nome,
       v.codigo_erp          AS vendedor_codigo,
       v.tipo_atuacao        AS vendedor_tipo_atuacao,
       COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END) AS supervisor_id,
       sup.nome              AS supervisor_nome,
       m.descricao           AS motivo_sem_interesse,
       CASE WHEN p.dt_primeiro_contato IS NOT NULL
            THEN CAST(julianday(date('now','-3 hours')) - julianday(p.dt_primeiro_contato) AS INTEGER) END AS dias_corridos,
       -- na_lista: aparece na lista de trabalho do vendedor (sem pedido/cadastro/baixa e abaixo do limite de atendimentos)
       CASE WHEN s.ativo_na_carteira = 1
             AND p.tentativas < (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'tentativas_maximas') THEN 1 ELSE 0 END AS na_lista,
       CASE WHEN s.ativo_na_carteira = 1
             AND p.tentativas < (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'tentativas_maximas')
             AND (p.data_proxima_acao IS NULL OR p.data_proxima_acao <= date('now','-3 hours')) THEN 1 ELSE 0 END AS pendente_hoje,
       CASE WHEN p.dt_interesse IS NOT NULL THEN 1 ELSE 0 END AS com_interesse,
       CASE WHEN p.status_atual = 'em_prospeccao' AND p.prazo_cadastro_ate < date('now','-3 hours') THEN 1 ELSE 0 END AS prazo_cadastro_vencido,
       CASE WHEN p.status_atual = 'venda_realizada' AND p.analise_financeira_ate >= date('now','-3 hours') THEN 1 ELSE 0 END AS em_analise_financeira,
       CAST(julianday(date('now','-3 hours')) - julianday(COALESCE(p.dt_ultimo_contato, p.dt_entrada_base)) AS INTEGER) AS dias_sem_movimento,
       CASE WHEN s.ativo_na_carteira = 1
             AND p.tentativas < (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'tentativas_maximas')
             AND julianday(date('now','-3 hours')) - julianday(COALESCE(p.dt_ultimo_contato, p.dt_entrada_base))
                 > (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') THEN 1 ELSE 0 END AS parado
  FROM prospects p
  JOIN status s   ON s.codigo = p.status_atual
  JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
  LEFT JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id;

-- Linha do tempo única da ficha do prospect
CREATE VIEW vw_linha_tempo AS
SELECT c.prospect_id, c.data_contato AS data, 'contato' AS tipo, c.id AS referencia,
       c.canal || ' · ' || c.resultado AS titulo, u.nome AS autor, c.observacao AS detalhe, c.recebido_em AS registrado_em
  FROM contatos c JOIN usuarios u ON u.id = c.usuario_id
UNION ALL
SELECT e.prospect_id, e.data_evento, 'erp', CAST(e.id AS TEXT), e.tipo || COALESCE(' · ' || e.documento, ''), 'ERP Senior', NULL, e.registrado_em
  FROM eventos_erp e
UNION ALL
SELECT t.prospect_id, t.data_transferencia, 'transferencia', CAST(t.id AS TEXT),
       'transferência: ' || de.nome || ' → ' || para.nome, u.nome, t.motivo, t.registrado_em
  FROM transferencias t
  JOIN usuarios de ON de.id = t.de_vendedor_id
  JOIN usuarios para ON para.id = t.para_vendedor_id
  JOIN usuarios u ON u.id = t.usuario_id;

-- Último lançamento por vendedor (bloco de atenção do painel)
CREATE VIEW vw_ultimo_lancamento AS
SELECT u.id AS usuario_id, u.nome, u.supervisor_id, MAX(c.data_contato) AS ultimo_contato,
       CAST(julianday(date('now','-3 hours')) - julianday(MAX(c.data_contato)) AS INTEGER) AS dias_sem_lancar
  FROM usuarios u
  LEFT JOIN contatos c ON c.usuario_id = u.id AND c.origem = 'app'
 WHERE u.perfil IN ('vendedor','supervisor') AND u.ativo = 1
 GROUP BY u.id;

-- Ranking de motivos de "sem interesse" (motivo final de cada prospect encerrado)
CREATE VIEW vw_ranking_motivos AS
SELECT m.codigo, m.descricao, p.vendedor_id,
       COALESCE(v.supervisor_id, v.id) AS supervisor_id,
       COUNT(*) AS quantidade
  FROM prospects p
  JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id
  JOIN usuarios v ON v.id = p.vendedor_id
 WHERE p.status_atual = 'sem_interesse'
 GROUP BY m.codigo, m.descricao, p.vendedor_id;
