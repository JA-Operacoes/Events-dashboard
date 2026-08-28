import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isResponse } from "@/lib/serverAuth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id: eventId } = await params;
  const body = await req.json();
  const ano = Number(body?.ano);
  const label = String(body?.label ?? ano).trim();
  if (!Number.isInteger(ano)) return NextResponse.json({ error: "Ano inválido" }, { status: 400 });

  try {
    const edition = await prisma.edition.create({ data: { eventId, ano, label } });
    return NextResponse.json(edition, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Já existe uma edição com esse ano para este evento" }, { status: 409 });
    }
    throw err;
  }
}
