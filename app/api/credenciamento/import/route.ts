import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionAccess, isResponse } from "@/lib/serverAuth";
import type { Participante } from "@/lib/dataSource";

export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  const rows = await prisma.importedParticipante.findMany({ where: { editionId } });
  const participantes: Participante[] = rows.map((r) => ({
    nome: r.nome,
    documento: r.documento,
    categoria: r.categoria,
    credenciadoEm: r.credenciadoEm,
    checkinEm: r.checkinEm,
    status: r.status as Participante["status"],
    sourceFile: r.sourceFile,
  }));
  return NextResponse.json(participantes);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const editionId = String(body?.editionId ?? "");
  const sourceFile = String(body?.sourceFile ?? "");
  const participantes: Participante[] = Array.isArray(body?.participantes) ? body.participantes : [];
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  await prisma.$transaction([
    prisma.importedParticipante.deleteMany({ where: { editionId, sourceFile } }),
    prisma.importedParticipante.createMany({
      data: participantes.map((p) => ({
        editionId,
        sourceFile,
        nome: p.nome,
        documento: p.documento,
        categoria: p.categoria,
        credenciadoEm: p.credenciadoEm,
        checkinEm: p.checkinEm,
        status: p.status,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, count: participantes.length });
}

export async function DELETE(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  const sourceFile = req.nextUrl.searchParams.get("sourceFile");
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  await prisma.importedParticipante.deleteMany({ where: { editionId, sourceFile } });
  return NextResponse.json({ ok: true });
}
