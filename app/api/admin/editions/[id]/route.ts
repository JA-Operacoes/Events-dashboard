import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isResponse } from "@/lib/serverAuth";
import { isModuleKey } from "@/lib/modules";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.ano !== undefined) data.ano = Number(body.ano);
  if (body.label !== undefined) data.label = String(body.label);
  if (body.bannerUrl !== undefined) data.bannerUrl = body.bannerUrl;
  if (body.showTitleOverBanner !== undefined) data.showTitleOverBanner = !!body.showTitleOverBanner;
  if (body.modulos !== undefined) {
    if (!Array.isArray(body.modulos)) {
      return NextResponse.json({ error: "modulos deve ser uma lista" }, { status: 400 });
    }
    // filtra contra o catálogo: chave desconhecida gravada aqui viraria um
    // módulo fantasma que nenhuma tela sabe renderizar.
    const invalidos = body.modulos.filter((m: unknown) => typeof m !== "string" || !isModuleKey(m));
    if (invalidos.length) {
      return NextResponse.json({ error: `Módulo desconhecido: ${invalidos.join(", ")}` }, { status: 400 });
    }
    data.modulos = Array.from(new Set(body.modulos as string[]));
  }

  const edition = await prisma.edition.update({ where: { id }, data });
  return NextResponse.json(edition);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id } = await params;
  await prisma.edition.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
