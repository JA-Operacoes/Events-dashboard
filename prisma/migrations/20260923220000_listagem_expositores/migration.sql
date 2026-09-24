-- Listagem geral de expositores da edição: a base que diz quantos existem,
-- para comparar com quantos contrataram algum serviço.
CREATE TABLE "imported_expositores" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "expositor" TEXT NOT NULL,
    "nomeFantasia" TEXT NOT NULL DEFAULT '',
    "cnpj" TEXT NOT NULL DEFAULT '',
    "estande" TEXT NOT NULL DEFAULT '',
    "localizacao" TEXT NOT NULL DEFAULT '',
    "tipoEstande" TEXT NOT NULL DEFAULT '',
    "area" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_expositores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "imported_expositores_editionId_idx" ON "imported_expositores"("editionId");
CREATE INDEX "imported_expositores_editionId_sourceFile_idx" ON "imported_expositores"("editionId", "sourceFile");

ALTER TABLE "imported_expositores" ADD CONSTRAINT "imported_expositores_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
