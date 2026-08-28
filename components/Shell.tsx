"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { IconSun, IconMoon, IconOverview, IconFinanceiro, IconCredenciamento, IconCalendar, IconUsers } from "@/components/icons";
import CursorField from "@/components/CursorField";
import Logo from "@/components/Logo";

function EventSwitcher() {
  const { events, loading, event, edition, setEventId, setEditionId } = useEvent();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (loading) return <div className="pulse-card">{t("shell.loadingEvents")}</div>;
  if (!event) return <div className="pulse-card">{t("shell.noEvents")}</div>;

  return (
    <div className="event-switcher">
      <button className="event-trigger" type="button" onClick={() => setOpen((v) => !v)}>
        <span className="event-name">{event.name}</span>
        <span className="event-caret">▾</span>
      </button>
      {open && (
        <div className="event-menu">
          {events.map((ev) => (
            <div
              key={ev.id}
              className={`event-menu-item ${ev.id === event.id ? "on" : ""}`}
              onClick={() => {
                setEventId(ev.id);
                setOpen(false);
              }}
            >
              {ev.name}
            </div>
          ))}
        </div>
      )}
      <div className="edition-pills">
        {event.editions.map((ed) => (
          <button
            key={ed.id}
            className={`edition-pill ${ed.id === edition?.id ? "on" : ""}`}
            onClick={() => setEditionId(ed.id)}
            type="button"
          >
            {ed.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function PrefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pref-row">
      <span className="pref-label">{label}</span>
      {children}
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme } = useTheme();

  const { session, isAdmin, logout } = useAuth();
  const { event } = useEvent();
  const hideBranding = !!event?.hideBranding;

  useEffect(() => {
    const root = document.documentElement;
    const color = event?.accentColor;
    if (color) {
      const soft = hexToRgba(color, theme === "dark" ? 0.14 : 0.22);
      root.style.setProperty("--accent", color);
      if (soft) root.style.setProperty("--accent-soft", soft);
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-soft");
    }
  }, [event?.accentColor, theme]);

  const NAV = [
    { href: "/", Icon: IconOverview, label: t("shell.nav.overview") },
    { href: "/financeiro", Icon: IconFinanceiro, label: t("shell.nav.financeiro") },
    { href: "/credenciamento", Icon: IconCredenciamento, label: t("shell.nav.credenciamento") },
  ];

  const ADMIN_NAV = [
    { href: "/admin/eventos", Icon: IconCalendar, label: "Eventos" },
    { href: "/admin/usuarios", Icon: IconUsers, label: "Usuários" },
  ];

  return (
    <>
      <CursorField />
      <div className="shell">
        <aside className="rail">
          {!hideBranding && (
            <div className="rail-brand">
              <Logo size={30} src={event?.logoUrl} />
              <div>
                <strong>{event?.logoUrl ? event.name : t("shell.brand.title")}</strong>
                {!event?.logoUrl && <span>{t("shell.brand.subtitle")}</span>}
              </div>
            </div>
          )}

          <EventSwitcher />

          <nav>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rail-link ${pathname === item.href ? "active" : ""}`}
              >
                <span className="ic">
                  <item.Icon size={15} />
                </span>{" "}
                {item.label}
              </Link>
            ))}
          </nav>

          {isAdmin && (
            <nav>
              <p className="section-label" style={{ margin: "0 0 4px 10px", fontSize: 10.5 }}>
                Administração
              </p>
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rail-link ${pathname === item.href ? "active" : ""}`}
                >
                  <span className="ic">
                    <item.Icon size={15} />
                  </span>{" "}
                  {item.label}
                </Link>
              ))}
            </nav>
          )}

          <div className="rail-foot">
            <PrefRow label={t("shell.theme")}>
              <button
                className="toggle-btn toggle-btn-icon"
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Alternar tema"
              >
                {theme === "dark" ? <IconMoon size={14} /> : <IconSun size={14} />}
              </button>
            </PrefRow>
            <PrefRow label={t("shell.language")}>
              <button
                className="toggle-btn"
                type="button"
                onClick={() => setLocale(locale === "pt" ? "en" : "pt")}
                aria-label="Alternar idioma"
              >
                {locale === "pt" ? "PT" : "EN"}
              </button>
            </PrefRow>
            {isAdmin && <div className="admin-badge">modo admin</div>}

            <div className="session-row">
              {session ? (
                <>
                  <span className="session-email" title={session.email}>
                    {session.email}
                  </span>
                  <button className="btn" type="button" onClick={logout}>
                    Sair
                  </button>
                </>
              ) : (
                <Link href="/login" className="btn" style={{ textAlign: "center" }}>
                  Entrar
                </Link>
              )}
            </div>
          </div>
        </aside>

        <main className="main">{children}</main>
      </div>
    </>
  );
}
