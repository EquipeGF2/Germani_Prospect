-- 0011 — Índice do Início (posição atual): vendedor × status com as datas das etapas do funil.  shared/painel.mjs
--        e índice do segmento (filtro da Lista principal).  shared/carteira.mjs
-- A consulta agrega a carteira lendo só este índice (sem abrir a linha de cada prospect). Só índice: nada muda no resultado.
CREATE INDEX IF NOT EXISTS ix_prospects_painel ON prospects (vendedor_id, status_atual, dt_atendido, dt_cadastro_erp, dt_liberacao_credito);
-- Filtro e lista de segmentos (TIPOLOGIA GTM) na Lista principal.
CREATE INDEX IF NOT EXISTS ix_prospects_segmento ON prospects (tipologia_gtm);
