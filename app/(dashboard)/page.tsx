"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { IconFinanceiro, IconOperacional, IconCredenciamento, IconClock } from "@/components/icons";
import { Checkbox } from "@/components/ui";
import { notifySuccess, notifyError } from "@/lib/swal";
import { editionModules } from "@/lib/modules";
import { formatRelativeTime, parseDateLoose } from "@/lib/period";

/** Resumo por módulo devolvido por /api/overview — números, nunca as linhas. */
type ResumoModulo = { registros: number; atualizadoEm: string | null };
type ResumoEdicao = {
  modulos: Record<string, ResumoModulo>;
  datas: Record<string, Array<{ data: string; registros: number }>>;
};

const BANNER_ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const BANNER_MAX_MB = 5;
// medida única do banner — a mesma exigida no upload em /admin/eventos, para
// o preview local daqui não aceitar uma imagem que o servidor recusaria.
const BANNER_WIDTH = 1000;
const BANNER_HEIGHT = 150;

const ALL_MODULES = [
  { href: "/financeiro", Icon: IconFinanceiro, accent: "var(--accent)", key: "financeiro" },
  { href: "/operacional", Icon: IconOperacional, accent: "var(--amber)", key: "operacional" },
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
    if (dims.width !== BANNER_WIDTH || dims.height !== BANNER_HEIGHT) {
      notifyError(
        "Tamanho do banner incorreto",
        `O banner precisa ter exatamente ${BANNER_WIDTH}x${BANNER_HEIGHT}px (essa tem ${dims.width}x${dims.height}px).`
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
  const { edition } = useEvent();
  const [resumo, setResumo] = useState<ResumoEdicao | null>(null);

  useEffect(() => {
    setResumo(null);
    if (!edition?.id) return;
    let vivo = true;
    fetch(`/api/overview?editionId=${edition.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => vivo && setResumo(dados))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [edition?.id]);

  /**
   * Linha do tempo da edição: o período vem das datas que as planilhas
   * trazem — comparecimento no credenciamento, data do serviço no
   * operacional, data de pagamento no financeiro. Não há campo de "início e
   * fim" cadastrado no evento, e inventar um seria pior que ler o que
   * aconteceu de fato.
   */
  const linhaDoTempo = useMemo(() => {
    if (!resumo) return null;
    const pontos: Array<{ ts: number; rotulo: string; registros: number; origem: string }> = [];
    for (const [modulo, lista] of Object.entries(resumo.datas)) {
      for (const d of lista) {
        const ts = parseDateLoose(d.data);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        pontos.push({ ts, rotulo: d.data, registros: d.registros, origem: modulo });
      }
    }
    if (!pontos.length) return null;
    pontos.sort((a, b) => a.ts - b.ts);
    const inicio = pontos[0];
    const fim = pontos[pontos.length - 1];
    const span = Math.max(1, fim.ts - inicio.ts);
    const agora = Date.now();
    // percentual do período já percorrido — 100% quando a edição terminou
    const progresso = Math.min(100, Math.max(0, ((agora - inicio.ts) / span) * 100));

    // dias de evento são os do credenciamento: é quando o público passou pela
    // catraca, a única data que representa o evento acontecendo
    const diasEvento = (resumo.datas.credenciamento ?? [])
      .map((d) => ({ ...d, ts: parseDateLoose(d.data) }))
      .filter((d) => Number.isFinite(d.ts) && d.ts > 0)
      .sort((a, b) => a.ts - b.ts);

    return { inicio, fim, span, progresso, diasEvento, total: pontos.length };
  }, [resumo]);

  // a visão geral lista só o que a edição contratou — um card que leva a uma
  // tela bloqueada seria um beco sem saída.
  const enabled = editionModules(edition);
  const MODULE_KEYS = ALL_MODULES.filter((m) => enabled.includes(m.key));

  return (
    <>
      <EventHero />

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("overview.statusTitle")}</h3>
              <p>{t("overview.statusDesc")}</p>
            </div>
          </div>
          <div className="status-list">
            {!MODULE_KEYS.length && (
              <div className="status-row">
                <span className="status-left" style={{ color: "var(--ink-mute)" }}>
                  nenhum módulo habilitado nesta edição
                </span>
              </div>
            )}
            {MODULE_KEYS.map((m) => (
              <div className="status-row" key={m.key}>
                <span className="status-left">
                  <span className="module-ic-sm" style={{ background: `color-mix(in srgb, ${m.accent} 16%, transparent)`, color: m.accent }}>
                    <m.Icon size={13} />
                  </span>
                  {t(`module.${m.key}.title` as any)}
                </span>
                {/* antes ficava "aguardando API" para sempre; o que interessa é
                    quando o módulo recebeu dados pela última vez */}
                <span className="status-val modulo-atualizacao">
                  {resumo?.modulos?.[m.key]?.registros ? (
                    <>
                      <strong>{resumo.modulos[m.key].registros.toLocaleString("pt-BR")} registros</strong>
                      <em>
                        {resumo.modulos[m.key].atualizadoEm
                          ? `atualizado ${formatRelativeTime(resumo.modulos[m.key].atualizadoEm!)}`
                          : "sem data de atualização"}
                      </em>
                    </>
                  ) : (
                    <>
                      <span className="pulse-dot" />
                      {resumo ? "nenhuma planilha importada" : "carregando…"}
                    </>
                  )}
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
          {linhaDoTempo ? (
            <>
              <div className="timeline-track">
                <div className="timeline-bar">
                  <div className="timeline-fill" style={{ width: `${linhaDoTempo.progresso}%` }} />
                  {/* cada dia de credenciamento marcado na régua: é onde o
                      evento de fato aconteceu dentro do período */}
                  {linhaDoTempo.diasEvento.map((d) => (
                    <span
                      key={d.data}
                      className="timeline-marca"
                      style={{ left: `${((d.ts - linhaDoTempo.inicio.ts) / linhaDoTempo.span) * 100}%` }}
                      title={`${d.data} — ${d.registros.toLocaleString("pt-BR")} credenciamentos`}
                    />
                  ))}
                </div>
                <div className="timeline-labels">
                  <span>{linhaDoTempo.inicio.rotulo}</span>
                  <span>{linhaDoTempo.fim.rotulo}</span>
                </div>
              </div>

              {linhaDoTempo.diasEvento.length > 0 && (
                <ul className="timeline-dias">
                  {linhaDoTempo.diasEvento.map((d) => (
                    <li key={d.data}>
                      <span className="timeline-dia-data">{d.data}</span>
                      <span className="timeline-dia-valor">
                        {d.registros.toLocaleString("pt-BR")} credenciamentos
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="empty" style={{ marginTop: 14, padding: "22px 10px" }}>
              <div className="g">
                <IconClock size={22} />
              </div>
              <span>
                {resumo
                  ? "importe uma planilha com datas (comparecimento, serviço ou pagamento) para ver o período da edição"
                  : "carregando…"}
              </span>
            </div>
          )}
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
