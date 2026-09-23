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
    tipoEstande: r.tipoEstande,
    quantidade: r.quantidade,
    dias: r.dias,
    dataInicio: r.dataInicio,
    dataFim: r.dataFim,
    horaInicio: r.horaInicio,
    horaFim: r.horaFim,
    turno: r.turno,
    valor: r.valor,
    kva: r.kva,
    area: r.area,
    equipamento: r.equipamento,
    tipo: r.tipo,
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
  // "replace" (padrão) limpa as linhas anteriores do arquivo; "append" é o
  // que os lotes seguintes usam para acrescentar sem apagar o que acabou de
  // entrar. Ver lib/importClient.ts.
  const modo = body?.modo === "append" ? "append" : "replace";
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "operacional");
  if (isResponse(auth)) return auth;

  // Só o primeiro lote apaga o que existia deste arquivo — reimportar
  // substitui, sem duplicar e sem tocar nas linhas de outros arquivos.
  if (modo === "replace") {
    await prisma.importedServico.deleteMany({ where: { editionId, sourceFile } });
  }

  const registros = pedidos.map((p) => ({
    editionId,
    sourceFile,
    servico: p.servico,
    expositor: p.expositor,
    nomeFantasia: p.nomeFantasia,
    cnpj: p.cnpj,
    estande: p.estande,
    localizacao: p.localizacao,
    tipoEstande: p.tipoEstande,
    quantidade: p.quantidade,
    dias: p.dias,
    dataInicio: p.dataInicio,
    dataFim: p.dataFim,
    horaInicio: p.horaInicio,
    horaFim: p.horaFim,
    turno: p.turno,
    valor: p.valor ?? null,
    kva: p.kva ?? null,
    area: p.area ?? null,
    equipamento: p.equipamento ?? "",
    tipo: p.tipo ?? "",
    status: p.status,
  }));

  // Inserção fatiada: cada createMany é uma ida ao banco, então o tamanho é
  // um meio-termo medido — 500 levava 16s para 10 mil linhas (21 chamadas),
  // 3000 leva 5s (4 chamadas).
  const TAMANHO = 3000;
  for (let i = 0; i < registros.length; i += TAMANHO) {
    await prisma.importedServico.createMany({ data: registros.slice(i, i + TAMANHO) });
  }

  return NextResponse.json({ ok: true, count: registros.length });
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
