"use client";

import { useRef } from "react";

/**
 * Mesmo efeito de tilt 3D + brilho seguindo o cursor dos cards de KPI
 * (components/ui.tsx TiltCard), mas genérico — envolve qualquer conteúdo em
 * vez de só o layout de KPI. Usa as classes `.tilt`/`.tilt-inner` já
 * existentes no CSS.
 */
export default function TiltPanel({
  children,
  className = "",
  innerClassName = "",
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
    const strength = 4;
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
    <div className={`tilt ${className}`} ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className={`tilt-inner ${innerClassName}`}>{children}</div>
    </div>
  );
}
