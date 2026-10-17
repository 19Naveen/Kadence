import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount, plural } from "../../lib/format";
import { useQueryApi, type DatasetPreview, type DatasetSummary } from "../../lib/hooks/useDatasets";
import { suggestJoinKeys } from "../../lib/transforms/joinKeys";
import { OPS, VALUELESS_FILTERS, type Column, type FieldDef, type Table, type TransformParams } from "../../lib/transforms/transforms";
import type { Snapshot } from "./usePipeline";

interface StepEditorProps {
  op: string;
  params: TransformParams;
  onChange: (params: TransformParams) => void;
  input: Table;                 // the data this step receives
  draft: Snapshot | null;       // the data after applying the draft step
  draftLoading: boolean;
  datasets: DatasetSummary[];   // candidates for join/append (current dataset already excluded)
  editing: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export function StepEditor({ op, params, onChange, input, draft, draftLoading, datasets, editing, onSubmit, onCancel }: StepEditorProps) {
  const def = OPS[op];
  const set = (key: string, value: TransformParams[string]) => onChange({ ...params, [key]: value });
  const canSubmit = !!draft && !draft.error && !draftLoading;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit(); }}
      className="flex h-full flex-col"
      aria-label={editing ? `Edit ${def?.label}` : `Add ${def?.label}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="section-label">{editing ? "Edit step" : "New step"}</p>
          <h2 className="mt-0.5 text-base font-semibold">{def?.label ?? op}</h2>
          <p className="text-xs text-text-secondary">{def?.desc}</p>
        </div>
        <button type="button" className="btn-icon -mr-2" aria-label="Close editor" onClick={onCancel}><X size={17} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {op === "join" ? (
          <JoinBuilder params={params} set={set} onChange={onChange} input={input} draft={draft} draftLoading={draftLoading} datasets={datasets} />
        ) : op === "append" ? (
          <AppendBuilder params={params} set={set} input={input} draft={draft} draftLoading={draftLoading} datasets={datasets} />
        ) : (
          def?.fields
            .filter((f) => !(op === "filter" && f.key === "value" && VALUELESS_FILTERS.has(String(params.op))))
            .filter((f) => !(op === "fillna" && f.key === "value" && params.strategy !== "value"))
            .filter((f) => !(op === "group" && f.key === "column" && params.agg === "count"))
            .map((f) => <FieldInput key={f.key} field={f} value={params[f.key]} onChange={(v) => set(f.key, v)} columns={input.columns} />)
        )}

        {op !== "join" && op !== "append" && draft && (
          draft.error ? (
            <p role="alert" className="rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger">{draft.error}</p>
          ) : (
            <ResultSummary input={input} output={draft.table} />
          )
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {draftLoading && <LoaderCircle size={15} className="animate-spin" />}
          {editing ? "Save step" : "Add step"}
        </button>
      </div>
    </form>
  );
}

function ResultSummary({ input, output }: { input: Table; output: Table }) {
  const dRows = output.rows.length - input.rows.length;
  const dCols = output.columns.length - input.columns.length;
  return (
    <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-secondary">
      In the preview: {plural(output.rows.length, "row")}
      {dRows !== 0 && <span className={cn("font-semibold", dRows < 0 ? "text-signal" : "text-primary")}> ({dRows > 0 ? "+" : "−"}{formatCount(Math.abs(dRows))})</span>}
      {" · "}{plural(output.columns.length, "column")}
      {dCols !== 0 && <span className={cn("font-semibold", dCols < 0 ? "text-signal" : "text-primary")}> ({dCols > 0 ? "+" : "−"}{Math.abs(dCols)})</span>}
    </p>
  );
}

// ── Generic field input ──────────────────────────────────────────────────────

function FieldShell({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function FieldInput({ field, value, onChange, columns }: {
  field: FieldDef; value: TransformParams[string]; onChange: (v: TransformParams[string]) => void; columns: Column[];
}) {
  const id = `field-${field.key}`;
  if (field.kind === "column") {
    return (
      <FieldShell label={field.label} htmlFor={id}>
        <ColumnSelect id={id} columns={columns} value={String(value ?? "")} onChange={onChange} />
      </FieldShell>
    );
  }
  if (field.kind === "columns") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <FieldShell label={field.label}>
        <div className="mb-1.5 flex gap-2 text-xs">
          <button type="button" className="font-semibold text-primary" onClick={() => onChange(columns.map((c) => c.name))}>Select all</button>
          <button type="button" className="font-semibold text-text-secondary" onClick={() => onChange([])}>Clear</button>
          <span className="ml-auto text-text-tertiary">{chosen.length} of {columns.length}</span>
        </div>
        <ul className="max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
          {columns.map((c) => (
            <li key={c.name}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={chosen.includes(c.name)}
                  // Keep the dataset's column order regardless of click order
                  onChange={(e) => onChange(columns.map((x) => x.name).filter((n) => (n === c.name ? e.target.checked : chosen.includes(n))))}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{c.name}</span>
                <TypeChip type={c.type} />
              </label>
            </li>
          ))}
        </ul>
      </FieldShell>
    );
  }
  if (field.kind === "select") {
    return (
      <FieldShell label={field.label} htmlFor={id}>
        <select id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => <option key={o} value={o}>{field.option_labels?.[o] ?? o}</option>)}
        </select>
      </FieldShell>
    );
  }
  if (field.kind === "number") {
    return (
      <FieldShell label={field.label} htmlFor={id}>
        <input id={id} type="number" className="input font-mono" placeholder={field.placeholder} value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
      </FieldShell>
    );
  }
  return (
    <FieldShell label={field.label} htmlFor={id}>
      <input id={id} className="input" placeholder={field.placeholder} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
    </FieldShell>
  );
}

const TYPE_STYLE: Record<string, string> = {
  integer: "bg-info-muted text-info", decimal: "bg-info-muted text-info",
  boolean: "bg-success-muted text-success", timestamp: "bg-warning-muted text-warning",
};

export function TypeChip({ type }: { type: string }) {
  return <span className={cn("badge shrink-0 font-mono font-medium", TYPE_STYLE[type] ?? "bg-surface-2 text-text-secondary")}>{type}</span>;
}

function ColumnSelect({ id, columns, value, onChange }: { id?: string; columns: Column[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} className="input font-mono text-[13px]" value={value} onChange={(e) => onChange(e.target.value)}>
      {!columns.some((c) => c.name === value) && <option value={value}>{value || "Choose a column"}</option>}
      {columns.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}
    </select>
  );
}

// ── Right-hand dataset loader (join / append) ────────────────────────────────

function useRightDataset(datasetId: string) {
  const { preview } = useQueryApi();
  const [data, setData] = useState<DatasetPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!datasetId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    preview(datasetId, 20)
      .then((p) => { if (!cancelled) setData(p); })
      .catch((e) => { if (!cancelled) { setData(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [datasetId, preview]);
  const columns: Column[] = data ? data.columns.map((name) => ({ name, type: data.dataset_schema[name] ?? "string" })) : [];
  return { data, columns, loading, error };
}

function DatasetSelect({ value, onChange, datasets }: { value: string; onChange: (v: string) => void; datasets: DatasetSummary[] }) {
  return (
    <FieldShell label="Dataset" htmlFor="field-dataset" hint={datasets.length ? undefined : "Import another dataset first — there's nothing else in this workspace yet."}>
      <select id="field-dataset" className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!datasets.length}>
        <option value="">Choose a dataset</option>
        {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} · {formatCount(d.latest_row_count)} rows</option>)}
      </select>
    </FieldShell>
  );
}

function samples(table: { columns: string[]; rows: unknown[][] } | null, col: string, n = 3): string {
  if (!table) return "";
  const i = table.columns.indexOf(col);
  if (i < 0) return "";
  const vals = [...new Set(table.rows.map((r) => r[i]).filter((v) => v !== null && v !== undefined).map(String))].slice(0, n);
  return vals.length ? `e.g. ${vals.join(", ")}` : "all empty in the sample";
}

// ── Join builder ─────────────────────────────────────────────────────────────

const JOIN_TYPES: { how: string; title: string; body: string }[] = [
  { how: "left", title: "All rows from this dataset", body: "Rows without a match get empty values for the new columns." },
  { how: "inner", title: "Only rows that match", body: "Drops rows that have no match on either side." },
  { how: "right", title: "All rows from the other dataset", body: "Keeps every row of the dataset you're joining in." },
  { how: "full", title: "All rows from both", body: "Keeps everything; unmatched cells are empty." },
];

function JoinBuilder({ params, set, onChange, input, draft, draftLoading, datasets }: {
  params: TransformParams;
  set: (k: string, v: TransformParams[string]) => void;
  onChange: (p: TransformParams) => void;
  input: Table;
  draft: Snapshot | null;
  draftLoading: boolean;
  datasets: DatasetSummary[];
}) {
  const datasetId = String(params.dataset_id ?? "");
  const right = useRightDataset(datasetId);
  const leftCols = input.columns;
  const leftKey = String(params.left_on ?? "");
  const rightKey = String(params.right_on ?? "");

  // When a dataset is chosen (or its schema arrives), suggest keys unless the current ones are valid.
  useEffect(() => {
    if (!right.columns.length) return;
    const rightNames = right.columns.map((c) => c.name);
    if (rightNames.includes(rightKey) && leftCols.some((c) => c.name === leftKey)) return;
    const k = suggestJoinKeys(leftCols.map((c) => c.name), rightNames);
    if (k) onChange({ ...params, ...k, how: params.how || "left" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [right.columns.length, datasetId]);

  const leftType = leftCols.find((c) => c.name === leftKey)?.type;
  const rightType = right.columns.find((c) => c.name === rightKey)?.type;
  const numeric = (t?: string) => t === "integer" || t === "decimal";
  const typeMismatch = leftType && rightType && leftType !== rightType && !(numeric(leftType) && numeric(rightType));

  const stats = useMemo(() => {
    if (!draft || draft.error) return null;
    const leftNames = new Set(leftCols.map((c) => c.name));
    const added = draft.table.columns.map((c, i) => ({ name: c.name, i })).filter((c) => !leftNames.has(c.name));
    const matched = draft.table.rows.filter((r) => added.some((c) => r[c.i] !== null && r[c.i] !== undefined)).length;
    return { added: added.map((c) => c.name), matched, total: draft.table.rows.length };
  }, [draft, leftCols]);

  const inputPreview = { columns: input.columns.map((c) => c.name), rows: input.rows };

  return (
    <>
      <DatasetSelect value={datasetId} onChange={(v) => onChange({ ...params, dataset_id: v, right_on: "" })} datasets={datasets} />
      {right.error && <p className="text-sm text-danger">{right.error}</p>}

      {datasetId && (
        <fieldset className="space-y-3">
          <legend className="field-label">Match rows where</legend>
          <div className="space-y-1.5">
            <ColumnSelect columns={leftCols} value={leftKey} onChange={(v) => set("left_on", v)} />
            <p className="truncate pl-1 text-xs text-text-tertiary">This dataset · {samples(inputPreview, leftKey)}</p>
          </div>
          <p className="text-center font-mono text-sm text-text-tertiary">equals</p>
          <div className="space-y-1.5">
            {right.loading ? (
              <div className="input flex items-center gap-2 text-text-tertiary"><LoaderCircle size={14} className="animate-spin" /> Loading columns…</div>
            ) : (
              <ColumnSelect columns={right.columns} value={rightKey} onChange={(v) => set("right_on", v)} />
            )}
            <p className="truncate pl-1 text-xs text-text-tertiary">Other dataset · {samples(right.data, rightKey)}</p>
          </div>
          {typeMismatch && (
            <p className="flex gap-2 rounded-lg bg-warning-muted px-3 py-2 text-xs text-warning">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              The keys have different types ({leftType} vs {rightType}), so values may not match. Add a “Change Type” step before the join if needed.
            </p>
          )}
        </fieldset>
      )}

      {datasetId && (
        <fieldset>
          <legend className="field-label">Keep</legend>
          <div className="space-y-1.5">
            {JOIN_TYPES.map((j) => (
              <label key={j.how} className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                params.how === j.how ? "border-primary bg-primary-muted/50" : "border-border hover:bg-surface-2",
              )}>
                <input type="radio" name="how" className="mt-1 accent-primary" checked={params.how === j.how} onChange={() => set("how", j.how)} />
                <span>
                  <span className="block text-sm font-semibold">{j.title}</span>
                  <span className="block text-xs text-text-secondary">{j.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {datasetId && (
        <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-text-secondary" aria-live="polite">
          {draftLoading ? (
            <span className="flex items-center gap-2"><LoaderCircle size={13} className="animate-spin" /> Previewing the join…</span>
          ) : draft?.error ? (
            <span className="text-danger">{draft.error}</span>
          ) : stats ? (
            <>
              <span className="block font-semibold text-text">
                {formatCount(stats.matched)} of {plural(stats.total, "preview row")} found a match
              </span>
              <span className="block">Adds {stats.added.length ? stats.added.join(", ") : "no new columns"}.</span>
            </>
          ) : (
            "Choose the matching columns to preview the result."
          )}
        </div>
      )}
    </>
  );
}

// ── Append builder ───────────────────────────────────────────────────────────

function AppendBuilder({ params, set, input, draft, draftLoading, datasets }: {
  params: TransformParams;
  set: (k: string, v: TransformParams[string]) => void;
  input: Table;
  draft: Snapshot | null;
  draftLoading: boolean;
  datasets: DatasetSummary[];
}) {
  const datasetId = String(params.dataset_id ?? "");
  const right = useRightDataset(datasetId);
  const here = input.columns.map((c) => c.name);
  const there = right.columns.map((c) => c.name);
  const both = here.filter((c) => there.includes(c));
  const onlyHere = here.filter((c) => !there.includes(c));
  const onlyThere = there.filter((c) => !here.includes(c));

  return (
    <>
      <DatasetSelect value={datasetId} onChange={(v) => set("dataset_id", v)} datasets={datasets} />
      {right.error && <p className="text-sm text-danger">{right.error}</p>}
      {datasetId && !right.loading && right.columns.length > 0 && (
        <div className="space-y-3 text-sm">
          <p className="field-label mb-0">How columns line up</p>
          <ColumnGroup title={`In both · ${both.length}`} names={both} tone="primary" />
          {onlyHere.length > 0 && <ColumnGroup title={`Only in this dataset · ${onlyHere.length}`} names={onlyHere} note="Appended rows get empty values here." />}
          {onlyThere.length > 0 && <ColumnGroup title={`Only in the other dataset · ${onlyThere.length}`} names={onlyThere} note="Added as new columns; existing rows get empty values." />}
          {both.length === 0 && (
            <p className="flex gap-2 rounded-lg bg-warning-muted px-3 py-2 text-xs text-warning">
              <AlertTriangle size={14} className="mt-px shrink-0" /> No column names match, so the rows won't line up. Rename columns first so they match.
            </p>
          )}
        </div>
      )}
      {datasetId && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-secondary" aria-live="polite">
          {draftLoading ? "Previewing…" : draft?.error ? <span className="text-danger">{draft.error}</span>
            : draft ? `In the preview: ${plural(draft.table.rows.length, "row")} after appending (the full dataset is appended when you save).` : ""}
        </p>
      )}
    </>
  );
}

function ColumnGroup({ title, names, note, tone }: { title: string; names: string[]; note?: string; tone?: "primary" }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-text-secondary">{title}</p>
      <div className="flex flex-wrap gap-1">
        {names.map((n) => (
          <span key={n} className={cn("badge font-mono font-medium", tone === "primary" ? "bg-primary-muted text-primary" : "bg-surface-2 text-text-secondary")}>{n}</span>
        ))}
      </div>
      {note && <p className="mt-1 text-xs text-text-tertiary">{note}</p>}
    </div>
  );
}
