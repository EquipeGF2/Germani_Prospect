# 07 — Pendências e dúvidas em aberto

Atualizado em 2026-10-19. Cada item diz o que já está implementado como padrão e o que falta confirmar.

| # | Assunto | Padrão implementado | Falta |
|---|---|---|---|
| 1 | Valores reais de "Status Atual" | mapa com Não contactado / Em prospecção / Em negociação e Com interesse (→ Em negociação) / Sem interesse; o resto é rejeitado | rodar `--listar-status` na planilha real e completar `config/mapa-status-planilha.json` |
| 2 | 2ª coluna "CNPJ" da planilha | comparada com a 1ª; diferente → aviso + `cnpj_secundario` | confirmar o que ela representa |
| 3 | Prazo de cadastro de 15 dias | contado do **primeiro "com interesse"** (data do "atendido em") até aparecer no arquivo de cadastro; vencido = alerta | confirmar o ponto de partida |
| 4 | Análise financeira de 10 dias | contados da data do pedido; só informativo (`em_analise_financeira`) | processo de pedido cancelado por restrição financeira (fase futura) |
| 5 | Intervalo entre tentativas | `dias_entre_tentativas` = 7 | confirmar o valor |
| 6 | "Sem interesse" na 1ª tentativa | não encerra: volta à fila para a 2ª tentativa | confirmar |
| 7 | Destino dos "Sem interesse" | saem da fila e ficam disponíveis em relatório | definir a ação posterior |
| 8 | Layout dos arquivos do ERP (cadastro, pedidos) e de baixados | colunas informadas na linha de comando | enviar amostras para fixar o layout |
| 9 | Códigos de supervisor e representante | espaços separados (podem repetir número sem conflito) | confirmar se supervisor também tem carteira própria (COD = COD SUP) |
| 10 | Canal das tentativas da planilha | `nao_informado` | — |
| 11 | Permissões do token do app × triggers | — | itens "Verificar" do [ADR-0001](adr/0001-turso-direto-github-pages.md) |
| 12 | Login | usuário + senha gerada pelo administrador | — |
| 14 | Quem é representante e quem é vendedor | **resolvido:** lista do administrador (`npm run importar:tipos`, docs/05 §3); sem definição = representante | enviar a lista |
| 15 | "Front mais amplo" do vendedor | **resolvido:** montagem de rotas (docs/03 §7) + visão por rota/subrota, na própria carteira | — |
| 16 | Representante registra "com interesse"? | sim — mesmo formulário do vendedor; o que muda é não ter rota | confirmar |
