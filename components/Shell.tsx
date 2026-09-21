"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import {
  IconSun,
  IconMoon,
  IconOverview,
  IconFinanceiro,
  IconOperacional,
  IconCredenciamento,
  IconCalendar,
  IconUsers,
} from "@/components/icons";
import CursorField from "@/components/CursorField";
import Logo from "@/components/Logo";
import { MODULES, editionModules, moduleForPath, type ModuleKey } from "@/lib/modules";
import type { Key } from "@/lib/i18n";

const MODULE_ICON: Record<ModuleKey, typeof IconFinanceiro> = {
  financeiro: IconFinanceiro,
  operacional: IconOperacional,
  credenciamento: IconCredenciamento,
};

/**
 * A edição selecionada não contratou o módulo desta URL. Esconder da sidebar
 * não basta — link salvo, histórico do navegador e troca de edição com a
 * página já aberta chegam aqui.
 */
function ModuleOff({ label }: { label: string }) {
  return (
    <div className="empty" style={{ marginTop: 24 }}>
      <div className="g">⃠</div>
      <strong>{label} não está habilitado nesta edição</strong>
      <span>
        Escolha outra edição no menu lateral ou peça a um administrador para habilitar o módulo em Administração →
        Eventos.
      </span>
      <Link className="btn" href="/" style={{ marginTop: 12 }}>
        Voltar para a visão geral
      </Link>
    </div>
  );
}

function EventSwitcher() {
  const { events, loading, event, edition, setEventId, setEditionId } = useEvent();
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  if (loading) return <div className="pulse-card">{t("shell.loadingEvents")}</div>;
  if (!event) return <div className="pulse-card">{t("shell.noEvents")}</div>;

  // usuário comum com só 1 evento não tem o que escolher — mostra fixo, sem
  // dropdown; admin sempre vê o seletor porque pode ter/ganhar acesso a mais.
  const canSwitch = isAdmin || events.length > 1;

  return (
    <div className="event-switcher">
      {canSwitch ? (
        <button className="event-trigger" type="button" onClick={() => setOpen((v) => !v)}>
          <span className="event-name">{event.name}</span>
          <span className="event-caret">▾</span>
        </button>
      ) : (
        <div className="event-trigger event-trigger-static">
          <span className="event-name">{event.name}</span>
        </div>
      )}
      {canSwitch && open && (
        <div className="event-menu">
          {(() => {
            // eventos já vêm ordenados por grupo/nome da API — só precisa
            // renderizar um cabeçalho toda vez que o grupo muda na sequência.
            let lastGrupo: string | null | undefined;
            return events.map((ev) => {
              const showHeader = (ev.grupo ?? null) !== lastGrupo;
              lastGrupo = ev.grupo ?? null;
              return (
                <div key={ev.id}>
                  {showHeader && ev.grupo && <div className="event-menu-group">{ev.grupo}</div>}
                  <div
                    className={`event-menu-item ${ev.id === event.id ? "on" : ""}`}
                    onClick={() => {
                      setEventId(ev.id);
                      setOpen(false);
                    }}
                  >
                    {ev.name}
                  </div>
                </div>
              );
            });
          })()}
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
  const { event, edition } = useEvent();
  const hideBranding = !!event?.hideBranding;

  // abaixo do breakpoint mobile a sidebar vira um drawer — fechado por padrão,
  // e sempre fecha sozinho ao trocar de página (senão ficaria aberto por cima
  // do conteúdo novo depois de navegar).
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

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

  // só os módulos contratados nesta edição entram na navegação
  const enabled = editionModules(edition);
  const NAV = [
    { href: "/", Icon: IconOverview, label: t("shell.nav.overview") },
    ...MODULES.filter((m) => enabled.includes(m.key)).map((m) => ({
      href: m.href,
      Icon: MODULE_ICON[m.key],
      label: t(m.navKey as Key),
    })),
  ];

  // enquanto a lista de eventos carrega, `edition` é null e editionModules()
  // devolve tudo — o bloqueio só vale quando já se sabe o que a edição tem.
  const currentModule = moduleForPath(pathname);
  const blockedModule = currentModule && edition && !enabled.includes(currentModule) ? currentModule : null;

  const ADMIN_NAV = [
    { href: "/admin/eventos", Icon: IconCalendar, label: "Eventos" },
    { href: "/admin/usuarios", Icon: IconUsers, label: "Usuários" },
  ];

  return (
    <>
      <CursorField />
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={navOpen ? "Fechar menu" : "Abrir menu"}
        aria-expanded={navOpen}
        onClick={() => setNavOpen((v) => !v)}
      >
        {navOpen ? "✕" : "☰"}
      </button>
      {navOpen && <div className="rail-backdrop" onClick={() => setNavOpen(false)} />}
      <div className="shell">
        <aside className={`rail ${navOpen ? "rail-open" : ""}`}>
          {!hideBranding && (
            <div className="rail-brand">
              {event?.logoUrl ? (
                <Logo width={176} src={event.logoUrl} />
              ) : (
                <>
                  <Logo size={30} />
                  <div>
                    <strong>{t("shell.brand.title")}</strong>
                    <span>{t("shell.brand.subtitle")}</span>
                  </div>
                </>
              )}
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

        <main className="main">
          {blockedModule ? (
            <ModuleOff label={t(MODULES.find((m) => m.key === blockedModule)!.navKey as Key)} />
          ) : (
            children
          )}
        </main>
      </div>
    </>
  );
}
