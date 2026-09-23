-- Bloco de dados que so a planilha de ingresso traz (comparecimento, convite,
-- cargo, segmento, estado, valor devido). JSON porque nao existe em contas a
-- receber e alimenta apenas os paineis do recorte de ingressos.
ALTER TABLE "imported_invoices" ADD COLUMN "ingresso" JSONB;
