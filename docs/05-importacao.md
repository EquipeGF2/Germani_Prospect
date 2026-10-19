# 05 — Importações

Todas as importações rodam na **máquina do administrador** (`.env` com o token administrativo).
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
```

### Layout (cabeçalho comparado sem acento, sem pontuação e sem diferenciar maiúsculas)

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
| 13 | ONDA | `onda` | |
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

### O que acontece com cada linha aceita
1. Supervisor (COD SUP) e vendedor (COD) são criados se não existirem — **sem senha**.
2. CNPJ novo → prospect criado. CNPJ existente → **só dados cadastrais** são atualizados; status,
   contatos, histórico e vendedor não mudam (mudança de vendedor = transferência). Baixado não é tocado.
3. DT 1o / DT 2o → contatos com `origem = 'importacao'`, canal `nao_informado`. As tentativas
   anteriores à última ficam como "sem conclusão"; a última recebe o resultado mapeado do Status Atual.
   As regras do app valem: 2 tentativas sem interesse ⇒ Sem interesse. Tentativas só entram uma vez.

### Rejeições (linha inteira, com motivo no relatório)
CNPJ vazio/inválido · razão social vazia · COD/NOME ou COD SUP/SUPERVISOR vazios · data inválida ou futura ·
DT 2o sem DT 1o ou anterior a ela · Status Atual não mapeado ou incoerente com as datas · CNPJ repetido na
planilha (a primeira ocorrência entra) · representante com dois supervisores diferentes · representante já
cadastrado com outro supervisor.

## 2. Arquivos do ERP e CNPJs baixados (recorrente)

O layout desses arquivos ainda não foi enviado — as colunas são informadas na linha de comando:

```bash
npm run importar:eventos -- --listar-colunas arquivo.xlsx
npm run importar:eventos -- --tipo cadastro arquivo.xlsx --col-cnpj "CNPJ" --col-data "Data Cadastro" --col-documento "Código" --simular
npm run importar:eventos -- --tipo pedido   arquivo.xlsx --col-cnpj "CNPJ" --col-data "Data"          --col-documento "Pedido"
npm run importar:eventos -- --tipo baixa    baixados.csv --col-cnpj "CNPJ" --data-padrao 2026-10-19
```

| Situação da linha | Resultado |
|---|---|
| CNPJ inválido, data inválida/futura, pedido sem número | rejeitada |
| CNPJ fora da base de prospects (ex.: cliente antigo no cadastro do ERP) | ignorada |
| Evento já importado (mesmo prospect + tipo + documento) | ignorada |
| Cadastro/pedido de CNPJ baixado | rejeitada — "impossibilitado de faturamento" |

Quando o layout real chegar, os nomes de coluna viram padrão no script (ver 07-pendencias).

## 3. Planilha fictícia para testes
`npm run exemplo:planilha` gera `exemplos/base-ficticia.xlsx` no layout real, com CNPJs inventados
(10% alfanuméricos) e 2 linhas com erro proposital.
