import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isResponse } from "@/lib/serverAuth";
import { getImageDimensions } from "@/lib/imageDimensions";

const REQUIRED_WIDTH = 650;
const REQUIRED_HEIGHT = 200;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — de sobra pra um PNG/WEBP 650x200

// Mapeia magic bytes -> mime real. Nunca confiamos no `file.type` do upload
// (é só o que o navegador reportou, um cabeçalho pode ser forjado).
function sniffMime(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Arquivo maior que 2MB" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) return NextResponse.json({ error: "Formato inválido — envie PNG, JPEG ou WEBP" }, { status: 400 });

  const dims = getImageDimensions(buf);
  if (!dims || dims.width !== REQUIRED_WIDTH || dims.height !== REQUIRED_HEIGHT) {
    return NextResponse.json(
      { error: `A imagem precisa ter exatamente ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT}px (recebido: ${dims ? `${dims.width}x${dims.height}` : "desconhecido"})` },
      { status: 400 }
    );
  }

  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const blob = await put(`event-logos/${id}-${Date.now()}.${ext}`, buf, {
    access: "public",
    contentType: mime,
  });

  const previousLogoUrl = event.logoUrl;
  await prisma.event.update({ where: { id }, data: { logoUrl: blob.url } });

  // apaga o arquivo antigo do blob store pra não acumular lixo — só se era
  // realmente um blob nosso (evento pode ter tido logoUrl setado via URL manual antes)
  if (previousLogoUrl && previousLogoUrl.includes(".public.blob.vercel-storage.com/")) {
    del(previousLogoUrl).catch(() => {});
  }

  return NextResponse.json({ logoUrl: blob.url });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  if (event.logoUrl && event.logoUrl.includes(".public.blob.vercel-storage.com/")) {
    del(event.logoUrl).catch(() => {});
  }
  await prisma.event.update({ where: { id }, data: { logoUrl: null } });
  return NextResponse.json({ ok: true });
}
