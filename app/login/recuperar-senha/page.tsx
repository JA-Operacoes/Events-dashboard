"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import CursorField from "@/components/CursorField";
import TiltPanel from "@/components/TiltPanel";
import Logo from "@/components/Logo";

export default function RecuperarSenhaPage() {
  const { requestPasswordReset } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await requestPasswordReset(email);
    setLoading(false);
    if (result.ok) setSent(true);
    else setError(result.error);
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

        {sent ? (
          <>
            <h1 className="auth-title">Verifique seu e-mail</h1>
            <p className="auth-sub">
              Se <strong>{email}</strong> estiver cadastrado, enviamos um link para redefinir a senha.
            </p>
            <Link href="/login" className="btn primary auth-submit" style={{ textAlign: "center", textDecoration: "none" }}>
              Voltar para o login
            </Link>
          </>
        ) : (
          <>
            <h1 className="auth-title">Esqueci minha senha</h1>
            <p className="auth-sub">Digite o e-mail cadastrado — vamos enviar um link para você criar uma nova senha.</p>

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

              {error && <div className="auth-error">{error}</div>}

              <button className="btn primary auth-submit" type="submit" disabled={loading}>
                {loading ? "Enviando…" : "Enviar link de recuperação"}
              </button>
            </form>

            <div className="auth-links">
              <Link href="/login">Voltar para o login</Link>
            </div>
          </>
        )}

        <div className="auth-note">
          O envio de e-mail ainda não está configurado — esta tela só demonstra o fluxo (ver{" "}
          <code>lib/auth.tsx</code>).
        </div>
      </TiltPanel>
    </div>
  );
}
