-- 0015 — "Sem interesse" em duas origens: do CLIENTE (recusou a proposta) e do REPRESENTANTE (não vai trabalhar o cliente).
-- docs/03 §2. O status continua um só (sem_interesse); quem decide a origem é o MOTIVO escolhido (motivos_sem_interesse.origem).
-- Registros antigos não mudam: os motivos que já existiam são do cliente. Um registro nunca é alterado — só incluído.

ALTER TABLE motivos_sem_interesse ADD COLUMN origem TEXT NOT NULL DEFAULT 'cliente' CHECK (origem IN ('cliente','representante'));

INSERT INTO motivos_sem_interesse (codigo, descricao, exige_observacao, uso_app, ordem, origem) VALUES
  ('REP_FORA_PERFIL',   'Fora do perfil (porte / tipo de negócio)',        0, 1, 21, 'representante'),
  ('REP_NAO_LOCALIZADO','Estabelecimento fechado ou não localizado',       0, 1, 22, 'representante'),
  ('REP_FORA_ROTA',     'Fora da rota / acesso difícil',                   0, 1, 23, 'representante'),
  ('REP_RISCO_CREDITO', 'Risco de crédito / histórico de inadimplência',   0, 1, 24, 'representante'),
  ('REP_OUTRO_CANAL',   'Já atendido por outro canal da Germani',          0, 1, 25, 'representante'),
  ('REP_VOLUME_BAIXO',  'Volume potencial muito baixo',                    0, 1, 26, 'representante'),
  ('REP_DUPLICADO',     'Cadastro duplicado (mesmo dono)',                 0, 1, 27, 'representante'),
  ('REP_OUTRO',         'Outro (descrever na observação)',                 1, 1, 28, 'representante');

