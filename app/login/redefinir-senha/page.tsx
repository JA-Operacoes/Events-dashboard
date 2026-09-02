"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import CursorField from "@/components/CursorField";
import TiltPanel from "@/components/TiltPanel";
import Logo from "@/components/Logo";
import { PASSWORD_HINT } from "@/lib/passwordPolicy";

function RedefinirSenhaForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (res.ok) setDone(true);
    else setError((await res.json()).error ?? "Falha ao redefinir a senha.");
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

        {!token ? (
          <>
            <h1 className="auth-title">Link inválido</h1>
            <p className="auth-sub">Este link de redefinição está incompleto. Peça um novo.</p>
            <Link href="/login/recuperar-senha" className="btn primary auth-submit" style={{ textAlign: "center", textDecoration: "none" }}>
              Pedir novo link
            </Link>
          </>
        ) : done ? (
          <>
            <h1 className="auth-title">Senha redefinida</h1>
            <p className="auth-sub">Sua senha foi alterada com sucesso.</p>
            <Link href="/login" className="btn primary auth-submit" style={{ textAlign: "center", textDecoration: "none" }}>
              Ir para o login
            </Link>
          </>
        ) : (
          <>
            <h1 className="auth-title">Nova senha</h1>
            <p className="auth-sub">Escolha uma nova senha para sua conta.</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <label className="auth-field">
                <span>Nova senha</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <small style={{ fontSize: 11, fontWeight: 400, color: "var(--ink-mute)" }}>{PASSWORD_HINT}</small>
              </label>
              <label className="auth-field">
                <span>Confirmar senha</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              {error && <div className="auth-error">{error}</div>}

              <button className="btn primary auth-submit" type="submit" disabled={loading}>
                {loading ? "Salvando…" : "Redefinir senha"}
              </button>
            </form>
          </>
        )}
      </TiltPanel>
    </div>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <Suspense fallback={<div className="auth-page" />}>
      <RedefinirSenhaForm />
    </Suspense>
  );
}
