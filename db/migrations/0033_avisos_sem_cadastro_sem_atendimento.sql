-- 0033 — "Cadastro sem atendimento" deixa de ser aviso: o cadastro que chega do ERP sem atendimento registrado segue o fluxo
-- normal (Análise financeira) e não gera cobrança. O sinal convertido_sem_registro continua no cliente (ficha e listas).
-- docs/03 §4 e §18. O índice que servia só a esse aviso sai (menos escrita a cada cadastro).

DROP VIEW vw_avisos;
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
SELECT 'parado', p.id, p.vendedor_id, MAX(COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato), COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')),
       CAST(julianday(date('now','-3 hours')) - julianday(MAX(COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato), COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), ''))) AS INTEGER)
  FROM prospects p
 WHERE p.status_atual = 'em_prospeccao' AND p.data_proxima_acao IS NULL
   AND COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato) < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') || ' days')
   AND COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '') < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') || ' days')
UNION ALL
SELECT 'parado', p.id, p.vendedor_id, MAX(MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito)), COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')),
       CAST(julianday(date('now','-3 hours')) - julianday(MAX(MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito)), COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), ''))) AS INTEGER)
  FROM prospects p
 WHERE p.status_atual = 'aguardando_pedido' AND p.data_proxima_acao IS NULL
   AND MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito)) < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') || ' days')
   AND COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '') < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') || ' days')
UNION ALL
SELECT 'sem_lancar', NULL, q.id, NULLIF(MAX(COALESCE(q.ultimo, COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')), COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')), ''),
       CAST(julianday(date('now','-3 hours')) - julianday(NULLIF(MAX(COALESCE(q.ultimo, COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')), COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')), '')) AS INTEGER)
  FROM (SELECT u.id, (SELECT MAX(c.data_contato) FROM contatos c WHERE c.usuario_id = u.id AND c.origem = 'app') AS ultimo
          FROM usuarios u WHERE u.perfil = 'vendedor' AND u.ativo = 1) q
 WHERE (q.ultimo IS NULL OR q.ultimo < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_lancamento') || ' days'))
   AND COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '') < date('now','-3 hours', '-' || (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_lancamento') || ' days')
   AND EXISTS (SELECT 1 FROM prospects p WHERE p.vendedor_id = q.id AND p.status_atual IN ('nao_contactado', 'em_prospeccao')
                 AND (COALESCE((SELECT valor FROM parametros WHERE chave = 'ondas_liberadas'), 'todas') = 'todas'
                      OR COALESCE(p.onda, '') IN (SELECT value FROM json_each(COALESCE(NULLIF((SELECT valor FROM parametros WHERE chave = 'ondas_liberadas'), 'todas'), '[]')))));


DROP INDEX IF EXISTS ix_avisos_sem_registro;
