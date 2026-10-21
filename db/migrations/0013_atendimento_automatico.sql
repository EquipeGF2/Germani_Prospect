-- 0013 — Atendimento automático pelo ERP.  docs/03 §3
-- Quando o representante/vendedor não registrou o atendimento e o CNPJ chega no arquivo de cadastro (ou de pedido) do ERP,
-- a data do cadastro (ou do pedido) passa a ser o atendimento: "atendido em" (dt_atendido), 1º registro (dt_primeiro_contato,
-- os dias corridos contam dela) e um movimento "atendido" no histórico (origem erp, sem usuário). O alerta
-- "convertido sem registro" continua marcando que foi automático.
-- O fluxo normal segue: o representante pode registrar o atendimento depois. Aí vale a data dele quando for anterior (o
-- atendimento real), o 1º registro também recua para ela e o alerta "convertido sem registro" sai — ele informou.
-- Os triggers de 0001 são recriados aqui (migração aplicada não se edita).

DROP TRIGGER trg_eventos_erp_aplicar;
CREATE TRIGGER trg_eventos_erp_aplicar
AFTER INSERT ON eventos_erp
BEGIN
  -- sem atendimento registrado: o cadastro/pedido vira o atendimento (antes do movimento do ERP; o status não muda aqui)
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, 'atendido', p.status_atual, p.status_atual, NEW.data_evento, 'erp', 'atendimento:' || NEW.id, p.vendedor_id,
         'atendimento automático pelo ' || CASE NEW.tipo WHEN 'cadastro' THEN 'cadastro' ELSE 'pedido' END || ' do ERP'
           || COALESCE(' (' || NEW.documento || ')', '')
    FROM prospects p
   WHERE p.id = NEW.prospect_id AND NEW.tipo IN ('cadastro','pedido') AND p.dt_atendido IS NULL AND p.status_atual <> 'venda_realizada';

  -- cadastro → Análise financeira · pedido → Venda realizada (final) · baixa → Inválido
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, NEW.tipo, p.status_atual,
         CASE NEW.tipo
           WHEN 'baixa'    THEN 'invalido'
           WHEN 'pedido'   THEN 'venda_realizada'
           WHEN 'cadastro' THEN CASE WHEN p.status_atual IN ('venda_realizada','aguardando_pedido') THEN p.status_atual ELSE 'analise_financeira' END
         END,
         NEW.data_evento, 'erp', CAST(NEW.id AS TEXT), p.vendedor_id, NEW.documento
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM movimentacoes WHERE origem = 'erp' AND referencia = CAST(NEW.id AS TEXT)),
    convertido_sem_registro = CASE
      WHEN NEW.tipo IN ('cadastro','pedido') AND status_atual <> 'venda_realizada' AND dt_atendido IS NULL THEN 1
      ELSE convertido_sem_registro END,
    dt_atendido = CASE
      WHEN NEW.tipo IN ('cadastro','pedido') AND status_atual <> 'venda_realizada' AND dt_atendido IS NULL THEN NEW.data_evento
      ELSE dt_atendido END,
    dt_primeiro_contato = CASE
      WHEN NEW.tipo IN ('cadastro','pedido') AND status_atual <> 'venda_realizada' AND dt_atendido IS NULL
        THEN COALESCE(MIN(dt_primeiro_contato, NEW.data_evento), NEW.data_evento)
      ELSE dt_primeiro_contato END,
    dt_cadastro_erp    = CASE WHEN NEW.tipo = 'cadastro' THEN COALESCE(dt_cadastro_erp, NEW.data_evento) ELSE dt_cadastro_erp END,
    codigo_cliente_erp = CASE WHEN NEW.tipo = 'cadastro' THEN COALESCE(NEW.documento, codigo_cliente_erp) ELSE codigo_cliente_erp END,
    dt_pedido          = CASE WHEN NEW.tipo = 'pedido' THEN COALESCE(dt_pedido, NEW.data_evento) ELSE dt_pedido END,
    numero_pedido      = CASE WHEN NEW.tipo = 'pedido' THEN COALESCE(numero_pedido, NEW.documento) ELSE numero_pedido END,
    analise_financeira_ate = CASE WHEN NEW.tipo = 'cadastro' AND dt_cadastro_erp IS NULL
      THEN date(NEW.data_evento, '+' || (SELECT valor FROM parametros WHERE chave = 'prazo_analise_financeira_dias') || ' days')
      ELSE analise_financeira_ate END,
    situacao_cadastral = CASE WHEN NEW.tipo = 'baixa' THEN 'baixada' ELSE situacao_cadastral END,
    dt_baixa           = CASE WHEN NEW.tipo = 'baixa' THEN NEW.data_evento ELSE dt_baixa END,
    data_proxima_acao  = NULL,
    atualizado_em      = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;
