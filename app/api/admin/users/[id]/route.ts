import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { requireAdmin, isResponse } from "@/lib/serverAuth";

const VALID_ROLES = ["admin", "funcionario", "usuario"] as const;
type Role = (typeof VALID_ROLES)[number];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const body = await req.json();

  if (body.editionIds !== undefined) {
    const editionIds: string[] = Array.isArray(body.editionIds) ? body.editionIds : [];
    await prisma.$transaction([
      prisma.userEditionAccess.deleteMany({ where: { userId: id } }),
      prisma.userEditionAccess.createMany({ data: editionIds.map((editionId) => ({ userId: id, editionId })) }),
    ]);
  }

  const data: Record<string, unknown> = {};
  if (body.role !== undefined && VALID_ROLES.includes(body.role)) data.role = body.role as Role;
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!email.includes("@")) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
    data.email = email;
  }
  if (body.password) {
    if (String(body.password).length < 8) {
      return NextResponse.json({ error: "Senha precisa ter ao menos 8 caracteres" }, { status: 400 });
    }
    data.passwordHash = hashPassword(String(body.password));
  }

  if (Object.keys(data).length) {
    try {
      await prisma.user.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === "P2002") {
        return NextResponse.json({ error: "Já existe um usuário com esse e-mail" }, { status: 409 });
      }
      throw err;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      editionAccess: {
        select: { edition: { select: { id: true, label: true, ano: true, event: { select: { id: true, nome: true } } } } },
      },
    },
  });
  return NextResponse.json(user);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const { id } = await params;
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
