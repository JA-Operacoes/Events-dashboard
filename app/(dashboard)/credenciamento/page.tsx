"use client";

import { useEffect, useMemo, useState, useDeferredValue, useRef } from "react";
import { useEvent } from "@/lib/eventContext";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { fetchCredenciamento, type CredenciamentoData, type CredenciamentoFilters, type Participante } from "@/lib/dataSource";
import { ConnChip, Empty, EmptyTableRow, KpiRow, int, money, pct } from "@/components/ui";
import { SpreadsheetImportCredenciamento } from "@/components/SpreadsheetImport";
import { aggregateCredenciamento, mergeImportedParticipantes } from "@/lib/spreadsheetImport";
import { Donut, StatusBars, LineChart } from "@/components/charts";
import { BarraDiasEvento, PaineisPublico } from "@/components/publico";
import { getCached, setCached } from "@/lib/pageCache";
import { useJanelaVirtual, ALTURA_LINHA_TABELA } from "@/lib/virtual";
import { enviarImportEmLotes } from "@/lib/importClient";
import { matchesPeriod, formatRelativeTime, parseDateLoose } from "@/lib/period";
import { notifySuccess, notifyWarning, notifyError } from "@/lib/swal";

export default function CredenciamentoPage() {
  const { eventId, editionId, event, edition } = useEvent();
  const { t } = useI18n();
  const { canManageData } = useAuth();
  const [period, setPeriod] = useState<CredenciamentoFilters["period"]>("all");
  const [categoria, setCategoria] = useState<CredenciamentoFilters["categoria"]>("all");
  const [statusFilter, setStatusFilter] = useState<CredenciamentoFilters["status"]>("all");
  const [search, setSearch] = useState("");
  // dia do evento: recorta cartões, painéis e tabela. Só aparece quando a
  // planilha traz a data do comparecimento.
  const [diaEvento, setDiaEvento] = useState("todos");
  /**
   * Busca adiada: digitar refiltra milhares de linhas e refaz a agregação a
   * cada tecla. Com useDeferredValue o campo responde na hora e o recálculo
   * acontece com a última letra digitada, sem travar a digitação.
   */
  const buscaAplicada = useDeferredValue(search);

  const [connState, setConnState] = useState<"pending" | "connected" | "error">("pending");
  const [apiData, setApiData] = useState<CredenciamentoData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [importedParticipantes, setImportedParticipantes] = useState<Participante[]>(
    () => getCached(`credenciamento:${editionId}`) ?? []
  );
  const hasImported = importedParticipantes.length > 0;
  const [kpiOverrides, setKpiOverrides] = useState<Partial<CredenciamentoData["kpis"]>>({});

  const rawParticipantes = apiData?.participantes ?? importedParticipantes;

  /**
   * Tabela virtualizada: só as linhas visíveis existem no DOM.
   *
   * O relatório de credenciamento traz dezenas de milhares de linhas — com sete
   * colunas, montar a lista inteira significa mais de setenta mil células, e a
   * página inteira trava: não só a rolagem, mas qualquer clique, porque o
   * navegador continua recalculando layout enquanto o resto da tela espera.
   */
  const areaTabela = useRef<HTMLDivElement>(null);

  const categorias = useMemo(
    () => Array.from(new Set(rawParticipantes.map((p) => p.categoria).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [rawParticipantes]
  );

  const filteredParticipantes = useMemo(() => {
    const term = buscaAplicada.trim().toLowerCase();
    return rawParticipantes.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (categoria !== "all" && p.categoria !== categoria) return false;
      if (!matchesPeriod(p.credenciadoEm, period)) return false;
      if (diaEvento !== "todos" && p.ingresso?.dataComparecimento?.trim() !== diaEvento) return false;
      if (term && !`${p.nome} ${p.documento}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rawParticipantes, statusFilter, categoria, period, buscaAplicada, diaEvento]);

  // Dias com movimento registrado. Saem da lista crua (e não do resultado já
  // filtrado) para os botões não sumirem conforme se escolhe um dia.
  const diasDoEvento = useMemo(() => {
    const dias = new Set<string>();
    for (const p of rawParticipantes) {
      const d = p.ingresso?.dataComparecimento?.trim();
      if (d) dias.add(d);
    }
    return Array.from(dias).sort((a, b) => parseDateLoose(a) - parseDateLoose(b));
  }, [rawParticipantes]);

  // Público por dia ignorando o filtro de dia: com ele, o gráfico viraria uma
  // barra só e não haveria com o que comparar o dia escolhido.
  const publicoPorDia = useMemo(() => {
    const porDia = new Map<string, number>();
    for (const p of rawParticipantes) {
      if (statusFilter !== "all" && p.status !== statusFilter) continue;
      if (categoria !== "all" && p.categoria !== categoria) continue;
      const d = p.ingresso?.dataComparecimento?.trim();
      if (d) porDia.set(d, (porDia.get(d) ?? 0) + 1);
    }
    return Array.from(porDia, ([name, value]) => ({ name, value })).sort(
      (a, b) => parseDateLoose(a.name) - parseDateLoose(b.name)
    );
  }, [rawParticipantes, statusFilter, categoria]);

  const data = useMemo(
    () => (apiData || hasImported ? aggregateCredenciamento(filteredParticipantes) : null),
    [apiData, hasImported, filteredParticipantes]
  );

  const linhasTabela = data?.participantes ?? [];
  const janela = useJanelaVirtual(areaTabela, linhasTabela.length, ALTURA_LINHA_TABELA);
  const linhasNaTela = linhasTabela.slice(janela.inicio, janela.fim);

  // filtro novo devolve lista nova: a rolagem antiga não corresponde a nada nela,
  // e a tabela abriria no meio do resultado
  const assinaturaFiltros = `${buscaAplicada}|${statusFilter}|${categoria}|${period}|${diaEvento}`;
  useEffect(() => {
    areaTabela.current?.scrollTo({ top: 0 });
  }, [assinaturaFiltros]);

  // A coluna de valor só aparece quando a planilha traz o dado; sem isso seria
  // uma coluna inteira de traços.
  const mostrarValor = rawParticipantes.some((p) => p.valor != null);
  const colunasTabela = mostrarValor ? 7 : 6;

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
    const proximo = mergeImportedParticipantes(importedParticipantes, participantes, fileName);
    setImportedParticipantes(proximo);
    setCached(`credenciamento:${editionId}`, proximo);

    const r = await enviarImportEmLotes("/api/credenciamento/import", editionId, fileName, "participantes", participantes);
    if (!r.ok) {
      loadImported();
      notifyError("Falha ao importar planilha", r.erro);
      return;
    }
    notifySuccess("Planilha importada", `${participantes.length.toLocaleString("pt-BR")} linha(s) de "${fileName}" foram salvas.`);
    loadImported();
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

      <BarraDiasEvento dias={diasDoEvento} selecionado={diaEvento} onSelecionar={setDiaEvento} />

      {/* Leitura do público — comparecimento, fluxo e perfil de quem veio.
          Só aparece quando a planilha importada traz essas colunas. */}
      {data?.publico && (
        <PaineisPublico
          publico={data.publico}
          publicoPorDia={publicoPorDia}
          diaSelecionado={diaEvento}
          onSelecionarDia={setDiaEvento}
        />
      )}

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
            {categoria !== "all" && (
              <button className="btn primary btn-ver-tudo" type="button" onClick={() => setCategoria("all")}>
                ↩ Ver todas as categorias
              </button>
            )}
          </div>
          {!data?.categorias.length ? (
            <Empty glyph="◈" title={t("credenciamento.categorias.empty.title")} desc={t("credenciamento.categorias.empty.desc")} />
          ) : (
            /* clicar na fatia recorta a tela para aquela categoria, como no
               operacional — e o botão acima devolve a visão completa */
            <Donut
              data={data.categorias}
              valueFmt={(v) => int(v)}
              legenda={{ nome: "Categoria", valor: "Qtd" }}
              selected={categoria === "all" ? undefined : categoria}
              onSelect={(nome) => setCategoria((atual) => (atual === nome ? "all" : nome))}
            />
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
        <div className="table-scroll scroll-slim" ref={areaTabela}>
          <table>
            <thead>
              <tr>
                <th>{t("col.nome")}</th>
                <th>{t("col.documento")}</th>
                <th>{t("col.categoria")}</th>
                <th>{t("col.credenciadoEm")}</th>
                <th>{t("col.checkin")}</th>
                {mostrarValor && <th className="num">Valor pago</th>}
                <th>{t("col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {!linhasTabela.length ? (
                <EmptyTableRow
                  colSpan={colunasTabela}
                  title={t("credenciamento.table.empty.title")}
                  desc={t("credenciamento.table.empty.desc")}
                />
              ) : (
                <>
                  {/* o espaço das linhas que ficaram fora da janela: mantém a
                      barra de rolagem fiel ao total */}
                  {janela.espacoAntes > 0 && (
                    <tr aria-hidden="true" className="linha-espacadora" style={{ height: janela.espacoAntes }}>
                      <td colSpan={colunasTabela} />
                    </tr>
                  )}
                  {linhasNaTela.map((p, i) => (
                  // mesmo raciocínio do Financeiro: documento pode se repetir se a
                  // pessoa aparecer em mais de uma planilha/arquivo importado.
                  <tr key={`${p.documento}-${janela.inicio + i}`}>
                    <td className="td-nome">
                      <span className="td-nome-texto">{p.nome}</span>
                    </td>
                    <td>{p.documento}</td>
                    <td>{p.categoria}</td>
                    <td>{p.credenciadoEm || "—"}</td>
                    <td>{p.checkinEm || "—"}</td>
                    {mostrarValor && <td className="num">{p.valor != null ? money(p.valor) : "—"}</td>}
                    <td>
                      <span className={`badge ${STATUS_CLASS[p.status]}`}>
                        <span className="dot" />
                        {STATUS_LABEL[p.status] || p.status}
                      </span>
                    </td>
                  </tr>
                  ))}
                  {janela.espacoDepois > 0 && (
                    <tr aria-hidden="true" className="linha-espacadora" style={{ height: janela.espacoDepois }}>
                      <td colSpan={colunasTabela} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            {linhasTabela.length
              ? `${linhasTabela.length.toLocaleString("pt-BR")} ${t("credenciamento.table.count")}`
              : t("credenciamento.table.countZero")}
          </span>
        </div>
      </div>

    </>
  );
}
