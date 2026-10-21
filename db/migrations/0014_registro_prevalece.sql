-- 0014 — O registro do representante sempre prevalece sobre o ERP.  docs/03 §3 (ajusta 0013)
--   * Atendimento automático (data do cadastro/pedido vira "atendido em" e 1º registro) SÓ quando o representante não
--     registrou nada no app (atendido, sem interesse ou pedido identificado). O ERP nunca sobrepõe o que ele informou.
--   * Com registro do representante (ex.: "sem interesse"), o cadastro só leva à próxima etapa (Análise financeira; pedido
--     → Venda realizada): as datas dele ficam como estão e nenhum atendimento automático é criado.
--   * Todo movimento do ERP diz no histórico que veio da importação ("via importação do cadastro (C123)").
--   * Se o representante registrar o atendimento depois do automático, vale o registro dele: "atendido em" passa a ser a
--     data que ele informou, o 1º registro volta a ser o 1º registro dele e o alerta "convertido sem registro" sai.
-- Os triggers são recriados aqui (0013 já aplicada não se edita).

DROP TRIGGER trg_eventos_erp_aplicar;
CREATE TRIGGER trg_eventos_erp_aplicar
AFTER INSERT ON eventos_erp
BEGIN
  -- nenhum registro do representante no app: o cadastro/pedido vira o atendimento (o status não muda neste movimento)
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, 'atendido', p.status_atual, p.status_atual, NEW.data_evento, 'erp', 'atendimento:' || NEW.id, p.vendedor_id,
         'atendimento automático via importação do ' || NEW.tipo || COALESCE(' (' || NEW.documento || ')', '')
           || ' — sem registro do representante'
    FROM prospects p
   WHERE p.id = NEW.prospect_id AND NEW.tipo IN ('cadastro','pedido') AND p.dt_atendido IS NULL
     AND p.status_atual <> 'venda_realizada'
     AND NOT EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = p.id AND c.origem = 'app');

  -- cadastro → Análise financeira · pedido → Venda realizada (final) · baixa → Inválido
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, vendedor_id, detalhe)
  SELECT p.id, NEW.tipo, p.status_atual,
         CASE NEW.tipo
           WHEN 'baixa'    THEN 'invalido'
           WHEN 'pedido'   THEN 'venda_realizada'
           WHEN 'cadastro' THEN CASE WHEN p.status_atual IN ('venda_realizada','aguardando_pedido') THEN p.status_atual ELSE 'analise_financeira' END
         END,
         NEW.data_evento, 'erp', CAST(NEW.id AS TEXT), p.vendedor_id,
         CASE NEW.tipo WHEN 'baixa' THEN 'via importação de CNPJs baixados' ELSE 'via importação do ' || NEW.tipo END
           || COALESCE(' (' || NEW.documento || ')', '')
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM movimentacoes WHERE origem = 'erp' AND referencia = CAST(NEW.id AS TEXT)),
    convertido_sem_registro = CASE
      WHEN NEW.tipo IN ('cadastro','pedido') AND status_atual <> 'venda_realizada' AND dt_atendido IS NULL THEN 1
      ELSE convertido_sem_registro END,
    -- só com o atendimento automático criado acima (nenhum registro do representante)
    dt_atendido = CASE
      WHEN EXISTS (SELECT 1 FROM movimentacoes WHERE origem = 'erp' AND referencia = 'atendimento:' || NEW.id) THEN NEW.data_evento
      ELSE dt_atendido END,
    dt_primeiro_contato = CASE
      WHEN EXISTS (SELECT 1 FROM movimentacoes WHERE origem = 'erp' AND referencia = 'atendimento:' || NEW.id)
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
    -- 1º registro: o mais antigo dos registros (app e planilha); só o atendimento automático do ERP fica de fora — o
    -- registro do representante prevalece sobre ele
    dt_primeiro_contato = CASE
      WHEN dt_atendido IS NOT NULL AND convertido_sem_registro = 1 AND NEW.origem = 'app'
           AND NEW.resultado IN ('atendido','pedido_informado')
           AND NOT EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = NEW.prospect_id AND c.origem = 'app' AND c.id <> NEW.id)
        THEN (SELECT MIN(c.data_contato) FROM contatos c WHERE c.prospect_id = NEW.prospect_id)
      ELSE COALESCE(dt_primeiro_contato, NEW.data_contato) END,
    dt_segundo_contato  = CASE WHEN NEW.numero_tentativa = 2 THEN NEW.data_contato ELSE dt_segundo_contato END,
    dt_ultimo_contato   = NEW.data_contato,
    -- 1º atendido do representante: vale a data dele, inclusive sobre o atendimento automático do ERP
    dt_atendido = CASE
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND dt_atendido IS NULL THEN NEW.data_contato
      WHEN NEW.resultado IN ('atendido','pedido_informado') AND NEW.origem = 'app' AND convertido_sem_registro = 1
           AND NOT EXISTS (SELECT 1 FROM contatos c WHERE c.prospect_id = NEW.prospect_id AND c.origem = 'app' AND c.id <> NEW.id
                             AND c.resultado IN ('atendido','pedido_informado'))
        THEN NEW.data_contato
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
