# 05 — Importações

**Operação definitiva: pelas telas de administração do app (F1)** — upload do arquivo, simulação com o
relatório na tela, confirmação. A lógica é a mesma dos comandos abaixo (`shared/importar-base.mjs`,
`shared/importar-eventos.mjs`, `shared/importar-tipos.mjs`); os comandos de linha ficam como contingência.
As planilhas **nunca** vão para o repositório (ele é público; o `.gitignore` bloqueia `*.xlsx`/`*.csv`).

Todas seguem as mesmas garantias:
- **Simulação primeiro** (`--simular`): valida tudo e gera o relatório sem gravar.
- **Nenhuma linha some:** `linhas_lidas = aceitas + rejeitadas + ignoradas`. Linhas 100% vazias são
  contadas à parte (`linhasVazias`).
- Cada linha fica registrada em `importacao_linhas` com os dados brutos e as mensagens, e sai no
  relatório `relatorios/<tipo>-<id>-<data>.csv` (abre no Excel).
- `.xlsx` malformado do Senior: leitura normal → reempacotamento corrigindo `\` e `styles.xml` →
  se falhar, a mensagem pede CSV. CSV aceita `;` ou `,`, aspas, decimal com vírgula, UTF-8 ou Windows-1252.

## 1. Planilha base de prospects (carga inicial — uma vez)

```bash
npm run importar:base -- base.xlsx --listar-status   # 1) ver os valores reais de "Status Atual"
#   → completar config/mapa-status-planilha.json
npm run importar:base -- base.xlsx --simular         # 2) conferir o relatório
npm run importar:base -- base.xlsx                   # 3) gravar
#   --sem-datas  ignora DT 1o / DT 2o e o Status Atual · --com-datas  força considerar
```

### Considerar ou não as datas de contato (DT 1o / DT 2o)
Na tela (passo "Datas e status da planilha") há a marcação **Considerar DT 1o / DT 2o contato e o Status Atual**.
- **Padrão:** marcada só se a planilha tiver alguma data preenchida (a tela mostra quantas linhas têm data).
  Na planilha atual as duas colunas estão vazias → vem **desmarcada**.
- **Desmarcada:** as duas datas e o Status Atual são ignorados; todo prospect novo entra como **Não contactado**,
  sem registro de contato da planilha, com `dt_entrada_base` = dia da importação. Status Atual diferente de
  "não contactado" gera só um **aviso** na linha (não rejeita). O mapeamento do Status Atual nem aparece.
- **Marcada:** regras abaixo (datas viram registros "contato da planilha"; Status Atual aplicado à última data).
- A escolha fica registrada em `importacoes.observacao` (`considerarDatas`) e no resumo da simulação.

### Layout (cabeçalho comparado sem acento, sem pontuação e sem diferenciar maiúsculas)

- O **cabeçalho** pode estar em qualquer uma das 10 primeiras linhas (título ou linha em branco acima dele, como na
  planilha real "Tabela Principal", com cabeçalho na linha 2). O número de linha no relatório é o da planilha.
- Coluna **TIPO** ("Representante" / "Vendedor") define o tipo de atuação do vendedor ao ser criado; na reimportação,
  preenche só quem ainda está sem tipo (o que foi ajustado na tela Usuários não muda). TIPO diferente para o mesmo
  código vira aviso e vale o da primeira linha.
- A gravação é feita em **lotes de 100 linhas** com barra de andamento (equipe → prospects → relatório). A aba precisa
  ficar aberta até o fim; se cair no meio, basta importar de novo o mesmo arquivo (CNPJ existente não duplica).
- **Status Atual** com número na frente ("1 - Não Contactado", "2 - Sem Interesse") é comparado sem o número.
- Planilhas grandes (~23 mil linhas, 4 MB) são lidas no navegador: antes da leitura saem os nomes definidos, o filtro
  automático, a validação de dados e a formatação condicional — o leitor expandia célula por célula um filtro salvo até
  a coluna XEY e ficava sem memória. Os valores das células não mudam.

| # | Coluna | Campo | Tratamento |
|---|---|---|---|
| 1 | CNPJ | `cnpj` | **obrigatória**; normalizado; DV validado (numérico ou alfanumérico) |
| 2 | Razão social | `razao_social` | **obrigatória** |
| 3 | Nome Fantasia | `nome_fantasia` | |
| 4 | Endereço | `endereco` | |
| 5 | Bairro | `bairro` | |
| 6 | Cidade | `cidade` (+ `cidade_busca` sem acento) | |
| 7 | Estado | `uf` | UF inválida → aviso, gravada vazia |
| 8 | Código Postal | `cep` | só dígitos, 8 posições; inválido → aviso |
| 9 | Latitude | `latitude` | aceita vírgula decimal; fora do Brasil → aviso, vazia |
| 10 | Longitude | `longitude` | idem (dispensa geocodificação) |
| 11 | TIPOLOGIA GTM | `tipologia_gtm` | |
| 12 | Telefone | `telefone` | só dígitos |
| 13 | ONDA | `onda` | segmentação: visão e filtro na lista, nos indicadores e no histórico |
| 14 | CNPJ (2ª) | `cnpj_secundario` | comparada com a 1ª; se diferente → aviso e guardada |
| 15 | TIPO | `tipo` | |
| 16 | COD SUP | supervisor (`usuarios.codigo_erp`) | **obrigatória** |
| 17 | SUPERVISOR | nome do supervisor | **obrigatória** |
| 18 | COD | representante/vendedor (`usuarios.codigo_erp`) | **obrigatória** |
| 19 | NOME | nome do representante/vendedor | **obrigatória** |
| 20 | ROTA | `rota` | |
| 21 | SUBROTA | `subrota` | |
| 22 | OBS | `obs_planilha` | |
| 23 | DT 1o.contato | contato nº 1 | data (serial Excel, dd/mm/aaaa ou ISO); futura → rejeita |
| 24 | DT 2o.contato | contato nº 2 | exige DT 1o; não pode ser anterior a ela |
| 25 | Status Atual | resultado da **última** tentativa | via `config/mapa-status-planilha.json`; valor não mapeado → **rejeita** |
| 26 | # Dias Corridos | — | ignorada: recalculada em `vw_prospects.dias_corridos` |

### O que acontece com cada linha aceita (com datas consideradas)
1. Supervisor (COD SUP) e vendedor (COD) são criados se não existirem — **sem senha**.
2. CNPJ novo → prospect criado. CNPJ existente → **só dados cadastrais** são atualizados; status,
   contatos, histórico e vendedor não mudam (mudança de vendedor = transferência). Baixado não é tocado.
3. DT 1o / DT 2o → registros com `origem = 'importacao'`, canal `nao_informado` — garantem que os
   **dias corridos** contem do 1º contato. Os anteriores ao último ficam como `contato_planilha`; o último
   recebe o resultado mapeado do Status Atual: `contato_planilha` (→ Em prospecção, continua na lista),
   `atendido` (→ Aguardando cadastro) ou `sem_interesse` (motivo "Não informado"). Entram uma vez só.

### Rejeições (linha inteira, com motivo no relatório)
CNPJ vazio/inválido · razão social vazia · COD/NOME ou COD SUP/SUPERVISOR vazios · data inválida ou futura ·
DT 2o sem DT 1o ou anterior a ela · Status Atual não mapeado ou incoerente com as datas · CNPJ repetido na
planilha (a primeira ocorrência entra) · representante com dois supervisores diferentes · representante já
cadastrado com outro supervisor.

## 2. Arquivos do ERP e CNPJs baixados (recorrente)

Cadastro e baixados: as colunas são informadas na tela ou na linha de comando. Pedidos: use a §6 (o comando abaixo é só contingência, grava venda definitiva e não pode ser apagado):

```bash
npm run importar:eventos -- --listar-colunas arquivo.xlsx
npm run importar:eventos -- --tipo cadastro arquivo.xlsx --col-cnpj "CNPJ" --col-data "Data Cadastro" --col-documento "Código" --simular
npm run importar:eventos -- --tipo pedido   arquivo.xlsx --col-cnpj "CNPJ" --col-data "Data"          --col-documento "Pedido" --col-valor "Valor Total"
npm run importar:eventos -- --tipo baixa    baixados.csv --col-cnpj "CNPJ" --data-padrao 2026-10-19
```

| Situação da linha | Resultado |
|---|---|
| CNPJ inválido, data inválida/futura, pedido sem número | rejeitada |
| CNPJ fora da base de prospects (ex.: cliente antigo no cadastro do ERP) | ignorada |
| Evento já importado (mesmo prospect + tipo + documento) | ignorada |
| Cadastro/pedido de CNPJ baixado | rejeitada — "impossibilitado de faturamento" |

Quando o layout real chegar, os nomes de coluna viram padrão no script (ver 07-pendencias).

## 3. Relatório de cadastro e crédito (rotina)

Tela **Administração → Cadastro e crédito (ERP)** (contingência: `npm run importar:credito -- arquivo.xlsx`).
O .xlsx do ERP vem fora do padrão (caminhos com "\\", aba solta, textos em CDATA): o leitor corrige na leitura.

| Coluna (relatório do ERP) | Uso |
|---|---|
| Cliente | código do cliente no ERP (registrado no cadastro, se o cliente ainda não tinha) |
| CPF / CNPJ * | localiza o prospect; CPF e fora da base = ignorados |
| Razão Social | conferência (diferente da base = aviso) |
| Cond. Pgto + Descrição | condição de pagamento (gravada como veio; prazo médio calculado da descrição) |
| Forma Pgto * + Descrição | forma de pagamento (gravada como veio; mapeada para o filtro rápido na tela) |
| Créd. Cliente | limite do cliente — prevalece quando preenchido (9.999.999 = sem limite; 0 = sem crédito) |
| Créd. Grupo | limite global da raiz do CNPJ — usado quando o Créd. Cliente está vazio |
| Dt. Cadastro * | data em que o cadastro entrou na empresa |

Efeito: Análise financeira → **Aguardando pedido** (regras em docs/03 §8.1). A simulação mostra antes de gravar:
linhas na base × fora da base × CPF, grupos (raiz com 2+ empresas), limite considerado (cliente · grupo · sem limite ·
sem crédito) e os pontos para conferir (grupos com Créd. Grupo diferente, grupos mistos, cadastros anteriores à campanha).
As colunas são reconhecidas pelo nome (a "Descrição" pela posição) e podem ser escolhidas na tela pela letra da coluna.

## 4. Lista de representantes e vendedores (forma de trabalho)

Quando a planilha base não informa quem é **representante** (sem rota) e quem é **vendedor** (com rota),
o administrador envia uma lista simples — rode depois da carga da base:

```bash
npm run importar:tipos -- tipos.xlsx --simular
npm run importar:tipos -- tipos.xlsx                                   # colunas padrão: COD e TIPO
npm run importar:tipos -- tipos.xlsx --col-codigo "Código" --col-tipo "Função"
```

| COD | NOME (opcional, ignorada) | TIPO |
|---|---|---|
| 1101 | Fulano | REPRESENTANTE |
| 1201 | Beltrana | VENDEDOR |

- **COD** = o mesmo código de representante/vendedor da planilha base.
- **TIPO** aceita (sem diferenciar acento/maiúsculas): REPRESENTANTE, REP, RCA, REPRESENTANTE COMERCIAL ·
  VENDEDOR, VENDEDOR INTERNO, INTERNO, VI.
- Rejeitadas: código vazio, código não cadastrado, tipo não reconhecido, mesmo código com tipos diferentes.
  Ignoradas: já estava com aquele tipo. Toda alteração vai para `auditoria`.
- Ao final, o resumo avisa quantos ainda estão **sem tipo** (tratados como representante).
- Para um ajuste pontual: `npm run usuarios -- tipo <login> representante|vendedor`.

## 6. Pedidos do ERP (rotina)

Tela **Administração → Pedidos · Baixados (ERP) → Importar arquivo de pedidos** (`#/admin/importar/pedidos`). Regras: docs/03 §14.

