import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isResponse } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  const auth = await requireSession(req);
  if (isResponse(auth)) return auth;

  // Multi-tenant: um usuário só pode ver — e só sabe que existem — as
  // EDIÇÕES às quais tem vínculo direto, não o evento inteiro. Um evento com
  // 5 edições onde a pessoa só tem acesso a 1 aparece com só essa 1 edição
  // (as outras nem existem do ponto de vista dela); eventos sem nenhuma
  // edição visível não aparecem.
  const isAllowedEdition = (editionId: string) => auth.allowedEditionIds === "all" || auth.allowedEditionIds.includes(editionId);

  const events = await prisma.event.findMany({
    orderBy: [{ grupo: "asc" }, { nome: "asc" }],
    include: { editions: { orderBy: { ano: "desc" } } },
  });

  const shaped = events
    .map((ev) => ({
      id: ev.id,
      name: ev.nome,
      grupo: ev.grupo,
      logoUrl: ev.logoUrl,
      hideBranding: ev.hideBranding,
      accentColor: ev.accentColor,
      editions: ev.editions
        .filter((ed) => isAllowedEdition(ed.id))
        .map((ed) => ({
          id: ed.id,
          year: ed.ano,
          label: ed.label,
          bannerUrl: ed.bannerUrl,
          showTitleOverBanner: ed.showTitleOverBanner,
        })),
    }))
    .filter((ev) => ev.editions.length > 0);

  return NextResponse.json(shaped);
}
