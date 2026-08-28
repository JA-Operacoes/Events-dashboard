import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { requireAdmin, isResponse } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      createdAt: true,
      eventAccess: { select: { event: { select: { id: true, nome: true } } } },
    },
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const isAdmin = !!body?.isAdmin;
  const eventIds: string[] = Array.isArray(body?.eventIds) ? body.eventIds : [];

  if (!email || !email.includes("@")) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Senha precisa ter ao menos 8 caracteres" }, { status: 400 });

  const passwordHash = hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        isAdmin,
        eventAccess: { create: eventIds.map((eventId) => ({ eventId })) },
      },
      select: { id: true, email: true, isAdmin: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Já existe um usuário com esse e-mail" }, { status: 409 });
    }
    throw err;
  }
}
