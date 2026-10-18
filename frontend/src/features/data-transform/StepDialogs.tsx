import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Dialog } from "../../components/shared/Dialog";
import { cn } from "../../lib/cn";
import { formatCount, plural } from "../../lib/format";
import type { DatasetSummary } from "../../lib/hooks/useDatasets";
import { suggestJoinKeys } from "../../lib/transforms/joinKeys";
import { OPS, VALUELESS_FILTERS, previewStep, type Table, type TransformParams } from "../../lib/transforms/transforms";
import { DatasetSelect, FieldInput, ResultSummary, TypeGlyph, useOtherDataset } from "./StepFields";
import { runStep, type Snapshot } from "./usePipeline";

interface BaseProps {
  input: Table;
  editing: boolean;
  onClose: () => void;
  onSubmit: (params: TransformParams) => void;
}

// ── Generic step dialog ──────────────────────────────────────────────────────

export function StepDialog({ op, initial, input, editing, onClose, onSubmit, authHeaders }: BaseProps & {
  op: string; initial: TransformParams; authHeaders: () => Record<string, string>;
}) {
  const def = OPS[op];
  const [params, setParams] = useState(initial);
  const [draft, setDraft] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    runStep(input, { op, params }, authHeaders).then((s) => { if (!cancelled) setDraft(s); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, JSON.stringify(params), input]);

  const fields = (def?.fields ?? [])
    .filter((f) => !(op === "filter" && f.key === "value" && VALUELESS_FILTERS.has(String(params.op))))
    .filter((f) => !(op === "fillna" && f.key === "value" && params.strategy !== "value"))
    .filter((f) => !(op === "group" && f.key === "column" && params.agg === "count"));
  const ok = !!draft && !draft.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={def?.label ?? op}
      description={def?.desc}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ok} onClick={() => onSubmit(params)}>{editing ? "Save" : "OK"}</button>
        </>
      }
    >
      <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(params); }}>
        {fields.map((f) => (
          <FieldInput key={f.key} field={f} value={params[f.key]} columns={input.columns} onChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))} />
        ))}
        {!fields.length && <p className="text-[13px] text-text-secondary">This step has no settings.</p>}
        <div className="border-t border-border pt-3">
          {draft?.error ? <p role="alert" className="text-[13px] text-danger">{draft.error}</p> : draft ? <ResultSummary input={input} output={draft.table} /> : null}
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

// ── Sample table with selectable columns ─────────────────────────────────────

