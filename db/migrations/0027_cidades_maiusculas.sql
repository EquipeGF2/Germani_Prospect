-- 0027 — Municípios em maiúsculas e o segmento "Atacado Perueiro" passa a ser "Atacado". docs/03 §5
--   O nome do município vinha da planilha como estava (maiúsculas, minúsculas, misturado). Agora fica em maiúsculas, com os
--   acentos (o upper() do SQLite só troca as letras sem acento: os acentuados são trocados antes, um a um). As próximas
--   importações da base já gravam assim (shared/importacao-base.mjs). cidade_busca (sem acento, usada na busca) não muda.
--   O cliente baixado fica congelado (0001): a trava sai só durante a correção e volta igual.
DROP TRIGGER trg_prospects_congelado;

UPDATE prospects SET cidade = upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(cidade, 'á', 'Á'), 'à', 'À'), 'â', 'Â'), 'ã', 'Ã'), 'ä', 'Ä'), 'é', 'É'), 'è', 'È'), 'ê', 'Ê'), 'ë', 'Ë'), 'í', 'Í'), 'ì', 'Ì'), 'î', 'Î'), 'ï', 'Ï'), 'ó', 'Ó'), 'ò', 'Ò'), 'ô', 'Ô'), 'õ', 'Õ'), 'ö', 'Ö'), 'ú', 'Ú'), 'ù', 'Ù'), 'û', 'Û'), 'ü', 'Ü'), 'ç', 'Ç'), 'ñ', 'Ñ'))
 WHERE cidade IS NOT NULL AND cidade <> upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(cidade, 'á', 'Á'), 'à', 'À'), 'â', 'Â'), 'ã', 'Ã'), 'ä', 'Ä'), 'é', 'É'), 'è', 'È'), 'ê', 'Ê'), 'ë', 'Ë'), 'í', 'Í'), 'ì', 'Ì'), 'î', 'Î'), 'ï', 'Ï'), 'ó', 'Ó'), 'ò', 'Ò'), 'ô', 'Ô'), 'õ', 'Õ'), 'ö', 'Ö'), 'ú', 'Ú'), 'ù', 'Ù'), 'û', 'Û'), 'ü', 'Ü'), 'ç', 'Ç'), 'ñ', 'Ñ'));

UPDATE prospects SET tipologia_gtm = CASE WHEN tipologia_gtm = upper(tipologia_gtm) THEN 'ATACADO' ELSE 'Atacado' END
 WHERE lower(trim(tipologia_gtm)) = 'atacado perueiro';

CREATE TRIGGER trg_prospects_congelado
BEFORE UPDATE ON prospects
WHEN OLD.status_atual = 'invalido'
BEGIN
  SELECT RAISE(ABORT, 'prospect baixado está congelado');
END;
