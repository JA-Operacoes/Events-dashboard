"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useEvent } from "@/lib/eventContext";
import { Checkbox } from "@/components/ui";
import { notifySuccess, notifyError, confirmDanger } from "@/lib/swal";

type Edition = { id: string; ano: number; label: string; _count: { access: number } };
type EventRow = {
  id: string;
  nome: string;
  grupo: string | null;
  editions: Edition[];
  logoUrl: string | null;
  hideBranding: boolean;
  accentColor: string | null;
};

const SEM_GRUPO = "— sem grupo —";

/**
 * Select "grande" de grupo — lista os grupos que já existem (derivados dos
 * eventos cadastrados) e uma opção "+ novo grupo" que revela um campo de
 * texto pra criar um nome ainda inédito. Reaproveitado no form de criação e
 * na configuração de cada evento já existente.
 */
function GroupSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (grupo: string) => void;
}) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [novo, setNovo] = useState("");

  if (creatingNew) {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          autoFocus
          placeholder="Nome do novo grupo (ex.: Beauty Fair)"
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onBlur={() => {
            if (novo.trim()) onChange(novo.trim());
            setCreatingNew(false);
            setNovo("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (novo.trim()) onChange(novo.trim());
              setCreatingNew(false);
              setNovo("");
            }
            if (e.key === "Escape") {
              setCreatingNew(false);
              setNovo("");
            }
          }}
          className="input"
          style={{ flex: 1 }}
        />
      </div>
    );
  }

  return (
    <select
      className="input"
      style={{ width: "100%" }}
      value={value}
      onChange={(e) => {
        if (e.target.value === "__new__") {
          setCreatingNew(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">{SEM_GRUPO}</option>
      {options.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
      <option value="__new__">+ Criar novo grupo…</option>
    </select>
  );
}

export default function AdminEventosPage() {
  const { isAdmin } = useAuth();
  const { refreshEvents } = useEvent();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [novoGrupo, setNovoGrupo] = useState("");
  const [editionForms, setEditionForms] = useState<Record<string, { ano: string; label: string }>>({});
  const [brandForms, setBrandForms] = useState<Record<string, { logoUrl: string; hideBranding: boolean; accentColor: string }>>({});
  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggleExpanded(eventId: string) {
    setExpanded((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  }

  const groupOptions = Array.from(new Set(events.map((ev) => ev.grupo).filter((g): g is string => !!g))).sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

  const filteredEvents = events.filter((ev) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return ev.nome.toLowerCase().includes(term) || (ev.grupo ?? "").toLowerCase().includes(term);
  });

  // agrupa pra exibição — eventos sem grupo caem numa seção "sem grupo" no final.
  const groupedEvents = Array.from(
    filteredEvents
      .reduce((map, ev) => {
        const key = ev.grupo ?? "";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
        return map;
      }, new Map<string, EventRow[]>())
      .entries()
  ).sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "pt-BR");
  });

  const LOGO_WIDTH = 650;
  const LOGO_HEIGHT = 200;
  const LOGO_ACCEPT = ["image/png", "image/jpeg", "image/webp"];

  async function handleLogoFile(eventId: string, file: File) {
    setLogoError((prev) => ({ ...prev, [eventId]: "" }));
    if (!LOGO_ACCEPT.includes(file.type)) {
      const msg = "Formato inválido — envie PNG, JPEG ou WEBP";
      setLogoError((prev) => ({ ...prev, [eventId]: msg }));
      notifyError("Formato de imagem inválido", msg);
      return;
    }
    // checagem client-side só pra feedback rápido; quem garante de verdade é o servidor
    const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
    if (!dims || dims.width !== LOGO_WIDTH || dims.height !== LOGO_HEIGHT) {
      const msg = `A imagem precisa ter exatamente ${LOGO_WIDTH}x${LOGO_HEIGHT}px (essa tem ${dims ? `${dims.width}x${dims.height}` : "tamanho desconhecido"})`;
      setLogoError((prev) => ({ ...prev, [eventId]: msg }));
      notifyError("Dimensões incorretas", msg);
      return;
    }

    setUploadingLogo(eventId);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/admin/events/${eventId}/logo`, { method: "POST", body });
    setUploadingLogo(null);
    if (!res.ok) {
      const errMsg = (await res.json()).error ?? "Falha ao enviar a logo";
      setLogoError((prev) => ({ ...prev, [eventId]: errMsg }));
      notifyError("Falha ao enviar a logo", errMsg);
      return;
    }
    const { logoUrl } = await res.json();
    setBrandForms((prev) => ({ ...prev, [eventId]: { ...prev[eventId], logoUrl } }));
    load();
    refreshEvents();
    notifySuccess("Logo atualizada");
  }

  async function handleRemoveLogo(eventId: string) {
    setUploadingLogo(eventId);
    await fetch(`/api/admin/events/${eventId}/logo`, { method: "DELETE" });
    setUploadingLogo(null);
    setBrandForms((prev) => ({ ...prev, [eventId]: { ...prev[eventId], logoUrl: "" } }));
    load();
    refreshEvents();
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/events");
    const data: EventRow[] = await res.json();
    setEvents(data);
    setBrandForms((prev) => {
      const next = { ...prev };
      for (const ev of data) {
        if (!next[ev.id])
          next[ev.id] = { logoUrl: ev.logoUrl ?? "", hideBranding: ev.hideBranding, accentColor: ev.accentColor ?? "" };
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
      body: JSON.stringify({ nome: novoNome, grupo: novoGrupo || null }),
    });
    if (!res.ok) {
      const msg = (await res.json()).error ?? "Falha ao criar evento";
      setError(msg);
      notifyError("Não foi possível criar o evento", msg);
      return;
    }
    setNovoNome("");
    setNovoGrupo("");
    load();
    notifySuccess("Evento criado", `"${novoNome}" já aparece na lista abaixo.`);
  }

  async function handleDeleteEvent(id: string) {
    const ok = await confirmDanger("Remover este evento?", "Isso apaga também todas as edições e vínculos de acesso dele — não dá pra desfazer.");
    if (!ok) return;
    await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
    load();
    notifySuccess("Evento removido");
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
      const msg = (await res.json()).error ?? "Falha ao criar edição";
      setError(msg);
      notifyError("Não foi possível criar a edição", msg);
      return;
    }
    setEditionForms((prev) => ({ ...prev, [eventId]: { ano: "", label: "" } }));
    notifySuccess("Edição criada");
    load();
  }

  async function handleDeleteEdition(id: string) {
    const ok = await confirmDanger("Remover esta edição?", "Os dados financeiros/credenciamento importados pra ela também somem — não dá pra desfazer.");
    if (!ok) return;
    await fetch(`/api/admin/editions/${id}`, { method: "DELETE" });
    load();
    notifySuccess("Edição removida");
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

  // Cor também é efeito imediato — igual ao toggle de marca — pra dar feedback
  // visual instantâneo enquanto o admin escolhe a cor no picker.
  async function handleAccentColorChange(eventId: string, accentColor: string) {
    setBrandForms((prev) => ({ ...prev, [eventId]: { ...prev[eventId], accentColor } }));
    await fetch(`/api/admin/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accentColor: accentColor || null }),
    });
    load();
    refreshEvents();
  }

  // Grupo é reassinalável a qualquer momento (efeito imediato, igual cor/marca) —
  // permite tanto encaixar um evento existente num grupo quanto criar um novo grupo na hora.
  async function handleGrupoChange(eventId: string, grupo: string) {
    setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, grupo: grupo || null } : ev)));
    await fetch(`/api/admin/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grupo: grupo || null }),
    });
    load();
    refreshEvents();
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
        <form onSubmit={handleCreateEvent} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="text"
              placeholder="Nome do evento (ex.: Beauty BH)"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              required
              style={{ flex: 1 }}
              className="input"
            />
            <button className="btn primary" type="submit">
              Adicionar
            </button>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 740 }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>
              Grupo (opcional — agrupa sub-eventos do mesmo cliente/marca, ex.: "Beauty Fair" agrupa Beauty BH, Beauty
              Show, Professional Fair RJ/BH)
            </span>
            <GroupSelect value={novoGrupo} options={groupOptions} onChange={setNovoGrupo} />
          </label>
        </form>
        {error && <div className="auth-error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {!loading && events.length > 0 && (
        <div className="search" style={{ marginBottom: 16, maxWidth: 340 }}>
          <input
            type="text"
            placeholder="Buscar evento pelo nome ou grupo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

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
      ) : !filteredEvents.length ? (
        <div className="empty">
          <div className="g">▣</div>
          <strong>nenhum evento encontrado</strong>
          <span>nenhum resultado para "{search}"</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {groupedEvents.map(([grupo, evs]) => (
            <div key={grupo || "__sem_grupo__"}>
              <p className="section-label" style={{ margin: "0 0 10px" }}>
                {grupo || SEM_GRUPO} <span style={{ fontWeight: 400 }}>({evs.length})</span>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {evs.map((ev) => {
                  const brand = brandForms[ev.id] ?? { logoUrl: "", hideBranding: false, accentColor: "" };
                  const isOpen = !!expanded[ev.id];
                  return (
                    <div className="panel" key={ev.id}>
                <button
                  type="button"
                  className="panel-head accordion-toggle"
                  onClick={() => toggleExpanded(ev.id)}
                  aria-expanded={isOpen}
                >
                  <div>
                    <h3>{ev.nome}</h3>
                    <p>{ev.editions.length} edição(ões)</p>
                  </div>
                  <span className="accordion-arrow">{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                  <button className="btn" type="button" onClick={() => handleDeleteEvent(ev.id)}>
                    Remover evento
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  {ev.editions.map((ed) => (
                    <div className="status-row" key={ed.id}>
                      <span className="status-left">
                        <strong style={{ fontWeight: 600 }}>{ed.label}</strong>
                        <span style={{ color: "var(--ink-mute)" }}>
                          ({ed.ano}) · {ed._count.access} usuário(s) com acesso
                        </span>
                      </span>
                      <button className="btn" type="button" onClick={() => handleDeleteEdition(ed.id)}>
                        ×
                      </button>
                    </div>
                  ))}
                  {!ev.editions.length && <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>sem edições ainda</span>}
                </div>

                <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18, maxWidth: 340 }}>
                  <span className="section-label">Grupo</span>
                  <GroupSelect value={ev.grupo ?? ""} options={groupOptions} onChange={(g) => handleGrupoChange(ev.id, g)} />
                </label>

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
                  <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "0 0 8px" }}>
                    Exige imagem exatamente {LOGO_WIDTH}x{LOGO_HEIGHT}px, em PNG, JPEG ou WEBP.
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                    {brand.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={brand.logoUrl}
                        alt=""
                        style={{ height: 52, width: 169, objectFit: "contain", objectPosition: "left center", border: "1px solid var(--line)", borderRadius: 6, background: "var(--panel-2)" }}
                      />
                    )}
                    <label className="btn" style={{ cursor: brand.hideBranding ? "not-allowed" : "pointer", opacity: brand.hideBranding ? 0.5 : 1 }}>
                      {uploadingLogo === ev.id ? "Enviando…" : brand.logoUrl ? "Trocar logo" : "Enviar logo"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={brand.hideBranding || uploadingLogo === ev.id}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) handleLogoFile(ev.id, file);
                        }}
                      />
                    </label>
                    {brand.logoUrl && (
                      <button className="btn" type="button" disabled={uploadingLogo === ev.id} onClick={() => handleRemoveLogo(ev.id)}>
                        Remover logo
                      </button>
                    )}
                  </div>
                  {logoError[ev.id] && (
                    <div className="auth-error" style={{ marginBottom: 10, fontSize: 12 }}>
                      {logoError[ev.id]}
                    </div>
                  )}
                  <Checkbox
                    checked={brand.hideBranding}
                    onChange={(checked) => handleToggleHideBranding(ev.id, checked)}
                    label="Ocultar completamente a marca do Portal JA para este evento"
                  />

                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                    <input
                      type="color"
                      value={brand.accentColor || "#e53939"}
                      onChange={(e) => handleAccentColorChange(ev.id, e.target.value)}
                      style={{ width: 40, height: 32, padding: 2, border: "1px solid var(--line)", borderRadius: 6, background: "none", cursor: "pointer" }}
                      aria-label="Cor primária do evento"
                    />
                    <span style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>
                      Cor primária deste evento (substitui a cor padrão do template)
                    </span>
                    {brand.accentColor && (
                      <button className="btn" type="button" onClick={() => handleAccentColorChange(ev.id, "")}>
                        Usar cor padrão
                      </button>
                    )}
                  </div>
                </div>
                  </>
                )}
              </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
