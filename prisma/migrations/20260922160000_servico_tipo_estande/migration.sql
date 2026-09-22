-- Tipo/montagem do estande ("PROMOTOR BASICO", "static display"...), vindo da
-- coluna "Montagem"/"Tipo de Estande" das planilhas de contratacao. Linhas ja
-- importadas ficam com o campo vazio ate serem reimportadas.
ALTER TABLE "imported_servicos" ADD COLUMN "tipoEstande" TEXT NOT NULL DEFAULT '';
