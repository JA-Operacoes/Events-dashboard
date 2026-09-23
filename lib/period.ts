/**
 * Filtro de período compartilhado pelas telas de Financeiro e Credenciamento.
 * "custom" recorta pelo intervalo escolhido na tela; enquanto as duas pontas
 * não forem preenchidas, se comporta como "all" — recortar por um intervalo
 * pela metade esconderia dados sem o usuário entender por quê.
 */

export type PeriodFilter = "all" | "30d" | "7d" | "custom";

/** Intervalo do filtro personalizado, no formato do <input type="date"> (yyyy-mm-dd). */
export type DateRange = { de: string; ate: string };

/** "27/08/2026" (planilhas BR) ou "2026-08-27" (ISO) — tenta os dois formatos. */
export function parseDateLoose(v: string | null | undefined): number {
  if (!v) return NaN;
  const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? NaN : t;
}

export function matchesPeriod(
  dateStr: string | null | undefined,
  period: PeriodFilter,
  range?: DateRange
): boolean {
  if (period === "custom") {
    if (!range?.de || !range?.ate) return true;
    const t = parseDateLoose(dateStr);
    if (Number.isNaN(t)) return false;
    const de = parseDateLoose(range.de);
    // o fim do intervalo é inclusivo: escolher 01/09 a 30/09 tem de pegar o
    // que caiu no dia 30, e não parar na meia-noite que o abre.
    const ate = parseDateLoose(range.ate) + 24 * 60 * 60 * 1000 - 1;
    if (Number.isNaN(de) || Number.isNaN(ate)) return true;
    return t >= de && t <= ate;
  }
  if (period === "all") return true;
  const t = parseDateLoose(dateStr);
  if (Number.isNaN(t)) return false;
  const days = period === "30d" ? 30 : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

/**
 * Separa "13/07/2026 17:13" (ou "2026-07-13T17:13:00") em data e hora.
 *
 * Alguns relatórios trazem as duas informações numa coluna só ("Data/Hora
 * Cadastro"), outros em colunas separadas. Mapeando a coluna combinada no
 * campo de data, a hora era descartada silenciosamente — e o gráfico por hora
 * ficava vazio sem explicação.
 */
export function separarDataHora(valor: string | null | undefined): { data: string; hora: string } {
  const v = (valor ?? "").trim();
  if (!v) return { data: "", hora: "" };

  // ISO: 2026-07-13T17:13:00 ou 2026-07-13 17:13
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2})?)/);
  if (iso) return { data: iso[1], hora: iso[2] };

  // BR: 13/07/2026 17:13:00
  const br = v.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (br) return { data: br[1], hora: br[2] };

  // só hora, sem data
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) return { data: "", hora: v };

  return { data: v, hora: "" };
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
