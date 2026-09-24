"use client";

import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  fetchOperacional,
  type OperacionalData,
  type OperacionalFilters,
  type PedidoServico,
  type ServicoStatus,
  type ExpositorBase,
} from "@/lib/dataSource";
import { ConnChip, Empty, EmptyTableRow, KpiRow, int, money, pct } from "@/components/ui";
import { SpreadsheetImportOperacional, SpreadsheetImportExpositores } from "@/components/SpreadsheetImport";
import {
  aggregateOperacional,
  mergeImportedPedidos,
  nomeArquivoCurto,
  tipoEstandeAgrupado,
} from "@/lib/spreadsheetImport";
import { Donut, BarList, StatusBars, PALETTE } from "@/components/charts";
import { getCached, setCached } from "@/lib/pageCache";
import { combina } from "@/lib/busca";
import { enviarImportEmLotes } from "@/lib/importClient";
import { formatRelativeTime, parseDateLoose } from "@/lib/period";
import { sugerir } from "@/lib/fuzzy";
import { notifySuccess, notifyWarning, notifyError } from "@/lib/swal";
import { exportarPlanilha } from "@/lib/exportar";

// quantos expositores o ranking mostra antes de pedir "ver todos"
const RANKING_VISIVEL = 10;

export default function OperacionalPage() {
  const { eventId, editionId, event, edition } = useEvent();
  const { t } = useI18n();
  const { canManageData } = useAuth();
  // não há filtro de período aqui: quando as planilhas trazem data, é a data
  // futura de operação no evento — recortar por "últimos 30 dias" não diria
  // nada. O que se acompanha é quantidade × dias por expositor.
  const [servico, setServico] = useState<OperacionalFilters["servico"]>("all");
  const [statusFilter, setStatusFilter] = useState<OperacionalFilters["status"]>("all");
  const [donutVariant, setDonutVariant] = useState<"full" | "half">("full");
  // o ranking mostra os 10 primeiros; o resto abre sob demanda
  const [verTodosExpositores, setVerTodosExpositores] = useState(false);
  // busca da lista de quem não contratou — a lista é operacional, para achar
  // um expositor específico e cobrá-lo
  const [buscaSemContratacao, setBuscaSemContratacao] = useState("");
  // busca só do ranking, liberada junto com o "ver todos" — serve para achar um
  // expositor fora do top sem mexer nos filtros da tela inteira
  const [buscaRanking, setBuscaRanking] = useState("");
  // opcional — só faz sentido quando a planilha importada traz a coluna de tipo/montagem.
  const [tipoFilter, setTipoFilter] = useState("all");
  // clicar num equipamento recorta a tela para ele
  const [equipamentoFiltro, setEquipamentoFiltro] = useState("all");
  const [search, setSearch] = useState("");
  // busca específica da tabela de pedidos — filtra só a lista abaixo, sem
  // recalcular KPIs/gráficos (diferente da busca geral, que filtra tudo).
  const [tableSearch, setTableSearch] = useState("");
  // Filtros próprios da tabela: recortam a lista sem mexer nos KPIs e
  // gráficos, que continuam respondendo aos filtros do topo.
  const [tableRange, setTableRange] = useState({ de: "", ate: "" });
  const [tableStatus, setTableStatus] = useState<"all" | ServicoStatus>("all");
  const [tableTurno, setTableTurno] = useState("all");
  /**
   * Busca adiada: digitar refiltra milhares de linhas e refaz a agregação a
   * cada tecla. Com useDeferredValue o campo responde na hora e o recálculo
   * acontece com a última letra digitada, sem travar a digitação.
   */
  const buscaAplicada = useDeferredValue(search);
  const tableSearchAplicada = useDeferredValue(tableSearch);

  const [connState, setConnState] = useState<"pending" | "connected" | "error">("pending");
  const [apiData, setApiData] = useState<OperacionalData | null>(null);
  // quando veio a última atualização de dados (import de planilha) — é o que
  // o usuário comum vê no lugar do chip técnico de conexão com a API.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  // lê o último resultado conhecido pra essa edição na hora — evita a tela
  // "piscar" vazia sempre que você sai da aba e volta; loadImported() abaixo
  // ainda busca a versão atual por baixo dos panos.
  const [importedPedidos, setImportedPedidos] = useState<PedidoServico[]>(
    () => getCached(`operacional:${editionId}`) ?? []
  );
  const hasImported = importedPedidos.length > 0;

  // Listagem geral de expositores da edição: é o denominador do "137 de 210".
  // Vem de uma planilha própria, então pode não existir — nesse caso o KPI
  // mostra só quantos contrataram.
  const [expositoresBase, setExpositoresBase] = useState<ExpositorBase[]>(
    () => getCached(`operacional-expositores:${editionId}`) ?? []
  );

  // fonte bruta de pedidos, venha de onde vier — o filtro de status/busca roda
  // por cima dela e os gráficos/tabela são recalculados a partir do resultado
  // filtrado, então os filtros afetam tudo, não só a tabela.
  const rawPedidos = apiData?.pedidos ?? importedPedidos;

  const servicoOptions = useMemo(
    () =>
      Array.from(new Set(rawPedidos.map((p) => p.servico).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rawPedidos]
  );

  // só existem quando a planilha importada mapeou a coluna de tipo/montagem —
  // por isso esse filtro só aparece na tela quando a lista não é vazia.
  const tipoOptions = useMemo(
    () =>
      Array.from(new Set(rawPedidos.map((p) => tipoEstandeAgrupado(p.tipoEstande)).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [rawPedidos]
  );

  // nomes que a busca geral oferece enquanto se digita — expositor (razão
  // social e fantasia), estande e serviço, que é por onde se procura na prática.
  const sugestoes = useMemo(() => {
    if (buscaAplicada.trim().length < 2) return [];
    const nomes = new Set<string>();
    for (const p of rawPedidos) {
      if (p.expositor) nomes.add(p.expositor);
      if (p.nomeFantasia) nomes.add(p.nomeFantasia);
      if (p.estande) nomes.add(p.estande);
      if (p.servico) nomes.add(p.servico);
    }
    return sugerir(buscaAplicada, Array.from(nomes));
  }, [rawPedidos, buscaAplicada]);

  const filteredPedidos = useMemo(() => {
    const term = buscaAplicada.trim();
    return rawPedidos.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (servico !== "all" && p.servico !== servico) return false;
      if (tipoFilter !== "all" && tipoEstandeAgrupado(p.tipoEstande) !== tipoFilter) return false;
      if (equipamentoFiltro !== "all" && tipoEstandeAgrupado(p.equipamento) !== equipamentoFiltro) return false;
      if (term && !combina(term, [p.expositor, p.nomeFantasia, p.cnpj, p.estande, p.turno, p.servico])) return false;
      return true;
    });
  }, [rawPedidos, statusFilter, servico, tipoFilter, equipamentoFiltro, buscaAplicada]);

  // memoizado pelo mesmo motivo do financeiro: a agregação roda em cima da
  // lista inteira e não pode ser refeita a cada render.
  const data = useMemo(
    () => (apiData || hasImported ? aggregateOperacional(filteredPedidos, expositoresBase) : null),
    [apiData, hasImported, filteredPedidos, expositoresBase]
  );

  // usados no KPI e no painel de quem não contratou
  const totalExpositoresBase = data?.kpis.qtdExpositoresBase ?? null;
  const semContratacao = data?.expositoresSemContratacao ?? [];

  // turnos presentes nos dados — lista fixa deixaria opção que nunca filtra nada
  const turnosDisponiveis = useMemo(
    () =>
      Array.from(new Set((data?.pedidos ?? []).map((p) => p.turno).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [data]
  );

  const visiblePedidos = useMemo(() => {
    const term = tableSearchAplicada.trim();
    return (data?.pedidos ?? []).filter((p) => {
      if (tableStatus !== "all" && p.status !== tableStatus) return false;
      if (tableTurno !== "all" && p.turno !== tableTurno) return false;
      if (tableRange.de || tableRange.ate) {
        // uma ponta só do intervalo já vale como limite aberto
        const alvo = p.dataInicio;
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
      if (term && !combina(term, [p.expositor, p.nomeFantasia, p.estande, p.cnpj, p.servico, p.turno])) return false;
      return true;
    });
  }, [data, tableSearchAplicada, tableStatus, tableTurno, tableRange]);

  const filtrosTabelaAtivos =
    tableStatus !== "all" || tableTurno !== "all" || !!tableRange.de || !!tableRange.ate || !!tableSearch.trim();

  // total só faz sentido quando a busca recorta pra um expositor/estande
  // específico — na visão geral (sem busca) fica sem essa soma na tela.
  const visibleTotal = useMemo(() => visiblePedidos.reduce((s, p) => s + p.quantidade, 0), [visiblePedidos]);

  // A tabela cresce por "mostrar mais" em vez de páginas numeradas: com
  // milhares de linhas, "página 7 de 48" não diz nada a quem só quer achar um
  // expositor — e obriga a decorar em que página estava.
  const LINHAS_POR_VEZ = 50;
  const [linhasVisiveis, setLinhasVisiveis] = useState(LINHAS_POR_VEZ);

  const [sortKey, setSortKey] = useState<keyof PedidoServico | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: keyof PedidoServico) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedPedidos = useMemo(() => {
    if (!sortKey) return visiblePedidos;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...visiblePedidos].sort((a, b) => {
      if (sortKey === "quantidade") return (a.quantidade - b.quantidade) * dir;
      // "03/09/2026" ordenado como texto ficaria fora de ordem entre meses.
      if (sortKey === "dataInicio" || sortKey === "dataFim") {
        const av = parseDateLoose(a[sortKey]);
        const bv = parseDateLoose(b[sortKey]);
        if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
        if (Number.isNaN(av)) return 1; // sem data sempre por último
        if (Number.isNaN(bv)) return -1;
        return (av - bv) * dir;
      }
      // sem nº de dias vai pro fim da lista, independente da direção — "—" não
      // tem ordem natural entre valores numéricos.
      if (sortKey === "dias") {
        if (a.dias == null && b.dias == null) return 0;
        if (a.dias == null) return 1;
        if (b.dias == null) return -1;
        return (a.dias - b.dias) * dir;
      }
      return String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), "pt-BR") * dir;
    });
  }, [visiblePedidos, sortKey, sortDir]);

  // Cada serviço tem uma planilha diferente: recepcionista traz quantidade e
  // dias, outra traz data/hora, outra só turno. Em vez de exibir um mar de "—",
  // a tabela só mostra as colunas que têm valor nos pedidos carregados (as
  // quatro primeiras e o status são fixas — sempre existem).
  const COLUMNS = useMemo(() => {
    const list = data?.pedidos ?? [];
    const has = (get: (p: PedidoServico) => string | number | null) =>
      list.some((p) => {
        const v = get(p);
        return v !== null && v !== "" && v !== undefined;
      });
    const defs: Array<{
      key: keyof PedidoServico;
      label: string;
      cls: string;
      show: boolean;
      /** quando a célula não mostra o valor cru do campo (ex.: tipo agrupado) */
      format?: (p: PedidoServico) => string;
    }> = [
      { key: "servico", label: t("col.servico"), cls: "", show: true },
      { key: "expositor", label: t("col.expositor"), cls: "", show: true },
      { key: "nomeFantasia", label: t("col.nomeFantasia"), cls: "", show: has((p) => p.nomeFantasia) },
      { key: "cnpj", label: t("col.cnpj"), cls: "", show: has((p) => p.cnpj) },
      { key: "estande", label: t("col.estande"), cls: "", show: has((p) => p.estande) },
      { key: "localizacao", label: t("col.localizacao"), cls: "", show: has((p) => p.localizacao) },
      {
        key: "tipoEstande",
        label: t("col.tipoEstande"),
        cls: "",
        show: has((p) => p.tipoEstande),
        format: (p: PedidoServico) => tipoEstandeAgrupado(p.tipoEstande),
      },
      { key: "equipamento", label: "Equipamento", cls: "", show: has((p) => p.equipamento) },
      { key: "tipo", label: "Tipo", cls: "", show: has((p) => p.tipo) },
      { key: "dataInicio", label: t("col.dataInicio"), cls: "", show: has((p) => p.dataInicio) },
      { key: "dataFim", label: t("col.dataFim"), cls: "", show: has((p) => p.dataFim) },
      { key: "horaInicio", label: t("col.horaInicio"), cls: "", show: has((p) => p.horaInicio) },
      { key: "horaFim", label: t("col.horaFim"), cls: "", show: has((p) => p.horaFim) },
      { key: "turno", label: t("col.turno"), cls: "", show: has((p) => p.turno) },
      { key: "quantidade", label: t("col.quantidade"), cls: "num", show: true },
      {
        key: "valor",
        label: t("col.valor"),
        cls: "num",
        show: has((p) => p.valor),
        format: (p: PedidoServico) => (p.valor == null ? "—" : money(p.valor)),
      },
      {
        key: "kva",
        label: "kVA",
        cls: "num",
        show: has((p) => p.kva),
        format: (p: PedidoServico) => (p.kva == null ? "—" : p.kva.toLocaleString("pt-BR")),
      },
      {
        key: "area",
        label: "Área (m²)",
        cls: "num",
        show: has((p) => p.area),
        format: (p: PedidoServico) => (p.area == null ? "—" : p.area.toLocaleString("pt-BR")),
      },
      { key: "dias", label: t("col.dias"), cls: "num", show: has((p) => p.dias) },
      { key: "status", label: t("col.status"), cls: "", show: true },
    ];
    return defs.filter((d) => d.show);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // filtro novo devolve lista nova: continuar com a lista esticada do filtro
  // anterior faria a tela abrir no meio do resultado
  const assinaturaFiltros = `${tableSearchAplicada}|${tableStatus}|${tableTurno}|${tableRange.de}|${tableRange.ate}|${buscaAplicada}|${statusFilter}|${servico}|${tipoFilter}|${equipamentoFiltro}`;
  const [filtrosAnteriores, setFiltrosAnteriores] = useState(assinaturaFiltros);
  if (filtrosAnteriores !== assinaturaFiltros) {
    setFiltrosAnteriores(assinaturaFiltros);
    setLinhasVisiveis(LINHAS_POR_VEZ);
  }
  const linhasDaPagina = useMemo(
    () => sortedPedidos.slice(0, linhasVisiveis),
    [sortedPedidos, linhasVisiveis]
  );
  const faltamLinhas = Math.max(0, visiblePedidos.length - linhasDaPagina.length);

  const importedFiles = Array.from(
    importedPedidos.reduce((map, p) => {
      const key = p.sourceFile ?? "";
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  );

  async function loadImported() {
    if (!editionId) return;
    const res = await fetch(`/api/operacional/import?editionId=${editionId}`);
    if (res.ok) {
      const pedidos: PedidoServico[] = await res.json();
      setImportedPedidos(pedidos);
      setCached(`operacional:${editionId}`, pedidos);
      setLastUpdatedAt(res.headers.get("X-Last-Updated"));
    }
  }

  async function loadExpositores() {
    if (!editionId) return;
    const res = await fetch(`/api/operacional/expositores?editionId=${editionId}`);
    if (res.ok) {
      const lista: ExpositorBase[] = await res.json();
      setExpositoresBase(lista);
      setCached(`operacional-expositores:${editionId}`, lista);
    }
  }

  async function handleExpositoresImportados(lista: ExpositorBase[], fileName: string) {
    if (!editionId) {
      notifyWarning(
        "Selecione uma edição primeiro",
        "Escolha (ou crie) uma edição do evento antes de importar a listagem — sem isso não há onde salvar."
      );
      return;
    }
    setExpositoresBase(lista);
    setCached(`operacional-expositores:${editionId}`, lista);

    const r = await enviarImportEmLotes("/api/operacional/expositores", editionId, fileName, "expositores", lista);
    if (!r.ok) {
      loadExpositores();
      notifyError("Falha ao importar a listagem", r.erro);
      return;
    }
    notifySuccess(
      "Listagem de expositores importada",
      `${lista.length.toLocaleString("pt-BR")} expositor(es) de "${fileName}" agora servem de base para comparar quem contratou.`
    );
    loadExpositores();
  }

  async function removerListagemExpositores() {
    if (!editionId) return;
    setExpositoresBase([]);
    setCached(`operacional-expositores:${editionId}`, []);
    const res = await fetch(`/api/operacional/expositores?editionId=${editionId}`, { method: "DELETE" });
    if (!res.ok) loadExpositores();
  }

  async function handleImported(pedidos: PedidoServico[], fileName: string) {
    if (!editionId) {
      // sem edição selecionada não tem onde persistir — avisa antes de fazer
      // qualquer coisa, senão o modal fecharia como se tivesse dado certo.
      notifyWarning("Selecione uma edição primeiro", "Escolha (ou crie) uma edição do evento antes de importar a planilha — sem isso não há onde salvar os dados.");
      return;
    }
    const proximo = mergeImportedPedidos(importedPedidos, pedidos, fileName);
    setImportedPedidos(proximo);
    setCached(`operacional:${editionId}`, proximo);

    const r = await enviarImportEmLotes("/api/operacional/import", editionId, fileName, "pedidos", pedidos);
    if (!r.ok) {
      loadImported();
      notifyError("Falha ao importar planilha", r.erro);
      return;
    }
    notifySuccess("Planilha importada", `${pedidos.length.toLocaleString("pt-BR")} linha(s) de "${fileName}" foram salvas.`);
    loadImported();
  }

  async function removeImportedFile(fileName: string) {
    if (!editionId) return;
    setImportedPedidos((prev) => {
      const next = prev.filter((p) => p.sourceFile !== fileName);
      setCached(`operacional:${editionId}`, next);
      return next;
    });
    const res = await fetch(`/api/operacional/import?editionId=${editionId}&sourceFile=${encodeURIComponent(fileName)}`, {
      method: "DELETE",
    });
    if (!res.ok) loadImported();
  }

  const semContratacaoVisivel = useMemo(() => {
    const termo = buscaSemContratacao.trim();
    if (!termo) return semContratacao;
    return semContratacao.filter((e) => combina(termo, [e.expositor, e.nomeFantasia, e.cnpj, e.estande]));
  }, [semContratacao, buscaSemContratacao]);

  // fechado mostra o topo; aberto mostra tudo, filtrado pela busca do card
  const rankingVisivel = useMemo(() => {
    const todos = data?.topExpositores ?? [];
    if (!verTodosExpositores) return todos.slice(0, RANKING_VISIVEL);
    return buscaRanking.trim() ? todos.filter((e) => combina(buscaRanking, [e.name])) : todos;
  }, [data?.topExpositores, verTodosExpositores, buscaRanking]);

  // ordem de leitura: quem contratou, o que foi contratado e quanto saiu isento.
  // A potência entra como quarto cartão só quando a planilha do serviço traz
  // kVA — é o caso do relatório de elétrica.
  const KPI_DEFS = [
    {
      key: "qtdExpositores" as const,
      // com a listagem geral importada, o número ganha o denominador: saber
      // que 137 contrataram só faz sentido sabendo de quantos.
      label: totalExpositoresBase ? "Expositores com contratações" : t("operacional.kpi.expositores"),
      fmt: (v: number | null) =>
        v == null ? "—" : totalExpositoresBase ? `${int(v)} de ${int(totalExpositoresBase)}` : int(v),
    },
    { key: "totalItens" as const, label: t("operacional.kpi.itens"), fmt: int },
    {
      key: "servicosPorExpositor" as const,
      label: t("operacional.kpi.servicosPorExpositor"),
      fmt: (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })),
    },
    ...(data?.kpis.kvaTotal != null
      ? [
          {
            key: "kvaTotal" as const,
            label: "Potência Geral contratada",
            fmt: (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR")} kVA`),
          },
        ]
      : []),
  ];

  const STATUS_LABEL: Record<string, string> = {
    pago: t("status.pago"),
    pendente: t("status.pendente"),
    cancelado: t("status.cancelado"),
    isento: t("status.isento"),
  };

  // Filtros que recortam a tela inteira (não os da tabela). Viram etiquetas
  // visíveis com um jeito óbvio de desfazer — clicar no gráfico filtra, e antes
  // não havia nada indicando como voltar.
  const filtrosDaTela = [
    servico !== "all" && { id: "servico", rotulo: "Serviço", valor: servico, limpar: () => setServico("all") },
    tipoFilter !== "all" && {
      id: "tipoEstande",
      rotulo: "Tipo de estande",
      valor: tipoFilter,
      limpar: () => setTipoFilter("all"),
    },
    equipamentoFiltro !== "all" && {
      id: "equipamento",
      rotulo: "Equipamento",
      valor: equipamentoFiltro,
      limpar: () => setEquipamentoFiltro("all"),
    },
    statusFilter !== "all" && {
      id: "status",
      rotulo: "Situação",
      valor: STATUS_LABEL[statusFilter as ServicoStatus] ?? String(statusFilter),
      limpar: () => setStatusFilter("all"),
    },
    search.trim() !== "" && { id: "busca", rotulo: "Busca", valor: search, limpar: () => setSearch("") },
  ].filter(Boolean) as Array<{ id: string; rotulo: string; valor: string; limpar: () => void }>;

  function limparFiltrosDaTela() {
    setServico("all");
    setTipoFilter("all");
    setEquipamentoFiltro("all");
    setStatusFilter("all");
    setSearch("");
  }

  // não existe classe de badge por status de serviço — reaproveita as do
  // financeiro pela semântica: pago é o desfecho positivo, recusado é
  // negativo, e isento/sem débito são neutros (não há nada a receber).
  const STATUS_CLASS: Record<string, string> = {
    pago: "pago",
    pendente: "pendente",
    cancelado: "atrasado",
    isento: "cortesia",
  };
  const STATUS_COLOR: Record<string, string> = {
    pago: "var(--good)",
    pendente: "var(--amber)",
    cancelado: "var(--red)",
    isento: "var(--ink-mute)",
  };

  /**
   * Cor fixa por serviço, calculada sobre TODOS os serviços da edição (não
   * sobre o resultado filtrado) e em ordem alfabética. Assim "Limpeza" tem a
   * mesma cor com a tela inteira ou filtrada por ela — antes a cor vinha da
   * posição na lista e mudava a cada filtro.
   */
  const corDoServico = useMemo(() => {
    const nomes = Array.from(new Set(rawPedidos.map((p) => p.servico).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );
    const mapa = new Map<string, string>();
    nomes.forEach((nome, i) => mapa.set(nome, PALETTE[i % PALETTE.length]));
    return (nome: string) => mapa.get(nome);
  }, [rawPedidos]);

  // quantidades são contagens de pessoas/itens, não dinheiro — o formatador
  // padrão dos gráficos é moeda, então todos recebem este aqui.
  const qtdFmt = (v: number) => v.toLocaleString("pt-BR");

  /**
   * Exporta a lista como ela está: mesmos filtros, mesma ordenação e as mesmas
   * colunas que a tabela decidiu mostrar. O arquivo tem de bater com a tela,
   * senão vira uma segunda fonte de verdade.
   */
  function handleExportar() {
    const linhas = sortedPedidos;
    if (!linhas.length) {
      notifyWarning("Nada para exportar", "Os filtros atuais não deixaram nenhum pedido na lista.");
      return;
    }

    const filtrosNoNome = [
      servico !== "all" ? servico : "",
      statusFilter !== "all" ? STATUS_LABEL[statusFilter] : "",
      tipoFilter !== "all" ? tipoFilter : "",
    ].filter(Boolean);

    const total = exportarPlanilha({
      prefixo: "operacional",
      contexto: [event?.name ?? "", edition?.label ?? "", ...filtrosNoNome],
      aba: servico !== "all" ? servico : "Operacional",
      linhas,
      colunas: COLUMNS.map((c) => ({
        titulo: c.label,
        valor: (p: PedidoServico) => {
          if (c.key === "status") return STATUS_LABEL[p.status] ?? p.status;
          const v = c.format ? c.format(p) : p[c.key];
          if (v === null || v === undefined || v === "") return "";
          // quantidade e dias saem como número para o Excel poder somar
          return typeof v === "number" ? v : String(v);
        },
      })),
    });

    notifySuccess("Planilha exportada", `${total.toLocaleString("pt-BR")} linha(s) com os filtros atuais.`);
  }

  async function load() {
    setConnState("pending");
    try {
      const result = await fetchOperacional({ eventId, editionId }, { servico, status: statusFilter, search });
      setApiData(result);
      setConnState(result ? "connected" : "pending");
    } catch (err) {
      console.error("Operacional: falha ao carregar dados", err);
      setConnState("error");
    }
  }

  useEffect(() => {
    // mostra o que já se sabe dessa edição na hora (cache ou vazio) em vez de
    // sempre zerar — evita a "piscada" ao trocar de edição/voltar pra aba.
    setImportedPedidos(getCached<PedidoServico[]>(`operacional:${editionId}`) ?? []);
    setExpositoresBase(getCached<ExpositorBase[]>(`operacional-expositores:${editionId}`) ?? []);
    setTableSearch("");
    // serviço/localização são valores das planilhas da edição anterior — manter
    // o filtro ao trocar de edição deixaria a tela vazia sem motivo aparente.
    setServico("all");
    setTipoFilter("all");
    setEquipamentoFiltro("all");
    loadImported(); // revalida com o banco por baixo dos panos
    loadExpositores();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, editionId]);

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t("operacional.title")}</h1>
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
          {canManageData && !apiData && (
            <SpreadsheetImportOperacional
              eventId={eventId}
              contexto={[event?.name ?? "", edition?.label ?? ""]}
              onImported={handleImported}
            />
          )}
          {canManageData && !apiData && (
            <SpreadsheetImportExpositores eventId={eventId} onImported={handleExpositoresImportados} />
          )}
          {(hasImported || apiData) && (
            <button className="btn" type="button" onClick={handleExportar}>
              Exportar planilha
            </button>
          )}
          {canManageData && (
            <button className="btn primary" type="button" onClick={load}>
              {t("common.sync")}
            </button>
          )}
        </div>
      </div>

      {/* Clicar num serviço do gráfico (ou num tipo de estande) recorta a tela
          inteira, e antes não havia nada dizendo isso nem como desfazer. Cada
          filtro vira uma etiqueta com "✕", e o botão devolve a visão completa. */}
      {filtrosDaTela.length > 0 && (
        <div className="filtros-ativos">
          <span className="filtros-ativos-titulo">Você está vendo só:</span>
          {filtrosDaTela.map((f) => (
            <button
              key={f.id}
              className="filtro-chip"
              type="button"
              onClick={f.limpar}
              title={`Remover o filtro de ${f.rotulo.toLowerCase()}`}
            >
              <span className="filtro-chip-rotulo">{f.rotulo}</span>
              <strong>{f.valor}</strong>
              <span className="filtro-chip-x" aria-hidden="true">
                ✕
              </span>
            </button>
          ))}
          {/* com um filtro só, o "✕" da etiqueta e o botão do próprio painel já
              resolvem; o botão geral aparece quando há vários para desfazer */}
          {filtrosDaTela.length > 1 && (
            <button className="btn primary filtros-limpar" type="button" onClick={limparFiltrosDaTela}>
              ↩ Ver tudo de novo
            </button>
          )}
        </div>
      )}

      {canManageData && !apiData && (importedFiles.length > 0 || expositoresBase.length > 0) && (
        <div className="import-files-bar">
          <span>Arquivos importados:</span>
          {expositoresBase.length > 0 && (
            <span className="import-file-chip" title={expositoresBase[0].sourceFile}>
              listagem de expositores ({expositoresBase.length})
              <button type="button" onClick={removerListagemExpositores} aria-label="Remover a listagem de expositores">
                ×
              </button>
            </span>
          )}
          {importedFiles.map(([name, count]) => (
            <span className="import-file-chip" key={name} title={name}>
              {nomeArquivoCurto(name)} ({count})
              <button type="button" onClick={() => removeImportedFile(name)} aria-label={`Remover ${name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="segbar">
        <div className="seg">
          {/* são status de PAGAMENTO do pedido: todos entram como filtro,
              porque cobrar o pendente e conferir o isento são partes
              diferentes do mesmo trabalho. */}
          {(["all", "pago", "pendente", "cancelado", "isento"] as const).map((v) => (
            <button key={v} className={statusFilter === v ? "on" : ""} onClick={() => setStatusFilter(v)}>
              {v === "all" ? t("common.allStatus") : STATUS_LABEL[v]}
            </button>
          ))}
        </div>
        {servicoOptions.length > 0 && (
          <select className="input" value={servico} onChange={(e) => setServico(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="all">{t("operacional.allServices")}</option>
            {servicoOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <div className="search">
          <input
            type="text"
            list="operacional-busca-sugestoes"
            placeholder={t("operacional.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <datalist id="operacional-busca-sugestoes">
            {sugestoes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>

      <KpiRow defs={KPI_DEFS} values={data?.kpis} />

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.ranking.title")}</h3>
              <p>{t("operacional.ranking.desc")}</p>
            </div>
            {(data?.topExpositores.length ?? 0) > RANKING_VISIVEL && (
              <button className="field field-btn" type="button" onClick={() => {
                  setVerTodosExpositores((v) => !v);
                  setBuscaRanking("");
                }}>
                {verTodosExpositores ? "Ver menos" : `Ver todos (${data!.topExpositores.length})`}
              </button>
            )}
          </div>
          {!data?.topExpositores.length ? (
            <Empty glyph="▤" title={t("operacional.ranking.empty.title")} desc={t("operacional.ranking.empty.desc")} />
          ) : (
            /* fechado: só o topo do ranking. Aberto: a lista inteira com busca
               e scroll dentro do próprio card — sem esticar o card. */
            <div className="ranking-wrap">
              {verTodosExpositores && (
                <input
                  className="input"
                  placeholder="Buscar expositor no ranking…"
                  value={buscaRanking}
                  onChange={(e) => setBuscaRanking(e.target.value)}
                />
              )}
              <div className={`ranking-lista ${verTodosExpositores ? "barlist-scroll scroll-slim" : ""}`}>
                <BarList
                  data={rankingVisivel}
                  valueFmt={qtdFmt}
                  selected={search}
                  onSelect={(name) => setSearch((prev) => (prev === name ? "" : name))}
                />
              </div>
              {verTodosExpositores && !rankingVisivel.length && (
                <p className="ranking-vazio">Nenhum expositor com esse nome.</p>
              )}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.donut.title")}</h3>
              <p>{t("operacional.donut.desc")}</p>
            </div>
            <div className="panel-head-tools">
              {/* o desfazer fica onde o filtro foi aplicado: quem clicou numa
                  fatia procura a saída no próprio gráfico, não no topo da tela */}
              {servico !== "all" && (
                <button className="btn primary btn-ver-tudo" type="button" onClick={() => setServico("all")}>
                  ↩ Ver todos os serviços
                </button>
              )}
              <div className="seg">
                <button className={donutVariant === "full" ? "on" : ""} type="button" onClick={() => setDonutVariant("full")}>
                  Completo
                </button>
                <button className={donutVariant === "half" ? "on" : ""} type="button" onClick={() => setDonutVariant("half")}>
                  Meio círculo
                </button>
              </div>
            </div>
          </div>
          {!data?.servicos.length ? (
            <Empty
              glyph="◷"
              title={t("operacional.donut.empty.title")}
              desc={t("operacional.donut.empty.desc")}
            />
          ) : (
            <Donut
              data={data.servicos}
              valueFmt={qtdFmt}
              variant={donutVariant}
              colorFor={corDoServico}
              selected={servico === "all" ? undefined : servico}
              onSelect={(nome) => setServico((atual) => (atual === nome ? "all" : nome))}
            />
          )}
        </div>
      </div>

      <div className="panels-3">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.tipo.title")}</h3>
              <p>{t("operacional.tipo.desc")}</p>
            </div>
            {tipoOptions.length > 0 && (
              <select className="input" value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="all">Todos os tipos</option>
                {tipoOptions.map((tp) => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </select>
            )}
          </div>
          {!data?.tiposEstande.length ? (
            <Empty glyph="⌗" title={t("operacional.tipo.empty.title")} desc={t("operacional.tipo.empty.desc")} />
          ) : (
            <BarList
              data={data.tiposEstande}
              valueFmt={qtdFmt}
              layout="stacked"
              selected={tipoFilter === "all" ? "" : tipoFilter}
              onSelect={(name) => setTipoFilter((prev) => (prev === name ? "all" : name))}
            />
          )}
        </div>

        {semContratacao.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>Expositores sem contratação</h3>
                <p>
                  {semContratacao.length.toLocaleString("pt-BR")} de{" "}
                  {(totalExpositoresBase ?? 0).toLocaleString("pt-BR")} não contrataram nenhum serviço
                  {filtrosDaTela.length > 0 ? " dentro do que está filtrado" : ""}
                </p>
              </div>
            </div>
            {/* lista de trabalho: é quem a equipe comercial ainda precisa
                procurar, então vem com busca e rola dentro do card */}
            <div className="ranking-wrap">
              <input
                className="input"
                placeholder="Buscar expositor nesta lista…"
                value={buscaSemContratacao}
                onChange={(e) => setBuscaSemContratacao(e.target.value)}
              />
              <div className="ranking-lista barlist-scroll scroll-slim">
                <ul className="lista-simples">
                  {semContratacaoVisivel.map((e) => (
                    <li key={e.cnpj || e.expositor}>
                      <span className="lista-simples-nome">{e.nomeFantasia || e.expositor}</span>
                      <span className="lista-simples-extra">
                        {[e.estande, tipoEstandeAgrupado(e.tipoEstande)].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {!semContratacaoVisivel.length && <p className="ranking-vazio">Nenhum expositor com esse nome.</p>}
            </div>
          </div>
        )}

        {(data?.equipamentos.length ?? 0) > 0 && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>Por equipamento</h3>
                <p>itens contratados por equipamento</p>
              </div>
              {equipamentoFiltro !== "all" && (
                <button className="btn primary btn-ver-tudo" type="button" onClick={() => setEquipamentoFiltro("all")}>
                  ↩ Ver todos os equipamentos
                </button>
              )}
            </div>
            <BarList
              data={data!.equipamentos}
              valueFmt={qtdFmt}
              layout="stacked"
              selected={equipamentoFiltro === "all" ? "" : equipamentoFiltro}
              onSelect={(nome) => setEquipamentoFiltro((atual) => (atual === nome ? "all" : nome))}
            />
          </div>
        )}

        {(data?.tipos.length ?? 0) > 0 && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>Por tipo</h3>
                <p>variação do item contratado</p>
              </div>
            </div>
            <BarList data={data!.tipos} valueFmt={qtdFmt} />
          </div>
        )}

        {/* Ocupa a linha inteira e distribui os status lado a lado: são quatro
            valores curtos, que empilhados deixavam meia coluna vazia ao lado. */}
        <div className="panel panel-largo">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.status.title")}</h3>
              <p>{t("operacional.status.desc")}</p>
            </div>
          </div>
          {!data?.statusBreakdown.length ? (
            <div className="statusbars-row">
              {(["pago", "pendente", "cancelado", "isento"] as const).map((s) => (
                <div className="statusbars-cell" key={s}>
                  <span className={`badge ${STATUS_CLASS[s]}`}>
                    <span className="dot" />
                    {STATUS_LABEL[s]}
                  </span>
                  <strong className="statusbars-value">—</strong>
                </div>
              ))}
            </div>
          ) : (
            <StatusBars
              data={data.statusBreakdown}
              labels={STATUS_LABEL}
              classMap={STATUS_CLASS}
              colorMap={STATUS_COLOR}
              layout="row"
            />
          )}
        </div>
      </div>

      <div className="table-wrap">
        <div className="panel-head" style={{ padding: "16px 16px 0" }}>
          <div>
            <h3>{t("operacional.table.title")}</h3>
            <p>{t("operacional.table.desc")}</p>
          </div>
          <div className="table-tools">
            <div className="search">
              <input
                type="text"
                placeholder="Buscar expositor ou estande"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
            </div>

            <span className="table-tools-sep">{t("col.dataInicio")}</span>
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
              onChange={(e) => setTableStatus(e.target.value as "all" | ServicoStatus)}
              aria-label="Status"
            >
              <option value="all">{t("common.allStatus")}</option>
              {(["pago", "pendente", "cancelado", "isento"] as const).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>

            {turnosDisponiveis.length > 0 && (
              <select
                className="field"
                value={tableTurno}
                onChange={(e) => setTableTurno(e.target.value)}
                aria-label="Turno"
              >
                <option value="all">Todos os turnos</option>
                {turnosDisponiveis.map((tu) => (
                  <option key={tu} value={tu}>
                    {tu}
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
                  setTableTurno("all");
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
                {COLUMNS.map(({ key, label, cls }) => (
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
              {!data?.pedidos.length ? (
                <EmptyTableRow
                  colSpan={COLUMNS.length}
                  title={t("operacional.table.empty.title")}
                  desc={t("operacional.table.empty.desc")}
                />
              ) : !visiblePedidos.length ? (
                <EmptyTableRow
                  colSpan={COLUMNS.length}
                  title="nenhum serviço encontrado"
                  desc={
                    tableSearch.trim()
                      ? `nenhum resultado para "${tableSearch}" entre os ${data.pedidos.length.toLocaleString(
                          "pt-BR"
                        )} registros que passaram pelos filtros do topo`
                      : "nenhum registro atende aos filtros da tabela"
                  }
                />
              ) : (
                linhasDaPagina.map((p, i) => (
                  // um mesmo expositor pede o mesmo serviço em linhas separadas
                  // (uma por variação, ex.: monolíngue e bilíngue), então não há
                  // identificador natural de linha — o índice garante a unicidade.
                  <tr key={`${p.sourceFile}-${p.expositor}-${i}`}>
                    {COLUMNS.map(({ key, cls, format }) => {
                      if (key === "status") {
                        return (
                          <td key={key}>
                            <span className={`badge ${STATUS_CLASS[p.status] ?? p.status}`}>
                              <span className="dot" />
                              {STATUS_LABEL[p.status] || p.status}
                            </span>
                          </td>
                        );
                      }
                      if (key === "expositor") {
                        return (
                          // razão social costuma ser longa: quebra em vez de
                          // sumir num corte com "…"
                          <td key={key} className="td-nome">
                            {p.expositor}
                          </td>
                        );
                      }
                      const v = format ? format(p) : p[key];
                      return (
                        <td key={key} className={cls}>
                          {v === null || v === "" || v === undefined
                            ? "—"
                            : typeof v === "number"
                            ? v.toLocaleString("pt-BR")
                            : v}
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
            {!visiblePedidos.length
              ? t("operacional.table.countZero")
              : faltamLinhas > 0
              ? `Mostrando ${linhasDaPagina.length.toLocaleString("pt-BR")} de ${visiblePedidos.length.toLocaleString(
                  "pt-BR"
                )} ${t("operacional.table.count")}`
              : `${visiblePedidos.length.toLocaleString("pt-BR")} ${t("operacional.table.count")}`}
          </span>
          <span className="pager">
            {filtrosTabelaAtivos && visiblePedidos.length > 0 && (
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>
                Total: {visibleTotal.toLocaleString("pt-BR")} item(ns)
              </span>
            )}
            {linhasVisiveis > LINHAS_POR_VEZ && (
              <button
                className="btn btn-mostrar-menos"
                type="button"
                onClick={() => {
                  setLinhasVisiveis(LINHAS_POR_VEZ);
                  // sem voltar ao topo, a tela ficaria parada num trecho que
                  // acabou de sumir da lista
                  document.querySelector(".table-scroll")?.scrollTo({ top: 0 });
                }}
              >
                ↑ Mostrar menos
              </button>
            )}
            {faltamLinhas > 0 && (
              <button
                className="btn primary btn-mostrar-mais"
                type="button"
                onClick={() => setLinhasVisiveis((n) => n + LINHAS_POR_VEZ)}
              >
                Mostrar mais {Math.min(LINHAS_POR_VEZ, faltamLinhas)} ({faltamLinhas.toLocaleString("pt-BR")} restantes)
              </button>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
