-- 0003 — Feriados automáticos.  docs/03 §10
-- Os feriados NACIONAIS passam a ser calculados pelo sistema para qualquer ano (shared/feriados.mjs:
-- datas fixas + Sexta-feira Santa pela Páscoa) — ninguém precisa cadastrar ano a ano.
-- Estaduais e municipais ganham "repete todo ano" (mesmo dia e mês em todos os anos).
ALTER TABLE feriados ADD COLUMN recorrente INTEGER NOT NULL DEFAULT 0 CHECK (recorrente IN (0,1));

-- os nacionais semeados pela 0002 agora vêm do cálculo; o 20/09 (RS) vira um único registro que repete todo ano
DELETE FROM feriados WHERE criado_por = 'migração 0002' AND abrangencia = 'nacional';
DELETE FROM feriados WHERE criado_por = 'migração 0002' AND abrangencia = 'estadual' AND data <> '2026-09-20';
UPDATE feriados SET recorrente = 1, criado_por = 'migração 0003' WHERE criado_por = 'migração 0002' AND data = '2026-09-20';
