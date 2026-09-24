import { NextResponse } from "next/server";

/**
 * Cache das respostas de leitura por edição, em memória do processo.
 *
 * O que ele resolve: entrar num módulo puxa todas as linhas da edição do Neon,
 * e o banco é remoto — medido, ~3,9s para 10 mil duplicatas, das quais ~0,45s
 * é só a latência mínima da conexão. O conteúdo só muda quando alguém importa
 * ou remove uma planilha, então repetir a consulta a cada visita é desperdício.
 *
 * Guarda o JSON já serializado: além da consulta, evita refazer o map() e o
 * stringify de alguns MB.
 *
 * Limites conhecidos, de propósito:
 * - é por processo. Em serverless, cada instância tem o seu; o ganho aparece
 *   nas visitas seguintes que caírem na mesma instância, não em todas.
 * - o TTL é a rede de segurança para qualquer escrita que escape da
 *   invalidação (um import feito por outra instância, por exemplo).
 */
type Entrada = { corpo: string; cabecalhos: Record<string, string>; expiraEm: number };

const cache = new Map<string, Entrada>();

/** Cinco minutos: curto o bastante para um dado esquecido não envelhecer na tela. */
const TTL_MS = 5 * 60 * 1000;

function chave(modulo: string, editionId: string) {
  return `${modulo}:${editionId}`;
}

/** Resposta pronta do cache, ou null quando não há nada válido guardado. */
export function respostaCacheada(modulo: string, editionId: string): NextResponse | null {
  const entrada = cache.get(chave(modulo, editionId));
  if (!entrada) return null;
  if (Date.now() > entrada.expiraEm) {
    cache.delete(chave(modulo, editionId));
    return null;
  }
  return new NextResponse(entrada.corpo, {
    headers: { "content-type": "application/json", "x-cache": "hit", ...entrada.cabecalhos },
  });
}

/** Guarda o corpo já serializado e devolve a resposta para o primeiro pedido. */
export function guardarResposta(
  modulo: string,
  editionId: string,
  dados: unknown,
  cabecalhos: Record<string, string> = {}
): NextResponse {
  const corpo = JSON.stringify(dados);
  cache.set(chave(modulo, editionId), { corpo, cabecalhos, expiraEm: Date.now() + TTL_MS });
  return new NextResponse(corpo, {
    headers: { "content-type": "application/json", "x-cache": "miss", ...cabecalhos },
  });
}

/**
 * Chamado por toda escrita (import, remoção de arquivo). Sem isso, quem
 * importar veria a tela antiga até o TTL vencer.
 */
export function invalidarCache(modulo: string, editionId: string): void {
  cache.delete(chave(modulo, editionId));
  // a visão geral resume todos os módulos: qualquer import muda o que ela mostra
  cache.delete(chave("overview", editionId));
}
