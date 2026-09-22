/**
 * Contraste WCAG e ajuste de cor por tema.
 *
 * As cores de marca do evento são escolhidas uma vez, mas cada pessoa lê o
 * painel no tema que preferir. Um texto preto escolhido pensando no tema claro
 * fica ilegível no escuro — e o inverso também. Em vez de proibir a escolha ou
 * ignorar o problema, a cor é clareada ou escurecida até ficar legível no tema
 * em uso, mantendo o matiz: a marca continua reconhecível e o texto, legível.
 */

export type Tema = "dark" | "light";

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const v = (c: number) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0");
  return `#${v(r)}${v(g)}${v(b)}`;
}

function luminancia([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
    else if (max === G) h = ((B - R) / d + 2) * 60;
    else h = ((R - G) / d + 4) * 60;
  }
  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

/** Razão de contraste (1 a 21). Devolve null se algum hex for inválido. */
export function contraste(corA: string, corB: string): number | null {
  const a = hexToRgb(corA);
  const b = hexToRgb(corB);
  if (!a || !b) return null;
  const la = luminancia(a);
  const lb = luminancia(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Fundo que vale como referência em cada tema. Não é o fundo do card, e sim o
 * mais desfavorável dos planos onde o texto aparece: no escuro, o painel mais
 * claro (#2b2b2c); no claro, o fundo bege atrás dos cards (#dbd7cd). Acertar o
 * contraste contra o pior caso resolve todos os outros.
 */
export const FUNDO_PAINEL: Record<Tema, string> = { dark: "#2b2b2c", light: "#dbd7cd" };

export type NivelContraste = "bom" | "limite" | "ruim";

export function nivelContraste(razao: number | null): NivelContraste {
  if (razao == null) return "ruim";
  if (razao >= 4.5) return "bom"; // mínimo WCAG AA para texto corrido
  if (razao >= 3) return "limite"; // passa só para texto grande
  return "ruim";
}

/**
 * Ajusta a luminosidade da cor até ela atingir `alvo` de contraste contra
 * `fundo`, preservando matiz e saturação. Tenta primeiro o sentido natural do
 * tema (clarear sobre fundo escuro, escurecer sobre fundo claro); se nem o
 * extremo resolver — acontece com matizes muito saturados — devolve branco ou
 * preto, o que for legível.
 */
export function ajustarParaContraste(cor: string, fundo: string, alvo: number): string {
  const rgb = hexToRgb(cor);
  const rgbFundo = hexToRgb(fundo);
  if (!rgb || !rgbFundo) return cor;

  const atual = contraste(cor, fundo);
  if (atual != null && atual >= alvo) return cor;

  const [h, s, l] = rgbToHsl(rgb);
  const fundoClaro = luminancia(rgbFundo) > 0.35;
  // sobre fundo claro o caminho é escurecer; sobre fundo escuro, clarear
  const passo = fundoClaro ? -2 : 2;

  // Cor sem matiz (preto, branco, cinza) não tem marca a preservar: vai direto
  // ao extremo legível. Parar no mínimo transformaria um preto escolhido para
  // o tema claro num cinza morno no tema escuro, quando o que se espera ali é
  // branco. Cor com matiz segue o ajuste gradual abaixo, que mantém o tom.
  if (s < 10) return fundoClaro ? "#000000" : "#ffffff";

  for (let nova = l + passo; nova >= 0 && nova <= 100; nova += passo) {
    const candidata = rgbToHex(hslToRgb(h, s, nova));
    const c = contraste(candidata, fundo);
    if (c != null && c >= alvo) return candidata;
  }

  return fundoClaro ? "#000000" : "#ffffff";
}

/** Alvo por papel: texto precisa de 4.5:1; elemento gráfico se sustenta com 3:1. */
export const ALVO_CONTRASTE = { texto: 4.5, grafico: 3 } as const;

/**
 * Cor efetiva de uma cor de marca no tema em uso — é o que as telas aplicam.
 * `null`/vazio devolve null, sinalizando "usar a cor padrão do tema".
 */
export function corEfetiva(
  cor: string | null | undefined,
  tema: Tema,
  papel: keyof typeof ALVO_CONTRASTE
): string | null {
  if (!cor) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(cor.trim())) return null;
  return ajustarParaContraste(cor.trim(), FUNDO_PAINEL[tema], ALVO_CONTRASTE[papel]);
}
