import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isResponse } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  const auth = await requireSession(req);
  if (isResponse(auth)) return auth;

  // Multi-tenant: um usuário só pode ver — e só sabe que existem — os
  // eventos aos quais tem acesso. Sem esse filtro aqui, qualquer usuário
  // logado conseguiria listar nome/edições/logo de todos os outros clientes
  // chamando esta rota direto, mesmo que a UI escondesse isso no seletor.
  const where = auth.allowedEventIds === "all" ? {} : { id: { in: auth.allowedEventIds } };

  const events = await prisma.event.findMany({
    where,
    orderBy: { nome: "asc" },
    include: { editions: { orderBy: { ano: "desc" } } },
  });

  const shaped = events.map((ev) => ({
    id: ev.id,
    name: ev.nome,
    logoUrl: ev.logoUrl,
    hideBranding: ev.hideBranding,
    editions: ev.editions.map((ed) => ({
      id: ed.id,
      year: ed.ano,
      label: ed.label,
      bannerUrl: ed.bannerUrl,
      showTitleOverBanner: ed.showTitleOverBanner,
    })),
  }));

  return NextResponse.json(shaped);
}
