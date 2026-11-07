-- 0034 — Sem interesse do cliente: 1ª recusa com retorno obrigatório e o cliente na lista; 2ª recusa tira da lista.  docs/03 §2
--   * 1ª recusa do cliente (motivo de origem cliente, sem recusa do cliente antes): a data de retorno é obrigatória e o cliente
--     continua na lista do representante (status Sem interesse · cliente; na lista pela data de retorno, como as demais
--     próximas ações). Passou a data sem novo registro: aviso Retorno vencido.
--   * Na volta: Atendido segue o fluxo; nova recusa do cliente (2ª) tira da lista, sem data (Rejeitados); sem interesse do
--     representante tira da lista na hora.
--   * Os sem interesse do cliente registrados antes desta migração ficam como estão (fora da lista); um novo registro deles
--     conta como 2ª recusa.
--   Só regras de app (origem 'app'); importações não mudam.

DROP TRIGGER trg_contatos_validar;
CREATE TRIGGER trg_contatos_validar
BEFORE INSERT ON contatos
BEGIN
  SELECT RAISE(ABORT, 'prospect não aceita novo contato (venda realizada ou CNPJ baixado)')
  WHERE (SELECT s.aceita_contato FROM prospects p JOIN status s ON s.codigo = p.status_atual
         WHERE p.id = NEW.prospect_id) = 0;

  SELECT RAISE(ABORT, 'usuário sem permissão para registrar contato neste prospect')
  WHERE NOT EXISTS (
    SELECT 1
      FROM prospects p
      JOIN usuarios v ON v.id = p.vendedor_id
      JOIN usuarios u ON u.id = NEW.usuario_id AND u.ativo = 1
     WHERE p.id = NEW.prospect_id
       AND (u.id = v.id OR u.perfil IN ('administrador','gerente') OR (u.perfil = 'supervisor' AND v.supervisor_id = u.id))
  );

  SELECT RAISE(ABORT, 'numero_tentativa fora de sequência')
  WHERE NEW.numero_tentativa <> (SELECT tentativas + 1 FROM prospects WHERE id = NEW.prospect_id);

  SELECT RAISE(ABORT, 'data do contato anterior ao último contato registrado')
  WHERE NEW.data_contato < COALESCE((SELECT dt_ultimo_contato FROM prospects WHERE id = NEW.prospect_id), '0000-00-00');

  SELECT RAISE(ABORT, 'motivo inativo ou não disponível para o app')
  WHERE NEW.motivo_id IS NOT NULL AND NEW.origem = 'app'
    AND NOT EXISTS (SELECT 1 FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id AND m.ativo = 1 AND m.uso_app = 1);

  SELECT RAISE(ABORT, 'este motivo exige observação')
  WHERE NEW.motivo_id IS NOT NULL AND COALESCE(trim(NEW.observacao), '') = ''
    AND EXISTS (SELECT 1 FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id AND m.exige_observacao = 1);

  -- 0034: 1ª recusa do cliente (sem interesse com motivo do cliente, sem recusa do cliente antes) exige a data de retorno;
  -- o cliente continua na lista. Na 2ª recusa ele sai da lista (vai para Rejeitados) e a data não vale.
  SELECT RAISE(ABORT, 'sem interesse do cliente: informe a data de retorno')
  WHERE NEW.origem = 'app' AND NEW.resultado = 'sem_interesse' AND NEW.data_retorno IS NULL
    -- cliente já cadastrado no ERP só registra (o status não muda): não há lista para voltar
    AND (SELECT status_atual FROM prospects WHERE id = NEW.prospect_id) NOT IN ('analise_financeira', 'aguardando_pedido', 'aguardando_pedido_valido')
    AND EXISTS (SELECT 1 FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id AND m.origem = 'cliente')
    AND NOT EXISTS (SELECT 1 FROM contatos c JOIN motivos_sem_interesse m ON m.id = c.motivo_id
                     WHERE c.prospect_id = NEW.prospect_id AND c.resultado = 'sem_interesse' AND m.origem = 'cliente');

  SELECT RAISE(ABORT, 'a data de retorno deve ser depois da data do registro')
  WHERE NEW.data_retorno IS NOT NULL AND NEW.data_retorno <= NEW.data_contato;
END;

