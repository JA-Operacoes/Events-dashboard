import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionModule, isResponse } from "@/lib/serverAuth";
import type { PedidoServico } from "@/lib/dataSource";

export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  const rows = await prisma.importedServico.findMany({ where: { editionId } });
  const pedidos: PedidoServico[] = rows.map((r) => ({
    servico: r.servico,
    expositor: r.expositor,
    nomeFantasia: r.nomeFantasia,
    cnpj: r.cnpj,
    estande: r.estande,
    localizacao: r.localizacao,
    quantidade: r.quantidade,
    dias: r.dias,
    dataInicio: r.dataInicio,
    dataFim: r.dataFim,
    horaInicio: r.horaInicio,
    horaFim: r.horaFim,
    turno: r.turno,
    status: r.status as PedidoServico["status"],
    sourceFile: r.sourceFile,
  }));
  // exposto via header (não no corpo) pra não quebrar o contrato
  // `PedidoServico[]` que o resto do app já espera dessa rota.
  const lastUpdatedAt = rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), new Date(0));
  const res = NextResponse.json(pedidos);
  if (rows.length) res.headers.set("X-Last-Updated", lastUpdatedAt.toISOString());
  return res;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const editionId = String(body?.editionId ?? "");
  const sourceFile = String(body?.sourceFile ?? "");
  const pedidos: PedidoServico[] = Array.isArray(body?.pedidos) ? body.pedidos : [];
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  // reimportar o mesmo arquivo substitui só as linhas dele — nunca duplica,
  // nunca mexe nas linhas de outro arquivo importado pra essa edição.
  await prisma.$transaction([
    prisma.importedServico.deleteMany({ where: { editionId, sourceFile } }),
    prisma.importedServico.createMany({
      data: pedidos.map((p) => ({
        editionId,
        sourceFile,
        servico: p.servico,
        expositor: p.expositor,
        nomeFantasia: p.nomeFantasia,
        cnpj: p.cnpj,
        estande: p.estande,
        localizacao: p.localizacao,
        quantidade: p.quantidade,
        dias: p.dias,
        dataInicio: p.dataInicio,
        dataFim: p.dataFim,
        horaInicio: p.horaInicio,
        horaFim: p.horaFim,
        turno: p.turno,
        status: p.status,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, count: pedidos.length });
}

export async function DELETE(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  const sourceFile = req.nextUrl.searchParams.get("sourceFile");
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  await prisma.importedServico.deleteMany({ where: { editionId, sourceFile } });
  return NextResponse.json({ ok: true });
}
