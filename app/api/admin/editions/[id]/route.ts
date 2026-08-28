import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isResponse } from "@/lib/serverAuth";

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
