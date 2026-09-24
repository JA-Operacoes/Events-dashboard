import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionAccess, isResponse } from "@/lib/serverAuth";

/**
 * Resumo da edição para a visão geral: quantas linhas cada módulo tem, quando
 * foi a última importação e em que datas há movimento.
 *
 * Devolve só números e datas distintas — nunca as linhas. A visão geral não
 * precisa das 11 mil duplicatas para dizer "atualizado há 2h".
 */
export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  const where = { editionId };

  const [
    invoices,
    participantes,
    servicos,
    diasCredenciamento,
    diasServico,
    diasPagamento,
  ] = await Promise.all([
    prisma.importedInvoice.aggregate({ where, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.importedParticipante.aggregate({ where, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.importedServico.aggregate({ where, _count: { _all: true }, _max: { createdAt: true } }),
    // agrupamentos devolvem só os valores distintos — são dezenas, não milhares
    prisma.importedParticipante.groupBy({ by: ["dataComparecimento"], where, _count: { _all: true } }),
    prisma.importedServico.groupBy({ by: ["dataInicio"], where, _count: { _all: true } }),
    prisma.importedInvoice.groupBy({ by: ["pagamento"], where, _count: { _all: true } }),
  ]);

  const limpar = (lista: Array<{ _count: { _all: number } } & Record<string, unknown>>, campo: string) =>
    lista
      .map((l) => ({ data: String(l[campo] ?? "").trim(), registros: l._count._all }))
      .filter((l) => l.data !== "");

  return NextResponse.json({
    modulos: {
      financeiro: { registros: invoices._count._all, atualizadoEm: invoices._max.createdAt },
      credenciamento: { registros: participantes._count._all, atualizadoEm: participantes._max.createdAt },
      operacional: { registros: servicos._count._all, atualizadoEm: servicos._max.createdAt },
    },
    // as datas vêm como texto cru da planilha (formatos variam entre eles);
    // quem interpreta é a tela, com o mesmo parser usado nos demais módulos
    datas: {
      credenciamento: limpar(diasCredenciamento, "dataComparecimento"),
      operacional: limpar(diasServico, "dataInicio"),
      financeiro: limpar(diasPagamento, "pagamento"),
    },
  });
}
