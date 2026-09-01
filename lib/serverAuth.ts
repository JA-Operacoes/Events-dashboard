import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/session";

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
  if (session.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores" }, { status: 403 });
  return session;
}

/** Só exige estar logado (qualquer papel) — sem exigir admin/funcionário. */
export async function requireSession(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return session;
}

/**
 * Exige admin ou funcionário — usado nas rotas que MUDAM dado (importar
 * planilha, remover arquivo importado). "usuario" só lê; sem isso, alguém
 * com esse papel conseguiria escrever direto pela API mesmo com a UI
 * escondendo o botão.
 */
export async function requireStaff(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (session.role === "usuario") return NextResponse.json({ error: "Sem permissão pra alterar dados" }, { status: 403 });
  return session;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * Exige sessão + vínculo de acesso à edição específica (admin sempre passa).
 * Usado pelas rotas de dados persistidos (financeiro/credenciamento
 * importados) — um usuário só pode ler/gravar dados de uma edição com a qual
 * tem vínculo direto, mesmo estando logado e tendo acesso a outras edições
 * do mesmo evento.
 */
export async function requireEditionAccess(req: NextRequest, editionId: string): Promise<SessionPayload | NextResponse> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (session.role === "admin") return session;

  const allowed = session.allowedEditionIds === "all" || session.allowedEditionIds.includes(editionId);
  if (!allowed) return NextResponse.json({ error: "Sem acesso a esta edição" }, { status: 403 });
  return session;
}
