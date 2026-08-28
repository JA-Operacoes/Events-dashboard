-- CreateTable
CREATE TABLE "imported_invoices" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "vencimento" TEXT NOT NULL,
    "pagamento" TEXT,
    "forma" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_participantes" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "credenciadoEm" TEXT,
    "checkinEm" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_participantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imported_invoices_editionId_idx" ON "imported_invoices"("editionId");

-- CreateIndex
CREATE INDEX "imported_invoices_editionId_sourceFile_idx" ON "imported_invoices"("editionId", "sourceFile");

-- CreateIndex
CREATE INDEX "imported_participantes_editionId_idx" ON "imported_participantes"("editionId");

-- CreateIndex
CREATE INDEX "imported_participantes_editionId_sourceFile_idx" ON "imported_participantes"("editionId", "sourceFile");

-- AddForeignKey
ALTER TABLE "imported_invoices" ADD CONSTRAINT "imported_invoices_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_participantes" ADD CONSTRAINT "imported_participantes_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
