# ADR-0008 — Apagar uma importação da base de prospects

**Situação:** aceita em 2026-11-06.

## Contexto
Uma base de prospects foi importada por engano (clientes de SC, antes de a base de SC estar pronta). Prospects, contatos e
movimentações são só de inclusão (ADR-0003), e só o arquivo de pedidos podia ser apagado (ADR-0007). O dono pediu para apagar.

## Decisão
Inserir em `base_exclusoes` apaga, num trigger e numa transação só, os prospects que entraram por aquela importação
(`prospects.importacao_id`), com os `contatos` e as `movimentacoes` deles.

- Só o administrador, só importação da base concluída, uma vez por importação.
- Recusa se algum desses clientes já foi trabalhado (`vw_base_trabalhados`): contato fora da planilha, evento do ERP, crédito,
  transferência, rota, expurgo ou pedido. Nada que alguém registrou é apagado.
- Quem já existia e só teve o cadastro atualizado não sai; o cadastro anterior não volta (não há foto do antes).
- Representante e supervisor criados pela importação, sem acesso liberado e sem cliente restante, são desativados (não apagados).
- `importacao_linhas` e `importacoes` ficam como registro; `base_exclusoes` guarda quem apagou, quando e as quantidades.
- O `DELETE` em prospects, contatos e movimentações só passa enquanto existe `base_exclusoes.concluida = 0`, o que só ocorre
  dentro do trigger. `resumo_carteira` ganhou o trigger de exclusão.

## Consequências
- A chave de administração precisa de `data_delete` em prospects e contatos (versão 4, renovada na publicação).
- Uma importação com qualquer cliente trabalhado não pode mais ser apagada: aí a saída é expurgo ou baixa, como antes.
