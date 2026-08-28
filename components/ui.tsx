"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

export const money = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const int = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR"));
export const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

function useCountUp(value: number | null, fmt: (v: number | null) => string) {
  const [text, setText] = useState(fmt(null));
  useEffect(() => {
    if (value == null) {
      setText(fmt(null));
      return;
    }
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setText(fmt(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setText(fmt(value));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, fmt]);
  return text;
}

export function TiltCard({
  label,
  value,
  fmt,
  editable,
  onEdit,
}: {
  label: string;
  value: number | null;
  fmt: (v: number | null) => string;
  editable?: boolean;
  onEdit?: (v: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const text = useCountUp(value, fmt);
  const { t } = useI18n();

  const raf = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);

  function apply() {
    raf.current = 0;
    const el = ref.current;
    const p = pending.current;
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    const px = (p.x - r.left) / r.width;
    const py = (p.y - r.top) / r.height;
    const strength = 6;
    el.style.setProperty("--ry", ((px - 0.5) * strength * 2).toFixed(2) + "deg");
    el.style.setProperty("--rx", (-(py - 0.5) * strength * 2).toFixed(2) + "deg");
    el.style.setProperty("--mx", px * 100 + "%");
    el.style.setProperty("--my", py * 100 + "%");
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    pending.current = { x: e.clientX, y: e.clientY };
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  }
  function onLeave() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <div className="tilt" ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="tilt-inner">
        <div className="kpi-top">
          <span className="kpi-label">{label}</span>
        </div>
        {editable ? (
          <input
            className="kpi-input"
            type="number"
            inputMode="decimal"
            placeholder={t("common.kpi.waitingFeed")}
            value={value ?? ""}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onEdit?.(e.target.value === "" ? null : Number(e.target.value))}
          />
        ) : (
          <div className={`kpi-value ${value == null ? "pending" : ""}`}>
            {value == null ? t("common.kpi.waitingFeed") : text}
          </div>
        )}
        <div className="kpi-foot">
          {editable ? "editado manualmente (admin)" : value == null ? t("common.kpi.noDataNow") : t("common.kpi.updatedNow")}
        </div>
      </div>
    </div>
  );
}

export function KpiRow<T extends Record<string, number | null>>({
  defs,
  values,
  editable,
  onEditValue,
}: {
  defs: readonly { key: keyof T & string; label: string; fmt: (v: number | null) => string }[];
  values: T | undefined | null;
  editable?: boolean;
  onEditValue?: (key: keyof T & string, v: number | null) => void;
}) {
  return (
    <div className="kpi-row">
      {defs.map((def) => (
        <TiltCard
          key={def.key}
          label={def.label}
          value={values ? values[def.key] : null}
          fmt={def.fmt}
          editable={editable}
          onEdit={(v) => onEditValue?.(def.key, v)}
        />
      ))}
    </div>
  );
}

export function Empty({ glyph, title, desc }: { glyph: string; title: string; desc: string }) {
  return (
    <div className="empty">
      <div className="g">{glyph}</div>
      <strong>{title}</strong>
      <span>{desc}</span>
    </div>
  );
}

export function EmptyTableRow({ colSpan, title, desc }: { colSpan: number; title: string; desc: string }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0, border: "none" }}>
        <div className="empty" style={{ border: "none", borderRadius: 0 }}>
          <div className="g">⌸</div>
          <strong>{title}</strong>
          <span>{desc}</span>
        </div>
      </td>
    </tr>
  );
}

export function ConnChip({ state }: { state: "pending" | "connected" | "error" }) {
  const { t } = useI18n();
  const label = state === "connected" ? t("common.connected") : state === "error" ? t("common.error") : t("common.pending");
  return (
    <span className="chip" data-state={state}>
      <span className="d" />
      <span>{label}</span>
    </span>
  );
}
