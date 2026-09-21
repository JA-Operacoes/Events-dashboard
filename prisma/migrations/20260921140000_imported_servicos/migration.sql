-- O módulo Operacional passou a ser "pedido de serviço por expositor" (planilha
-- de contratação: recepcionista, limpeza...) em vez de contrato de fornecedor,
-- antes de qualquer import existir. A guarda abaixo aborta a migration se a
-- tabela antiga tiver ganhado linhas nesse meio-tempo, em vez de descartá-las.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "imported_contratos") THEN
    RAISE EXCEPTION 'imported_contratos nao esta vazia — migre os dados antes de dropar a tabela';
  END IF;
END $$;

-- DropTable
DROP TABLE "imported_contratos";

-- CreateTable
CREATE TABLE "imported_servicos" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "servico" TEXT NOT NULL,
    "expositor" TEXT NOT NULL,
    "nomeFantasia" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "estande" TEXT NOT NULL,
    "localizacao" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "dias" INTEGER,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_servicos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imported_servicos_editionId_idx" ON "imported_servicos"("editionId");

-- CreateIndex
CREATE INDEX "imported_servicos_editionId_sourceFile_idx" ON "imported_servicos"("editionId", "sourceFile");

-- AddForeignKey
ALTER TABLE "imported_servicos" ADD CONSTRAINT "imported_servicos_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
