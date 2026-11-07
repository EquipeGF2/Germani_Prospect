-- 0031 — Avisos da equipe (tela #/avisos): o que passou do prazo, por representante.  docs/03 §4 e §18 · shared/avisos.mjs
--   * vw_prospects.parado: "sem movimento" só depois do 1º registro (em prospecção e aguardando pedido, sem retorno marcado).
--     Antes contava o não contactado desde a entrada na base: toda onda liberada virava aviso depois de 30 dias.
--   * vw_avisos: um aviso por linha — tipo, cliente (NULL no "sem registrar", que é do representante), dono da carteira,
--     data de referência e dias de atraso. A tela, o Excel, o PDF e o número do menu leem daqui.
--   * Tela Avisos para administrador, gerente e supervisor (o supervisor só a equipe dele).

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
       -- parado (0031): só depois do 1º registro — em prospecção (desde o último registro) e aguardando pedido (desde a liberação
       -- do crédito ou o último registro), sem retorno marcado. Não contactado não entra; aguardando cadastro e análise têm prazo próprio.
       CASE WHEN p.data_proxima_acao IS NULL
             AND julianday(date('now','-3 hours')) - julianday(CASE p.status_atual
                   WHEN 'em_prospeccao' THEN COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato)
                   WHEN 'aguardando_pedido' THEN MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito)) END)
                 > (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') THEN 1 ELSE 0 END AS parado
  FROM prospects p
  JOIN status s   ON s.codigo = p.status_atual
  JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
  LEFT JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id;

-- Tipos e atraso (dias):
--   cadastro     aguardando cadastro com prazo vencido           · desde o atendimento     · dias depois do prazo
--   analise      análise financeira com prazo vencido            · desde o cadastro        · dias depois do prazo
--   retorno      retorno marcado que já passou                   · data do retorno         · dias depois da data
--   parado       sem movimento (mesma regra de vw_prospects)     · último registro         · dias parado
--   sem_registro cadastro/pedido do ERP sem atendimento no app   · cadastro (ou pedido)    · dias desde então
--   sem_lancar   representante com clientes a procurar (ondas liberadas) e sem registro no app há mais de N dias
--                · último registro (NULL = nunca registrou)      · dias sem registrar
-- Leitura mínima (o Turso cobra por linha lida): cada parte compara com uma data fixa ("antes de hoje − N dias") num índice
-- parcial próprio, e lê só as linhas que já passaram do prazo — nunca a carteira inteira.
CREATE VIEW vw_avisos AS
SELECT 'cadastro' AS tipo, p.id AS prospect_id, p.vendedor_id, COALESCE(p.dt_pedido_informado, p.dt_atendido) AS data_ref,
       CAST(julianday(date('now','-3 hours')) - julianday(p.prazo_cadastro_ate) AS INTEGER) AS atraso
  FROM prospects p
 WHERE p.status_atual = 'aguardando_cadastro' AND p.prazo_cadastro_ate < date('now','-3 hours')
UNION ALL
SELECT 'analise', p.id, p.vendedor_id, p.dt_cadastro_erp, CAST(julianday(date('now','-3 hours')) - julianday(p.analise_financeira_ate) AS INTEGER)
  FROM prospects p
 WHERE p.status_atual = 'analise_financeira' AND p.analise_financeira_ate < date('now','-3 hours')
UNION ALL
SELECT 'retorno', p.id, p.vendedor_id, p.data_proxima_acao, CAST(julianday(date('now','-3 hours')) - julianday(p.data_proxima_acao) AS INTEGER)
  FROM prospects p JOIN status s ON s.codigo = p.status_atual
 WHERE p.data_proxima_acao < date('now','-3 hours') AND s.aceita_contato = 1
UNION ALL
SELECT 'parado', p.id, p.vendedor_id, COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato),
       CAST(julianday(date('now','-3 hours')) - julianday(COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato)) AS INTEGER)
  FROM prospects p
 WHERE p.status_atual = 'em_prospeccao' AND p.data_proxima_acao IS NULL
   AND COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato)
       < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') || ' days')
UNION ALL
SELECT 'parado', p.id, p.vendedor_id, MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito)),
       CAST(julianday(date('now','-3 hours')) - julianday(MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito))) AS INTEGER)
  FROM prospects p
 WHERE p.status_atual = 'aguardando_pedido' AND p.data_proxima_acao IS NULL
   AND MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito))
       < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') || ' days')
UNION ALL
SELECT 'sem_registro', p.id, p.vendedor_id, COALESCE(p.dt_cadastro_erp, p.dt_pedido),
       CAST(julianday(date('now','-3 hours')) - julianday(COALESCE(p.dt_cadastro_erp, p.dt_pedido)) AS INTEGER)
  FROM prospects p
 WHERE p.convertido_sem_registro = 1 AND p.status_atual NOT IN ('invalido', 'expurgado')
UNION ALL
SELECT 'sem_lancar', NULL, q.id, q.ultimo, CAST(julianday(date('now','-3 hours')) - julianday(q.ultimo) AS INTEGER)
  FROM (SELECT u.id, (SELECT MAX(c.data_contato) FROM contatos c WHERE c.usuario_id = u.id AND c.origem = 'app') AS ultimo
          FROM usuarios u WHERE u.perfil = 'vendedor' AND u.ativo = 1) q
 WHERE (q.ultimo IS NULL
        OR q.ultimo < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_lancamento') || ' days'))
   AND EXISTS (SELECT 1 FROM prospects p WHERE p.vendedor_id = q.id AND p.status_atual IN ('nao_contactado', 'em_prospeccao')
                 AND (COALESCE((SELECT valor FROM parametros WHERE chave = 'ondas_liberadas'), 'todas') = 'todas'
                      OR COALESCE(p.onda, '') IN (SELECT value FROM json_each(COALESCE(NULLIF((SELECT valor FROM parametros WHERE chave = 'ondas_liberadas'), 'todas'), '[]')))));

-- índices parciais: cada parte da view lê só o que venceu (o índice já vem ordenado pela data comparada)
CREATE INDEX IF NOT EXISTS ix_avisos_cadastro ON prospects (prazo_cadastro_ate) WHERE status_atual = 'aguardando_cadastro';
CREATE INDEX IF NOT EXISTS ix_avisos_analise  ON prospects (analise_financeira_ate) WHERE status_atual = 'analise_financeira';
CREATE INDEX IF NOT EXISTS ix_avisos_parado   ON prospects (COALESCE(dt_ultimo_contato, dt_primeiro_contato))
  WHERE status_atual = 'em_prospeccao' AND data_proxima_acao IS NULL;
CREATE INDEX IF NOT EXISTS ix_avisos_parado_pedido ON prospects (MAX(COALESCE(dt_liberacao_credito, dt_ultimo_contato), COALESCE(dt_ultimo_contato, dt_liberacao_credito)))
  WHERE status_atual = 'aguardando_pedido' AND data_proxima_acao IS NULL;
CREATE INDEX IF NOT EXISTS ix_avisos_sem_registro ON prospects (vendedor_id) WHERE convertido_sem_registro = 1;
-- último registro no app de cada representante: uma linha lida por representante
CREATE INDEX IF NOT EXISTS ix_avisos_contatos_app ON contatos (usuario_id, data_contato) WHERE origem = 'app';

-- tela Avisos: administrador, gerente e supervisor (todos os perfis desses tipos-base)
INSERT OR IGNORE INTO perfil_telas (perfil_id, tela)
SELECT id, 'avisos' FROM perfis WHERE base IN ('administrador', 'gerente', 'supervisor');
