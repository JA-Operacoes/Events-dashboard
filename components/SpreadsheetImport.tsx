"use client";

import { useState } from "react";
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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    setError(null);
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheetFile(file);
      setTable(parsed);

      const saved = loadMapping<K, V>(module, eventId);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ler a planilha");
      setTable(null);
    }
  }

  const statusValues = table && mapping[STATUS_KEY] ? distinctValues(table, mapping[STATUS_KEY]!) : [];
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
  const missingStatusMap = statusValues.some((v) => !statusMapping[v]);
  const canConfirm = table && missingRequired.length === 0 && statusValues.length > 0 && !missingStatusMap;

  function reset() {
    setTable(null);
    setFileName("");
    setError(null);
  }

  function handleConfirm() {
    if (!table || !eventId || !canConfirm) return;
    const rows = mapRowsFn(table, mapping, statusMapping, fileName);
    saveMapping(module, eventId, mapping, statusMapping);
    onImported(rows, fileName);
    setOpen(false);
    reset();
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

      {!table && (
        <div className="import-upload">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
          {error && <div className="import-error">{error}</div>}
        </div>
      )}

      {table && (
        <>
          <div className="import-file-info">
            <strong>{fileName}</strong> · {table.rows.length} linhas · {table.headers.length} colunas
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
            <button className="btn" type="button" onClick={reset}>
              Trocar arquivo
            </button>
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
      description="Pode subir mais de uma planilha, e subir de novo sempre que atualizar — reenviar um arquivo com o mesmo nome substitui só as linhas dele, arquivos diferentes se somam. O mapeamento abaixo já vem sugerido pelo nome das colunas — confira e ajuste só o que estiver errado."
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
      description="Pode subir mais de uma planilha, e subir de novo sempre que atualizar — reenviar um arquivo com o mesmo nome substitui só as linhas dele, arquivos diferentes se somam. O mapeamento abaixo já vem sugerido pelo nome das colunas — confira e ajuste só o que estiver errado."
      fields={CREDENCIAMENTO_FIELDS}
      statusOptions={CREDENCIAMENTO_STATUS_OPTIONS}
      suggestMappingFn={suggestCredenciamentoMapping}
      suggestStatusMappingFn={suggestCredenciamentoStatusMapping}
      mapRowsFn={mapRowsToParticipantes}
      onImported={onImported}
    />
  );
}
