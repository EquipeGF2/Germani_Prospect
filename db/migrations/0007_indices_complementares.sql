-- 0007 — Índices complementares, criados com o banco ainda vazio (instantâneo; depois exigiria reconstruir tabelas grandes).
-- Critério: só onde há consulta, ligação entre tabelas ou gatilho que procura pela coluna (docs/02 "Índices").
-- Índices não mudam resultado de consulta nenhuma; custam um pouco a cada gravação e espaço.

-- histórico de movimentação (a maior tabela: um registro por evento de cada prospect)
CREATE INDEX IF NOT EXISTS ix_movimentacoes_status_data  ON movimentacoes (status_novo, data_evento);   -- filtro por status no período
CREATE INDEX IF NOT EXISTS ix_movimentacoes_usuario_data ON movimentacoes (usuario_id, data_evento)
  WHERE usuario_id IS NOT NULL;                                                                          -- "o que cada usuário fez"

-- transferências de carteira: histórico do prospect e de cada vendedor (quem saiu / quem recebeu)
CREATE INDEX IF NOT EXISTS ix_transferencias_prospect ON transferencias (prospect_id, data_transferencia);
CREATE INDEX IF NOT EXISTS ix_transferencias_de       ON transferencias (de_vendedor_id, data_transferencia);
CREATE INDEX IF NOT EXISTS ix_transferencias_para     ON transferencias (para_vendedor_id, data_transferencia);

-- eventos do ERP: por tipo no período (cadastros, pedidos, baixados) e por arquivo importado
CREATE INDEX IF NOT EXISTS ix_eventos_erp_tipo_data  ON eventos_erp (tipo, data_evento);
CREATE INDEX IF NOT EXISTS ix_eventos_erp_importacao ON eventos_erp (importacao_id);

-- liberações de crédito: por analista no período e por relatório importado
CREATE INDEX IF NOT EXISTS ix_liberacoes_usuario_data ON liberacoes_credito (usuario_id, data_liberacao) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_liberacoes_importacao   ON liberacoes_credito (importacao_id) WHERE importacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_liberacoes_data         ON liberacoes_credito (data_liberacao);

-- contatos: registros vindos de uma importação e ranking de motivos de recusa
CREATE INDEX IF NOT EXISTS ix_contatos_importacao ON contatos (importacao_id) WHERE importacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_contatos_motivo     ON contatos (motivo_id) WHERE motivo_id IS NOT NULL;

-- prospects: ranking de motivos (vw_ranking_motivos) e prospects de uma importação
CREATE INDEX IF NOT EXISTS ix_prospects_motivo     ON prospects (motivo_sem_interesse_id) WHERE motivo_sem_interesse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prospects_importacao ON prospects (importacao_id);

-- rotas do vendedor: "este prospect já está em alguma rota?"
CREATE INDEX IF NOT EXISTS ix_rota_paradas_prospect ON rota_paradas (prospect_id);

-- usuários: equipe do supervisor e listas por perfil
CREATE INDEX IF NOT EXISTS ix_usuarios_supervisor   ON usuarios (supervisor_id) WHERE supervisor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_usuarios_perfil_ativo ON usuarios (perfil, ativo);

-- auditoria e importações: consulta por registro alterado, por data e por tipo de arquivo
CREATE INDEX IF NOT EXISTS ix_auditoria_entidade ON auditoria (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS ix_auditoria_data     ON auditoria (data_hora);
CREATE INDEX IF NOT EXISTS ix_importacoes_tipo   ON importacoes (tipo, id);
