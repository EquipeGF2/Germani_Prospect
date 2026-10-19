-- 0004 — Valor do pedido.  docs/03 §3 e §10
-- O arquivo de pedidos do ERP pode trazer o valor de cada pedido (coluna informada na importação, opcional).
-- O Início mostra o "Valor dos pedidos" (soma real) ao lado do "Valor de conversão" (estimado: vendas × valor médio).
-- Como eventos_erp é só de inclusão, o valor entra junto com o pedido; reimportar o mesmo pedido não altera o valor.
ALTER TABLE eventos_erp ADD COLUMN valor REAL CHECK (valor IS NULL OR (tipo = 'pedido' AND valor >= 0));