DROP TRIGGER trg_contatos_aplicar;
CREATE TRIGGER trg_contatos_aplicar
AFTER INSERT ON contatos
BEGIN
  INSERT INTO movimentacoes (prospect_id, tipo, status_anterior, status_novo, data_evento, origem, referencia, usuario_id, vendedor_id, detalhe)
  SELECT p.id, NEW.resultado, p.status_atual,
         CASE
           WHEN p.status_atual IN ('analise_financeira','aguardando_pedido','aguardando_pedido_valido') THEN p.status_atual
           WHEN NEW.resultado IN ('atendido','pedido_informado') THEN 'aguardando_cadastro'
           WHEN NEW.resultado = 'sem_interesse' THEN 'sem_interesse'
           WHEN p.status_atual = 'nao_contactado' THEN 'em_prospeccao'
           ELSE p.status_atual
         END,
         NEW.data_contato, 'contato', NEW.id,
         CASE WHEN NEW.origem = 'app' THEN NEW.usuario_id END, p.vendedor_id,
         TRIM(COALESCE((SELECT m.descricao FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id) || ' — ', '')
              || COALESCE(NEW.observacao, '')
              || COALESCE(' · pedido de ' || strftime('%d/%m/%Y', NEW.data_pedido_informado), '')
              -- atendimento informado com data posterior ao automático da importação: fica registrado no histórico
              || CASE WHEN NEW.resultado IN ('atendido','pedido_informado') AND p.convertido_sem_registro = 1
                        AND p.dt_atendido IS NOT NULL AND NEW.data_contato > p.dt_atendido
                        AND EXISTS (SELECT 1 FROM movimentacoes a WHERE a.prospect_id = p.id AND a.origem = 'erp' AND a.tipo = 'atendido')
                      THEN ' · representante informou data posterior à importação (atendimento considerado em '
                           || strftime('%d/%m/%Y', p.dt_atendido) || ')'
                      ELSE '' END, ' —·')
    FROM prospects p WHERE p.id = NEW.prospect_id;

  UPDATE prospects SET
    status_atual = (SELECT status_novo FROM movimentacoes WHERE origem = 'contato' AND referencia = NEW.id),
    tentativas = NEW.numero_tentativa,
    -- 1º registro: sempre a primeira data (do representante, da planilha ou do atendimento automático da importação)
    dt_primeiro_contato = COALESCE(MIN(dt_primeiro_contato, NEW.data_contato), NEW.data_contato),
    dt_segundo_contato  = CASE WHEN NEW.numero_tentativa = 2 THEN NEW.data_contato ELSE dt_segundo_contato END,
    dt_ultimo_contato   = NEW.data_contato,
    -- "atendido em": o 1º atendido; sobre o automático da importação, vale a primeira data (a dele, se anterior)
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
    -- retorno: na negociação (opcional) e na 1ª recusa do cliente (obrigatório, 0034: o cliente continua na lista);
    -- na 2ª recusa do cliente, ou no sem interesse do representante, fica sem data e o cliente sai da lista
    data_proxima_acao = CASE
      WHEN status_atual = 'aguardando_cadastro' THEN NEW.data_retorno
      WHEN NEW.resultado = 'sem_interesse' AND status_atual = 'sem_interesse'
           AND EXISTS (SELECT 1 FROM motivos_sem_interesse m WHERE m.id = NEW.motivo_id AND m.origem = 'cliente')
           AND (SELECT COUNT(*) FROM contatos c JOIN motivos_sem_interesse m ON m.id = c.motivo_id
                 WHERE c.prospect_id = NEW.prospect_id AND c.resultado = 'sem_interesse' AND m.origem = 'cliente') = 1
        THEN NEW.data_retorno
      ELSE NULL END,
    -- motivo final = o do último "sem interesse"
    motivo_sem_interesse_id = CASE WHEN NEW.resultado = 'sem_interesse' THEN NEW.motivo_id ELSE motivo_sem_interesse_id END
  WHERE id = NEW.prospect_id;
END;

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
       -- 0034: o sem interesse do cliente com retorno marcado (1ª recusa) continua na lista do representante
       CASE WHEN s.lista_trabalho = 1 OR (p.status_atual = 'sem_interesse' AND p.data_proxima_acao IS NOT NULL) THEN 1 ELSE 0 END AS na_lista,
       CASE WHEN (s.lista_trabalho = 1 OR (p.status_atual = 'sem_interesse' AND p.data_proxima_acao IS NOT NULL))
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
       -- 0032: os dias contam a partir do início da campanha (Parâmetros) — registro anterior a ela conta do início
       CASE WHEN p.data_proxima_acao IS NULL
             AND julianday(date('now','-3 hours')) - julianday(MAX(CASE p.status_atual
                   WHEN 'em_prospeccao' THEN COALESCE(p.dt_ultimo_contato, p.dt_primeiro_contato)
                   WHEN 'aguardando_pedido' THEN MAX(COALESCE(p.dt_liberacao_credito, p.dt_ultimo_contato), COALESCE(p.dt_ultimo_contato, p.dt_liberacao_credito)) END,
                   COALESCE((SELECT valor FROM parametros WHERE chave = 'data_inicio_campanha'), '')))
                 > (SELECT CAST(valor AS INTEGER) FROM parametros WHERE chave = 'dias_alerta_sem_movimento') THEN 1 ELSE 0 END AS parado
  FROM prospects p
  JOIN status s   ON s.codigo = p.status_atual
  JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios sup ON sup.id = COALESCE(v.supervisor_id, CASE WHEN v.perfil = 'supervisor' THEN v.id END)
  LEFT JOIN motivos_sem_interesse m ON m.id = p.motivo_sem_interesse_id;


