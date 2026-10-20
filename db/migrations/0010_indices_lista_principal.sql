-- 0010 — Índices para a 1ª página da Lista principal sem ler a base inteira.  shared/carteira.mjs (faixas da lista)
-- A lista vem em 3 faixas da próxima ação: vencida/hoje, sem data (a grande maioria: base recém-importada) e futura.
-- A faixa "sem data" é lida já na ordem cidade → bairro → razão social; por vendedor, idem (carteira do representante).
CREATE INDEX IF NOT EXISTS ix_prospects_lista_sem_acao ON prospects (cidade_busca, bairro_busca, razao_social, id)
  WHERE data_proxima_acao IS NULL;
CREATE INDEX IF NOT EXISTS ix_prospects_lista_sem_acao_vendedor ON prospects (vendedor_id, cidade_busca, bairro_busca, razao_social, id)
  WHERE data_proxima_acao IS NULL;
