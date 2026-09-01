/**
 * Filtro de período compartilhado pelas telas de Financeiro e Credenciamento.
 * "custom" ainda não tem seletor de datas na UI — até isso existir, se
 * comporta como "all" (não teria como recortar um intervalo escolhido).
 */

export type PeriodFilter = "all" | "30d" | "7d" | "custom";

/** "27/08/2026" (planilhas BR) ou "2026-08-27" (ISO) — tenta os dois formatos. */
export function parseDateLoose(v: string | null | undefined): number {
  if (!v) return NaN;
  const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? NaN : t;
}

export function matchesPeriod(dateStr: string | null | undefined, period: PeriodFilter): boolean {
  if (period === "all" || period === "custom") return true;
  const t = parseDateLoose(dateStr);
  if (Number.isNaN(t)) return false;
  const days = period === "30d" ? 30 : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

/** "há 5 min" / "há 2h" / "há 3 dias" / data completa se for muito antigo. */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "—";
  if (diffMs < 60_000) return "agora mesmo";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} dia${d > 1 ? "s" : ""}`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export type PaymentMethod = "boleto" | "cartao" | "pix" | "outro";

/** Planilhas trazem texto livre ("Boleto Bancário", "Cartão de Crédito"...) — normaliza pras categorias do filtro. */
export function normalizePaymentMethod(forma: string): PaymentMethod {
  const f = forma.toLowerCase();
  if (f.includes("boleto")) return "boleto";
  if (f.includes("pix")) return "pix";
  if (f.includes("cart")) return "cartao";
  return "outro";
}
