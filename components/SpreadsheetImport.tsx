"use client";

import { useRef, useState } from "react";
import {
  parseSpreadsheetFile,
  distinctValues,
  saveMapping,
  loadMapping,
  suggestFinanceiroMapping,
  suggestFinanceiroStatusMapping,
  mapRowsToInvoices,
  suggestCredenciamentoMapping,
  suggestCredenciamentoStatusMapping,
  mapRowsToParticipantes,
  FINANCEIRO_FIELDS,
  CREDENCIAMENTO_FIELDS,
  type SheetTable,
  type ColumnMapping,
  type StatusMapping,
  type FinanceiroFieldKey,
  type CredenciamentoFieldKey,
} from "@/lib/spreadsheetImport";
import type { Invoice, InvoiceStatus, Participante, CredenciamentoStatus } from "@/lib/dataSource";

type FieldDef<K extends string> = { key: K; label: string; required: boolean };

function SpreadsheetImportPanel<K extends string, V extends string, T>({
  eventId,
  module,
  title,
  description,
  fields,
  statusOptions,
  suggestMappingFn,
  suggestStatusMappingFn,
  mapRowsFn,
  onImported,
}: {
  eventId: string | null;
  module: string;
  title: string;
  description: string;
  fields: readonly FieldDef<K>[];
  statusOptions: { value: V; label: string }[];
  suggestMappingFn: (headers: string[]) => ColumnMapping<K>;
  suggestStatusMappingFn: (values: string[]) => StatusMapping<V>;
  mapRowsFn: (table: SheetTable, mapping: ColumnMapping<K>, statusMapping: StatusMapping<V>, sourceFile: string) => T[];
  onImported: (rows: T[], fileName: string) => void;
}) {
  // Todo módulo de importação tem um campo "status" que precisa de de-para de valores —
  // é assinalado como convenção pelas union types (FinanceiroFieldKey/CredenciamentoFieldKey).
  const STATUS_KEY = "status" as K;

  const [open, setOpen] = useState(false);
  const [table, setTable] = useState<SheetTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping<K>>({});
  const [statusMapping, setStatusMapping] = useState<StatusMapping<V>>({});
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  // Upload em lote: quando mais de um arquivo é escolhido de uma vez, os que
  // têm exatamente o mesmo cabeçalho do primeiro (mesmo mapeamento) são
  // importados automaticamente em sequência — só pausa pra pedir mapeamento
  // de novo quando encontra um arquivo com colunas diferentes.
  const queueRef = useRef<File[]>([]);
  const lastMappingRef = useRef<{ headers: string[]; mapping: ColumnMapping<K>; statusMapping: StatusMapping<V> } | null>(null);
  const [batchTotal, setBatchTotal] = useState(0);
  const [imported, setImported] = useState<{ fileName: string; rows: number }[]>([]);
  const [skipped, setSkipped] = useState<{ fileName: string; reason: string }[]>([]);
  const [processing, setProcessing] = useState(false);

  function sameHeaders(a: string[], b: string[]) {
    return a.length === b.length && a.every((h, i) => h === b[i]);
  }

  async function loadTableFor(file: File): Promise<SheetTable | null> {
    try {
      return await parseSpreadsheetFile(file);
    } catch (err) {
      setSkipped((prev) => [...prev, { fileName: file.name, reason: err instanceof Error ? err.message : "Falha ao ler a planilha" }]);
      return null;
    }
  }

  function applyMappingFor(parsed: SheetTable) {
    const saved = loadMapping<K, V>(module, eventId!);
    const savedValid = saved && Object.values(saved.mapping).every((col) => !col || parsed.headers.includes(col as string));
    const nextMapping = savedValid ? saved!.mapping : suggestMappingFn(parsed.headers);
    setMapping(nextMapping);

    const statusCol = nextMapping[STATUS_KEY];
    if (statusCol) {
      const values = distinctValues(parsed, statusCol);
      const suggested = suggestStatusMappingFn(values);
      setStatusMapping(savedValid ? { ...suggested, ...saved!.statusMapping } : suggested);
    } else {
      setStatusMapping({});
    }
  }

  // Processa a fila: importa direto todo arquivo cujo cabeçalho bate com o
  // último mapeamento confirmado; para no primeiro que não bater, pra revisão manual.
  async function drainQueue() {
    setProcessing(true);
    while (queueRef.current.length > 0) {
      const file = queueRef.current[0];
      const parsed = await loadTableFor(file);
      queueRef.current = queueRef.current.slice(1);
      if (!parsed) continue;

      const last = lastMappingRef.current;
      if (last && sameHeaders(parsed.headers, last.headers)) {
        const rows = mapRowsFn(parsed, last.mapping, last.statusMapping, file.name);
        onImported(rows, file.name);
        setImported((prev) => [...prev, { fileName: file.name, rows: rows.length }]);
        continue;
      }

      // cabeçalho diferente (ou é o primeiro arquivo) — pausa a fila e pede revisão manual.
      setTable(parsed);
      setFileName(file.name);
      applyMappingFor(parsed);
      setProcessing(false);
      return;
    }
    setProcessing(false);
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !eventId) return;
    setError(null);
    setImported([]);
    setSkipped([]);
    lastMappingRef.current = null;
    setBatchTotal(files.length);
    queueRef.current = files;
    await drainQueue();
  }

  const statusValues = table && mapping[STATUS_KEY] ? distinctValues(table, mapping[STATUS_KEY]!) : [];
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
  const missingStatusMap = statusValues.some((v) => !statusMapping[v]);
  const canConfirm = table && missingRequired.length === 0 && statusValues.length > 0 && !missingStatusMap;

  function reset() {
    setTable(null);
    setFileName("");
    setError(null);
    setBatchTotal(0);
    setImported([]);
    setSkipped([]);
    queueRef.current = [];
    lastMappingRef.current = null;
  }

  // "Trocar arquivo" descarta só o que está em revisão — se houver mais
  // arquivos na fila do lote, eles continuam esperando.
  function resetCurrent() {
    setTable(null);
    setFileName("");
    setError(null);
  }

  // Em lote, "trocar arquivo" não faz sentido (não tem como escolher um
  // substituto no meio da fila) — em vez disso pula esse arquivo e segue pro próximo.
  async function handleSkipCurrent() {
    setSkipped((prev) => [...prev, { fileName, reason: "pulado manualmente" }]);
    setTable(null);
    setFileName("");
    if (queueRef.current.length > 0) {
      await drainQueue();
    } else {
      setOpen(false);
      reset();
    }
  }

  async function handleConfirm() {
    if (!table || !eventId || !canConfirm) return;
    const rows = mapRowsFn(table, mapping, statusMapping, fileName);
    saveMapping(module, eventId, mapping, statusMapping);
    onImported(rows, fileName);
    setImported((prev) => [...prev, { fileName, rows: rows.length }]);
    lastMappingRef.current = { headers: table.headers, mapping, statusMapping };
    setTable(null);
    setFileName("");

    if (queueRef.current.length > 0) {
      await drainQueue();
      return;
    }
    if (batchTotal <= 1) {
      setOpen(false);
      reset();
    }
  }

  if (!open) {
    return (
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        Importar planilha
      </button>
    );
  }

  return (
    <div className="import-panel">
      <div className="import-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Fechar
        </button>
      </div>

      {!table && !processing && batchTotal === 0 && (
        <div className="import-upload">
          <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleFiles} />
          <div className="import-hint">Formatos aceitos: .xlsx, .xls ou .csv — pode selecionar vários arquivos de uma vez</div>
          {error && <div className="import-error">{error}</div>}
        </div>
      )}

      {processing && (
        <div className="import-file-info">Processando lote… {imported.length + skipped.length} de {batchTotal} arquivo(s)</div>
      )}

      {!table && !processing && batchTotal > 0 && (
        <>
          <div className="import-batch-summary">
            <p className="section-label" style={{ margin: "0 0 8px" }}>
              Lote concluído — {imported.length} de {batchTotal} arquivo(s) importado(s)
            </p>
            {imported.map((f) => (
              <div className="import-status-row" key={f.fileName}>
                <span>{f.fileName}</span>
                <span style={{ color: "var(--good)" }}>{f.rows} linha(s)</span>
              </div>
            ))}
            {skipped.map((f) => (
              <div className="import-status-row" key={f.fileName}>
                <span>{f.fileName}</span>
                <span style={{ color: "var(--red)" }}>{f.reason}</span>
              </div>
            ))}
          </div>
          <div className="import-actions">
            <button className="btn" type="button" onClick={reset}>
              Selecionar mais arquivos
            </button>
            <button className="btn primary" type="button" onClick={() => { setOpen(false); reset(); }}>
              Fechar
            </button>
          </div>
        </>
      )}

      {table && (
        <>
          <div className="import-file-info">
            <strong>{fileName}</strong> · {table.rows.length} linhas · {table.headers.length} colunas
            {batchTotal > 1 && ` · arquivo ${imported.length + skipped.length + 1} de ${batchTotal}`}
          </div>

          <div className="import-grid">
            {fields.map((f) => (
              <label className="import-field" key={f.key}>
                <span>
                  {f.label} {f.required && <em>*</em>}
                </span>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => {
                    const col = e.target.value || undefined;
                    setMapping((prev) => ({ ...prev, [f.key]: col }));
                    if (f.key === "status") {
                      setStatusMapping(col && table ? suggestStatusMappingFn(distinctValues(table, col)) : {});
                    }
                  }}
                >
                  <option value="">— não usar —</option>
                  {table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {mapping[STATUS_KEY] && (
            <div className="import-status-map">
              <p className="section-label" style={{ margin: "14px 2px 8px" }}>
                De-para de status ({statusValues.length} valor(es) encontrado(s) na coluna &quot;{mapping[STATUS_KEY]}&quot;)
              </p>
              {statusValues.map((v) => (
                <div className="import-status-row" key={v}>
                  <span>{v || "(vazio)"}</span>
                  <select
                    value={statusMapping[v] ?? ""}
                    onChange={(e) => setStatusMapping((prev) => ({ ...prev, [v]: e.target.value as V }))}
                  >
                    <option value="">— escolher —</option>
                    {statusOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <div className="import-actions">
            {batchTotal > 1 ? (
              <button className="btn" type="button" onClick={handleSkipCurrent}>
                Pular este arquivo
              </button>
            ) : (
              <button className="btn" type="button" onClick={resetCurrent}>
                Trocar arquivo
              </button>
            )}
            <button className="btn primary" type="button" disabled={!canConfirm} onClick={handleConfirm}>
              Usar esses dados
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const FINANCEIRO_STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "pago", label: "Pago" },
  { value: "pendente", label: "Pendente" },
  { value: "atrasado", label: "Atrasado" },
  { value: "cancelado", label: "Cancelado" },
];

export function SpreadsheetImportFinanceiro({
  eventId,
  onImported,
}: {
  eventId: string | null;
  onImported: (invoices: Invoice[], fileName: string) => void;
}) {
  return (
    <SpreadsheetImportPanel<FinanceiroFieldKey, InvoiceStatus, Invoice>
      eventId={eventId}
      module="financeiro"
      title="Importar planilha — Financeiro"
      description="Selecione um ou vários arquivos de uma vez — os que tiverem o mesmo cabeçalho do primeiro são importados em lote automaticamente; também dá pra subir de novo sempre que atualizar — reenviar um arquivo com o mesmo nome substitui só as linhas dele, arquivos diferentes se somam. O mapeamento abaixo já vem sugerido pelo nome das colunas — confira e ajuste só o que estiver errado."
      fields={FINANCEIRO_FIELDS}
      statusOptions={FINANCEIRO_STATUS_OPTIONS}
      suggestMappingFn={suggestFinanceiroMapping}
      suggestStatusMappingFn={suggestFinanceiroStatusMapping}
      mapRowsFn={mapRowsToInvoices}
      onImported={onImported}
    />
  );
}

const CREDENCIAMENTO_STATUS_OPTIONS: { value: CredenciamentoStatus; label: string }[] = [
  { value: "credenciado", label: "Credenciado" },
  { value: "pendente", label: "Pendente" },
  { value: "cancelado", label: "Cancelado" },
];

export function SpreadsheetImportCredenciamento({
  eventId,
  onImported,
}: {
  eventId: string | null;
  onImported: (participantes: Participante[], fileName: string) => void;
}) {
  return (
    <SpreadsheetImportPanel<CredenciamentoFieldKey, CredenciamentoStatus, Participante>
      eventId={eventId}
      module="credenciamento"
      title="Importar planilha — Credenciamento"
      description="Selecione um ou vários arquivos de uma vez — os que tiverem o mesmo cabeçalho do primeiro são importados em lote automaticamente; também dá pra subir de novo sempre que atualizar — reenviar um arquivo com o mesmo nome substitui só as linhas dele, arquivos diferentes se somam. O mapeamento abaixo já vem sugerido pelo nome das colunas — confira e ajuste só o que estiver errado."
      fields={CREDENCIAMENTO_FIELDS}
      statusOptions={CREDENCIAMENTO_STATUS_OPTIONS}
      suggestMappingFn={suggestCredenciamentoMapping}
      suggestStatusMappingFn={suggestCredenciamentoStatusMapping}
      mapRowsFn={mapRowsToParticipantes}
      onImported={onImported}
    />
  );
}
