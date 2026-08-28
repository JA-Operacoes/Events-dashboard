/**
 * Cache simples em memória (module-scope, sobrevive a trocas de aba dentro
 * do app, mas some num F5) — resolve a demora de "sair da aba e voltar"
 * mostrando o último dado conhecido na hora, enquanto busca uma versão
 * atualizada por baixo dos panos (stale-while-revalidate simplificado).
 */
const cache = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
}