function SampleTable({ table, selected, onSelect, label }: { table: Table; selected: string; onSelect: (c: string) => void; label: string }) {
  const rows = table.rows.slice(0, 5);
  return (
    <div className="overflow-auto rounded-md border border-border" role="group" aria-label={label}>
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            {table.columns.map((c) => {
              const on = c.name === selected;
              return (
                <th key={c.name} className={cn("sticky top-0 border-b border-r border-border p-0 text-left font-normal last:border-r-0", on ? "bg-primary-muted" : "bg-surface-2")}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSelect(c.name)}
                    className={cn("flex w-full items-center gap-1 px-2 py-1.5 text-left hover:bg-surface-3", on && "text-primary")}
                  >
                    <TypeGlyph type={c.type} className="w-5" />
                    <span className="max-w-[160px] truncate font-medium">{c.name}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, ci) => (
                <td key={ci} className={cn(
                  "max-w-[200px] truncate border-b border-r border-border-subtle px-2 py-1 font-mono last:border-r-0",
                  table.columns[ci]?.name === selected && "bg-primary-muted/50",
                  v === null || v === undefined ? "italic text-text-tertiary" : "",
                )}>
                  {v === null || v === undefined ? "empty" : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Merge (join) ─────────────────────────────────────────────────────────────

const JOIN_KINDS: { how: string; label: string }[] = [
  { how: "left", label: "Left outer — all rows from this dataset, matches from the other" },
  { how: "inner", label: "Inner — only rows that match in both" },
  { how: "right", label: "Right outer — all rows from the other dataset, matches from this one" },
  { how: "full", label: "Full outer — all rows from both" },
];

const ROW_TAG = "__kadence_row";

interface MergeStats {
  leftRows: number;
  resultRows: number;
  matchedLeft: number;   // distinct rows of this dataset that found a match
  addedColumns: string[];
}

export function MergeDialog({ initial, input, editing, onClose, onSubmit, datasets, authHeaders }: BaseProps & {
  initial: TransformParams; datasets: DatasetSummary[]; authHeaders: () => Record<string, string>;
}) {
  const [params, setParams] = useState<TransformParams>({ how: "left", ...initial });
  const datasetId = String(params.dataset_id ?? "");
  const other = useOtherDataset(datasetId, 50);
  const leftKey = String(params.left_on ?? "");
  const rightKey = String(params.right_on ?? "");
  const [stats, setStats] = useState<MergeStats | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);

  // When the other dataset loads, suggest keys only if both tables share a column name.
  useEffect(() => {
    if (!other.table) return;
    const rightNames = other.table.columns.map((c) => c.name);
    if (rightNames.includes(rightKey) && input.columns.some((c) => c.name === leftKey)) return;
    const k = suggestJoinKeys(input.columns.map((c) => c.name), rightNames);
    setParams((p) => ({ ...p, left_on: k?.left_on ?? (input.columns.some((c) => c.name === leftKey) ? leftKey : ""), right_on: k?.right_on ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other.table]);

  // Preview the join with each input row tagged, so matches can be counted exactly.
  useEffect(() => {
    setStats(null);
    setPreviewError("");
    if (!datasetId || !leftKey || !rightKey) return;
    let cancelled = false;
    setPreviewing(true);
    const tagged: Table = { columns: [...input.columns, { name: ROW_TAG, type: "integer" }], rows: input.rows.map((r, i) => [...r, i]) };
    const t = setTimeout(async () => {
      try {
        const out = await previewStep(tagged, "join", params, authHeaders);
        if (cancelled) return;
        const tagIdx = out.columns.findIndex((c) => c.name === ROW_TAG);
        const leftNames = new Set(input.columns.map((c) => c.name));
        const added = out.columns.map((c, i) => ({ name: c.name, i })).filter((c) => !leftNames.has(c.name) && c.name !== ROW_TAG);
        const matched = new Set<unknown>();
        for (const r of out.rows) if (r[tagIdx] !== null && added.some((c) => r[c.i] !== null && r[c.i] !== undefined)) matched.add(r[tagIdx]);
        setStats({ leftRows: input.rows.length, resultRows: out.rows.length, matchedLeft: matched.size, addedColumns: added.map((c) => c.name) });
      } catch (e) {
        if (!cancelled) setPreviewError((e as Error).message);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, leftKey, rightKey, params.how, input]);

  const leftType = input.columns.find((c) => c.name === leftKey)?.type;
  const rightType = other.table?.columns.find((c) => c.name === rightKey)?.type;
  const numeric = (t?: string) => t === "integer" || t === "decimal";
  const typeMismatch = leftType && rightType && leftType !== rightType && !(numeric(leftType) && numeric(rightType));
  const multiplies = stats && (params.how === "left" || params.how === "inner") && stats.resultRows > stats.leftRows;
  const ready = !!(datasetId && leftKey && rightKey && stats && !previewError);

  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title="Merge with another dataset"
      description="Add columns from another dataset by matching rows on a key. Select the matching column in each table."
      footer={
        <>
          <span className="mr-auto text-xs text-text-tertiary">Preview uses the first {formatCount(input.rows.length)} rows of this dataset.</span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready} onClick={() => onSubmit(params)}>{editing ? "Save" : "OK"}</button>
        </>
      }
    >
      <div className="space-y-4">
        <section className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-medium">This dataset</h3>
            <span className="text-xs text-text-tertiary">{leftKey ? <>Matching on <span className="font-mono text-text">{leftKey}</span></> : "Select a column"}</span>
          </div>
          <SampleTable table={input} selected={leftKey} onSelect={(c) => setParams((p) => ({ ...p, left_on: c }))} label="This dataset — select the matching column" />
        </section>

        <section className="space-y-1.5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
            <DatasetSelect id="merge-dataset" label="Merge with" value={datasetId} datasets={datasets} onChange={(v) => setParams((p) => ({ ...p, dataset_id: v, right_on: "" }))} />
            {other.table && (
              <span className="pb-2 text-right text-xs text-text-tertiary">{rightKey ? <>Matching on <span className="font-mono text-text">{rightKey}</span></> : "Select a column"}</span>
            )}
          </div>
          {other.loading && <p className="flex items-center gap-2 py-6 text-[13px] text-text-tertiary"><LoaderCircle size={14} className="animate-spin" /> Loading sample…</p>}
          {other.error && <p className="text-[13px] text-danger">{other.error}</p>}
          {other.table && <SampleTable table={other.table} selected={rightKey} onSelect={(c) => setParams((p) => ({ ...p, right_on: c }))} label="Other dataset — select the matching column" />}
        </section>

        {datasetId && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,420px)_1fr]">
            <div>
              <label className="field-label" htmlFor="merge-kind">Join kind</label>
              <select id="merge-kind" className="input" value={String(params.how)} onChange={(e) => setParams((p) => ({ ...p, how: e.target.value }))}>
                {JOIN_KINDS.map((k) => <option key={k.how} value={k.how}>{k.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 self-end text-[13px]" aria-live="polite">
              {!leftKey || !rightKey ? (
                <p className="text-text-tertiary">Select the matching column in both tables to see how many rows match.</p>
              ) : previewing ? (
                <p className="flex items-center gap-2 text-text-tertiary"><LoaderCircle size={13} className="animate-spin" /> Checking matches…</p>
              ) : previewError ? (
                <p className="text-danger">{previewError}</p>
              ) : stats ? (
                <>
                  <p className={cn(stats.matchedLeft === 0 ? "text-danger" : "text-text")}>
                    {stats.matchedLeft === 0
                      ? "No rows match. Check that the columns hold the same values."
                      : `${formatCount(stats.matchedLeft)} of ${plural(stats.leftRows, "row")} found a match.`}
                  </p>
                  {stats.addedColumns.length > 0 && <p className="truncate text-text-tertiary" title={stats.addedColumns.join(", ")}>Adds {plural(stats.addedColumns.length, "column")}: {stats.addedColumns.join(", ")}</p>}
                </>
              ) : null}
            </div>
          </div>
        )}

        {typeMismatch && (
          <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-[13px] text-warning">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            The columns have different types ({leftType} and {rightType}), so values may not match. Change one column's type first if needed.
          </p>
        )}
        {multiplies && stats && (
          <p className="flex gap-2 rounded-md border border-signal/30 bg-signal-muted px-3 py-2 text-[13px] text-signal">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span>
              <span className="font-medium">Rows will be duplicated.</span> {rightKey} repeats in the other dataset, so each match is copied once per repeat:
              {" "}{formatCount(stats.leftRows)} rows become {formatCount(stats.resultRows)} in the preview. Use a column that's unique in the other dataset, or group it first.
            </span>
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ── Append ───────────────────────────────────────────────────────────────────

export function AppendDialog({ initial, input, editing, onClose, onSubmit, datasets, authHeaders }: BaseProps & {
  initial: TransformParams; datasets: DatasetSummary[]; authHeaders: () => Record<string, string>;
}) {
  const [params, setParams] = useState<TransformParams>(initial);
  const datasetId = String(params.dataset_id ?? "");
  const other = useOtherDataset(datasetId, 5);
  const [draft, setDraft] = useState<Snapshot | null>(null);

  useEffect(() => {
    setDraft(null);
    if (!datasetId) return;
    let cancelled = false;
    runStep(input, { op: "append", params }, authHeaders).then((s) => { if (!cancelled) setDraft(s); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, input]);

  const align = useMemo(() => {
    const here = input.columns.map((c) => c.name);
    const there = other.table?.columns.map((c) => c.name) ?? [];
    return { both: here.filter((c) => there.includes(c)), onlyHere: here.filter((c) => !there.includes(c)), onlyThere: there.filter((c) => !here.includes(c)) };
  }, [input, other.table]);

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Append rows from another dataset"
      description="Stacks the other dataset's rows under these, lining columns up by name."
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!draft || !!draft.error} onClick={() => onSubmit(params)}>{editing ? "Save" : "OK"}</button>
        </>
      }
    >
      <div className="space-y-4">
        <DatasetSelect id="append-dataset" label="Dataset to append" value={datasetId} datasets={datasets} onChange={(v) => setParams({ dataset_id: v })} />
        {other.error && <p className="text-[13px] text-danger">{other.error}</p>}
        {other.table && (
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border-subtle border-y border-border">
              {[
                ["In both", align.both, "Lined up"],
                ["Only in this dataset", align.onlyHere, "Appended rows get empty values"],
                ["Only in the other dataset", align.onlyThere, "Added as new columns"],
              ].map(([label, cols, note]) => (
                <tr key={label as string} className="align-top">
                  <td className="w-44 py-2 pr-3 text-text-secondary">{label as string} <span className="tabular text-text-tertiary">· {(cols as string[]).length}</span></td>
                  <td className="py-2 font-mono text-[12.5px]">{(cols as string[]).join(", ") || "—"}</td>
                  <td className="w-52 py-2 pl-3 text-xs text-text-tertiary">{note as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {other.table && align.both.length === 0 && (
          <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-[13px] text-warning">
            <AlertTriangle size={15} className="mt-px shrink-0" /> No column names match, so the rows won't line up. Rename columns so they match first.
          </p>
        )}
        {draft && (draft.error ? <p className="text-[13px] text-danger">{draft.error}</p> : <ResultSummary input={input} output={draft.table} />)}
      </div>
    </Dialog>
  );
}
