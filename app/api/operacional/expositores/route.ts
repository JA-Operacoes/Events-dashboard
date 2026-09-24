import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionModule, isResponse } from "@/lib/serverAuth";
import type { ExpositorBase } from "@/lib/dataSource";

/**
 * Listagem geral de expositores da edição. Fica separada das planilhas de
 * serviço porque responde outra pergunta: quantos expositores existem (o
 * denominador), não o que cada um contratou.
 */
export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  const rows = await prisma.importedExpositor.findMany({ where: { editionId } });
  const expositores: ExpositorBase[] = rows.map((r) => ({
    expositor: r.expositor,
    nomeFantasia: r.nomeFantasia,
    cnpj: r.cnpj,
    estande: r.estande,
    localizacao: r.localizacao,
    tipoEstande: r.tipoEstande,
    area: r.area,
    sourceFile: r.sourceFile,
  }));
  return NextResponse.json(expositores);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const editionId = String(body?.editionId ?? "");
  const sourceFile = String(body?.sourceFile ?? "");
  const expositores: ExpositorBase[] = Array.isArray(body?.expositores) ? body.expositores : [];
  const modo = body?.modo === "append" ? "append" : "replace";
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  // A listagem é uma só por edição: subir uma nova troca a anterior inteira,
  // inclusive quando o arquivo tem outro nome — duas listagens conviverem
  // dobraria o denominador sem ninguém perceber.
  if (modo === "replace") {
    await prisma.importedExpositor.deleteMany({ where: { editionId } });
  }

  const registros = expositores.map((e) => ({
    editionId,
    sourceFile,
    expositor: e.expositor,
    nomeFantasia: e.nomeFantasia ?? "",
    cnpj: e.cnpj ?? "",
    estande: e.estande ?? "",
    localizacao: e.localizacao ?? "",
    tipoEstande: e.tipoEstande ?? "",
    area: e.area ?? null,
  }));

  const TAMANHO = 3000;
  for (let i = 0; i < registros.length; i += TAMANHO) {
    await prisma.importedExpositor.createMany({ data: registros.slice(i, i + TAMANHO) });
  }

  return NextResponse.json({ ok: true, count: registros.length });
}

export async function DELETE(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  await prisma.importedExpositor.deleteMany({ where: { editionId } });
  return NextResponse.json({ ok: true });
}
