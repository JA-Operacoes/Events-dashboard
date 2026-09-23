"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  fetchFinanceiro,
  type FinanceiroData,
  type FinanceiroFilters,
  type Invoice,
  type InvoiceStatus,
  type OrigemReceita,
} from "@/lib/dataSource";
import { ConnChip, Empty, EmptyTableRow, KpiRow, money, int, pct } from "@/components/ui";
import { SpreadsheetImportFinanceiro } from "@/components/SpreadsheetImport";
import { aggregateFinanceiro, mergeImportedInvoices, classificarOrigem } from "@/lib/spreadsheetImport";
import { Donut, BarList, StatusBars, LineChart } from "@/components/charts";
import { getCached, setCached } from "@/lib/pageCache";
import { combina } from "@/lib/busca";
import { enviarImportEmLotes } from "@/lib/importClient";
import { matchesPeriod, normalizePaymentMethod, formatRelativeTime } from "@/lib/period";
import { notifySuccess, notifyWarning, notifyError } from "@/lib/swal";

/** Cartões do recorte de ingressos: os do financeiro mais os dois próprios dele. */
type KpisIngresso = FinanceiroData["kpis"] & { taxaComparecimento: number | null; valorEmAberto: number | null };

/** Quantos itens o ranking mostra antes de pedir "ver todos". */
const RANKING_VISIVEL = 8;

type AbaRanking = {
  id: string;
  /** rótulo do botão quando o card tem mais de uma leitura */
  aba?: string;
  desc: string;
  layout?: "row" | "stacked";
  /** uma lista só… */
  dados?: Array<{ name: string; value: number }>;
  /** …ou várias, empilhadas com subtítulo (é o que a opção "Ambos" usa) */
  grupos?: Array<{ titulo: string; dados: Array<{ name: string; value: number }> }>;
};

/**
 * Ranking do recorte de ingressos. Mostra o topo e abre a lista inteira sob
 * demanda — cargo e segmento passam de mil valores distintos no relatório, e
 * sem isso o 9º colocado nunca apareceria.
 *
 * Aceita mais de uma leitura no mesmo card (estado, país, ou os dois juntos):
 * são a mesma pergunta em recortes diferentes e não precisam de painéis
 * separados disputando espaço.
 */
