import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });

  // Sempre responde "ok" mesmo se o e-mail não existir — evita que alguém
  // descubra quais e-mails estão cadastrados testando esta rota.
  if (user) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const resetUrl = `${req.nextUrl.origin}/login/redefinir-senha?token=${token}`;
    // Envio real ainda não configurado (ver lib/email.ts) — por enquanto só loga no servidor.
    await sendPasswordResetEmail(email, resetUrl);
  }

  return NextResponse.json({ ok: true });
}
