-- Coluna "Origem" das planilhas de contas a receber ("EXPOSITOR",
-- "FINANCEIRO", "INGRESSO"...), usada para separar receita de expositor e de
-- ingresso na tela. Linhas ja importadas ficam com origem vazia e aparecem
-- apenas na visao geral.
ALTER TABLE "imported_invoices" ADD COLUMN "origem" TEXT NOT NULL DEFAULT '';
