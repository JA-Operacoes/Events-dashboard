-- Item contratado dentro do servico ("Camera de Monitoramento") e a variacao
-- dele ("220V", "Bilingue"). Vazios nos servicos que nao detalham item.
ALTER TABLE "imported_servicos" ADD COLUMN "equipamento" TEXT NOT NULL DEFAULT '';
ALTER TABLE "imported_servicos" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT '';
