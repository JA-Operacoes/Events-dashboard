import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditionModule, isResponse } from "@/lib/serverAuth";
import type { Invoice, DadosIngresso } from "@/lib/dataSource";
import { classificarOrigem } from "@/lib/spreadsheetImport";

export async function GET(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  if (!editionId) return NextResponse.json({ error: "editionId é obrigatório" }, { status: 400 });

  const auth = await requireEditionModule(req, editionId, "financeiro");
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
    quantidade: r.quantidade,
    // Só o valor devido: o resto do bloco (cargo, segmento, comparecimento...)
    // é leitura de público, que hoje vem do módulo de credenciamento. Mandar
    // tudo inflava a resposta em alguns MB por edição.
    ingresso: (r.ingresso as DadosIngresso | null)?.valorDevido != null
      ? { valorDevido: (r.ingresso as DadosIngresso).valorDevido }
      : null,
    origem: r.origem,
    origemTipo: classificarOrigem(r.origem),
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
  // "replace" (padrão) limpa as linhas anteriores do arquivo; "append" é o
  // que os lotes seguintes usam para acrescentar sem apagar o que acabou de
  // entrar. Ver lib/importClient.ts.
  const modo = body?.modo === "append" ? "append" : "replace";
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "financeiro");
  if (isResponse(auth)) return auth;

  // Só o primeiro lote apaga o que existia deste arquivo — reimportar
  // substitui, sem duplicar e sem tocar nas linhas de outros arquivos.
  if (modo === "replace") {
    await prisma.importedInvoice.deleteMany({ where: { editionId, sourceFile } });
  }

  const registros = invoices.map((inv) => ({
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
    quantidade: inv.quantidade ?? null,
    ingresso: inv.ingresso ?? undefined,
    origem: inv.origem ?? "",
    centroCusto: inv.centroCusto ?? null,
    conta1: inv.conta1 ?? null,
    conta2: inv.conta2 ?? null,
    conta3: inv.conta3 ?? null,
  }));

  // Inserção fatiada: cada createMany é uma ida ao banco, então o tamanho é
  // um meio-termo medido — 500 levava 16s para 10 mil linhas (21 chamadas),
  // 3000 leva 5s (4 chamadas).
  const TAMANHO = 3000;
  for (let i = 0; i < registros.length; i += TAMANHO) {
    await prisma.importedInvoice.createMany({ data: registros.slice(i, i + TAMANHO) });
  }

  return NextResponse.json({ ok: true, count: registros.length });
}

export async function DELETE(req: NextRequest) {
  const editionId = req.nextUrl.searchParams.get("editionId");
  const sourceFile = req.nextUrl.searchParams.get("sourceFile");
  if (!editionId || !sourceFile) {
    return NextResponse.json({ error: "editionId e sourceFile são obrigatórios" }, { status: 400 });
  }

  const auth = await requireEditionModule(req, editionId, "financeiro");
  if (isResponse(auth)) return auth;

  await prisma.importedInvoice.deleteMany({ where: { editionId, sourceFile } });
  return NextResponse.json({ ok: true });
}
