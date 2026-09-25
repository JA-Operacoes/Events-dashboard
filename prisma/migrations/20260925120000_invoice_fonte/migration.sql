-- De qual das três planilhas do financeiro a linha veio: contas a receber com
-- rateio (expositor), contas a receber sem rateio (valores de ingresso) ou o
-- relatório de credenciamento (quantidade de ingressos).
--
-- É o que permite ter as duas fontes de ingresso carregadas ao mesmo tempo sem
-- cobrar a mesma venda duas vezes: as duas descrevem o mesmo ingresso, e sem
-- saber de onde a linha veio o painel somava os dois valores.
--
-- Linhas já gravadas ficam com '' e continuam contando no valor, como antes.
ALTER TABLE "imported_invoices"
  ADD COLUMN "fonte" TEXT NOT NULL DEFAULT '';
