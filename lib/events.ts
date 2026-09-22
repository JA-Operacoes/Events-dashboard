export type Edition = {
  id: string;
  year: number;
  label: string;
  bannerUrl?: string | null;
  /** Quando o banner já traz o nome/identidade do evento, o admin pode desligar o texto sobreposto. Default: true. */
  showTitleOverBanner?: boolean;
  /** Módulos contratados nesta edição — ver lib/modules.ts. Ausente = todos (payload antigo). */
  modulos?: string[];
};
export type EventOption = {
  id: string;
  name: string;
  /** Agrupa sub-eventos do mesmo cliente/marca (ex.: "Beauty Fair" agrupa Beauty BH, Beauty Show...). */
  grupo?: string | null;
  editions: Edition[];
  /** Marca própria do evento (multi-tenant) — substitui a logo padrão na sidebar enquanto ele está selecionado. */
  logoUrl?: string | null;
  /** Alguns eventos contratados não querem nenhuma referência à empresa contratada visível. */
  hideBranding?: boolean;
  /** Cor primária (hex) do cliente — substitui --accent/--accent-soft do tema enquanto ele está selecionado. */
  accentColor?: string | null;
  /** Cor secundária (hex) — realces de apoio e 2ª série dos gráficos. */
  secondaryColor?: string | null;
  /** Cor do texto principal (hex) — substitui --ink enquanto o evento está selecionado. */
  textColor?: string | null;
};

/**
 * Lista de eventos/edições disponíveis para o seletor do topo — vem do nosso
 * próprio banco (cadastrado pelo admin em /admin/eventos) enquanto a API
 * oficial do sistema deles não existe. Trocar de evento no template inteiro
 * continua funcionando igual quando essa fonte mudar — nenhuma tela depende
 * de como os dados chegam aqui.
 */
/**
 * O banco (Neon) suspende por inatividade e a primeira chamada depois de um
 * tempo parado pode falhar enquanto ele acorda. Como essa lista é o que
 * sustenta a sidebar inteira, uma falha dessas deixava o painel vazio até
 * alguém recarregar a página na mão — por isso a nova tentativa, com uma
 * pausa curta para dar tempo do banco subir.
 */
export async function fetchEvents(): Promise<EventOption[]> {
  const tentativas = [0, 1500, 4000];
  let ultimoErro: unknown = null;

  for (const espera of tentativas) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    try {
      const res = await fetch("/api/events");
      if (res.ok) return res.json();
      // 4xx é erro de permissão/sessão: repetir não muda nada
      if (res.status < 500) throw new Error("Falha ao carregar eventos");
      ultimoErro = new Error(`Falha ao carregar eventos (HTTP ${res.status})`);
    } catch (err) {
      if (err instanceof Error && err.message === "Falha ao carregar eventos") throw err;
      ultimoErro = err;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Falha ao carregar eventos");
}
