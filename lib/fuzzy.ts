/**
 * Sugestões de busca: dado o que foi digitado, devolve os nomes reais mais
 * próximos para o campo oferecer como opção. Quem digita "recepcionsta" ou
 * "EXPOSITOR TESTE" não deve ficar sem resultado por um caractere trocado ou
 * por não lembrar o nome inteiro.
 */

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Distância de edição (Levenshtein) com duas linhas em vez da matriz inteira —
 * a lista de expositores de uma edição grande passa de mil nomes e isso roda a
 * cada tecla digitada.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + custo);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * Ordena por proximidade e corta em `limite`. A ordem é: começa com o termo,
 * contém o termo, e só então parecido-mas-escrito-diferente — assim quem
 * digitou certo vê o resultado exato primeiro, e quem errou uma letra ainda
 * encontra. Tolerância proporcional ao tamanho do termo (~1 erro a cada 4
 * caracteres) para termos curtos não casarem com meio mundo.
 */
export function sugerir(termo: string, candidatos: string[], limite = 8): string[] {
  const t = normalize(termo);
  if (!t) return [];

  const tolerancia = Math.max(1, Math.floor(t.length / 4));
  const pontuados: Array<{ nome: string; score: number }> = [];

  for (const nome of candidatos) {
    const n = normalize(nome);
    if (!n) continue;

    if (n.startsWith(t)) {
      pontuados.push({ nome, score: n.length - t.length });
      continue;
    }
    if (n.includes(t)) {
      pontuados.push({ nome, score: 1000 + n.indexOf(t) });
      continue;
    }
    // compara com cada palavra do nome: "teste" deve achar "EXPOSITOR TESTE - JA"
    // tokens de pontuação ("-", "/") ficam de fora: a um caractere de
    // distância de qualquer termo curto, casariam com quase tudo.
    const palavras = n.split(/\s+/).filter((w) => w.length > 1);
    const melhorPalavra = Math.min(...palavras.map((w) => editDistance(t, w)), editDistance(t, n));
    if (melhorPalavra <= tolerancia) pontuados.push({ nome, score: 2000 + melhorPalavra });
  }

  return pontuados
    .sort((a, b) => a.score - b.score || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, limite)
    .map((p) => p.nome);
}
