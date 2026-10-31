# ADR-0007 — Apagar os dados de um arquivo de pedidos

**Situação:** aceita em 2026-10-31.

## Contexto
O histórico e as linhas de importação são só de inclusão: correção é novo registro. O administrador precisa fazer cargas de teste de pedidos
no banco único de produção e depois tirá-las sem deixar vendas, valores e histórico falsos.

## Decisão
Cada pedido e cada efeito em cliente guardam o arquivo de origem. Inserir em `pedido_exclusoes` apaga, num trigger e numa transação só, o que aquele arquivo trouxe:
`pedidos_erp`, `pedido_aplicacoes`, `importacao_linhas` e as `movimentacoes` geradas por ele, e devolve os campos do cliente a partir da foto guardada em `pedido_aplicacoes`.

- Só o administrador, e do arquivo mais novo para o mais antigo: um arquivo posterior pode ter mudado os mesmos pedidos.
- Atendimentos do representante, cadastro, crédito e baixados não saem. Se ele registrou atendimento depois do arquivo, o status considera esse registro.
- Fica permanente: a linha em `importacoes`, `pedido_importacoes.apagada_em/apagada_por` e `pedido_exclusoes`.
- A trava de `movimentacoes` e `importacao_linhas` só libera enquanto existe `pedido_exclusoes.concluida = 0`, o que só ocorre dentro do trigger. `DELETE` direto continua recusado.
- Não cobre pedidos antigos em `eventos_erp`: esses continuam definitivos. Por isso a tela de pedidos deixou de gravar nessa tabela.

## Consequências
- A chave de administração precisa de `data_delete` nessas tabelas (versão 3, renovada na publicação). As regras do banco continuam mandando.
- Quem tem a chave de administração não consegue apagar histórico fora de uma exclusão de arquivo.
- Durante uma carga de teste, os dados aparecem para todos os usuários até serem apagados.