END;

DROP TRIGGER trg_contatos_aplicar;
CREATE TRIGGER trg_contatos_aplicar
AFTER INSERT ON contatos
BEGIN
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, usuario_id, vendedor_id, detalhe)
  SELECT p.id, NEW.resultado, p.status_atual,
         CASE
           WHEN p.status_atual IN ('analise_financeira','aguardando_pedido') THEN p.status_atual
           WHEN NEW.resultado IN ('atendido','pedido_informado') THEN 'aguardando_cadastro'
           WHEN NEW.resultado = 'sem_interesse' THEN 'sem_interesse'
           WHEN p.status_atual = 'nao_contactado' THEN 'em_prospeccao'
           ELSE p.status_atual
         END,
         NEW.data_contato, 'contato', NEW.id,
         CASE WHEN NEW.origem = 'app' THEN NEW.usuario_id END, p.vendedor_id,
         TRIM(COALESCE((SELECT m.descricao FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id) || ' — ', '')
              || COALESCE(NEW.observacao, '')
              || COALESCE(' · pedido de ' || strftime('%d/%m/%Y', NEW.data_pedido_informado), ''), ' —')
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM movimentacoes WHERE origem = 'contato' AND referencia = NEW.id),
    tentativas = NEW.numero_tentativa,
    -- o 1º registro recua quando o atendimento informado é anterior ao automático do ERP
    dt_primeiro_contato = COALESCE(MIN(dt_primeiro_contato, NEW.data_contato), NEW.data_contato),
    dt_segundo_contato  = CASE WHEN NEW.numero_tentativa = 2 THEN NEW.data_contato ELSE dt_segundo_contato END,
    dt_ultimo_contato   = NEW.data_contato,
    -- atendimento informado depois do automático do ERP: vale a data informada quando for anterior
    dt_atendido = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND dt_atendido IS NULL THEN NEW.data_contato
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND convertido_sem_registro = 1 THEN MIN(dt_atendido, NEW.data_contato)
      ELSE dt_atendido END,
    -- quem registra o atendimento tira o alerta "convertido sem registro"
    convertido_sem_registro = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND NEW.origem = 'app' THEN 0
      ELSE convertido_sem_registro END,
    dt_pedido_informado = CASE WHEN NEW.resultado = 'pedido_informado' THEN NEW.data_pedido_informado ELSE dt_pedido_informado END,
    prazo_cadastro_ate = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND dt_atendido IS NULL
        THEN date(NEW.data_contato, '+' || (SELECT valor FROM parametros WHERE chave = 'prazo_cadastro_dias') || ' days')
      ELSE prazo_cadastro_ate END,
    atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.prospect_id;

  UPDATE prospects SET
    -- retorno agendado (opcional) só existe na negociação; a lista principal está sempre pendente
    data_proxima_acao = CASE WHEN status_atual = 'aguardando_cadastro' THEN NEW.data_retorno ELSE NULL END,
    -- motivo final = o do último "sem interesse"
    motivo_sem_interesse_id = CASE WHEN NEW.resultado = 'sem_interesse' THEN NEW.motivo_id ELSE motivo_sem_interesse_id END
  WHERE id = NEW.prospect_id;
END;
