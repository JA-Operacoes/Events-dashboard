import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, signSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  const user = await prisma.user.findUnique({
    where: { email },
    include: { editionAccess: { select: { editionId: true } } },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

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
