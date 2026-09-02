import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordPolicy } from "@/lib/password";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");

  const passwordError = validatePasswordPolicy(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link inválido ou expirado. Peça um novo." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  return NextResponse.json({ ok: true });
}
