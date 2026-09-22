-- Valor da linha, quando a planilha de contratacao traz preco (ex.: locacao de
-- equipamento com "Valor Unitario"). Nulo nas planilhas que nao tem valor.
ALTER TABLE "imported_servicos" ADD COLUMN "valor" DOUBLE PRECISION;
