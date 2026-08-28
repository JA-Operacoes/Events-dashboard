export type Edition = {
  id: string;
  year: number;
  label: string;
  bannerUrl?: string | null;
  /** Quando o banner já traz o nome/identidade do evento, o admin pode desligar o texto sobreposto. Default: true. */
  showTitleOverBanner?: boolean;
};
export type EventOption = {
  id: string;
  name: string;
  editions: Edition[];
  /** Marca própria do evento (multi-tenant) — substitui a logo padrão na sidebar enquanto ele está selecionado. */
  logoUrl?: string | null;
  /** Alguns eventos contratados não querem nenhuma referência à empresa contratada visível. */
  hideBranding?: boolean;
  /** Cor primária (hex) do cliente — substitui --accent/--accent-soft do tema enquanto ele está selecionado. */
  accentColor?: string | null;
};

/**
 * Lista de eventos/edições disponíveis para o seletor do topo — vem do nosso
 * próprio banco (cadastrado pelo admin em /admin/eventos) enquanto a API
 * oficial do sistema deles não existe. Trocar de evento no template inteiro
 * continua funcionando igual quando essa fonte mudar — nenhuma tela depende
 * de como os dados chegam aqui.
 */
export async function fetchEvents(): Promise<EventOption[]> {
  const res = await fetch("/api/events");
  if (!res.ok) throw new Error("Falha ao carregar eventos");
  return res.json();
}
