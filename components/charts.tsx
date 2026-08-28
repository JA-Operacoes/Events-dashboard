"use client";

import { useState } from "react";
import { money, int } from "@/components/ui";

const PALETTE = ["var(--accent)", "var(--amber)", "var(--teal)", "var(--violet)", "var(--red)"];

/* ------------------------------- Donut ---------------------------------- */

export function Donut({
  data,
  valueFmt = money,
}: {
  data: Array<{ label: string; value: number }>;
  valueFmt?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;

  const R = 44;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const len = frac * C;
    const arc = { ...d, i, dasharray: `${len} ${C - len}`, dashoffset: -offset, color: PALETTE[i % PALETTE.length] };
    offset += len;
    return arc;
  });

  return (
    <div className="donut-wrap">
      <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="Distribuição proporcional">
        <circle cx="56" cy="56" r={R} fill="none" stroke="var(--line)" strokeWidth="14" />
        {arcs.map((a) => (
          <circle
            key={a.label}
            cx="56"
            cy="56"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.i ? 16 : 14}
            strokeDasharray={a.dasharray}
            strokeDashoffset={a.dashoffset}
            transform="rotate(-90 56 56)"
            style={{ transition: "stroke-width .15s", cursor: "pointer" }}
            onPointerEnter={() => setHover(a.i)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <div className="donut-legend">
        {arcs.map((a) => (
          <div
            className="status-row"
            style={{ border: "none", padding: 0, opacity: hover === null || hover === a.i ? 1 : 0.45 }}
            key={a.label}
            onPointerEnter={() => setHover(a.i)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="status-left">
              <span className="legend-swatch" style={{ background: a.color, height: 8, width: 8, borderRadius: 2 }} />
              {a.label}
            </span>
            <span className="status-val">
              {valueFmt(a.value)} · {((a.value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Bar list --------------------------------- */

export function BarList({
  data,
  valueFmt = money,
}: {
  data: Array<{ name: string; value: number }>;
  valueFmt?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="barlist">
      {data.map((d) => (
        <div className="barlist-row" key={d.name}>
          <span className="barlist-name">{d.name}</span>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="barlist-val">{valueFmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- Status bars -------------------------------- */

const STATUS_COLOR: Record<string, string> = {
  pago: "var(--good)",
  pendente: "var(--amber)",
  atrasado: "var(--red)",
  credenciado: "var(--good)",
  cancelado: "var(--red)",
};

export function StatusBars({
  data,
  labels,
  classMap,
  colorMap,
}: {
  data: Array<{ label: string; value: number }>;
  labels: Record<string, string>;
  /** mapeia o `label` para a classe CSS do badge — necessário quando o rótulo não tem classe própria (ex.: "credenciado" reaproveita a cor de "pago"). */
  classMap?: Record<string, string>;
  /** sobrepõe a cor padrão da barrinha proporcional — útil quando o mesmo `label` tem semântica diferente entre módulos (ex.: "cancelado" é negativo no credenciamento, mas neutro no financeiro). */
  colorMap?: Record<string, string>;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div>
      {data.map((d) => (
        <div className="status-row" key={d.label}>
          <span className="status-left">
            <span className={`badge ${classMap?.[d.label] ?? d.label}`}>
              <span className="dot" />
              {labels[d.label] ?? d.label}
            </span>
          </span>
          <span className="status-val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="barlist-track" style={{ width: 70 }}>
              <span
                className="barlist-fill"
                style={{
                  width: `${(d.value / total) * 100}%`,
                  background: colorMap?.[d.label] ?? STATUS_COLOR[d.label] ?? "var(--accent)",
                }}
              />
            </span>
            {d.value.toLocaleString("pt-BR")}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Line chart ------------------------------ */

export function LineChart({
  data,
  series,
  valueFmt = money,
}: {
  data: Array<{ date: string; [key: string]: string | number }>;
  series: Array<{ key: string; color: string }>;
  valueFmt?: (v: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 560;
  const h = 180;
  const pad = { top: 10, right: 10, bottom: 22, left: 10 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const max = Math.max(...data.flatMap((d) => series.map((s) => Number(d[s.key]))), 1);
  const x = (i: number) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const path = (key: string) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(Number(d[key])).toFixed(1)}`).join(" ");

  const hovered = hoverIdx != null ? data[hoverIdx] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Série no tempo"
        onPointerLeave={() => setHoverIdx(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = data.length > 1 ? Math.round(((px - pad.left) / innerW) * (data.length - 1)) : 0;
          setHoverIdx(Math.min(Math.max(idx, 0), data.length - 1));
        }}
      >
        <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="var(--baseline)" />
        {series.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" />
        ))}
        {hoverIdx != null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={pad.top} y2={h - pad.bottom} stroke="var(--line)" strokeWidth="1" />
        )}
        {data.map((d, i) => (
          <g key={String(d.date ?? i)}>
            {series.map((s) => (
              <circle key={s.key} cx={x(i)} cy={y(Number(d[s.key]))} r={hoverIdx === i ? 4 : 2.5} fill={s.color} />
            ))}
          </g>
        ))}
        {data.length > 0 && (
          <>
            <text x={x(0)} y={h - 6} fontSize="10" fill="var(--ink-mute)" textAnchor="start">
              {String(data[0].date)}
            </text>
            <text x={x(data.length - 1)} y={h - 6} fontSize="10" fill="var(--ink-mute)" textAnchor="end">
              {String(data[data.length - 1].date)}
            </text>
          </>
        )}
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: `${(x(hoverIdx!) / w) * 100}%` }}>
          <strong>{String(hovered.date)}</strong>
          {series.map((s) => (
            <div key={s.key}>
              <span className="legend-swatch" style={{ background: s.color }} /> {valueFmt(Number(hovered[s.key]))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { int };
