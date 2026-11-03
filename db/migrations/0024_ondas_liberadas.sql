-- Liberação escalonada: o administrador escolhe, em Parâmetros, quais ondas o representante/vendedor vê para prospectar.
-- 'todas' = sem restrição (como antes). Lista JSON (ex.: ["1","2"]) = só essas ondas; "" na lista = prospects sem onda.
-- Vale para quem ainda está na lista (Não contactado e Em prospecção): cliente já atendido nunca some. docs/03 §1.1
INSERT INTO parametros (chave, valor, tipo, descricao) VALUES
  ('ondas_liberadas', 'todas', 'texto', 'Ondas que o representante/vendedor vê na Lista principal e no Explorar carteira (liberação escalonada)');

CREATE TRIGGER trg_parametros_ondas_validas
BEFORE UPDATE OF valor ON parametros
WHEN NEW.chave = 'ondas_liberadas' AND NEW.valor <> 'todas'
     AND (json_valid(NEW.valor) = 0 OR json_type(NEW.valor) <> 'array')
BEGIN
  SELECT RAISE(ABORT, 'ondas liberadas: informe todas ou a lista de ondas');
END;
