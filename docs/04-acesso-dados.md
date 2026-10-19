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
| Painel | `shared/indicadores.mjs` (`consultaPosicao`, `consultaAtividade`), `vw_ultimo_lancamento`, `vw_ranking_motivos`, `vw_prospects` (alertas) | supervisor: o próprio `supervisor_id` |
| Login | `usuarios` (login, senha_hash, perfil, ativo) + `conferirSenha()` | — |

## O app GRAVA (somente inclusão)

### Registrar contato
```sql
INSERT INTO contatos (id, prospect_id, usuario_id, numero_tentativa, data_contato, data_hora_dispositivo,
                      canal, resultado, motivo_id, observacao, observacao_busca, data_retorno,
                      latitude, longitude, distancia_m, gps_confirmado)
VALUES (:uuid_do_aparelho, :prospect, :usuario, :tentativas_atuais + 1, :data_do_aparelho, :iso_com_fuso,
        :canal, :resultado, :motivo, :obs, normalizarBusca(:obs), :retorno, :lat, :lng, :dist, :gps);
```
- Validar antes com `validarContato()` (`shared/status.mjs`) — mesma regra do banco, mensagem amigável.
- O banco recusa com mensagem clara: prospect que não aceita contato (venda/baixado), sem permissão, tentativa fora de sequência,
  data anterior ao último contato, motivo inválido, motivo que exige observação.
- `numero_tentativa` fora de sequência indica que outro aparelho registrou antes: recarregar a ficha.

### Transferir carteira (supervisor/admin)
```sql
INSERT INTO transferencias (prospect_id, de_vendedor_id, para_vendedor_id, data_transferencia, motivo, usuario_id)
VALUES (...);
```

## O app NUNCA faz
- `UPDATE`/`DELETE` em qualquer tabela.
- Alterar `prospects.status_atual` diretamente (é sempre efeito de evento).
- Colocar dados pessoais em URL (query string).
