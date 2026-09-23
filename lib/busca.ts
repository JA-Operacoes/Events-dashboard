/**
 * Comparação de texto para busca na tela.
 *
 * Quem procura está quase sempre conferindo contra outro sistema: copia o CPF
 * com pontos de um lado e cola do outro, ou digita sem pontuação nenhuma.
 * Comparar as strings cruas faz "02722608359" não achar "027.226.083-59", e o
 * resultado parece que o dado não existe.
 */

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Só letras e números: é o que permite casar documento com e sem máscara. */
function soAlfanumerico(s: string): string {
  return semAcento(s).replace(/[^a-z0-9]/g, "");
}

/**
 * Verdadeiro quando o termo aparece em algum dos campos. Ignora caixa, acento
 * e pontuação — e, quando o termo é só dígitos, compara também a versão sem
 * máscara dos campos.
 */
export function combina(termo: string, campos: Array<string | null | undefined>): boolean {
  const t = semAcento(termo.trim());
  if (!t) return true;

  const texto = semAcento(campos.filter(Boolean).join(" "));
  if (texto.includes(t)) return true;

  // "027.226.083-59" encontrado por "02722608359" (e vice-versa)
  const tNumerico = soAlfanumerico(termo);
  if (tNumerico.length < 3) return false;
  return soAlfanumerico(campos.filter(Boolean).join(" ")).includes(tNumerico);
}