Etapas: **arquivo** (e data) → **classificação** dos códigos → **vínculo** com os clientes → **simulação** → **gravação**. Nada é gravado antes da confirmação.

| Coluna do relatório | Uso |
|---|---|
| Pedido | identifica o pedido. Repetido no arquivo = rejeitado |
| CPF / CNPJ | liga ao cliente pelo CNPJ exato. Até 11 dígitos = CPF, ignorado. CNPJ fora da base = ignorado; mesma raiz de um cliente da base = visão do grupo (docs/03 §14). Inválido = rejeitado |
| Cliente · Razão Social | código do ERP e nome (vale o nome da base, quando o CNPJ está nela). Código diferente do cadastro = aviso |
| Vlr. Pedido · Vlr. Faturado | valores. Faturado maior que o pedido = aviso |
| Sit. + Situação · Transação + Desc. Trans. | classificação |
| Rep. | representante do pedido |
| Dt. Emissão ou Data (opcional) | data da linha; sem ela, vale a data informada |

O arquivo é o **.xls antigo do Senior** (BIFF2, `shared/biff.mjs`), com qualquer caixa na extensão; também aceita .xlsx e .csv. A extensão não importa para o `.gitignore`: planilha real nunca vai para o repositório.

**Data:** importação diária = data do dia; semanal = data informada na tela (ou coluna de data). Todas as mudanças do arquivo ficam com essa data.

**Próximo arquivo:** o mesmo pedido volta com outra situação e entra uma linha nova (`pedidos_erp`, só inclusão; a atual é a última). Pedido igual ao anterior é ignorado, então reimportar o mesmo arquivo não muda nada.
Pedido em aberto que não veio no arquivo novo não é cancelado (o relatório pode ter outro filtro): a simulação só avisa.

**Toda linha fica vinculada ao arquivo** (`importacao_id`) e pode ser apagada: docs/03 §14, ADR-0007.

## 5. Planilha fictícia para testes
`npm run exemplo:planilha` gera `exemplos/base-ficticia.xlsx` no layout real, com CNPJs inventados
(10% alfanuméricos) e 2 linhas com erro proposital.
