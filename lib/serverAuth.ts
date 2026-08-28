import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * Lê e valida o cookie de sessão dentro de uma rota de API (Node runtime).
 * O proxy.ts já bloqueia a maioria dos casos antes de chegar aqui, mas
 * cada rota `/api/admin/*` chama isto de novo — defesa em profundidade, caso
 * o matcher do proxy tenha algum buraco.
 */
export async function getSession(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireAdmin(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "Acesso restrito a administradores" }, { status: 403 });
  return session;
}

/** Só exige estar logado (qualquer usuário) — sem exigir admin. */
export async function requireSession(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return session;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * Exige sessão + acesso ao evento dono da edição informada (admin sempre
 * passa). Usado pelas rotas de dados persistidos (financeiro/credenciamento
 * importados) — um usuário só pode ler/gravar dados da edição de um evento
 * que ele tem vínculo, mesmo estando logado.
 */
export async function requireEditionAccess(req: NextRequest, editionId: string): Promise<SessionPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (session.isAdmin) return session;

  const edition = await prisma.edition.findUnique({ where: { id: editionId }, select: { eventId: true } });
  if (!edition) return NextResponse.json({ error: "Edição não encontrada" }, { status: 404 });

  const allowed = session.allowedEventIds === "all" || session.allowedEventIds.includes(edition.eventId);
  if (!allowed) return NextResponse.json({ error: "Sem acesso a este evento" }, { status: 403 });
  return session;
}
