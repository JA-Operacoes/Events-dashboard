"use client";

import { useEffect, useMemo, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { fetchOperacional, type OperacionalData, type OperacionalFilters, type PedidoServico } from "@/lib/dataSource";
import { ConnChip, Empty, EmptyTableRow, KpiRow, int } from "@/components/ui";
import { SpreadsheetImportOperacional } from "@/components/SpreadsheetImport";
import { aggregateOperacional, mergeImportedPedidos, nomeArquivoCurto } from "@/lib/spreadsheetImport";
import { Donut, BarList, StatusBars } from "@/components/charts";
import { getCached, setCached } from "@/lib/pageCache";
import { formatRelativeTime, parseDateLoose } from "@/lib/period";
import { notifySuccess, notifyWarning, notifyError } from "@/lib/swal";

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
  // opcional — só faz sentido quando a planilha importada traz a coluna de localização.
  const [localFilter, setLocalFilter] = useState("all");
  const [search, setSearch] = useState("");
  // busca específica da tabela de pedidos — filtra só a lista abaixo, sem
  // recalcular KPIs/gráficos (diferente da busca geral, que filtra tudo).
  const [tableSearch, setTableSearch] = useState("");
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

  // fonte bruta de pedidos, venha de onde vier — o filtro de status/busca roda
  // por cima dela e os gráficos/tabela são recalculados a partir do resultado
  // filtrado, então os filtros afetam tudo, não só a tabela.
  const rawPedidos = apiData?.pedidos ?? importedPedidos;

  const servicoOptions = useMemo(
    () =>
      Array.from(new Set(rawPedidos.map((p) => p.servico).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rawPedidos]
  );

  // só existem quando a planilha importada mapeou a coluna de localização —
  // por isso esse filtro só aparece na tela quando a lista não é vazia.
  const localOptions = useMemo(
    () =>
      Array.from(new Set(rawPedidos.map((p) => p.localizacao).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [rawPedidos]
  );

  const filteredPedidos = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rawPedidos.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (servico !== "all" && p.servico !== servico) return false;
      if (localFilter !== "all" && p.localizacao !== localFilter) return false;
      if (term) {
        const haystack = `${p.expositor} ${p.nomeFantasia} ${p.cnpj} ${p.estande} ${p.turno}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rawPedidos, statusFilter, servico, localFilter, search]);

  const data = apiData || hasImported ? aggregateOperacional(filteredPedidos) : null;

  const visiblePedidos = useMemo(() => {
    const term = tableSearch.trim().toLowerCase();
    const list = data?.pedidos ?? [];
    if (!term) return list;
    return list.filter((p) => `${p.expositor} ${p.nomeFantasia} ${p.estande}`.toLowerCase().includes(term));
  }, [data, tableSearch]);

  // total só faz sentido quando a busca recorta pra um expositor/estande
  // específico — na visão geral (sem busca) fica sem essa soma na tela.
  const visibleTotal = useMemo(() => visiblePedidos.reduce((s, p) => s + p.quantidade, 0), [visiblePedidos]);

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
    const defs: Array<{ key: keyof PedidoServico; label: string; cls: string; show: boolean }> = [
      { key: "servico", label: t("col.servico"), cls: "", show: true },
      { key: "expositor", label: t("col.expositor"), cls: "", show: true },
      { key: "nomeFantasia", label: t("col.nomeFantasia"), cls: "", show: has((p) => p.nomeFantasia) },
      { key: "cnpj", label: t("col.cnpj"), cls: "", show: has((p) => p.cnpj) },
      { key: "estande", label: t("col.estande"), cls: "", show: has((p) => p.estande) },
      { key: "localizacao", label: t("col.localizacao"), cls: "", show: has((p) => p.localizacao) },
      { key: "dataInicio", label: t("col.dataInicio"), cls: "", show: has((p) => p.dataInicio) },
      { key: "dataFim", label: t("col.dataFim"), cls: "", show: has((p) => p.dataFim) },
      { key: "horaInicio", label: t("col.horaInicio"), cls: "", show: has((p) => p.horaInicio) },
      { key: "horaFim", label: t("col.horaFim"), cls: "", show: has((p) => p.horaFim) },
      { key: "turno", label: t("col.turno"), cls: "", show: has((p) => p.turno) },
      { key: "quantidade", label: t("col.quantidade"), cls: "num", show: true },
      { key: "dias", label: t("col.dias"), cls: "num", show: has((p) => p.dias) },
      { key: "status", label: t("col.status"), cls: "", show: true },
    ];
    return defs.filter((d) => d.show);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  async function handleImported(pedidos: PedidoServico[], fileName: string) {
    if (!editionId) {
      // sem edição selecionada não tem onde persistir — avisa antes de fazer
      // qualquer coisa, senão o modal fecharia como se tivesse dado certo.
      notifyWarning("Selecione uma edição primeiro", "Escolha (ou crie) uma edição do evento antes de importar a planilha — sem isso não há onde salvar os dados.");
      return;
    }
    // otimista: mostra na hora, e persiste em paralelo — se falhar, recarrega do banco pra não ficar dessincronizado.
    setImportedPedidos((prev) => {
      const next = mergeImportedPedidos(prev, pedidos, fileName);
      setCached(`operacional:${editionId}`, next);
      return next;
    });
    const res = await fetch("/api/operacional/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editionId, sourceFile: fileName, pedidos }),
    });
    if (!res.ok) {
      loadImported();
      notifyError("Falha ao importar planilha", "Os dados não foram salvos — tente novamente em instantes.");
      return;
    }
    notifySuccess("Planilha importada", `${pedidos.length} linha(s) de "${fileName}" foram salvas.`);
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

  const KPI_DEFS = [
    { key: "totalItens", label: t("operacional.kpi.itens"), fmt: int },
    {
      key: "totalDiarias",
      // o rótulo avisa quando parte dos pedidos não informa dias e ficou de
      // fora da conta — sem isso o número pareceria cobrir a edição inteira.
      label:
        data && data.itensSemDias > 0
          ? `${t("operacional.kpi.diarias")} · ${data.itensSemDias} item(ns) sem dias`
          : t("operacional.kpi.diarias"),
      fmt: int,
    },
    { key: "qtdPedidos", label: t("operacional.kpi.pedidos"), fmt: int },
    { key: "qtdExpositores", label: t("operacional.kpi.expositores"), fmt: int },
  ] as const;

  const STATUS_LABEL: Record<string, string> = {
    pendente: t("status.pendente"),
    confirmado: t("status.confirmado"),
    atendido: t("status.atendido"),
    cancelado: t("status.cancelado"),
  };
  // não existe classe de badge por status de serviço — reaproveita as do
  // financeiro pela semântica: atendido é o desfecho positivo, confirmado
  // ainda está por acontecer e cancelado é negativo.
  const STATUS_CLASS: Record<string, string> = {
    pendente: "pendente",
    confirmado: "pago",
    atendido: "pago",
    cancelado: "atrasado",
  };
  const STATUS_COLOR: Record<string, string> = {
    pendente: "var(--amber)",
    confirmado: "var(--teal)",
    atendido: "var(--good)",
    cancelado: "var(--red)",
  };

  // quantidades são contagens de pessoas/itens, não dinheiro — o formatador
  // padrão dos gráficos é moeda, então todos recebem este aqui.
  const qtdFmt = (v: number) => v.toLocaleString("pt-BR");

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
    setTableSearch("");
    // serviço/localização são valores das planilhas da edição anterior — manter
    // o filtro ao trocar de edição deixaria a tela vazia sem motivo aparente.
    setServico("all");
    setLocalFilter("all");
    loadImported(); // revalida com o banco por baixo dos panos
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
          {canManageData && (
            <button className="btn primary" type="button" onClick={load}>
              {t("common.sync")}
            </button>
          )}
        </div>
      </div>

      {localFilter !== "all" && (
        <div className="conta-focus-banner">
          <span>
            Visão exclusiva de <strong>{localFilter}</strong> — KPIs, gráficos e status abaixo consideram só os pedidos
            dessa localização.
          </span>
          <button className="btn" type="button" onClick={() => setLocalFilter("all")}>
            ← Voltar para visão geral
          </button>
        </div>
      )}

      {canManageData && !apiData && importedFiles.length > 0 && (
        <div className="import-files-bar">
          <span>Arquivos importados:</span>
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
          {(["all", "pendente", "confirmado", "atendido", "cancelado"] as const).map((v) => (
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
          <input type="text" placeholder={t("operacional.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
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
          </div>
          {!data?.topExpositores.length ? (
            <Empty glyph="▤" title={t("operacional.ranking.empty.title")} desc={t("operacional.ranking.empty.desc")} />
          ) : (
            <BarList
              data={data.topExpositores}
              valueFmt={qtdFmt}
              selected={search}
              onSelect={(name) => setSearch((prev) => (prev === name ? "" : name))}
            />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.donut.title")}</h3>
              <p>{t("operacional.donut.desc")}</p>
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
          {!data?.servicos.length ? (
            <Empty
              glyph="◷"
              title={t("operacional.donut.empty.title")}
              desc={t("operacional.donut.empty.desc")}
            />
          ) : (
            <Donut data={data.servicos} valueFmt={qtdFmt} variant={donutVariant} />
          )}
        </div>
      </div>

      <div className="panels-3">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.local.title")}</h3>
              <p>{t("operacional.local.desc")}</p>
            </div>
            {localOptions.length > 0 && (
              <select className="input" value={localFilter} onChange={(e) => setLocalFilter(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="all">Todas as localizações</option>
                {localOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </div>
          {!data?.localizacoes.length ? (
            <Empty glyph="⌗" title={t("operacional.local.empty.title")} desc={t("operacional.local.empty.desc")} />
          ) : (
            <BarList
              data={data.localizacoes}
              valueFmt={qtdFmt}
              layout="stacked"
              selected={localFilter === "all" ? "" : localFilter}
              onSelect={(name) => setLocalFilter((prev) => (prev === name ? "all" : name))}
            />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("operacional.status.title")}</h3>
              <p>{t("operacional.status.desc")}</p>
            </div>
          </div>
          {!data?.statusBreakdown.length ? (
            <>
              {(["pendente", "confirmado", "atendido", "cancelado"] as const).map((s) => (
                <div className="status-row" key={s}>
                  <span className="status-left">
                    <span className={`badge ${STATUS_CLASS[s]}`}>
                      <span className="dot" />
                      {STATUS_LABEL[s]}
                    </span>
                  </span>
                  <span className="status-val">—</span>
                </div>
              ))}
            </>
          ) : (
            <StatusBars data={data.statusBreakdown} labels={STATUS_LABEL} classMap={STATUS_CLASS} colorMap={STATUS_COLOR} />
          )}
        </div>
      </div>

      <div className="table-wrap">
        <div className="panel-head" style={{ padding: "16px 16px 0" }}>
          <div>
            <h3>{t("operacional.table.title")}</h3>
            <p>{t("operacional.table.desc")}</p>
          </div>
          <div className="search" style={{ maxWidth: 260 }}>
            <input
              type="text"
              placeholder="Buscar expositor ou estande"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
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
                  title="nenhum pedido encontrado"
                  desc={`nenhum resultado para "${tableSearch}"`}
                />
              ) : (
                sortedPedidos.map((p, i) => (
                  // um mesmo expositor pede o mesmo serviço em linhas separadas
                  // (uma por variação, ex.: monolíngue e bilíngue), então não há
                  // identificador natural de linha — o índice garante a unicidade.
                  <tr key={`${p.sourceFile}-${p.expositor}-${i}`}>
                    {COLUMNS.map(({ key, cls }) => {
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
                          <td key={key} style={{ fontFamily: "var(--sans)", color: "var(--ink)" }}>
                            {p.expositor}
                          </td>
                        );
                      }
                      const v = p[key];
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
              : tableSearch.trim()
              ? `${visiblePedidos.length.toLocaleString("pt-BR")} de ${data!.pedidos.length.toLocaleString("pt-BR")} ${t("operacional.table.count")}`
              : `${visiblePedidos.length.toLocaleString("pt-BR")} ${t("operacional.table.count")}`}
          </span>
          {tableSearch.trim() && visiblePedidos.length > 0 ? (
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>
              Total: {visibleTotal.toLocaleString("pt-BR")} item(ns)
            </span>
          ) : (
            <span>{t("common.page")}</span>
          )}
        </div>
      </div>
    </>
  );
}
