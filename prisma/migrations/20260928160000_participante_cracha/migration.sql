-- Código do crachá do participante — o identificador que o sistema de
-- credenciamento emite por pessoa.
--
-- É o que faz o cartão "Credenciados" contar gente em vez de linha, com a
-- mesma chave que o financeiro já usa em "Pessoas credenciadas": o relatório
-- sai fatiado a cada 4.000 linhas e a mesma pessoa reaparece em mais de um
-- arquivo, sempre com o mesmo crachá. O CPF não serve para isso — falta em
-- milhares de linhas (convidado de expositor, estrangeiro), e cada linha sem
-- ele virava uma pessoa a mais na contagem.
--
-- Linhas já gravadas ficam com '' e continuam identificadas pelo documento,
-- exatamente como antes; passam a contar por crachá quando o arquivo for
-- reimportado.
ALTER TABLE "imported_participantes"
  ADD COLUMN "cracha" TEXT NOT NULL DEFAULT '';
