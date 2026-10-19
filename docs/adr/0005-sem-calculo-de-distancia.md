# ADR-0005 — Sem cálculo de distância por geolocalização

- **Data:** 2026-10-19 · **Situação:** aceita · **Sistema:** GERMANI

## Contexto
A planilha base traz latitude/longitude. Daria para estimar distâncias (prospect mais perto, ordem de rota,
"visita confirmada pelo GPS"), mas as coordenadas de planilha costumam ser aproximadas (centro do CEP,
geocodificação antiga), e o GPS do celular varia muito em área urbana. Uma distância errada leva a decisão
errada (rota ruim, visita "não confirmada" injustamente). O dono avaliou como arriscado.

## Decisão
- O sistema **não calcula distância** e não confirma visita por GPS.
- Coordenadas servem só para **abrir o ponto no mapa do celular** (`linkMapa`) e para centralizar o mapa
  nas visões por cidade/bairro (média das coordenadas do grupo).
- Ordem de rota: **manual**, com sugestão por cidade → bairro → rota/subrota da planilha → endereço.
- O app pode gravar a posição do aparelho no contato (`contatos.latitude/longitude`) apenas como registro.
- Removidos do modelo: parâmetro `raio_gps_metros`, colunas `distancia_m` e `gps_confirmado`.

## Revisão
Se no futuro as coordenadas forem validadas, uma nova migração pode reintroduzir distância como
**informação** (nunca como regra bloqueante).