-- ficha, listas e relatórios: a origem e o status "Sem interesse · cliente" / "Sem interesse · representante"
DROP VIEW vw_prospects;
CREATE VIEW vw_prospects AS
SELECT p.*,
       s.nome                AS status_nome,
       s.cor                 AS status_cor,
       s.aceita_contato,
       -- "Aguardando cadastro · atendido em dd/mm/aaaa" ou "· pedido informado em dd/mm/aaaa"; "Sem interesse · cliente|representante"
       CASE WHEN p.status_atual = 'aguardando_cadastro' AND p.dt_pedido_informado IS NOT NULL
            THEN s.nome || ' · pedido informado em ' || strftime('%d/%m/%Y', p.dt_pedido_informado)
            WHEN p.status_atual = 'aguardando_cadastro' AND p.dt_atendido IS NOT NULL
            THEN s.nome || ' · atendido em ' || strftime('%d/%m/%Y', p.dt_atendido)
            WHEN p.status_atual = 'sem_interesse' AND m.origem IS NOT NULL
            THEN s.nome || ' · ' || m.origem ELSE s.nome END AS status_descricao,
       v.nome                AS vendedor_nome,
       v.codigo_erp          AS vendedor_codigo,
       v.tipo_atuacao        AS vendedor_tipo_atuacao,
       COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END) AS supervisor_id,
       sup.nome              AS supervisor_nome,
       m.descricao           AS motivo_sem_interesse,
       CASE WHEN p.status_atual = 'sem_interesse' THEN m.origem END AS sem_interesse_origem,
       -- dias corridos SEMPRE a partir do 1º registro (atendido, sem interesse ou contato da planilha), em qualquer status
       CASE WHEN p.dt_primeiro_contato IS NOT NULL
            THEN CAST(julianday(date('now','-3 hours')) - julianday(p.dt_primeiro_contato) AS INTEGER) END AS dias_corridos,
       -- na_lista: aparece na lista de prospects (Não contactado / Em prospecção). Fora da lista continua em todos os indicadores.
       s.lista_trabalho AS na_lista,
       CASE WHEN s.lista_trabalho = 1
             AND (p.data_proxima_acao IS NULL OR p.data_proxima_acao <= date('now','-3 hours')) THEN 1 ELSE 0 END AS pendente_hoje,
       -- retorno agendado vencido/hoje em qualquer status que ainda aceita contato (inclui Aguardando cadastro)
       CASE WHEN s.aceita_contato = 1 AND p.data_proxima_acao IS NOT NULL
             AND p.data_proxima_acao <= date('now','-3 hours') THEN 1 ELSE 0 END AS retorno_pendente,
       CASE WHEN p.dt_atendido IS NOT NULL THEN 1 ELSE 0 END AS atendido,
       CASE WHEN p.status_atual = 'aguardando_cadastro' AND p.prazo_cadastro_ate < date('now','-3 hours') THEN 1 ELSE 0 END AS prazo_cadastro_vencido,
       CASE WHEN p.status_atual = 'analise_financeira' AND p.analise_financeira_ate < date('now','-3 hours') THEN 1 ELSE 0 END AS analise_financeira_vencida,
       CAST(julianday(date('now','-3 hours')) - julianday(COALESCE(p.dt_ultimo_contato, p.dt_entrada_base)) AS INTEGER) AS dias_sem_movimento,
       CASE WHEN p.status_atual IN ('nao_contactado','em_prospeccao','aguardando_cadastro')
             AND julianday(date('now','-3 hours')) - julianday(COALESCE(p.dt_ultimo_contato, p.dt_entrada_base))
                 > (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') THEN 1 ELSE 0 END AS parado
  FROM prospects p
  JOIN status s   ON s.codigo = p.status_atual
  JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
  LEFT JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id;

-- ranking de motivos com a origem
DROP VIEW vw_ranking_motivos;
CREATE VIEW vw_ranking_motivos AS
SELECT m.codigo, m.descricao, m.origem, p.vendedor_id,
       COALESCE(v.supervisor_id, v.id) AS supervisor_id,
       COUNT(*) AS quantidade
  FROM prospects p
  JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id
  JOIN usuarios v ON v.id = p.vendedor_id
 WHERE p.status_atual = 'sem_interesse'
 GROUP BY m.codigo, m.descricao, m.origem, p.vendedor_id;

-- resumo da carteira (Explorar, Início): quantos dos "sem interesse" são do representante (os demais são do cliente)
ALTER TABLE resumo_carteira ADD COLUMN si_representante INTEGER NOT NULL DEFAULT 0;
UPDATE resumo_carteira SET si_representante = (
  SELECT COUNT(*) FROM prospects p JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id
   WHERE p.status_atual = 'sem_interesse' AND m.origem = 'representante'
     AND p.vendedor_id = resumo_carteira.vendedor_id AND COALESCE(p.cidade_busca, '') = resumo_carteira.cidade_busca
     AND COALESCE(p.uf, '') = resumo_carteira.uf AND COALESCE(p.tipologia_gtm, '') = resumo_carteira.tipologia_gtm
     AND COALESCE(p.onda, '') = resumo_carteira.onda AND COALESCE(p.rota, '') = resumo_carteira.rota
     AND COALESCE(p.subrota, '') = resumo_carteira.subrota AND p.status_atual = resumo_carteira.status_atual)
 WHERE status_atual = 'sem_interesse';

DROP TRIGGER trg_resumo_carteira_ins;
CREATE TRIGGER trg_resumo_carteira_ins AFTER INSERT ON prospects BEGIN
  INSERT INTO resumo_carteira (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual, cidade, qtd, atendidos, cadastrados, credito, si_representante)
  VALUES (NEW.vendedor_id, COALESCE(NEW.cidade_busca, ''), COALESCE(NEW.uf, ''), COALESCE(NEW.tipologia_gtm, ''), COALESCE(NEW.onda, ''),
          COALESCE(NEW.rota, ''), COALESCE(NEW.subrota, ''), NEW.status_atual, NEW.cidade, 1,
          NEW.dt_atendido IS NOT NULL OR NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.status_atual = 'sem_interesse' AND COALESCE((SELECT origem FROM motivos_sem_interesse WHERE id = NEW.motivo_sem_interesse_id), '') = 'representante')
  ON CONFLICT (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual) DO UPDATE SET
    qtd = qtd + 1, atendidos = atendidos + excluded.atendidos, cadastrados = cadastrados + excluded.cadastrados,
    credito = credito + excluded.credito, si_representante = si_representante + excluded.si_representante,
    cidade = COALESCE(excluded.cidade, cidade);
END;

DROP TRIGGER trg_resumo_carteira_upd;
CREATE TRIGGER trg_resumo_carteira_upd
AFTER UPDATE OF vendedor_id, cidade_busca, uf, cidade, tipologia_gtm, onda, rota, subrota, status_atual, dt_atendido, dt_cadastro_erp, dt_liberacao_credito,
                motivo_sem_interesse_id ON prospects
BEGIN
  UPDATE resumo_carteira SET
    qtd = qtd - 1,
    atendidos = atendidos - (OLD.dt_atendido IS NOT NULL OR OLD.dt_cadastro_erp IS NOT NULL OR OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    cadastrados = cadastrados - (OLD.dt_cadastro_erp IS NOT NULL OR OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    credito = credito - (OLD.dt_liberacao_credito IS NOT NULL OR OLD.status_atual = 'venda_realizada'),
    si_representante = si_representante - (OLD.status_atual = 'sem_interesse'
      AND COALESCE((SELECT origem FROM motivos_sem_interesse WHERE id = OLD.motivo_sem_interesse_id), '') = 'representante')
  WHERE vendedor_id = OLD.vendedor_id AND cidade_busca = COALESCE(OLD.cidade_busca, '') AND uf = COALESCE(OLD.uf, '')
    AND tipologia_gtm = COALESCE(OLD.tipologia_gtm, '') AND onda = COALESCE(OLD.onda, '') AND rota = COALESCE(OLD.rota, '')
    AND subrota = COALESCE(OLD.subrota, '') AND status_atual = OLD.status_atual;
  INSERT INTO resumo_carteira (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual, cidade, qtd, atendidos, cadastrados, credito, si_representante)
  VALUES (NEW.vendedor_id, COALESCE(NEW.cidade_busca, ''), COALESCE(NEW.uf, ''), COALESCE(NEW.tipologia_gtm, ''), COALESCE(NEW.onda, ''),
          COALESCE(NEW.rota, ''), COALESCE(NEW.subrota, ''), NEW.status_atual, NEW.cidade, 1,
          NEW.dt_atendido IS NOT NULL OR NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_cadastro_erp IS NOT NULL OR NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.dt_liberacao_credito IS NOT NULL OR NEW.status_atual = 'venda_realizada',
          NEW.status_atual = 'sem_interesse' AND COALESCE((SELECT origem FROM motivos_sem_interesse WHERE id = NEW.motivo_sem_interesse_id), '') = 'representante')
  ON CONFLICT (vendedor_id, cidade_busca, uf, tipologia_gtm, onda, rota, subrota, status_atual) DO UPDATE SET
    qtd = qtd + 1, atendidos = atendidos + excluded.atendidos, cadastrados = cadastrados + excluded.cadastrados,
    credito = credito + excluded.credito, si_representante = si_representante + excluded.si_representante,
    cidade = COALESCE(excluded.cidade, cidade);
END;
