"use client";

import { useEffect } from "react";

/**
 * Camadas de fundo reativas ao cursor (grid + glow) — usa transform em vez de
 * animar background-position/mask-image (que forçaria repaint da tela
 * inteira a cada pointermove). Compartilhado entre o Shell do dashboard e as
 * telas de login/autenticação.
 */
export default function CursorField() {
  useEffect(() => {
    let raf = 0;
    let pending: { x: number; y: number } | null = null;
    function apply() {
      raf = 0;
      if (!pending) return;
      document.documentElement.style.setProperty("--mx", pending.x + "px");
      document.documentElement.style.setProperty("--my", pending.y + "px");
    }
    function onMove(e: PointerEvent) {
      pending = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div className="bg-grid" />
      <div className="cursor-spot" />
      <div id="glow" />
    </>
  );
}
