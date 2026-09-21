-- Modulos contratados por edicao: uma edicao pode ter financeiro e
-- credenciamento e a seguinte so operacional. Edicoes ja existentes recebem
-- todos os modulos (era o comportamento ate aqui), e o admin desliga o que
-- nao foi contratado em /admin/eventos.
ALTER TABLE "editions" ADD COLUMN "modulos" TEXT[] DEFAULT ARRAY['financeiro', 'operacional', 'credenciamento']::TEXT[];

UPDATE "editions" SET "modulos" = ARRAY['financeiro', 'operacional', 'credenciamento']::TEXT[] WHERE "modulos" IS NULL;

ALTER TABLE "editions" ALTER COLUMN "modulos" SET NOT NULL;
