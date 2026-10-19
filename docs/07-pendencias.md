# 07 — Pendências e dúvidas em aberto

Atualizado em 2026-10-19. Cada item diz o que já está implementado como padrão e o que falta confirmar.

| # | Assunto | Padrão implementado | Falta |
|---|---|---|---|
| 1 | Valores reais de "Status Atual" | mapa com Não contactado / Em prospecção / Aguardando cadastro e Atendido (→ Aguardando cadastro) / Não atendido (→ contato da planilha, continua na lista) / Sem interesse; o resto é rejeitado | rodar `--listar-status` na planilha real e completar `config/mapa-status-planilha.json` |
| 2 | 2ª coluna "CNPJ" da planilha | comparada com a 1ª; diferente → aviso + `cnpj_secundario` | confirmar o que ela representa |
| 3 | Prazo de cadastro de 15 dias | contado do **primeiro "atendido"** (data do "atendido em") até aparecer no arquivo de cadastro; vencido = alerta | confirmar o ponto de partida |
| 4 | Análise financeira | **resolvido:** começa no arquivo de cadastro; termina com o OK do analista — a liberação sempre ocorre, com condição (à vista/antecipado ou a prazo), restrição de crédito sim/não e limite estipulado → Aguardando pedido; 10 dias = alerta | — |
| 18 | Arquivos do ERP × status do app | **resolvido:** cadastro e pedido prevalecem para qualquer cliente (inclusive Sem interesse) | — |
| 7 | Destino dos "Sem interesse" | saem da fila e ficam disponíveis em relatório | definir a ação posterior |
| 8 | Layout dos arquivos do ERP (cadastro, pedidos) e de baixados | colunas informadas na linha de comando | enviar amostras para fixar o layout |
| 9 | Códigos de supervisor e representante | espaços separados (podem repetir número sem conflito) | confirmar se supervisor também tem carteira própria (COD = COD SUP) |
| 10 | Canal das tentativas da planilha | `nao_informado` | — |
| 11 | Permissões do token do app × triggers | — | itens "Verificar" do [ADR-0001](adr/0001-turso-direto-github-pages.md) |
| 12 | Login | usuário + senha gerada pelo administrador | — |
| 14 | Quem é representante e quem é vendedor | **resolvido:** lista do administrador (`npm run importar:tipos`, docs/05 §3); sem definição = representante | enviar a lista |
| 15 | "Front mais amplo" do vendedor | **resolvido:** montagem de rotas (docs/03 §7) + visão por rota/subrota, na própria carteira | — |
| 16 | Registros do app | **resolvido:** atendido · sem interesse (também em lote) · reabrir com pedido identificado; "não atendido" não gera registro | — |
| 19 | Operação pelo app | **decidido:** nada direto no banco; carga e administração por telas. Token de administração digitado na tela (ADR-0001) | definir com a F1 |
