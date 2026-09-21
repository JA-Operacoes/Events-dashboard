-- Nem toda planilha de servico traz as mesmas colunas: algumas tem data/hora
-- de inicio e fim, outras so turno. Colunas novas entram com default vazio
-- para que as linhas ja importadas continuem validas.
ALTER TABLE "imported_servicos" ADD COLUMN "dataInicio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "imported_servicos" ADD COLUMN "dataFim" TEXT NOT NULL DEFAULT '';
ALTER TABLE "imported_servicos" ADD COLUMN "horaInicio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "imported_servicos" ADD COLUMN "horaFim" TEXT NOT NULL DEFAULT '';
ALTER TABLE "imported_servicos" ADD COLUMN "turno" TEXT NOT NULL DEFAULT '';
