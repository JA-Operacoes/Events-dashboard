"use client";

import Link from "next/link";
import { useRef } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { IconFinanceiro, IconCredenciamento, IconClock } from "@/components/icons";
import { Checkbox } from "@/components/ui";
import { notifySuccess, notifyError } from "@/lib/swal";

const BANNER_ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const BANNER_MAX_MB = 5;
// o banner estica full-width com object-fit:cover — sem um mínimo de
// resolução, imagem pequena fica borrada/pixelizada esticada na tela toda.
const BANNER_MIN_WIDTH = 1200;
const BANNER_MIN_HEIGHT = 300;

const MODULE_KEYS = [
  { href: "/financeiro", Icon: IconFinanceiro, accent: "var(--accent)", key: "financeiro" },
  { href: "/credenciamento", Icon: IconCredenciamento, accent: "var(--teal)", key: "credenciamento" },
] as const;

function EventHero() {
  const { event, edition, setEditionBannerPreview, setEditionShowTitleOverBanner } = useEvent();
  const { canManageData } = useAuth();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const hasBanner = !!edition?.bannerUrl;
  const showTitle = !hasBanner || edition?.showTitleOverBanner !== false;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !edition) return;

    if (!BANNER_ACCEPT.includes(file.type)) {
      notifyError("Formato de imagem inválido", "Envie um arquivo PNG, JPEG ou WEBP.");
      return;
    }
    const maxBytes = BANNER_MAX_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      notifyError(
        "Arquivo muito grande",
        `O banner precisa ter até ${BANNER_MAX_MB}MB (esse arquivo tem ${(file.size / (1024 * 1024)).toFixed(1)}MB).`
      );
      return;
    }

    const url = URL.createObjectURL(file);
    const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
    if (!dims) {
      notifyError("Não foi possível ler a imagem", "O arquivo pode estar corrompido — tente outro.");
      URL.revokeObjectURL(url);
      return;
    }
    if (dims.width < BANNER_MIN_WIDTH || dims.height < BANNER_MIN_HEIGHT) {
      notifyError(
        "Imagem com resolução muito baixa",
        `O banner precisa ter pelo menos ${BANNER_MIN_WIDTH}x${BANNER_MIN_HEIGHT}px (essa tem ${dims.width}x${dims.height}px) — abaixo disso ela fica borrada esticada na tela toda.`
      );
      URL.revokeObjectURL(url);
      return;
    }

    setEditionBannerPreview(edition.id, url);
    notifySuccess("Banner atualizado");
  }

  return (
    <div className={`hero ${hasBanner ? "hero-with-banner" : ""}`}>
      {hasBanner && <img src={edition!.bannerUrl!} alt="" className="hero-banner-img" />}
      {hasBanner && <div className="hero-banner-scrim" />}

      {showTitle && (
        <div className="hero-text">
          <div className="hero-kicker">{t("overview.kicker")}</div>
          <h1 className="hero-title">{event ? event.name : "…"}</h1>
          <p className="hero-sub">
            {edition ? `${t("overview.subtitle")} · ${edition.label}` : t("overview.subtitle")}
          </p>
        </div>
      )}

      {!hasBanner && (
        <div className="hero-glyphs" aria-hidden="true">
          <IconFinanceiro size={30} />
          <IconCredenciamento size={30} />
        </div>
      )}

      {canManageData && edition && (
        <div className="hero-admin">
          <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
            {hasBanner ? "Trocar banner" : "Adicionar banner"}
          </button>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
          {hasBanner && (
            <Checkbox
              className="hero-admin-toggle"
              checked={showTitle}
              onChange={(checked) => setEditionShowTitleOverBanner(edition.id, checked)}
              label="manter título sobre o banner"
            />
          )}
          <span className="banner-hint">preview local — ainda não é salvo (upload real pendente)</span>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { t } = useI18n();

  return (
    <>
      <EventHero />

      <div className="panels" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("overview.statusTitle")}</h3>
              <p>{t("overview.statusDesc")}</p>
            </div>
          </div>
          <div className="status-list">
            {MODULE_KEYS.map((m) => (
              <div className="status-row" key={m.key}>
                <span className="status-left">
                  <span className="module-ic-sm" style={{ background: `color-mix(in srgb, ${m.accent} 16%, transparent)`, color: m.accent }}>
                    <m.Icon size={13} />
                  </span>
                  {t(`module.${m.key}.title` as any)}
                </span>
                <span className="status-val" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="pulse-dot" />
                  {t("common.pending")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("overview.timelineTitle")}</h3>
              <p>{t("overview.timelineDesc")}</p>
            </div>
          </div>
          <div className="timeline-track">
            <div className="timeline-bar">
              <div className="timeline-fill" style={{ width: "0%" }} />
            </div>
            <div className="timeline-labels">
              <span>—</span>
              <span>—</span>
            </div>
          </div>
          <div className="empty" style={{ marginTop: 14, padding: "22px 10px" }}>
            <div className="g">
              <IconClock size={22} />
            </div>
            <span>{t("overview.timeline.empty")}</span>
          </div>
        </div>
      </div>

      <p className="section-label">{t("overview.modulesTitle")}</p>
      <div className="module-grid">
        {MODULE_KEYS.map((m) => (
          <Link key={m.href} href={m.href} className="module-card">
            <span className="module-accent" style={{ background: m.accent }} />
            <span className="module-ic" style={{ background: `color-mix(in srgb, ${m.accent} 16%, transparent)`, color: m.accent }}>
              <m.Icon size={19} />
            </span>
            <div>
              <h3>{t(`module.${m.key}.title` as any)}</h3>
              <p>{t(`module.${m.key}.desc` as any)}</p>
            </div>
            <span className="module-arrow">→</span>
          </Link>
        ))}
      </div>

      <div className="footnote">{t("overview.footnote")}</div>
    </>
  );
}
