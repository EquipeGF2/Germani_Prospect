-- 0002 — Gerente comercial, feriados e parâmetros do painel (Início).  docs/03 §5 e §10
--
-- 1) Perfil 'gerente' (gerente comercial): vê tudo e age em qualquer carteira (registro, lote, transferência),
--    mas NÃO libera crédito (trg_liberacoes_validar continua só financeiro/administrador) e não administra.
--    O CHECK de usuarios.perfil só muda recriando a tabela: copia → recria → devolve os dados (mesmos ids).
--    Views e triggers que citam "usuarios" resolvem o nome na execução e continuam valendo.
-- 2) Feriados (dias úteis da campanha = seg–sex menos os feriados cadastrados).
-- 3) Parâmetros do painel: início da campanha, % do pipeline e valor por cliente.
PRAGMA foreign_keys = OFF;

CREATE TABLE _usuarios_0002 AS SELECT * FROM usuarios;
DROP TABLE usuarios;
CREATE TABLE usuarios (
  id               INTEGER PRIMARY KEY,
  perfil           TEXT NOT NULL CHECK (perfil IN ('administrador','gerente','supervisor','vendedor','financeiro')),
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
INSERT INTO usuarios SELECT * FROM _usuarios_0002;
DROP TABLE _usuarios_0002;

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

DROP TRIGGER trg_contatos_validar;
CREATE TRIGGER trg_contatos_validar
BEFORE INSERT ON contatos
BEGIN
  SELECT RAISE(ABORT, 'prospect não aceita novo contato (venda realizada ou CNPJ baixado)')
  WHERE (SELECT s.aceita_contato FROM prospects p JOIN status s ON s.codigo = p.status_atual
         WHERE p.id = NEW.prospect_id) = 0;

  SELECT RAISE(ABORT, 'usuário sem permissão para registrar contato neste prospect')
  WHERE NOT EXISTS (
    SELECT 1
      FROM prospects p
      JOIN usuarios v ON v.id = p.vendedor_id
      JOIN usuarios u ON u.id = NEW.usuario_id AND u.ativo = 1
     WHERE p.id = NEW.prospect_id
       AND (u.id = v.id OR u.perfil IN ('administrador','gerente') OR (u.perfil = 'supervisor' AND v.supervisor_id = u.id))
  );

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
                AND u.id = (SELECT COALESCE(supervisor_id, id) FROM usuarios WHERE id = NEW.para_vendedor_id)))
  );
END;

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Feriados (cadastro na tela Administração → Feriados). Todos os cadastrados saem da contagem de dias úteis.
-- ---------------------------------------------------------------------
CREATE TABLE feriados (
  id           INTEGER PRIMARY KEY,
  data         TEXT NOT NULL CHECK (date(data) = data),
  descricao    TEXT NOT NULL CHECK (length(trim(descricao)) > 0),
  abrangencia  TEXT NOT NULL CHECK (abrangencia IN ('nacional','estadual','municipal')),
  uf           TEXT CHECK (uf IS NULL OR length(uf) = 2),
  cidade       TEXT,
  criado_por   TEXT,
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (abrangencia <> 'nacional'  OR (uf IS NULL AND cidade IS NULL)),
  CHECK (abrangencia <> 'estadual'  OR (uf IS NOT NULL AND cidade IS NULL)),
  CHECK (abrangencia <> 'municipal' OR (uf IS NOT NULL AND cidade IS NOT NULL))
);
CREATE UNIQUE INDEX ux_feriados ON feriados (data, abrangencia, COALESCE(uf, ''), COALESCE(cidade, ''));

INSERT INTO feriados (data, descricao, abrangencia, uf, cidade, criado_por) VALUES
  ('2026-01-01', 'Confraternização Universal', 'nacional', NULL, NULL, 'migração 0002'),
  ('2026-04-03', 'Sexta-feira Santa',          'nacional', NULL, NULL, 'migração 0002'),
  ('2026-04-21', 'Tiradentes',                 'nacional', NULL, NULL, 'migração 0002'),
  ('2026-05-01', 'Dia do Trabalho',            'nacional', NULL, NULL, 'migração 0002'),
  ('2026-09-07', 'Independência do Brasil',    'nacional', NULL, NULL, 'migração 0002'),
  ('2026-09-20', 'Revolução Farroupilha',      'estadual', 'RS', NULL, 'migração 0002'),
  ('2026-10-12', 'Nossa Senhora Aparecida',    'nacional', NULL, NULL, 'migração 0002'),
  ('2026-11-02', 'Finados',                    'nacional', NULL, NULL, 'migração 0002'),
  ('2026-11-15', 'Proclamação da República',   'nacional', NULL, NULL, 'migração 0002'),
  ('2026-11-20', 'Dia da Consciência Negra',   'nacional', NULL, NULL, 'migração 0002'),
  ('2026-12-25', 'Natal',                      'nacional', NULL, NULL, 'migração 0002'),
  ('2027-01-01', 'Confraternização Universal', 'nacional', NULL, NULL, 'migração 0002'),
  ('2027-03-26', 'Sexta-feira Santa',          'nacional', NULL, NULL, 'migração 0002'),
  ('2027-04-21', 'Tiradentes',                 'nacional', NULL, NULL, 'migração 0002'),
  ('2027-05-01', 'Dia do Trabalho',            'nacional', NULL, NULL, 'migração 0002'),
  ('2027-09-07', 'Independência do Brasil',    'nacional', NULL, NULL, 'migração 0002'),
  ('2027-09-20', 'Revolução Farroupilha',      'estadual', 'RS', NULL, 'migração 0002'),
  ('2027-10-12', 'Nossa Senhora Aparecida',    'nacional', NULL, NULL, 'migração 0002'),
  ('2027-11-02', 'Finados',                    'nacional', NULL, NULL, 'migração 0002'),
  ('2027-11-15', 'Proclamação da República',   'nacional', NULL, NULL, 'migração 0002'),
  ('2027-11-20', 'Dia da Consciência Negra',   'nacional', NULL, NULL, 'migração 0002'),
  ('2027-12-25', 'Natal',                      'nacional', NULL, NULL, 'migração 0002');

-- ---------------------------------------------------------------------
-- Parâmetros do painel
-- ---------------------------------------------------------------------
INSERT INTO parametros (chave, valor, tipo, descricao) VALUES
  ('data_inicio_campanha',      '2026-10-01', 'texto',   'Início da campanha de prospecção (conta os dias úteis do painel)'),
  ('percentual_pipeline',       '30',         'inteiro', 'Percentual da base de prospects considerado no potencial do pipeline de abertura'),
  ('valor_medio_cliente',       '1200',       'inteiro', 'Valor (R$) por cliente usado no potencial do pipeline e no valor de conversão');

CREATE TRIGGER trg_parametros_data_valida
BEFORE UPDATE OF valor ON parametros
WHEN NEW.chave LIKE 'data\_%' ESCAPE '\' AND date(NEW.valor) IS NOT NEW.valor
BEGIN
  SELECT RAISE(ABORT, 'informe a data no formato AAAA-MM-DD');
END;
