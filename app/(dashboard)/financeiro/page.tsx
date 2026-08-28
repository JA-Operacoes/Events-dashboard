"use client";

import { useEffect, useMemo, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { fetchFinanceiro, type FinanceiroData, type FinanceiroFilters, type Invoice } from "@/lib/dataSource";
import { ConnChip, Empty, EmptyTableRow, KpiRow, money, int } from "@/components/ui";
import { SpreadsheetImportFinanceiro } from "@/components/SpreadsheetImport";
import { aggregateFinanceiro, mergeImportedInvoices } from "@/lib/spreadsheetImport";
import { Donut, BarList, StatusBars, LineChart } from "@/components/charts";
import { getCached, setCached } from "@/lib/pageCache";

export default function FinanceiroPage() {
  const { eventId, editionId, event, edition } = useEvent();
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<FinanceiroFilters["period"]>("all");
  const [method, setMethod] = useState<FinanceiroFilters["method"]>("all");
  const [statusFilter, setStatusFilter] = useState<FinanceiroFilters["status"]>("all");
  const [search, setSearch] = useState("");
  // busca específica da tabela de duplicatas — filtra só a lista abaixo, sem
  // recalcular KPIs/gráficos (diferente da busca geral, que filtra tudo).
  const [tableSearch, setTableSearch] = useState("");
  const [connState, setConnState] = useState<"pending" | "connected" | "error">("pending");
  const [apiData, setApiData] = useState<FinanceiroData | null>(null);
  // lê o último resultado conhecido pra essa edição na hora — evita a tela
  // "piscar" vazia sempre que você sai da aba e volta; loadImported() abaixo
  // ainda busca a versão atual por baixo dos panos.
  const [importedInvoices, setImportedInvoices] = useState<Invoice[]>(
    () => getCached(`financeiro:${editionId}`) ?? []
  );
  const hasImported = importedInvoices.length > 0;
  const [kpiOverrides, setKpiOverrides] = useState<Partial<FinanceiroData["kpis"]>>({});

  // fonte bruta de duplicatas, venha de onde vier — o filtro de status/busca
  // roda por cima dela e os gráficos/tabela são recalculados a partir do
  // resultado filtrado, então os filtros afetam tudo, não só a tabela.
  const rawInvoices = apiData?.invoices ?? importedInvoices;
  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rawInvoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (term) {
        const haystack = `${inv.cliente} ${inv.cnpj} ${inv.numero}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rawInvoices, statusFilter, search]);

  const data = apiData || hasImported ? aggregateFinanceiro(filteredInvoices) : null;

  const visibleInvoices = useMemo(() => {
    const term = tableSearch.trim().toLowerCase();
    const list = data?.invoices ?? [];
    if (!term) return list;
    return list.filter((inv) => `${inv.cliente} ${inv.numero}`.toLowerCase().includes(term));
  }, [data, tableSearch]);

  // total só faz sentido quando a busca recorta pra um cliente/duplicata
  // específico — na visão geral (sem busca) fica sem essa soma na tela.
  const visibleTotal = useMemo(() => visibleInvoices.reduce((s, inv) => s + inv.valor, 0), [visibleInvoices]);

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
    const isDateCol = sortKey === "vencimento" || sortKey === "pagamento";
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
    }
  }

  async function handleImported(invoices: Invoice[], fileName: string) {
    if (!editionId) return;
    // otimista: mostra na hora, e persiste em paralelo — se falhar, recarrega do banco pra não ficar dessincronizado.
    setImportedInvoices((prev) => {
      const next = mergeImportedInvoices(prev, invoices, fileName);
      setCached(`financeiro:${editionId}`, next);
      return next;
    });
    const res = await fetch("/api/financeiro/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editionId, sourceFile: fileName, invoices }),
    });
    if (!res.ok) loadImported();
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

  const KPI_DEFS = [
    { key: "totalRecebido", label: t("financeiro.kpi.total"), fmt: money },
    { key: "ticketMedio", label: t("financeiro.kpi.ticket"), fmt: money },
    { key: "qtdDuplicatas", label: t("financeiro.kpi.duplicatas"), fmt: int },
    {
      key: "pontualidadeDias",
      label: t("financeiro.kpi.pontualidade"),
      fmt: (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} d`),
    },
  ] as const;

  const STATUS_LABEL: Record<string, string> = {
    pago: t("status.pago"),
    pendente: t("status.pendente"),
    atrasado: t("status.atrasado"),
    cancelado: t("status.cancelado"),
  };

  async function load() {
    setConnState("pending");
    try {
      const result = await fetchFinanceiro({ eventId, editionId }, { period, method, status: statusFilter, search });
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
  }, [eventId, editionId, period, method]);

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
          {hasImported && !apiData && <span className="import-badge">dados de planilha importada</span>}
          <ConnChip state={connState} />
          {!apiData && <SpreadsheetImportFinanceiro eventId={eventId} onImported={handleImported} />}
          <button className="btn primary" type="button" onClick={load}>
            {t("common.sync")}
          </button>
        </div>
      </div>

      {!apiData && importedFiles.length > 0 && (
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
          {(["all", "pago", "pendente", "atrasado", "cancelado"] as const).map((v) => (
            <button key={v} className={statusFilter === v ? "on" : ""} onClick={() => setStatusFilter(v)}>
              {v === "all" ? t("common.allStatus") : STATUS_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="search">
          <input type="text" placeholder={t("financeiro.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <KpiRow
        defs={KPI_DEFS}
        values={isAdmin ? { ...data?.kpis, ...kpiOverrides } : data?.kpis}
        editable={isAdmin}
        onEditValue={(key, v) => setKpiOverrides((prev) => ({ ...prev, [key]: v }))}
      />

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
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: "var(--amber)" }} />
                {t("status.pendente").toLowerCase()}
              </span>
            </div>
          </div>
          {!data?.timeline.length ? (
            <Empty glyph="⌁" title={t("financeiro.timeline.empty.title")} desc={t("financeiro.timeline.empty.desc")} />
          ) : (
            <LineChart
              data={data.timeline}
              series={[
                { key: "recebido", color: "var(--accent)" },
                { key: "previsto", color: "var(--amber)" },
              ]}
            />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("financeiro.donut.title")}</h3>
              <p>{t("financeiro.donut.desc")}</p>
            </div>
          </div>
          {!data?.paymentMethods.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
                <circle cx="56" cy="56" r="44" fill="none" stroke="var(--line)" strokeWidth="14" strokeDasharray="4 6" />
              </svg>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
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
            <Donut data={data.paymentMethods} />
          )}
        </div>
      </div>

      <div className="panels-3">
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
            <BarList data={data.topClients} />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("financeiro.status.title")}</h3>
              <p>{t("financeiro.status.desc")}</p>
            </div>
          </div>
          {!data?.statusBreakdown.length ? (
            <>
              {(["pago", "pendente", "atrasado", "cancelado"] as const).map((s) => (
                <div className="status-row" key={s}>
                  <span className="status-left">
                    <span className={`badge ${s}`}>
                      <span className="dot" />
                      {STATUS_LABEL[s]}
                    </span>
                  </span>
                  <span className="status-val">—</span>
                </div>
              ))}
            </>
          ) : (
            <StatusBars data={data.statusBreakdown} labels={STATUS_LABEL} />
          )}
        </div>
      </div>

      <div className="table-wrap">
        <div className="panel-head" style={{ padding: "16px 16px 0" }}>
          <div>
            <h3>{t("financeiro.table.title")}</h3>
            <p>{t("financeiro.table.desc")}</p>
          </div>
          <div className="search" style={{ maxWidth: 260 }}>
            <input
              type="text"
              placeholder="Buscar cliente ou nº da duplicata"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {(
                  [
                    ["numero", t("col.numero"), ""],
                    ["cliente", t("col.cliente"), ""],
                    ["cnpj", t("col.cnpj"), ""],
                    ["vencimento", t("col.vencimento"), ""],
                    ["pagamento", t("col.pagamento"), ""],
                    ["forma", t("col.forma"), ""],
                    ["valor", t("col.valor"), "num"],
                    ["status", t("col.status"), ""],
                  ] as const
                ).map(([key, label, cls]) => (
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
                <EmptyTableRow colSpan={8} title={t("financeiro.table.empty.title")} desc={t("financeiro.table.empty.desc")} />
              ) : !visibleInvoices.length ? (
                <EmptyTableRow colSpan={8} title="nenhuma duplicata encontrada" desc={`nenhum resultado para "${tableSearch}"`} />
              ) : (
                sortedInvoices.map((inv, i) => (
                  // `numero` identifica a duplicata, não a linha — uma duplicata rateada
                  // em várias rubricas gera várias linhas com o mesmo número, então o
                  // índice entra na key só pra garantir unicidade de renderização.
                  <tr key={`${inv.numero}-${i}`}>
                    <td>{inv.numero}</td>
                    <td style={{ fontFamily: "var(--sans)", color: "var(--ink)" }}>{inv.cliente}</td>
                    <td>{inv.cnpj}</td>
                    <td>{inv.vencimento}</td>
                    <td>{inv.pagamento || "—"}</td>
                    <td>{inv.forma}</td>
                    <td className="num">{money(inv.valor)}</td>
                    <td>
                      <span className={`badge ${inv.status}`}>
                        <span className="dot" />
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </td>
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
              : tableSearch.trim()
              ? `${visibleInvoices.length.toLocaleString("pt-BR")} de ${data!.invoices.length.toLocaleString("pt-BR")} ${t("financeiro.table.count")}`
              : `${visibleInvoices.length.toLocaleString("pt-BR")} ${t("financeiro.table.count")}`}
          </span>
          {tableSearch.trim() && visibleInvoices.length > 0 ? (
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>Total: {money(visibleTotal)}</span>
          ) : (
            <span>{t("common.page")}</span>
          )}
        </div>
      </div>

      <div className="footnote">{t("financeiro.footnote")}</div>
    </>
  );
}
