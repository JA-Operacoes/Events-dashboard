import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!email) {
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  // checa o rate limit ANTES de tocar a senha — evita gastar o custo do
  // scrypt (propositalmente lento) em tentativas que já vão ser bloqueadas.
  const rateLimit = await checkLoginRateLimit(email);
  if (rateLimit.blocked) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 0) / 60);
    return NextResponse.json(
      { error: `Muitas tentativas de login. Tente novamente em ${minutes} min.` },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { editionAccess: { select: { editionId: true } } },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    await recordFailedLogin(email);
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  await clearLoginAttempts(email);

  const session = {
    email: user.email,
    role: user.role,
    allowedEditionIds: user.role === "admin" ? ("all" as const) : user.editionAccess.map((a) => a.editionId),
  };

  const token = await signSession(session);
  const res = NextResponse.json(session);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 dias — igual à expiração do JWT
  });
  return res;
}
