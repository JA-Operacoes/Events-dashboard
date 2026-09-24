import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionModule, isResponse } from "@/lib/serverAuth";
import type { Participante } from "@/lib/dataSource";

export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionModule(req, editionId, "credenciamento");
  if (isResponse(auth)) return auth;

  const rows = await prisma.importedParticipante.findMany({ where: { editionId } });
  const participantes: Participante[] = rows.map((r) => ({
    nome: r.nome,
    documento: r.documento,
    categoria: r.categoria,
    credenciadoEm: r.credenciadoEm,
    checkinEm: r.checkinEm,
    status: r.status as Participante["status"],
    valor: r.valor,
    statusPagamento: (r.statusPagamento || null) as Participante["statusPagamento"],
    // só monta o bloco de público quando a planilha trouxe alguma dessas
    // colunas — sem isso a tela acharia que tem dado de presença zerado
    ingresso:
      r.compareceu != null || r.dataComparecimento || r.cargo || r.segmento || r.estado || r.pais || r.convite
        ? {
            compareceu: r.compareceu,
            valorDevido: r.valorDevido,
            convite: r.convite,
            categoria: r.categoria,
            cargo: r.cargo,
            segmento: r.segmento,
            estado: r.estado,
            pais: r.pais,
            dataComparecimento: r.dataComparecimento,
            horaComparecimento: r.horaComparecimento,
          }
        : null,
    sourceFile: r.sourceFile,
  }));
  const lastUpdatedAt = rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), new Date(0));
  const res = NextResponse.json(participantes);
  if (rows.length) res.headers.set("X-Last-Updated", lastUpdatedAt.toISOString());
  return res;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const editionId = String(body?.editionId ?? "");
  const sourceFile = String(body?.sourceFile ?? "");
  const participantes: Participante[] = Array.isArray(body?.participantes) ? body.participantes : [];
  // "replace" (padrão) limpa as linhas anteriores do arquivo; "append" é o
  // que os lotes seguintes usam para acrescentar sem apagar o que acabou de
  // entrar. Ver lib/importClient.ts.
  const modo = body?.modo === "append" ? "append" : "replace";
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "credenciamento");
  if (isResponse(auth)) return auth;

  // Só o primeiro lote apaga o que existia deste arquivo — reimportar
  // substitui, sem duplicar e sem tocar nas linhas de outros arquivos.
  if (modo === "replace") {
    await prisma.importedParticipante.deleteMany({ where: { editionId, sourceFile } });
  }

  const registros = participantes.map((p) => ({
    editionId,
    sourceFile,
    nome: p.nome,
    documento: p.documento,
    categoria: p.categoria,
    credenciadoEm: p.credenciadoEm,
    checkinEm: p.checkinEm,
    status: p.status,
    compareceu: p.ingresso?.compareceu ?? null,
    dataComparecimento: p.ingresso?.dataComparecimento ?? "",
    horaComparecimento: p.ingresso?.horaComparecimento ?? "",
    convite: p.ingresso?.convite ?? "",
    cargo: p.ingresso?.cargo ?? "",
    segmento: p.ingresso?.segmento ?? "",
    estado: p.ingresso?.estado ?? "",
    pais: p.ingresso?.pais ?? "",
    valor: p.valor ?? null,
    valorDevido: p.ingresso?.valorDevido ?? null,
    statusPagamento: p.statusPagamento ?? "",
  }));

  // Inserção fatiada: cada createMany é uma ida ao banco, então o tamanho é
  // um meio-termo medido — 500 levava 16s para 10 mil linhas (21 chamadas),
  // 3000 leva 5s (4 chamadas).
  const TAMANHO = 3000;
  for (let i = 0; i < registros.length; i += TAMANHO) {
    await prisma.importedParticipante.createMany({ data: registros.slice(i, i + TAMANHO) });
  }

  return NextResponse.json({ ok: true, count: registros.length });
}

export async function DELETE(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  const sourceFile = req.nextUrl.searchParams.get("sourceFile");
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "credenciamento");
  if (isResponse(auth)) return auth;

  await prisma.importedParticipante.deleteMany({ where: { editionId, sourceFile } });
  return NextResponse.json({ ok: true });
}
