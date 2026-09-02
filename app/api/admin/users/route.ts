import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordPolicy } from "@/lib/password";
import { requireAdmin, isResponse } from "@/lib/serverAuth";

const VALID_ROLES = ["admin", "funcionario", "usuario"] as const;
type Role = (typeof VALID_ROLES)[number];
function parseRole(v: unknown): Role {
  return VALID_ROLES.includes(v as Role) ? (v as Role) : "usuario";
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isResponse(auth)) return auth;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      editionAccess: {
        select: { edition: { select: { id: true, label: true, ano: true, event: { select: { id: true, nome: true } } } } },
      },
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
  const role = parseRole(body?.role);
  const editionIds: string[] = Array.isArray(body?.editionIds) ? body.editionIds : [];

  if (!email || !email.includes("@")) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  const passwordError = validatePasswordPolicy(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const passwordHash = hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        editionAccess: { create: editionIds.map((editionId) => ({ editionId })) },
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Já existe um usuário com esse e-mail" }, { status: 409 });
    }
    throw err;
  }
}
