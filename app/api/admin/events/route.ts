import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isResponse } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  // acesso agora é por edição, não por evento — cada edição carrega sua
  // própria contagem de usuários vinculados em vez de um total único por evento.
  const events = await prisma.event.findMany({
    orderBy: [{ grupo: "asc" }, { nome: "asc" }],
    include: {
      editions: { orderBy: { ano: "desc" }, include: { _count: { select: { access: true } } } },
    },
  });
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const body = await req.json();
  const nome = String(body?.nome ?? "").trim();
  if (!nome) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  const grupo = body?.grupo ? String(body.grupo).trim() : null;

  const event = await prisma.event.create({ data: { nome, grupo: grupo || null } });
  return NextResponse.json(event, { status: 201 });
}
