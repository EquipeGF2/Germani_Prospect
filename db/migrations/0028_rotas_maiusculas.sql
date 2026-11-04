-- 0028 — Rota e subrota em maiúsculas (como os municípios, 0027). docs/03 §5
--   Vinham da planilha como estavam. Agora ficam em maiúsculas, com acento; as próximas importações da base já gravam assim
--   (shared/importacao-base.mjs). O cliente baixado fica congelado (0001): a trava sai só durante a correção e volta igual.
DROP TRIGGER trg_prospects_congelado;

UPDATE prospects SET rota = upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(rota, 'á', 'Á'), 'à', 'À'), 'â', 'Â'), 'ã', 'Ã'), 'ä', 'Ä'), 'é', 'É'), 'è', 'È'), 'ê', 'Ê'), 'ë', 'Ë'), 'í', 'Í'), 'ì', 'Ì'), 'î', 'Î'), 'ï', 'Ï'), 'ó', 'Ó'), 'ò', 'Ò'), 'ô', 'Ô'), 'õ', 'Õ'), 'ö', 'Ö'), 'ú', 'Ú'), 'ù', 'Ù'), 'û', 'Û'), 'ü', 'Ü'), 'ç', 'Ç'), 'ñ', 'Ñ'))
 WHERE rota IS NOT NULL AND rota <> upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(rota, 'á', 'Á'), 'à', 'À'), 'â', 'Â'), 'ã', 'Ã'), 'ä', 'Ä'), 'é', 'É'), 'è', 'È'), 'ê', 'Ê'), 'ë', 'Ë'), 'í', 'Í'), 'ì', 'Ì'), 'î', 'Î'), 'ï', 'Ï'), 'ó', 'Ó'), 'ò', 'Ò'), 'ô', 'Ô'), 'õ', 'Õ'), 'ö', 'Ö'), 'ú', 'Ú'), 'ù', 'Ù'), 'û', 'Û'), 'ü', 'Ü'), 'ç', 'Ç'), 'ñ', 'Ñ'));

UPDATE prospects SET subrota = upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(subrota, 'á', 'Á'), 'à', 'À'), 'â', 'Â'), 'ã', 'Ã'), 'ä', 'Ä'), 'é', 'É'), 'è', 'È'), 'ê', 'Ê'), 'ë', 'Ë'), 'í', 'Í'), 'ì', 'Ì'), 'î', 'Î'), 'ï', 'Ï'), 'ó', 'Ó'), 'ò', 'Ò'), 'ô', 'Ô'), 'õ', 'Õ'), 'ö', 'Ö'), 'ú', 'Ú'), 'ù', 'Ù'), 'û', 'Û'), 'ü', 'Ü'), 'ç', 'Ç'), 'ñ', 'Ñ'))
 WHERE subrota IS NOT NULL AND subrota <> upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(subrota, 'á', 'Á'), 'à', 'À'), 'â', 'Â'), 'ã', 'Ã'), 'ä', 'Ä'), 'é', 'É'), 'è', 'È'), 'ê', 'Ê'), 'ë', 'Ë'), 'í', 'Í'), 'ì', 'Ì'), 'î', 'Î'), 'ï', 'Ï'), 'ó', 'Ó'), 'ò', 'Ò'), 'ô', 'Ô'), 'õ', 'Õ'), 'ö', 'Ö'), 'ú', 'Ú'), 'ù', 'Ù'), 'û', 'Û'), 'ü', 'Ü'), 'ç', 'Ç'), 'ñ', 'Ñ'));

CREATE TRIGGER trg_prospects_congelado
BEFORE UPDATE ON prospects
WHEN OLD.status_atual = 'invalido'
BEGIN
  SELECT RAISE(ABORT, 'prospect baixado está congelado');
END;
