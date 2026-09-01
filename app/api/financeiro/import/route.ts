import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionAccess, isResponse } from "@/lib/serverAuth";
import type { Invoice } from "@/lib/dataSource";

export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  const rows = await prisma.importedInvoice.findMany({ where: { editionId } });
  const invoices: Invoice[] = rows.map((r) => ({
    numero: r.numero,
    cliente: r.cliente,
    cnpj: r.cnpj,
    vencimento: r.vencimento,
    pagamento: r.pagamento,
    forma: r.forma,
    valor: r.valor,
    status: r.status as Invoice["status"],
    centroCusto: r.centroCusto,
    conta1: r.conta1,
    conta2: r.conta2,
    conta3: r.conta3,
    sourceFile: r.sourceFile,
  }));
  // exposto via header (não no corpo) pra não quebrar o contrato `Invoice[]`
  // que o resto do app já espera dessa rota.
  const lastUpdatedAt = rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), new Date(0));
  const res = NextResponse.json(invoices);
  if (rows.length) res.headers.set("X-Last-Updated", lastUpdatedAt.toISOString());
  return res;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const editionId = String(body?.editionId ?? "");
  const sourceFile = String(body?.sourceFile ?? "");
  const invoices: Invoice[] = Array.isArray(body?.invoices) ? body.invoices : [];
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  // reimportar o mesmo arquivo substitui só as linhas dele — nunca duplica,
  // nunca mexe nas linhas de outro arquivo importado pra essa edição.
  await prisma.$transaction([
    prisma.importedInvoice.deleteMany({ where: { editionId, sourceFile } }),
    prisma.importedInvoice.createMany({
      data: invoices.map((inv) => ({
        editionId,
        sourceFile,
        numero: inv.numero,
        cliente: inv.cliente,
        cnpj: inv.cnpj,
        vencimento: inv.vencimento,
        pagamento: inv.pagamento,
        forma: inv.forma,
        valor: inv.valor,
        status: inv.status,
        centroCusto: inv.centroCusto ?? null,
        conta1: inv.conta1 ?? null,
        conta2: inv.conta2 ?? null,
        conta3: inv.conta3 ?? null,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, count: invoices.length });
}

export async function DELETE(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  const sourceFile = req.nextUrl.searchParams.get("sourceFile");
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionAccess(req, editionId);
  if (isResponse(auth)) return auth;

  await prisma.importedInvoice.deleteMany({ where: { editionId, sourceFile } });
  return NextResponse.json({ ok: true });
}