function PainelRanking({ titulo, abas }: { titulo: string; abas: AbaRanking[] }) {
  const [verTodos, setVerTodos] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState(0);

  const tamanho = (a: AbaRanking) =>
    a.grupos ? a.grupos.reduce((acc, g) => acc + g.dados.length, 0) : a.dados?.length ?? 0;

  const disponiveis = abas.filter((a) => tamanho(a) > 0);
  if (!disponiveis.length) return null;

  const atual = disponiveis[Math.min(abaAtiva, disponiveis.length - 1)];
  const grupos = atual.grupos ?? [{ titulo: "", dados: atual.dados ?? [] }];
  const maiorGrupo = Math.max(...grupos.map((g) => g.dados.length));

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>{titulo}</h3>
          <p>{atual.desc}</p>
        </div>
        <div className="panel-head-tools">
          {disponiveis.length > 1 && (
            <div className="seg">
              {disponiveis.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className={atual.id === a.id ? "on" : ""}
                  onClick={() => {
                    setAbaAtiva(i);
                    setVerTodos(false); // a outra leitura tem outro tamanho de lista
                  }}
                >
                  {a.aba ?? a.id}
                </button>
              ))}
            </div>
          )}
          {maiorGrupo > RANKING_VISIVEL && (
            <button className="field field-btn" type="button" onClick={() => setVerTodos((v) => !v)}>
              {verTodos ? "Ver menos" : "Ver todos (" + tamanho(atual).toLocaleString("pt-BR") + ")"}
            </button>
          )}
        </div>
      </div>
      {/* fechado, a lista se distribui pela altura do card; aberto, ela rola
          dentro do mesmo card em vez de esticá-lo */}
      <div className={`ranking-lista ${verTodos ? "barlist-scroll scroll-slim" : ""}`}>
        {grupos.map((g) => (
          <div className="ranking-grupo" key={g.titulo || atual.id}>
            {g.titulo && <span className="section-label">{g.titulo}</span>}
            <BarList
              data={verTodos ? g.dados : g.dados.slice(0, RANKING_VISIVEL)}
              valueFmt={(v) => v.toLocaleString("pt-BR")}
              layout={atual.layout ?? "row"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FinanceiroPage() {
  const { eventId, editionId, event, edition } = useEvent();
  const { t } = useI18n();
  const { canManageData } = useAuth();
  const [period, setPeriod] = useState<FinanceiroFilters["period"]>("all");
  // Dia do evento (recorte de ingressos): "todos" ou uma das datas de
  // comparecimento. Vale para os cartões e todos os painéis da seção.
  const [diaEvento, setDiaEvento] = useState<string>("todos");
  // intervalo do filtro "Personalizado" — vazio até o usuário escolher as duas pontas
  const [customRange, setCustomRange] = useState({ de: "", ate: "" });
  // recorte por origem da receita: expositor, ingresso ou a visão geral com
  // as duas somadas. Vem da coluna "Origem" da planilha.
  const [origem, setOrigem] = useState<FinanceiroFilters["origem"]>("all");
  const [method, setMethod] = useState<FinanceiroFilters["method"]>("all");
  const [statusFilter, setStatusFilter] = useState<FinanceiroFilters["status"]>("all");
  const [donutVariant, setDonutVariant] = useState<"full" | "half">("full");
  // opcional — só faz sentido quando a planilha importada traz colunas de rateio (Conta/Conta 2/Conta 3).
  const [contaFilter, setContaFilter] = useState("all");
  const [search, setSearch] = useState("");
  // busca específica da tabela de duplicatas — filtra só a lista abaixo, sem
  // recalcular KPIs/gráficos (diferente da busca geral, que filtra tudo).
  const [tableSearch, setTableSearch] = useState("");
  // Filtros da própria tabela: afinam a lista sem recalcular KPIs e gráficos,
  // que continuam respondendo só aos filtros do topo. É o que permite olhar o
  // detalhe (uma forma de pagamento, um intervalo de vencimento) sem perder a
  // referência do total.
  const [tableRange, setTableRange] = useState({ de: "", ate: "" });
  const [tableStatus, setTableStatus] = useState<"all" | InvoiceStatus>("all");
  const [tableForma, setTableForma] = useState("all");
  const [connState, setConnState] = useState<"pending" | "connected" | "error">("pending");
  const [apiData, setApiData] = useState<FinanceiroData | null>(null);
  // quando veio a última atualização de dados (import de planilha) — é o que
  // o usuário comum vê no lugar do chip técnico de conexão com a API.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  // lê o último resultado conhecido pra essa edição na hora — evita a tela
  // "piscar" vazia sempre que você sai da aba e volta; loadImported() abaixo
  // ainda busca a versão atual por baixo dos panos.
  const [importedInvoices, setImportedInvoices] = useState<Invoice[]>(
    () => getCached(`financeiro:${editionId}`) ?? []
  );
  const hasImported = importedInvoices.length > 0;

  // fonte bruta de duplicatas, venha de onde vier — o filtro de status/busca
  // roda por cima dela e os gráficos/tabela são recalculados a partir do
  // resultado filtrado, então os filtros afetam tudo, não só a tabela.
  const rawInvoices = apiData?.invoices ?? importedInvoices;

  // só existem quando a planilha importada mapeou alguma coluna de conta —
  // por isso o filtro de conta só aparece na tela quando essa lista não é vazia.
  const contaOptions = useMemo(
    () =>
      Array.from(
        new Set(
          rawInvoices.flatMap((inv) => [inv.centroCusto, inv.conta1, inv.conta2, inv.conta3]).filter((c): c is string => !!c)
        )
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rawInvoices]
  );

  // Um filtro só, com o recorte por dia opcional: o painel que compara os
  // dias entre si precisa de todos eles mesmo quando um dia está selecionado.
  const aplicarFiltros = useCallback(
    (lista: Invoice[], comDia: boolean) => {
      const term = search.trim();
      return lista.filter((inv) => {
        if (statusFilter !== "all" && inv.status !== statusFilter) return false;
        if (origem !== "all" && (inv.origemTipo ?? classificarOrigem(inv.origem)) !== origem) return false;
        if (method !== "all" && normalizePaymentMethod(inv.forma) !== method) return false;
        if (
          contaFilter !== "all" &&
          inv.centroCusto !== contaFilter &&
          inv.conta1 !== contaFilter &&
          inv.conta2 !== contaFilter &&
          inv.conta3 !== contaFilter
        )
          return false;
        // o recorte de período usa a data de pagamento: é a única data de fato
      // comparável depois que o vencimento saiu do painel
      if (!matchesPeriod(inv.pagamento, period, customRange)) return false;
        if (term && !combina(term, [inv.cliente, inv.cnpj, inv.numero, inv.origem])) return false;
        if (comDia && diaEvento !== "todos" && inv.ingresso?.dataComparecimento?.trim() !== diaEvento) return false;
        return true;
      });
    },
    [statusFilter, origem, method, contaFilter, period, customRange, search, diaEvento]
  );

  const filteredInvoices = useMemo(() => aplicarFiltros(rawInvoices, true), [rawInvoices, aplicarFiltros]);

  /**
   * Público por dia calculado sem o recorte de dia. Com o filtro aplicado,
   * este painel virava uma barra só — justamente o gráfico cujo trabalho é
   * comparar um dia com os outros.
   */
  const publicoPorDia = useMemo(() => {
    const porDia = new Map<string, number>();
    for (const inv of aplicarFiltros(rawInvoices, false)) {
      const d = inv.ingresso?.dataComparecimento?.trim();
      if (d) porDia.set(d, (porDia.get(d) ?? 0) + 1);
    }
    return Array.from(porDia, ([name, value]) => ({ name, value })).sort(
      (a, b) => parseDateLoose(a.name) - parseDateLoose(b.name)
    );
  }, [rawInvoices, aplicarFiltros]);

  // Sem memo, esta conta (25ms com 10 mil duplicatas) rodava a cada render —
  // inclusive a cada tecla digitada na busca, que é o que travava a tela.
  const data = useMemo(
    () => (apiData || hasImported ? aggregateFinanceiro(filteredInvoices) : null),
    [apiData, hasImported, filteredInvoices]
  );

  // A barra de origem é calculada sobre TODAS as duplicatas, não sobre o
  // resultado filtrado: senão, ao escolher "Expositor", as outras abas
  // zerariam e não daria para comparar nem voltar com referência.
  const origensDisponiveis = useMemo(() => {
    const set = new Set<OrigemReceita>();
    for (const inv of rawInvoices) {
      const tipo = inv.origemTipo ?? classificarOrigem(inv.origem);
      if (tipo) set.add(tipo);
    }
    return set;
  }, [rawInvoices]);
  const temOrigem = origensDisponiveis.size > 0;

  const origemTotais = useMemo(() => {
    const tot: Partial<Record<OrigemReceita, number>> = {};
    for (const inv of rawInvoices) {
      const tipo = inv.origemTipo ?? classificarOrigem(inv.origem);
      if (!tipo) continue;
      tot[tipo] = (tot[tipo] ?? 0) + inv.valor;
    }
    return tot;
  }, [rawInvoices]);

  // Todas as abas ficam visíveis; as que não têm receita aparecem
  // desabilitadas. Esconder as vazias fazia a barra inteira sumir quando a
  // planilha não trazia a coluna "Origem", e não havia como saber que o
  // recorte existe nem por que ele não apareceu.
  const ORIGEM_TABS = ["all", "expositor", "ingresso"] as const;

  // formas de pagamento que realmente aparecem nos dados carregados — lista
  // fixa deixaria opções que nunca filtram nada.
  const formasDisponiveis = useMemo(
    () =>
      Array.from(new Set((data?.invoices ?? []).map((inv) => inv.forma).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [data]
  );

  const visibleInvoices = useMemo(() => {
    const term = tableSearch.trim();
    return (data?.invoices ?? []).filter((inv) => {
      if (tableStatus !== "all" && inv.status !== tableStatus) return false;
      if (tableForma !== "all" && inv.forma !== tableForma) return false;
      if (tableRange.de || tableRange.ate) {
        // "custom" com as duas pontas vazias não filtra; aqui uma ponta só já
        // vale como limite aberto, porque o intervalo é do próprio usuário.
        const alvo = inv.pagamento;
        const t = parseDateLoose(alvo);
        if (Number.isNaN(t)) return false;
        if (tableRange.de) {
          const de = parseDateLoose(tableRange.de);
          if (!Number.isNaN(de) && t < de) return false;
        }
        if (tableRange.ate) {
          const ate = parseDateLoose(tableRange.ate) + 24 * 60 * 60 * 1000 - 1;
          if (!Number.isNaN(ate) && t > ate) return false;
        }
      }
      if (term && !combina(term, [inv.cliente, inv.numero, inv.cnpj, inv.forma])) return false;
      return true;
    });
  }, [data, tableSearch, tableStatus, tableForma, tableRange]);

  const filtrosTabelaAtivos =
    tableStatus !== "all" || tableForma !== "all" || !!tableRange.de || !!tableRange.ate || !!tableSearch.trim();

  // total só faz sentido quando a busca recorta pra um cliente/duplicata
  // específico — na visão geral (sem busca) fica sem essa soma na tela.
  const visibleTotal = useMemo(() => visibleInvoices.reduce((s, inv) => s + inv.valor, 0), [visibleInvoices]);

  // A tabela mostra uma página por vez: renderizar 10 mil linhas de uma vez
  // enche o DOM de células e deixa toda a página lenta, mesmo com os dados já
  // carregados. Os KPIs e gráficos continuam somando a lista inteira.
  const LINHAS_POR_PAGINA = 100;
  const [pagina, setPagina] = useState(1);

  const [sortKey, setSortKey] = useState<keyof Invoice | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: keyof Invoice) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // "27/08/2026" (planilhas BR) ou "2026-08-27" (ISO) — tenta os dois formatos
  // pra ordenar datas de verdade em vez de comparar como texto.
  function parseDateLoose(v: string | null): number {
    if (!v) return NaN;
    const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
    const t = Date.parse(v);
    return Number.isNaN(t) ? NaN : t;
  }

  const sortedInvoices = useMemo(() => {
    if (!sortKey) return visibleInvoices;
    const dir = sortDir === "asc" ? 1 : -1;
    const isDateCol = sortKey === "pagamento";
    return [...visibleInvoices].sort((a, b) => {
      if (sortKey === "valor") return (a.valor - b.valor) * dir;
      if (isDateCol) {
        const av = parseDateLoose(a[sortKey] as string | null);
        const bv = parseDateLoose(b[sortKey] as string | null);
        if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
        if (Number.isNaN(av)) return 1; // sem data sempre por último
        if (Number.isNaN(bv)) return -1;
        return (av - bv) * dir;
      }
      return String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), "pt-BR") * dir;
    });
  }, [visibleInvoices, sortKey, sortDir]);

  const totalPaginas = Math.max(1, Math.ceil(visibleInvoices.length / LINHAS_POR_PAGINA));

  // Filtro novo devolve uma lista nova: continuar na página anterior mostraria
  // o meio do resultado e passava a impressão de que a busca não encontrou nada.
  const assinaturaFiltros = `${tableSearch}|${tableStatus}|${tableForma}|${tableRange.de}|${tableRange.ate}|${search}|${statusFilter}|${origem}|${method}|${period}|${contaFilter}`;
  const [filtrosAnteriores, setFiltrosAnteriores] = useState(assinaturaFiltros);
  if (filtrosAnteriores !== assinaturaFiltros) {
    // ajuste de estado durante o render, como o React recomenda para estado
    // derivado: mais direto que um efeito, e sem o render intermediário
    setFiltrosAnteriores(assinaturaFiltros);
    setPagina(1);
  }
  // filtro novo pode encolher a lista: sem o clamp, a tela ficaria numa página
  // que não existe mais e pareceria vazia.
  const paginaAtual = Math.min(pagina, totalPaginas);
  const linhasDaPagina = useMemo(
    () => sortedInvoices.slice((paginaAtual - 1) * LINHAS_POR_PAGINA, paginaAtual * LINHAS_POR_PAGINA),
    [sortedInvoices, paginaAtual]
  );

  /**
   * Colunas da tabela. Sem vencimento: quando a duplicata vence o ERP gera
   * outra no lugar, então a data antiga não descreve mais a cobrança em aberto
   * — a única data com significado aqui é a do pagamento.
   */
  const COLUNAS_TABELA = useMemo(() => {
    const defs: Array<{ key: keyof Invoice; label: string; cls: string }> = [
      { key: "numero", label: t("col.numero"), cls: "" },
      { key: "cliente", label: t("col.cliente"), cls: "" },
      { key: "cnpj", label: t("col.documento"), cls: "" },
      { key: "pagamento", label: t("col.pagamento"), cls: "" },
      { key: "forma", label: t("col.forma"), cls: "" },
      { key: "valor", label: t("col.valor"), cls: "num" },
      { key: "status", label: t("col.status"), cls: "" },
    ];
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importedFiles = Array.from(
    importedInvoices.reduce((map, inv) => {
      const key = inv.sourceFile ?? "";
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  );

  async function loadImported() {
    if (!editionId) return;
    const res = await fetch(`/api/financeiro/import?editionId=${editionId}`);
    if (res.ok) {
      const invoices: Invoice[] = await res.json();
      setImportedInvoices(invoices);
      setCached(`financeiro:${editionId}`, invoices);
      setLastUpdatedAt(res.headers.get("X-Last-Updated"));
    }
  }

  async function handleImported(invoices: Invoice[], fileName: string) {
    if (!editionId) {
      // sem edição selecionada não tem onde persistir — antes isso falhava
      // em silêncio (o modal fechava como se tivesse dado certo, mas nada
      // era salvo). Agora avisa antes de fazer qualquer coisa.
      notifyWarning("Selecione uma edição primeiro", "Escolha (ou crie) uma edição do evento antes de importar a planilha — sem isso não há onde salvar os dados.");
      return;
    }
    // otimista: mostra na hora e persiste em seguida. O cache é atualizado
    // fora do updater — efeito colateral ali dentro roda duas vezes em modo
    // de desenvolvimento e gravava o valor errado.
    const proximo = mergeImportedInvoices(importedInvoices, invoices, fileName);
    setImportedInvoices(proximo);
    setCached(`financeiro:${editionId}`, proximo);

    const r = await enviarImportEmLotes("/api/financeiro/import", editionId, fileName, "invoices", invoices);
    if (!r.ok) {
      // sem isto a tela seguiria mostrando dados que não foram gravados, e
      // tudo sumiria no próximo refresh
      loadImported();
      notifyError("Falha ao importar planilha", r.erro);
      return;
    }
    notifySuccess("Planilha importada", `${invoices.length.toLocaleString("pt-BR")} linha(s) de "${fileName}" foram salvas.`);
    // relê do banco: é o que garante que a tela mostra o que foi realmente gravado
    loadImported();
  }

  async function removeImportedFile(fileName: string) {
    if (!editionId) return;
    setImportedInvoices((prev) => {
      const next = prev.filter((inv) => inv.sourceFile !== fileName);
      setCached(`financeiro:${editionId}`, next);
      return next;
    });
    const res = await fetch(`/api/financeiro/import?editionId=${editionId}&sourceFile=${encodeURIComponent(fileName)}`, {
      method: "DELETE",
    });
    if (!res.ok) loadImported();
  }

  // No recorte de ingresso, ticket médio e nº de duplicatas dizem pouco: o que
  // interessa é quanto entrou e quantos ingressos saíram.
  const ing = origem === "ingresso" ? data?.ingressoStats ?? null : null;

  // Dias do evento com movimento registrado. Saem das duplicatas cruas (e não
  // do resultado já filtrado) para os botões não sumirem conforme o usuário
  // escolhe um dia.
  const diasDoEvento = useMemo(() => {
    const dias = new Set<string>();
    for (const inv of rawInvoices) {
      const d = inv.ingresso?.dataComparecimento?.trim();
      if (d) dias.add(d);
    }
    return Array.from(dias).sort((a, b) => parseDateLoose(a) - parseDateLoose(b));
  }, [rawInvoices]);
  /**
   * Em "Todos", a curva única soma os dias e esconde justamente o que
   * interessa: em qual dia e em qual hora deu fila. Esta matriz mostra cada
   * dia numa linha, com uma barra por hora — dá para comparar os dias na
   * vertical e as horas na horizontal de uma vez.
   */
  const matrizFluxo = useMemo(() => {
    const linhas = ing?.comparecimentoPorHora ?? [];
    if (!linhas.length) return null;

    const horas = Array.from(new Set(linhas.map((l) => l.hora))).sort((a, b) => a - b);
    const dias = Array.from(new Set(linhas.map((l) => l.dia)));
    const porDia = dias.map((dia) => {
      const doDia = linhas.filter((l) => l.dia === dia);
      const valores = horas.map((h) => doDia.find((l) => l.hora === h)?.pessoas ?? 0);
      const total = valores.reduce((acc, v) => acc + v, 0);
      const picoValor = Math.max(...valores);
      return { dia, valores, total, picoHora: horas[valores.indexOf(picoValor)], picoValor };
    });
    // a escala é comum a todos os dias: uma barra só é maior que a outra se o
    // movimento foi maior mesmo, e não porque o dia teve menos gente no total
    const maximo = Math.max(...porDia.flatMap((d) => d.valores), 1);
    return { horas, porDia, maximo };
  }, [ing]);

  /**
   * Cartões do recorte de ingressos, numa linha só.
   *
   * O valor em aberto aparece em "Todos" (onde é a informação que falta) e
   * substitui o total recebido quando o filtro é "Em aberto" — ali o recebido
   * é sempre zero por definição, e quem filtrou por em aberto quer ver quanto
   * falta entrar. Nos demais status ele sai de cena.
   */
  const KPI_DEFS_INGRESSO = [
    statusFilter === "pendente"
      ? { key: "valorEmAberto" as const, label: t("financeiro.kpi.emAberto"), fmt: money }
      : { key: "totalRecebido" as const, label: t("financeiro.kpi.total"), fmt: money },
    { key: "qtdIngressos" as const, label: t("financeiro.kpi.ingressos"), fmt: int },
    { key: "taxaComparecimento" as const, label: t("financeiro.kpi.comparecimento"), fmt: pct },
    ...(statusFilter === "all"
      ? [{ key: "valorEmAberto" as const, label: t("financeiro.kpi.emAberto"), fmt: money }]
      : []),
  ];

  // tipo explícito: os dois campos de ingresso não existem em FinanceiroData["kpis"],
  // e sem isso o KpiRow infere o tipo do objeto base e recusa as chaves novas
  const valoresIngresso: KpisIngresso | null = data
    ? { ...data.kpis, taxaComparecimento: ing?.taxaComparecimento ?? null, valorEmAberto: ing?.valorEmAberto ?? null }
    : null;


  const KPI_DEFS_PADRAO = [
    { key: "totalRecebido", label: t("financeiro.kpi.total"), fmt: money },
    { key: "ticketMedio", label: t("financeiro.kpi.ticket"), fmt: money },
    { key: "qtdDuplicatas", label: t("financeiro.kpi.duplicatas"), fmt: int },
  ] as const;


  const ORIGEM_LABEL: Record<string, string> = {
    all: t("financeiro.origem.all"),
    expositor: t("financeiro.origem.expositor"),
    ingresso: t("financeiro.origem.ingresso"),
  };

  const STATUS_LABEL: Record<string, string> = {
    pago: t("status.pago"),
    pendente: t("status.pendente"),
    cortesia: t("status.cortesia"),
    cancelado: t("status.cancelado"),
  };
  // cortesia usa a cor neutra do tema: não é receita nem cobrança em aberto
  const STATUS_CLASS: Record<string, string> = { cortesia: "cancelado" };

  async function load() {
    setConnState("pending");
    try {
      const result = await fetchFinanceiro({ eventId, editionId }, { period, origem, method, status: statusFilter, search });
      setApiData(result);
      setConnState(result ? "connected" : "pending");
    } catch (err) {
      console.error("Financeiro: falha ao carregar dados", err);
      setConnState("error");
    }
  }

  useEffect(() => {
    // mostra o que já se sabe dessa edição na hora (cache ou vazio) em vez de
    // sempre zerar — evita a "piscada" ao trocar de edição/voltar pra aba.
    setImportedInvoices(getCached<Invoice[]>(`financeiro:${editionId}`) ?? []);
    setTableSearch("");
    loadImported(); // revalida com o banco por baixo dos panos
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, editionId, period, method, origem]);

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t("financeiro.title")}</h1>
          <div className="sub">
            {event ? <b>{event.name}</b> : "…"} {edition ? `· ${edition.label}` : ""}
          </div>
        </div>
        <div className="actions">
          {canManageData && hasImported && !apiData && <span className="import-badge">dados de planilha importada</span>}
          {canManageData ? (
            <ConnChip state={connState} />
          ) : (
            lastUpdatedAt && <span className="last-updated-chip">atualizado {formatRelativeTime(lastUpdatedAt)}</span>
          )}
          {canManageData && !apiData && <SpreadsheetImportFinanceiro eventId={eventId} onImported={handleImported} />}
          {canManageData && (
            <button className="btn primary" type="button" onClick={load}>
              {t("common.sync")}
            </button>
          )}
        </div>
      </div>

      {contaFilter !== "all" && (
        <div className="conta-focus-banner">
          <span>
            Visão exclusiva da conta <strong>{contaFilter}</strong> — KPIs, gráficos e status abaixo consideram só as
            duplicatas dela.
          </span>
          <button className="btn" type="button" onClick={() => setContaFilter("all")}>
            ← Voltar para visão geral
          </button>
        </div>
      )}

      {canManageData && !apiData && importedFiles.length > 0 && (
        <div className="import-files-bar">
          <span>Arquivos importados:</span>
          {importedFiles.map(([name, count]) => (
            <span className="import-file-chip" key={name}>
              {name} ({count})
              <button type="button" onClick={() => removeImportedFile(name)} aria-label={`Remover ${name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="segbar" style={{ marginBottom: 10 }}>
        <div className="seg">
          {ORIGEM_TABS.map((v) => {
            const vazia = v !== "all" && !origensDisponiveis.has(v);
            return (
              <button
                key={v}
                className={origem === v ? "on" : ""}
                disabled={vazia}
                title={vazia ? "nenhuma duplicata desta origem nos dados carregados" : undefined}
                onClick={() => setOrigem(v)}
              >
                {ORIGEM_LABEL[v]}
                {v !== "all" && origemTotais[v] != null && (
                  <span style={{ opacity: 0.6, marginLeft: 6 }}>{money(origemTotais[v]!)}</span>
                )}
              </button>
            );
          })}
        </div>
        {!temOrigem && hasImported && (
          <span style={{ fontSize: 11.5, color: "var(--ink-mute)", alignSelf: "center" }}>
            as planilhas carregadas não têm a coluna &quot;Origem&quot; — reimporte para separar por origem
          </span>
        )}
      </div>

      <div className="segbar">
        <div className="seg">
          {(["all", "30d", "7d", "custom"] as const).map((v) => (
            <button key={v} className={period === v ? "on" : ""} onClick={() => setPeriod(v)}>
              {{ all: t("common.all"), "30d": t("common.last30"), "7d": t("common.last7"), custom: t("common.custom") }[v]}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["all", "boleto", "cartao", "pix"] as const).map((v) => (
            <button key={v} className={method === v ? "on" : ""} onClick={() => setMethod(v)}>
              {{ all: t("common.allMethods"), boleto: t("common.boleto"), cartao: t("common.cartao"), pix: t("common.pix") }[v]}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["all", "pago", "pendente", "cortesia", "cancelado"] as const).map((v) => (
            <button key={v} className={statusFilter === v ? "on" : ""} onClick={() => setStatusFilter(v)}>
              {v === "all" ? t("common.allStatus") : STATUS_LABEL[v]}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="date-range">
            <input
              type="date"
              className="input"
              value={customRange.de}
              max={customRange.ate || undefined}
              onChange={(e) => setCustomRange((r) => ({ ...r, de: e.target.value }))}
              aria-label="Data inicial"
            />
            <span>até</span>
            <input
              type="date"
              className="input"
              value={customRange.ate}
              min={customRange.de || undefined}
              onChange={(e) => setCustomRange((r) => ({ ...r, ate: e.target.value }))}
              aria-label="Data final"
            />
            {(customRange.de || customRange.ate) && (
              <button className="btn" type="button" onClick={() => setCustomRange({ de: "", ate: "" })}>
                Limpar
              </button>
            )}
          </div>
        )}
        <div className="search">
          <input type="text" placeholder={t("financeiro.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {ing ? (
        <KpiRow<KpisIngresso> defs={KPI_DEFS_INGRESSO} values={valoresIngresso} />
      ) : (
        <KpiRow defs={KPI_DEFS_PADRAO} values={data?.kpis} />
      )}

      {ing && diasDoEvento.length > 0 && (
        <div className="segbar" style={{ marginBottom: 12 }}>
          <div className="seg">
            <button className={diaEvento === "todos" ? "on" : ""} type="button" onClick={() => setDiaEvento("todos")}>
              Todos
            </button>
            {diasDoEvento.map((d) => (
              <button key={d} className={diaEvento === d ? "on" : ""} type="button" onClick={() => setDiaEvento(d)}>
                {d.slice(0, 5)}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--ink-mute)", alignSelf: "center" }}>
            {diaEvento === "todos"
              ? "dia do evento — recorta cartões, painéis e tabela"
              : `mostrando só quem passou no credenciamento em ${diaEvento}`}
          </span>
        </div>
      )}

      {ing && (
        <>
          <div className="panels panels-ingresso">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3>Comparecimento por situação de pagamento</h3>
                  <p>quem pagou aparece mais do que quem ganhou cortesia?</p>
                </div>
              </div>
              {!ing.comparecimentoPorStatus.length ? (
                <Empty
                  glyph="⌸"
                  title="sem dado de comparecimento"
                  desc="mapeie a coluna 'Compareceu' no import para ver esta leitura"
                />
              ) : (
                <div className="statusbars-row">
                  {ing.comparecimentoPorStatus.map((c) => {
                    const total = c.compareceu + c.faltou;
                    const taxa = total ? (c.compareceu / total) * 100 : 0;
                    return (
                      <div className="statusbars-cell" key={c.status}>
                        <span className={`badge ${STATUS_CLASS[c.status] ?? c.status}`}>
                          <span className="dot" />
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                        <strong className="statusbars-value">{taxa.toFixed(1)}%</strong>
                        <span className="barlist-track">
                          <span className="barlist-fill" style={{ width: `${taxa}%`, background: "var(--good)" }} />
                        </span>
                        <span className="statusbars-pct">
                          {c.compareceu.toLocaleString("pt-BR")} vieram · {c.faltou.toLocaleString("pt-BR")} faltaram
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {publicoPorDia.length > 0 && (
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Público por dia do evento</h3>
                    <p>
                      {diaEvento === "todos"
                        ? "quantos passaram pelo credenciamento em cada dia"
                        : "todos os dias, para comparar com o selecionado"}
                    </p>
                  </div>
                </div>
                {/* em ordem de data, não de volume: a leitura aqui é a
                    sequência dos dias do evento. Clicar no dia recorta a seção. */}
                <BarList
                  data={publicoPorDia}
                  valueFmt={(v) => v.toLocaleString("pt-BR")}
                  selected={diaEvento === "todos" ? "" : diaEvento}
                  onSelect={(nome) => setDiaEvento((atual) => (atual === nome ? "todos" : nome))}
                />
              </div>
            )}

            {ing.comparecimentoPorHora.length > 0 && (
              <div className="panel panel-largo">
                <div className="panel-head">
                  <div>
                    <h3>Fluxo de credenciamento</h3>
                    <p>
                      {diaEvento === "todos"
                        ? "cada dia numa linha, uma barra por hora — clique no dia para recortar a seção"
                        : `pessoas por hora em ${diaEvento}`}
                    </p>
                  </div>
                </div>
                {matrizFluxo ? (
                  <div
                    className={`fluxo-matriz scroll-slim ${matrizFluxo.porDia.length === 1 ? "fluxo-matriz-dia" : ""}`}
                    style={{ ["--horas" as string]: matrizFluxo.horas.length }}
                  >
                    <div className="fluxo-linha fluxo-cabecalho">
                      <span className="fluxo-dia" />
                      {matrizFluxo.horas.map((h) => (
                        <span className="fluxo-hora-rotulo" key={h}>
                          {String(h).padStart(2, "0")}
                        </span>
                      ))}
                      <span className="fluxo-total">total</span>
                    </div>
                    {matrizFluxo.porDia.map((d) => (
                      <div className="fluxo-linha" key={d.dia}>
                        <button
                          className="fluxo-dia"
                          type="button"
                          onClick={() => setDiaEvento(d.dia)}
                          title={`Ver só ${d.dia}`}
                        >
                          {d.dia.slice(0, 5)}
                        </button>
                        {d.valores.map((v, i) => (
                          <span
                            className="fluxo-celula"
                            key={matrizFluxo.horas[i]}
                            title={`${d.dia} às ${String(matrizFluxo.horas[i]).padStart(2, "0")}h — ${v.toLocaleString(
                              "pt-BR"
                            )} pessoa(s)`}
                          >
                            {/* com um dia só há espaço para o número; com
                                vários, ele viraria poluição sobre barras baixas */}
                            <em className="fluxo-valor">{v > 0 ? v.toLocaleString("pt-BR") : ""}</em>
                            <span
                              className={`fluxo-barra ${v === d.picoValor && v > 0 ? "fluxo-pico" : ""}`}
                              style={{ height: `${Math.max(v > 0 ? 6 : 0, (v / matrizFluxo.maximo) * 100)}%` }}
                            />
                          </span>
                        ))}
                        <span className="fluxo-total">
                          {d.total.toLocaleString("pt-BR")}
                          <em>
                            pico {String(d.picoHora).padStart(2, "0")}h · {d.picoValor.toLocaleString("pt-BR")}
                          </em>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty glyph="⌁" title="sem horário registrado" desc="a planilha não trouxe a hora do comparecimento" />
                )}
              </div>
            )}
          </div>

          <div className="panels-rankings">
            {/* "stacked" só na origem do convite, onde o nome passa de 40 caracteres */}
            <PainelRanking
              titulo="Origem do convite"
              abas={[
                {
                  id: "convite",
                  desc: "de qual lote/patrocinador veio cada ingresso",
                  dados: ing.convites,
                  layout: "stacked",
                },
              ]}
            />
            <PainelRanking titulo="Categoria" abas={[{ id: "categoria", desc: "tipo de ingresso emitido", dados: ing.categorias }]} />
            <PainelRanking titulo="Cargo" abas={[{ id: "cargo", desc: "quem é o público que se inscreveu", dados: ing.cargos }]} />
            <PainelRanking titulo="Segmento" abas={[{ id: "segmento", desc: "área de atuação declarada", dados: ing.segmentos }]} />
            <PainelRanking
              titulo="Origem geográfica"
              abas={[
                { id: "estado", aba: "Estado", desc: "de qual estado veio o público (siglas agrupadas)", dados: ing.estados },
                { id: "pais", aba: "País", desc: "de qual país veio o público", dados: ing.paises },
                {
                  id: "ambos",
                  aba: "Ambos",
                  desc: "estado e país no mesmo painel",
                  grupos: [
                    { titulo: "Estado", dados: ing.estados },
                    { titulo: "País", dados: ing.paises },
                  ],
                },
              ]}
            />
          </div>

          {ing.documentosRepetidos > 0 && (
            <div className="import-files-bar" style={{ marginBottom: 12 }}>
              <span>
                {ing.documentosDistintos.toLocaleString("pt-BR")} documentos distintos ·{" "}
                <strong>{ing.documentosRepetidos.toLocaleString("pt-BR")}</strong> aparecem em mais de um ingresso — pode
                ser a mesma pessoa com vários ingressos ou cadastro duplicado.
              </span>
            </div>
          )}
        </>
      )}

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("financeiro.timeline.title")}</h3>
              <p>{t("financeiro.timeline.desc")}</p>
            </div>
            <div className="legend">
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: "var(--accent)" }} />
                {t("status.pago").toLowerCase()}
              </span>
            </div>
          </div>
          {!data?.timeline.length ? (
            <Empty glyph="⌁" title={t("financeiro.timeline.empty.title")} desc={t("financeiro.timeline.empty.desc")} />
          ) : (
            <LineChart data={data.timeline} series={[{ key: "recebido", color: "var(--accent)" }]} />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("financeiro.donut.title")}</h3>
              <p>{t("financeiro.donut.desc")}</p>
            </div>
            <div className="seg">
              <button className={donutVariant === "full" ? "on" : ""} type="button" onClick={() => setDonutVariant("full")}>
                Completo
              </button>
              <button className={donutVariant === "half" ? "on" : ""} type="button" onClick={() => setDonutVariant("half")}>
                Meio círculo
              </button>
            </div>
          </div>
          {!data?.paymentMethods.length ? (
            <div className="donut-wrap">
              <svg className="donut-svg" viewBox="0 0 144 144" aria-hidden="true">
                <circle cx="72" cy="72" r="56" fill="none" stroke="var(--line)" strokeWidth="18" strokeDasharray="4 6" />
              </svg>
              <div className="donut-legend">
                {[
                  { label: t("common.boleto"), color: "var(--accent)" },
                  { label: t("common.cartao"), color: "var(--amber)" },
                  { label: t("common.pix"), color: "var(--teal)" },
                ].map((r) => (
                  <div className="status-row" style={{ border: "none", padding: 0 }} key={r.label}>
                    <span className="status-left">
                      <span className="legend-swatch" style={{ background: r.color, height: 8, width: 8, borderRadius: 2 }} />
                      {r.label}
                    </span>
                    <span className="status-val">—</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Donut data={data.paymentMethods} variant={donutVariant} />
          )}
        </div>
      </div>

      <div className="panels-3">
        {/* Em ingresso cada linha é um participante, não um expositor — um
            "top" de compradores individuais não diz nada sobre o evento. */}
        {origem !== "ingresso" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>{t("financeiro.ranking.title")}</h3>
                <p>{t("financeiro.ranking.desc")}</p>
              </div>
            </div>
            {!data?.topClients.length ? (
              <Empty glyph="▤" title={t("financeiro.ranking.empty.title")} desc={t("financeiro.ranking.empty.desc")} />
            ) : (
              <BarList
                data={data.topClients}
                selected={search}
                onSelect={(name) => setSearch((prev) => (prev === name ? "" : name))}
              />
            )}
          </div>
        )}

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("financeiro.status.title")}</h3>
              <p>{t("financeiro.status.desc")}</p>
            </div>
          </div>
          {!data?.statusBreakdown.length ? (
            <>
              {(["pago", "pendente", "cortesia", "cancelado"] as const).map((s) => (
                <div className="status-row" key={s}>
                  <span className="status-left">
                    <span className={`badge ${STATUS_CLASS[s] ?? s}`}>
                      <span className="dot" />
                      {STATUS_LABEL[s]}
                    </span>
                  </span>
                  <span className="status-val">—</span>
                </div>
              ))}
            </>
          ) : (
            <StatusBars
              data={data.statusBreakdown}
              labels={STATUS_LABEL}
              classMap={STATUS_CLASS}
              // em ingresso são poucos status e a leitura é de proporção
              // (quanto é cortesia, quanto foi pago) — lado a lado compara melhor
              layout={origem === "ingresso" ? "row" : "list"}
            />
          )}
        </div>
      </div>

      {!!data?.contas.length && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-head">
            <div>
              <h3>Por conta / centro de custo</h3>
              <p>quanto passa por cada conta do rateio importado da planilha</p>
            </div>
        {contaOptions.length > 0 && (
          <select className="input" value={contaFilter} onChange={(e) => setContaFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="all">Todas as contas</option>
            {contaOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
          </div>
          <BarList
            data={data.contas}
            layout="stacked"
            selected={contaFilter === "all" ? "" : contaFilter}
            onSelect={(name) => setContaFilter((prev) => (prev === name ? "all" : name))}
          />
        </div>
      )}

      <div className="table-wrap">
        <div className="panel-head" style={{ padding: "16px 16px 0" }}>
          <div>
            <h3>{t("financeiro.table.title")}</h3>
            <p>{t("financeiro.table.desc")}</p>
          </div>
          {/* busca e filtros na mesma linha: são todos recortes da lista
              abaixo, e separá-los em duas faixas sugeria escopos diferentes. */}
          <div className="table-tools">
            <div className="search">
              <input
                type="text"
                placeholder="Buscar cliente ou nº da duplicata"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
            </div>

            <span className="table-tools-sep">{t("col.pagamento")}</span>
            <input
              type="date"
              className="field"
              value={tableRange.de}
              max={tableRange.ate || undefined}
              onChange={(e) => setTableRange((r) => ({ ...r, de: e.target.value }))}
              aria-label="Data inicial"
            />
            <span className="table-tools-sep">até</span>
            <input
              type="date"
              className="field"
              value={tableRange.ate}
              min={tableRange.de || undefined}
              onChange={(e) => setTableRange((r) => ({ ...r, ate: e.target.value }))}
              aria-label="Data final"
            />

            <select
              className="field"
              value={tableStatus}
              onChange={(e) => setTableStatus(e.target.value as "all" | InvoiceStatus)}
              aria-label="Status"
            >
              <option value="all">{t("common.allStatus")}</option>
              {(["pago", "pendente", "cortesia", "cancelado"] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>

            {formasDisponiveis.length > 0 && (
              <select
                className="field"
                value={tableForma}
                onChange={(e) => setTableForma(e.target.value)}
                aria-label="Forma de pagamento"
              >
                <option value="all">{t("common.allMethods")}</option>
                {formasDisponiveis.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}

            {filtrosTabelaAtivos && (
              <button
                className="field field-btn"
                type="button"
                onClick={() => {
                  setTableStatus("all");
                  setTableForma("all");
                  setTableRange({ de: "", ate: "" });
                  setTableSearch("");
                }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="table-scroll scroll-slim">
          <table>
            <thead>
              <tr>
                {COLUNAS_TABELA.map(({ key, label, cls }) => (
                  <th key={key} className={cls}>
                    <button className="th-sort" type="button" onClick={() => toggleSort(key)}>
                      {label}
                      <span className="th-sort-arrow">{sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data?.invoices.length ? (
                <EmptyTableRow colSpan={COLUNAS_TABELA.length} title={t("financeiro.table.empty.title")} desc={t("financeiro.table.empty.desc")} />
              ) : !visibleInvoices.length ? (
                <EmptyTableRow
                  colSpan={COLUNAS_TABELA.length}
                  title="nenhuma duplicata encontrada"
                  desc={
                    tableSearch.trim()
                      ? `nenhum resultado para "${tableSearch}" entre as ${data.invoices.length.toLocaleString(
                          "pt-BR"
                        )} duplicatas que passaram pelos filtros do topo`
                      : "nenhuma duplicata atende aos filtros da tabela"
                  }
                />
              ) : (
                linhasDaPagina.map((inv, i) => (
                  // `numero` identifica a duplicata, não a linha — uma duplicata rateada
                  // em várias rubricas gera várias linhas com o mesmo número, então o
                  // índice entra na key só pra garantir unicidade de renderização.
                  <tr key={`${inv.numero}-${i}`}>
                    {COLUNAS_TABELA.map(({ key, cls }) => {
                      if (key === "status") {
                        return (
                          <td key={key}>
                            <span className={`badge ${STATUS_CLASS[inv.status] ?? inv.status}`}>
                              <span className="dot" />
                              {STATUS_LABEL[inv.status] || inv.status}
                            </span>
                          </td>
                        );
                      }
                      if (key === "cliente") {
                        return (
                          <td key={key} style={{ fontFamily: "var(--sans)", color: "var(--ink)" }}>
                            {inv.cliente}
                          </td>
                        );
                      }
                      if (key === "valor") {
                        return (
                          <td key={key} className={cls}>
                            {money(inv.valor)}
                          </td>
                        );
                      }
                      const v = inv[key];
                      return (
                        <td key={key} className={cls}>
                          {v === null || v === undefined || v === "" ? "—" : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            {!visibleInvoices.length
              ? t("financeiro.table.countZero")
              : filtrosTabelaAtivos
              ? `${visibleInvoices.length.toLocaleString("pt-BR")} de ${data!.invoices.length.toLocaleString("pt-BR")} ${t("financeiro.table.count")}`
              : `${visibleInvoices.length.toLocaleString("pt-BR")} ${t("financeiro.table.count")}`}
          </span>
          <span className="pager">
            {filtrosTabelaAtivos && visibleInvoices.length > 0 && (
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>Total: {money(visibleTotal)}</span>
            )}
            {totalPaginas > 1 && (
              <>
                <button className="field field-btn" type="button" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>
                  ‹
                </button>
                <span>
                  {paginaAtual} / {totalPaginas}
                </span>
                <button
                  className="field field-btn"
                  type="button"
                  disabled={paginaAtual >= totalPaginas}
                  onClick={() => setPagina(paginaAtual + 1)}
                >
                  ›
                </button>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="footnote">{t("financeiro.footnote")}</div>
    </>
  );
}
