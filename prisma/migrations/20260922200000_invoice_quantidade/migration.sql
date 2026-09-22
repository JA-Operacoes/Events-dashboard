-- Quantidade de ingressos por duplicata (planilhas de venda de ingresso).
-- Nulo nas planilhas que nao trazem a coluna; nesse caso a duplicata vale 1
-- na contagem de ingressos.
ALTER TABLE "imported_invoices" ADD COLUMN "quantidade" INTEGER;
