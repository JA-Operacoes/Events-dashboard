-- CreateTable
CREATE TABLE "imported_contratos" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "inicio" TEXT NOT NULL,
    "fim" TEXT,
    "valor" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "centroCusto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_contratos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imported_contratos_editionId_idx" ON "imported_contratos"("editionId");

-- CreateIndex
CREATE INDEX "imported_contratos_editionId_sourceFile_idx" ON "imported_contratos"("editionId", "sourceFile");

-- AddForeignKey
ALTER TABLE "imported_contratos" ADD CONSTRAINT "imported_contratos_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
