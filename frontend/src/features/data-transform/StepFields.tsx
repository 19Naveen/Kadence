import { useEffect, useState, type ReactNode } from "react";
import { Calendar, ToggleLeft } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { useQueryApi, type DatasetPreview, type DatasetSummary } from "../../lib/hooks/useDatasets";
import type { Column, FieldDef, Table, TransformParams } from "../../lib/transforms/transforms";

/** Power Query-style type glyph shown before a column name. */
export function TypeGlyph({ type, className }: { type: string; className?: string }) {
  const base = cn("inline-flex w-6 shrink-0 justify-center font-mono text-[10px] font-medium text-text-tertiary", className);
  if (type === "timestamp") return <Calendar size={12} className={cn("shrink-0 text-text-tertiary", className)} aria-label="date" />;
  if (type === "boolean") return <ToggleLeft size={13} className={cn("shrink-0 text-text-tertiary", className)} aria-label="true/false" />;
  return <span className={base} aria-label={type}>{type === "integer" ? "123" : type === "decimal" ? "1.2" : "ABC"}</span>;
}

export function FieldShell({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function ColumnSelect({ id, columns, value, onChange, placeholder = "Choose a column" }: {
  id?: string; columns: Column[]; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <select id={id} className="input font-mono" value={value} onChange={(e) => onChange(e.target.value)}>
      {!columns.some((c) => c.name === value) && <option value={value}>{value || placeholder}</option>}
      {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  );
}

export function FieldInput({ field, value, onChange, columns }: {
  field: FieldDef; value: TransformParams[string]; onChange: (v: TransformParams[string]) => void; columns: Column[];
}) {
  const id = `field-${field.key}`;
  if (field.kind === "column") {
    return <FieldShell label={field.label} htmlFor={id}><ColumnSelect id={id} columns={columns} value={String(value ?? "")} onChange={onChange} /></FieldShell>;
  }
  if (field.kind === "columns") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <FieldShell label={field.label}>
        <div className="mb-1 flex gap-3 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={() => onChange(columns.map((c) => c.name))}>Select all</button>
          <button type="button" className="text-text-secondary hover:underline" onClick={() => onChange([])}>Clear</button>
          <span className="ml-auto text-text-tertiary">{chosen.length} of {columns.length}</span>
        </div>
        <ul className="max-h-64 overflow-y-auto rounded-md border border-border">
          {columns.map((c) => (
            <li key={c.name} className="border-b border-border-subtle last:border-0">
              <label className="flex h-8 cursor-pointer items-center gap-2 px-2.5 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={chosen.includes(c.name)}
                  // Keep the dataset's column order regardless of click order
                  onChange={(e) => onChange(columns.map((x) => x.name).filter((n) => (n === c.name ? e.target.checked : chosen.includes(n))))}
                />
                <TypeGlyph type={c.type} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{c.name}</span>
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

/** "In the preview: 1,180 rows (−24) · 9 columns (+1)". */
export function ResultSummary({ input, output }: { input: Table; output: Table }) {
  const dRows = output.rows.length - input.rows.length;
  const dCols = output.columns.length - input.columns.length;
  const delta = (d: number) => (
    <span className={cn("font-medium", d < 0 ? "text-signal" : "text-primary")}> ({d > 0 ? "+" : "−"}{formatCount(Math.abs(d))})</span>
  );
  return (
    <p className="tabular text-[13px] text-text-secondary">
      Result in the preview: {formatCount(output.rows.length)} rows{dRows !== 0 && delta(dRows)} · {output.columns.length} columns{dCols !== 0 && delta(dCols)}
    </p>
  );
}

/** Load another dataset's columns and a small sample (for merge / append). */
export function useOtherDataset(datasetId: string, limit = 20) {
  const { preview } = useQueryApi();
  const [data, setData] = useState<DatasetPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!datasetId) { setData(null); setError(""); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    preview(datasetId, limit)
      .then((p) => { if (!cancelled) setData(p); })
      .catch((e) => { if (!cancelled) { setData(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [datasetId, limit, preview]);
  const table: Table | null = data
    ? { columns: data.columns.map((name) => ({ name, type: data.dataset_schema[name] ?? "string" })), rows: data.rows }
    : null;
  return { table, loading, error };
}

export function DatasetSelect({ id, label, value, onChange, datasets }: {
  id: string; label: string; value: string; onChange: (v: string) => void; datasets: DatasetSummary[];
}) {
  return (
    <FieldShell label={label} htmlFor={id} hint={datasets.length ? undefined : "There's no other dataset in this workspace yet. Import one first."}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!datasets.length}>
        <option value="">Choose a dataset</option>
        {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({formatCount(d.latest_row_count)} rows)</option>)}
      </select>
    </FieldShell>
  );
}
