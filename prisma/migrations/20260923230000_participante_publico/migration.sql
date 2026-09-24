-- Presença e perfil do público passam a viver no credenciamento: são as
-- colunas que o relatório de credenciamento traz e que antes só o financeiro
-- (recorte de ingressos) lia.
ALTER TABLE "imported_participantes"
  ADD COLUMN "compareceu" BOOLEAN,
  ADD COLUMN "dataComparecimento" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "horaComparecimento" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "convite" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "cargo" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "segmento" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "estado" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "pais" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "valor" DOUBLE PRECISION,
  ADD COLUMN "valorDevido" DOUBLE PRECISION,
  ADD COLUMN "statusPagamento" TEXT NOT NULL DEFAULT '';
