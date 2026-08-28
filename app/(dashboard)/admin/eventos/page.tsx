"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEvent } from "@/lib/eventContext";

type Edition = { id: string; ano: number; label: string };
type EventRow = {
  id: string;
  nome: string;
  editions: Edition[];
  logoUrl: string | null;
  hideBranding: boolean;
  _count: { access: number };
};

export default function AdminEventosPage() {
  const { isAdmin } = useAuth();
  const { refreshEvents } = useEvent();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [editionForms, setEditionForms] = useState<Record<string, { ano: string; label: string }>>({});
  const [brandForms, setBrandForms] = useState<Record<string, { logoUrl: string; hideBranding: boolean }>>({});
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/events");
    const data: EventRow[] = await res.json();
    setEvents(data);
    setBrandForms((prev) => {
      const next = { ...prev };
      for (const ev of data) {
        if (!next[ev.id]) next[ev.id] = { logoUrl: ev.logoUrl ?? "", hideBranding: ev.hideBranding };
      }
      return next;
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: novoNome }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Falha ao criar evento");
      return;
    }
    setNovoNome("");
    load();
  }

  async function handleDeleteEvent(id: string) {
    if (!confirm("Remover este evento e todas as edições/vínculos dele?")) return;
    await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
    load();
  }

  async function handleCreateEdition(eventId: string) {
    setError(null);
    const form = editionForms[eventId] ?? { ano: "", label: "" };
    const res = await fetch(`/api/admin/events/${eventId}/editions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ano: Number(form.ano), label: form.label || form.ano }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Falha ao criar edição");
      return;
    }
    setEditionForms((prev) => ({ ...prev, [eventId]: { ano: "", label: "" } }));
    load();
  }

  async function handleDeleteEdition(id: string) {
    if (!confirm("Remover esta edição?")) return;
    await fetch(`/api/admin/editions/${id}`, { method: "DELETE" });
    load();
  }

  async function handleSaveBrand(eventId: string) {
    setSavingBrand(eventId);
    const form = brandForms[eventId];
    await fetch(`/api/admin/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: form.logoUrl.trim() || null, hideBranding: form.hideBranding }),
    });
    setSavingBrand(null);
    load();
    refreshEvents();
  }

  // O toggle de ocultar marca aplica na hora (não precisa clicar em "Salvar
  // marca") — é um switch, não um campo de texto, então a expectativa é
  // efeito imediato. Atualiza o estado local otimisticamente e já dispara o
  // PATCH; `load()` no fim resincroniza com o que ficou salvo de verdade.
  async function handleToggleHideBranding(eventId: string, hideBranding: boolean) {
    setBrandForms((prev) => ({ ...prev, [eventId]: { ...prev[eventId], hideBranding } }));
    await fetch(`/api/admin/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hideBranding }),
    });
    load();
    refreshEvents(); // atualiza a sidebar na hora, sem precisar recarregar a página
  }

  if (!isAdmin) {
    return (
      <div className="empty" style={{ marginTop: 40 }}>
        <div className="g">⌸</div>
        <strong>Acesso restrito</strong>
        <span>Esta área é só para administradores.</span>
      </div>
    );
  }

  return (
    <>
      <div className="topline">
        <div>
          <h1>Eventos e edições</h1>
          <div className="sub">cadastro que alimenta o seletor do dashboard</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div>
            <h3>Novo evento</h3>
            <p>cria só o evento — as edições você adiciona depois, na lista abaixo</p>
          </div>
        </div>
        <form onSubmit={handleCreateEvent} style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            placeholder="Nome do evento (ex.: SetExpo)"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            required
            style={{ flex: 1 }}
            className="input"
          />
          <button className="btn primary" type="submit">
            Adicionar
          </button>
        </form>
        {error && <div className="auth-error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {loading ? (
        <div className="empty">
          <div className="g">◷</div>
          <span>carregando…</span>
        </div>
      ) : !events.length ? (
        <div className="empty">
          <div className="g">▣</div>
          <strong>nenhum evento cadastrado ainda</strong>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((ev) => {
            const brand = brandForms[ev.id] ?? { logoUrl: "", hideBranding: false };
            return (
              <div className="panel" key={ev.id}>
                <div className="panel-head">
                  <div>
                    <h3>{ev.nome}</h3>
                    <p>
                      {ev.editions.length} edição(ões) · {ev._count.access} usuário(s) com acesso
                    </p>
                  </div>
                  <button className="btn" type="button" onClick={() => handleDeleteEvent(ev.id)}>
                    Remover evento
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  {ev.editions.map((ed) => (
                    <div className="status-row" key={ed.id}>
                      <span className="status-left">
                        <strong style={{ fontWeight: 600 }}>{ed.label}</strong>
                        <span style={{ color: "var(--ink-mute)" }}>({ed.ano})</span>
                      </span>
                      <button className="btn" type="button" onClick={() => handleDeleteEdition(ed.id)}>
                        ×
                      </button>
                    </div>
                  ))}
                  {!ev.editions.length && <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>sem edições ainda</span>}
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  <input
                    type="number"
                    placeholder="Ano"
                    value={editionForms[ev.id]?.ano ?? ""}
                    onChange={(e) => setEditionForms((prev) => ({ ...prev, [ev.id]: { ano: e.target.value, label: prev[ev.id]?.label ?? "" } }))}
                    style={{ width: 90 }}
                    className="input"
                  />
                  <input
                    type="text"
                    placeholder="Rótulo (opcional, ex.: 2026)"
                    value={editionForms[ev.id]?.label ?? ""}
                    onChange={(e) => setEditionForms((prev) => ({ ...prev, [ev.id]: { ano: prev[ev.id]?.ano ?? "", label: e.target.value } }))}
                    style={{ flex: 1 }}
                    className="input"
                  />
                  <button className="btn" type="button" onClick={() => handleCreateEdition(ev.id)}>
                    Adicionar edição
                  </button>
                </div>

                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <p className="section-label" style={{ margin: "0 0 8px" }}>
                    Marca (white-label)
                  </p>
                  <p style={{ fontSize: 11.5, color: "var(--ink-mute)", margin: "0 0 10px" }}>
                    Alguns eventos não querem nenhuma referência ao Portal JA visível — use a opção abaixo pra
                    esconder, ou coloque a logo do próprio evento no lugar.
                  </p>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <input
                      type="text"
                      placeholder="URL da logo do evento (opcional)"
                      value={brand.logoUrl}
                      disabled={brand.hideBranding}
                      onChange={(e) =>
                        setBrandForms((prev) => ({ ...prev, [ev.id]: { ...prev[ev.id], logoUrl: e.target.value } }))
                      }
                      className="input"
                      style={{ flex: 1 }}
                    />
                    <button className="btn" type="button" disabled={savingBrand === ev.id} onClick={() => handleSaveBrand(ev.id)}>
                      {savingBrand === ev.id ? "Salvando…" : "Salvar marca"}
                    </button>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-dim)" }}>
                    <input
                      type="checkbox"
                      checked={brand.hideBranding}
                      onChange={(e) => handleToggleHideBranding(ev.id, e.target.checked)}
                    />
                    Ocultar completamente a marca do Portal JA para este evento
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
