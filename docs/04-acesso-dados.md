# 04 — Contrato de acesso a dados do app (para a F1)

Sem servidor (ADR-0001), o app fala SQL com o Turso. Para manter o banco íntegro, o app segue este contrato
— e o token do app só permite isso.

## O app LÊ (somente views e tabelas de referência)

| Tela | Fonte | Filtro obrigatório na consulta |
|---|---|---|
| Lista de prospects (lista · cidade · bairro · rota) | `consultaCarteira()` de `shared/carteira.mjs` sobre `vw_prospects` | escopo e visões pelo usuário: representante sem rota; vendedor com rota; supervisor = equipe |
| Acompanhamento por status (carteira inteira) | `consultaCarteira({ visao: 'status' })` e `consultaCarteira({ filtros: { status } })` | idem |
| Retornos hoje | lista: `consultaCarteira({ filtros: { somenteRetornos: true } })` · negociação (no acompanhamento): `consultaCarteira({ filtros: { status: 'em_negociacao', somenteRetornos: true } })` | idem carteira |
| Ficha | `vw_prospects` + `vw_linha_tempo` | `prospect_id` |
| Formulário de contato | `motivos_sem_interesse WHERE ativo = 1 AND uso_app = 1 ORDER BY ordem`, `parametros` | — |
| Painel | `shared/indicadores.mjs` (`consultaPosicao`, `consultaAtividade`, `consultaExecucaoRotas`), `vw_ultimo_lancamento`, `vw_ranking_motivos`, `vw_prospects` (alertas) | supervisor: o próprio `supervisor_id` |
| Login | `usuarios` (login, senha_hash, perfil, ativo) + `conferirSenha()` | — |

## O app GRAVA (somente inclusão)

### Registrar contato
```sql
INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, data_hora_dispositivo,
                      canal, resultado, motivo_id, observacao, observacao_busca, data_retorno,
                      data_pedido_informado, latitude, longitude)
VALUES (:uuid_do_aparelho, :prospect, :usuario, :registros_atuais + 1 /* prospects.tentativas + 1 */, :data_do_aparelho, :iso_com_fuso,
        :canal, :resultado, :motivo, :obs, normalizarBusca(:obs), :retorno,
        :data_pedido /* só em "pedido identificado" */, :lat_aparelho, :lng_aparelho);
```
- Validar antes com `validarContato()` (`shared/status.mjs`) — mesma regra do banco, mensagem amigável.
- O banco recusa com mensagem clara: prospect que não aceita contato (venda/baixado), sem permissão, tentativa fora de sequência,
  data anterior ao último contato, motivo inválido, motivo que exige observação.
- `numero_tentativa` fora de sequência indica que outro aparelho registrou antes: recarregar a ficha.

### Registrar em lote
`prepararLote()` + `registrarLote()` de `shared/lote.mjs` — justificativa do lote e/ou individual; devolve os
itens recusados com o motivo.

### Transferir carteira (supervisor/admin)
```sql
INSERT INTO transferencias (prospect_id, de_vendedor_id, para_vendedor_id, data_transferencia, motivo, usuario_id)
VALUES (...);
```

### Montar rota (somente vendedor)
`comandoCriarRota`, `comandosSalvarParadas` (substitui as paradas da rota, em lote) e `comandoEncerrarRota`
de `shared/rotas.mjs`. Leitura: `consultaParadas` / `vw_rota_paradas`. É a única parte editável pelo app,
porque rota é plano — o histórico continua só nos contatos.

## O app NUNCA faz
- `UPDATE`/`DELETE` em qualquer tabela, exceto o plano de rota (`rotas`, `rota_paradas`) enquanto planejada.
- Calcular distância entre pontos (ADR-0005).
- Alterar `prospects.status_atual` diretamente (é sempre efeito de evento).
- Colocar dados pessoais em URL (query string).
