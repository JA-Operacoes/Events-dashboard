import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Roda no Edge antes de qualquer página/rota do grupo (dashboard) e de
 * /api/admin/*. Cada rota /api/admin/* também revalida por conta própria
 * (lib/serverAuth.ts) — defesa em profundidade, caso este matcher tenha
 * algum buraco no futuro.
 */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  const { pathname } = req.nextUrl;
  const isAdminApi = pathname.startsWith("/api/admin");
  const isAdminPage = pathname.startsWith("/admin");

  if (isAdminApi) {
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (!session.isAdmin) return NextResponse.json({ error: "Acesso restrito a administradores" }, { status: 403 });
    return NextResponse.next();
  }

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (isAdminPage && !session.isAdmin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/financeiro/:path*",
    "/credenciamento/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
