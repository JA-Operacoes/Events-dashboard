"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchEvents, type EventOption } from "./events";
import { useAuth } from "./auth";

type EditionOverride = { bannerUrl?: string | null; showTitleOverBanner?: boolean };

type EventContextValue = {
  events: EventOption[];
  loading: boolean;
  eventId: string | null;
  editionId: string | null;
  event: EventOption | null;
  edition: EventOption["editions"][number] | null;
  setEventId: (id: string) => void;
  setEditionId: (id: string) => void;
  /**
   * Preview local do banner/preferências de exibição por edição — não
   * persiste em lugar nenhum ainda. TODO: quando o upload real existir (ex.
   * Cloudflare Images/R2) e houver onde salvar `showTitleOverBanner`, trocar
   * por uma chamada que grava no banco de eventos e recarrega `fetchEvents()`.
   */
  setEditionBannerPreview: (editionId: string, url: string | null) => void;
  setEditionShowTitleOverBanner: (editionId: string, show: boolean) => void;
  /** Rebusca a lista de eventos — chamado depois de editar marca/eventos no admin, pra sidebar refletir na hora. */
  refreshEvents: () => Promise<void>;
};

const EventContext = createContext<EventContextValue | null>(null);

export function EventProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [allEvents, setAllEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventId, setEventId] = useState<string | null>(null);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, EditionOverride>>({});

  async function refreshEvents() {
    try {
      setAllEvents(await fetchEvents());
    } catch (err) {
      console.error("Falha ao carregar eventos:", err);
    }
  }

  useEffect(() => {
    refreshEvents().finally(() => setLoading(false));
  }, []);

  // sem sessão (stub atual), mostra tudo — a restrição por usuário só passa a
  // valer quando o login estiver ligado a um backend de verdade.
  const events = useMemo(() => {
    if (!session || session.allowedEventIds === "all") return allEvents;
    const allowed = new Set(session.allowedEventIds);
    return allEvents.filter((ev) => allowed.has(ev.id));
  }, [allEvents, session]);

  useEffect(() => {
    if (events.length && !events.some((ev) => ev.id === eventId)) {
      setEventId(events[0].id);
      setEditionId(events[0].editions[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const event = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);
  const edition = useMemo(() => {
    const base = event?.editions.find((ed) => ed.id === editionId) ?? null;
    if (!base) return null;
    const override = overrides[base.id];
    return override ? { ...base, ...override } : base;
  }, [event, editionId, overrides]);

  function handleSetEventId(id: string) {
    setEventId(id);
    const next = events.find((e) => e.id === id);
    setEditionId(next?.editions[0]?.id ?? null);
  }

  function patchOverride(edId: string, patch: EditionOverride) {
    setOverrides((prev) => ({ ...prev, [edId]: { ...prev[edId], ...patch } }));
  }

  function setEditionBannerPreview(edId: string, url: string | null) {
    patchOverride(edId, { bannerUrl: url });
  }

  function setEditionShowTitleOverBanner(edId: string, show: boolean) {
    patchOverride(edId, { showTitleOverBanner: show });
  }

  return (
    <EventContext.Provider
      value={{
        events,
        loading,
        eventId,
        editionId,
        event,
        edition,
        setEventId: handleSetEventId,
        setEditionId,
        setEditionBannerPreview,
        setEditionShowTitleOverBanner,
        refreshEvents,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useEvent must be used within EventProvider");
  return ctx;
}
