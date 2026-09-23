-- Potencia eletrica (kVA) e area do estande (m2): vem do relatorio de eletrica
-- e sao nulos nos demais servicos.
ALTER TABLE "imported_servicos" ADD COLUMN "kva" DOUBLE PRECISION;
ALTER TABLE "imported_servicos" ADD COLUMN "area" DOUBLE PRECISION;
