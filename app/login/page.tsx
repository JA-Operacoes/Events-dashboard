"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import CursorField from "@/components/CursorField";
import TiltPanel from "@/components/TiltPanel";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const { session, login } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.ok) {
      router.push("/");
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="auth-page">
      <CursorField />
      <TiltPanel className="auth-tilt" innerClassName="auth-card">
        <div className="auth-brand">
          <Logo size={28} />
          <div>
            <strong>{t("shell.brand.title")}</strong>
          </div>
        </div>

        <h1 className="auth-title">Entrar</h1>
        <p className="auth-sub">Acesse com o e-mail cadastrado pelo administrador do evento.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
            />
          </label>

          <label className="auth-field">
            <span>Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="btn primary auth-submit" type="submit" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div className="auth-links">
          <Link href="/login/recuperar-senha">Esqueci minha senha</Link>
        </div>

        <div className="auth-note">
          Ainda não possui nenhuma conta cadastrada? Entre em contato e solicite o acesso
        </div>
      </TiltPanel>
    </div>
  );
}
