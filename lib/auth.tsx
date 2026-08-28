"use client";

/**
 * Camada de autenticação/autorização. A sessão agora vive num JWT em cookie
 * httpOnly (`SESSION_COOKIE` em lib/session.ts), validado no servidor a cada
 * requisição — não é mais um valor confiável só no navegador:
 * - `proxy.ts` bloqueia o grupo (dashboard) e `/api/admin/*` pra quem
 *   não tiver cookie válido (e `/admin/*` também exige `isAdmin`).
 * - cada rota `/api/admin/*` revalida de novo (`lib/serverAuth.ts`) como
 *   defesa em profundidade.
 * - o `session` guardado aqui no client é só um espelho pra UI (evita re-
 *   buscar a cada render) — quem manda de verdade é o cookie.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { SessionPayload as Session } from "@/lib/session";

export type { Session };

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  requestPasswordReset: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, error: body?.error ?? "Falha ao entrar." } as const;
    }
    setSession(await res.json());
    return { ok: true } as const;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
  }

  async function requestPasswordReset(email: string) {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return { ok: false, error: "Falha ao enviar o e-mail." } as const;
    return { ok: true } as const;
  }

  const value: AuthContextValue = {
    session,
    loading,
    login,
    logout,
    requestPasswordReset,
    isAdmin: session?.isAdmin ?? false,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
