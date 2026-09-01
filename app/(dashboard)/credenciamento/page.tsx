"use client";

import { useEffect, useMemo, useState } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { fetchCredenciamento, type CredenciamentoData, type CredenciamentoFilters, type Participante } from "@/lib/dataSource";
import { ConnChip, Empty, EmptyTableRow, KpiRow, int, pct } from "@/components/ui";
import { SpreadsheetImportCredenciamento } from "@/components/SpreadsheetImport";
import { aggregateCredenciamento, mergeImportedParticipantes } from "@/lib/spreadsheetImport";
import { Donut, StatusBars, LineChart } from "@/components/charts";
import { getCached, setCached } from "@/lib/pageCache";
import { matchesPeriod, formatRelativeTime } from "@/lib/period";
import { notifySuccess, notifyWarning, notifyError } from "@/lib/swal";

export default function CredenciamentoPage() {
  const { eventId, editionId, event, edition } = useEvent();
  const { t } = useI18n();
  const { canManageData } = useAuth();
  const [period, setPeriod] = useState<CredenciamentoFilters["period"]>("all");
  const [categoria, setCategoria] = useState<CredenciamentoFilters["categoria"]>("all");
  const [statusFilter, setStatusFilter] = useState<CredenciamentoFilters["status"]>("all");
  const [search, setSearch] = useState("");
  const [connState, setConnState] = useState<"pending" | "connected" | "error">("pending");
  const [apiData, setApiData] = useState<CredenciamentoData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [importedParticipantes, setImportedParticipantes] = useState<Participante[]>(
    () => getCached(`credenciamento:${editionId}`) ?? []
  );
  const hasImported = importedParticipantes.length > 0;
  const [kpiOverrides, setKpiOverrides] = useState<Partial<CredenciamentoData["kpis"]>>({});

  const rawParticipantes = apiData?.participantes ?? importedParticipantes;

  const categorias = useMemo(
    () => Array.from(new Set(rawParticipantes.map((p) => p.categoria).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rawParticipantes]
  );

  const filteredParticipantes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rawParticipantes.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (categoria !== "all" && p.categoria !== categoria) return false;
      if (!matchesPeriod(p.credenciadoEm, period)) return false;
      if (term && !`${p.nome} ${p.documento}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rawParticipantes, statusFilter, categoria, period, search]);

  const data = apiData || hasImported ? aggregateCredenciamento(filteredParticipantes) : null;

  const importedFiles = Array.from(
    importedParticipantes.reduce((map, p) => {
      const key = p.sourceFile ?? "";
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  );

  async function loadImported() {
    if (!editionId) return;
    const res = await fetch(`/api/credenciamento/import?editionId=${editionId}`);
    if (res.ok) {
      const participantes: Participante[] = await res.json();
      setImportedParticipantes(participantes);
      setCached(`credenciamento:${editionId}`, participantes);
      setLastUpdatedAt(res.headers.get("X-Last-Updated"));
    }
  }

  async function handleImported(participantes: Participante[], fileName: string) {
    if (!editionId) {
      notifyWarning("Selecione uma edição primeiro", "Escolha (ou crie) uma edição do evento antes de importar a planilha — sem isso não há onde salvar os dados.");
      return;
    }
    setImportedParticipantes((prev) => {
      const next = mergeImportedParticipantes(prev, participantes, fileName);
      setCached(`credenciamento:${editionId}`, next);
      return next;
    });
    const res = await fetch("/api/credenciamento/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editionId, sourceFile: fileName, participantes }),
    });
    if (!res.ok) {
      loadImported();
      notifyError("Falha ao importar planilha", "Os dados não foram salvos — tente novamente em instantes.");
      return;
    }
    notifySuccess("Planilha importada", `${participantes.length} linha(s) de "${fileName}" foram salvas.`);
  }

  async function removeImportedFile(fileName: string) {
    if (!editionId) return;
    setImportedParticipantes((prev) => {
      const next = prev.filter((p) => p.sourceFile !== fileName);
      setCached(`credenciamento:${editionId}`, next);
      return next;
    });
    const res = await fetch(`/api/credenciamento/import?editionId=${editionId}&sourceFile=${encodeURIComponent(fileName)}`, {
      method: "DELETE",
    });
    if (!res.ok) loadImported();
  }

  const KPI_DEFS = [
    { key: "totalCredenciados", label: t("credenciamento.kpi.total"), fmt: int },
    { key: "presencaConfirmada", label: t("credenciamento.kpi.presenca"), fmt: int },
    { key: "checkinsRealizados", label: t("credenciamento.kpi.checkins"), fmt: int },
    { key: "taxaComparecimento", label: t("credenciamento.kpi.taxa"), fmt: pct },
  ] as const;

  const STATUS_LABEL: Record<string, string> = {
    credenciado: t("status.credenciado"),
    pendente: t("status.pendente"),
    cancelado: t("status.cancelado"),
  };
  const STATUS_CLASS: Record<string, string> = { credenciado: "pago", pendente: "pendente", cancelado: "atrasado" };

  async function load() {
    setConnState("pending");
    try {
      const result = await fetchCredenciamento({ eventId, editionId }, { period, categoria, status: statusFilter, search });
      setApiData(result);
      setConnState(result ? "connected" : "pending");
    } catch (err) {
      console.error("Credenciamento: falha ao carregar dados", err);
      setConnState("error");
    }
  }

  useEffect(() => {
    setImportedParticipantes(getCached<Participante[]>(`credenciamento:${editionId}`) ?? []);
    loadImported();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, editionId, period, categoria]);

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t("credenciamento.title")}</h1>
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
          {canManageData && !apiData && <SpreadsheetImportCredenciamento eventId={eventId} onImported={handleImported} />}
          {canManageData && (
            <button className="btn primary" type="button" onClick={load}>
              {t("common.sync")}
            </button>
          )}
        </div>
      </div>

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

      <div className="segbar">
        <div className="seg">
          {(["all", "30d", "7d", "custom"] as const).map((v) => (
            <button key={v} className={period === v ? "on" : ""} onClick={() => setPeriod(v)}>
              {{ all: t("common.all"), "30d": t("common.last30"), "7d": t("common.last7"), custom: t("common.custom") }[v]}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={categoria === "all" ? "on" : ""} onClick={() => setCategoria("all")}>
            {t("common.allCategories")}
          </button>
          {categorias.map((c) => (
            <button key={c} className={categoria === c ? "on" : ""} onClick={() => setCategoria(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["all", "credenciado", "pendente", "cancelado"] as const).map((v) => (
            <button key={v} className={statusFilter === v ? "on" : ""} onClick={() => setStatusFilter(v)}>
              {v === "all" ? t("common.allStatus") : STATUS_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="search">
          <input type="text" placeholder={t("credenciamento.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <KpiRow
        defs={KPI_DEFS}
        values={canManageData ? { ...data?.kpis, ...kpiOverrides } : data?.kpis}
        editable={canManageData}
        onEditValue={(key, v) => setKpiOverrides((prev) => ({ ...prev, [key]: v }))}
      />

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("credenciamento.timeline.title")}</h3>
              <p>{t("credenciamento.timeline.desc")}</p>
            </div>
            <div className="legend">
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: "var(--accent)" }} />
                {t("credenciamento.kpi.total").toLowerCase()}
              </span>
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: "var(--teal)" }} />
                {t("common.checkins")}
              </span>
            </div>
          </div>
          {!data?.timeline.length ? (
            <Empty glyph="⌁" title={t("credenciamento.timeline.empty.title")} desc={t("credenciamento.timeline.empty.desc")} />
          ) : (
            <LineChart
              data={data.timeline}
              series={[
                { key: "credenciados", color: "var(--accent)" },
                { key: "checkins", color: "var(--teal)" },
              ]}
              valueFmt={(v) => int(v)}
            />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>{t("credenciamento.categorias.title")}</h3>
              <p>{t("credenciamento.categorias.desc")}</p>
            </div>
          </div>
          {!data?.categorias.length ? (
            <Empty glyph="◈" title={t("credenciamento.categorias.empty.title")} desc={t("credenciamento.categorias.empty.desc")} />
          ) : (
            <Donut data={data.categorias} valueFmt={(v) => int(v)} />
          )}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-head">
          <div>
            <h3>{t("credenciamento.status.title")}</h3>
            <p>{t("credenciamento.status.desc")}</p>
          </div>
        </div>
        {!data?.statusBreakdown.length ? (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {(["credenciado", "pendente", "cancelado"] as const).map((s) => (
              <div className="status-row" style={{ border: "none", padding: 0, minWidth: 160 }} key={s}>
                <span className="status-left">
                  <span className={`badge ${STATUS_CLASS[s]}`}>
                    <span className="dot" />
                    {STATUS_LABEL[s]}
                  </span>
                </span>
                <span className="status-val">—</span>
              </div>
            ))}
          </div>
        ) : (
          <StatusBars data={data.statusBreakdown} labels={STATUS_LABEL} classMap={STATUS_CLASS} />
        )}
      </div>

      <div className="table-wrap">
        <div className="panel-head" style={{ padding: "16px 16px 0" }}>
          <div>
            <h3>{t("credenciamento.table.title")}</h3>
            <p>{t("credenciamento.table.desc")}</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("col.nome")}</th>
                <th>{t("col.documento")}</th>
                <th>{t("col.categoria")}</th>
                <th>{t("col.credenciadoEm")}</th>
                <th>{t("col.checkin")}</th>
                <th>{t("col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {!data?.participantes.length ? (
                <EmptyTableRow colSpan={6} title={t("credenciamento.table.empty.title")} desc={t("credenciamento.table.empty.desc")} />
              ) : (
                data.participantes.map((p, i) => (
                  // mesmo raciocínio do Financeiro: documento pode se repetir se a
                  // pessoa aparecer em mais de uma planilha/arquivo importado.
                  <tr key={`${p.documento}-${i}`}>
                    <td style={{ fontFamily: "var(--sans)", color: "var(--ink)" }}>{p.nome}</td>
                    <td>{p.documento}</td>
                    <td>{p.categoria}</td>
                    <td>{p.credenciadoEm || "—"}</td>
                    <td>{p.checkinEm || "—"}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[p.status]}`}>
                        <span className="dot" />
                        {STATUS_LABEL[p.status] || p.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>{data?.participantes.length ? `${data.participantes.length.toLocaleString("pt-BR")} ${t("credenciamento.table.count")}` : t("credenciamento.table.countZero")}</span>
          <span>{t("common.page")}</span>
        </div>
      </div>

      <div className="footnote">{t("credenciamento.footnote")}</div>
    </>
  );
}
