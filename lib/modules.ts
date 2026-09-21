/**
 * Catálogo dos módulos do painel e quais estão ligados em cada edição.
 *
 * Nem toda edição contrata tudo: uma pode ter financeiro e credenciamento, a
 * seguinte só operacional. Quem manda é `Edition.modulos` (configurado em
 * /admin/eventos) — a sidebar, a visão geral, a proteção de rota e as rotas de
 * import leem todos daqui, para não existir uma segunda lista de módulos que
 * saia de sincronia com esta.
 */

export const MODULES = [
  { key: "financeiro", href: "/financeiro", navKey: "shell.nav.financeiro", label: "Financeiro" },
  { key: "operacional", href: "/operacional", navKey: "shell.nav.operacional", label: "Operacional" },
  { key: "credenciamento", href: "/credenciamento", navKey: "shell.nav.credenciamento", label: "Credenciamento" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

/** Edição nova nasce com tudo ligado — o admin desliga o que não foi contratado. */
export const DEFAULT_MODULES: ModuleKey[] = [...MODULE_KEYS];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as string[]).includes(value);
}

/**
 * Lista normalizada de módulos de uma edição. `undefined` (payload antigo em
 * cache, ou edição ainda carregando) vale como "tudo ligado": esconder módulos
 * por causa de um dado que ainda não chegou seria pior que mostrar demais por
 * um instante. Lista vazia é diferente — significa que o admin desligou tudo.
 */
export function editionModules(edition: { modulos?: string[] | null } | null | undefined): ModuleKey[] {
  if (!edition || edition.modulos == null) return [...MODULE_KEYS];
  return edition.modulos.filter(isModuleKey);
}

export function hasModule(
  edition: { modulos?: string[] | null } | null | undefined,
  key: ModuleKey
): boolean {
  return editionModules(edition).includes(key);
}

/** Qual módulo uma rota pertence — usado para barrar o acesso direto pela URL. */
export function moduleForPath(pathname: string): ModuleKey | null {
  const hit = MODULES.find((m) => pathname === m.href || pathname.startsWith(m.href + "/"));
  return hit ? hit.key : null;
}
