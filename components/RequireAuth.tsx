"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Guard client-side — redireciona para /login quando não há sessão. Não
 * substitui proteção real de servidor (ver nota em lib/auth.tsx): alguém
 * com JS desabilitado ou chamando a API direto ainda passa. Enquanto não
 * existir cookie httpOnly + middleware, isto só controla a navegação normal
 * pela UI.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) return null;

  return <>{children}</>;
}
