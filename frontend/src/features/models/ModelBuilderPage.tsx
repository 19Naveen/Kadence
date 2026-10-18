import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Blocks, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { useDatasets, type DatasetSummary } from "../../lib/hooks/useDatasets";
import { combine, waitForJob } from "../../lib/api/ingest";
import { JOIN_KIND_LABEL } from "../../lib/api/models";
import { formatCount, plural } from "../../lib/format";
import { suggestJoinKeys } from "../../lib/transforms/joinKeys";
import type { Table } from "../../lib/transforms/transforms";
import { duplicatesRows, previewJoin, type JoinStats } from "../data-transform/joinPreview";
import { ColumnSelect, DatasetSelect, FieldInput, useOtherDataset } from "../data-transform/StepFields";

interface Clause {
  key: number;
  dataset_id: string;
  how: string;
  left_on: string;
  right_on: string;
}

/** Outcome of evaluating one clause on the preview sample. */
interface ClauseResult {
  key: number;
  table?: Table;
  stats?: JoinStats;
  error?: string;
}

const JOIN_HINT: Record<string, string> = {
  left: "Keeps every row so far; adds matches where there are any.",
  inner: "Keeps only rows that find a match.",
  right: "Keeps every row of the joined table.",
  full: "Keeps every row from both sides.",
};

const SAMPLE = 200;
const isComplete = (c: Clause) => !!(c.dataset_id && c.left_on && c.right_on);
let nextKey = 1;
const newClause = (): Clause => ({ key: nextKey++, dataset_id: "", how: "left", left_on: "", right_on: "" });

export function ModelBuilderPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading, authHeaders } = useDatasets();

  const [baseId, setBaseId] = useState<string>((location.state as { baseId?: string } | null)?.baseId ?? "");
  const [clauses, setClauses] = useState<Clause[]>(() => [newClause()]);
  const [customName, setCustomName] = useState<string | null>(null);
  const [keepSome, setKeepSome] = useState(false);
  const [keepColumns, setKeepColumns] = useState<string[]>([]);
  const [results, setResults] = useState<ClauseResult[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  const base = datasets.find((d) => d.id === baseId) ?? null;
  const baseSample = useOtherDataset(baseId, SAMPLE);
  const name = customName ?? (base ? `${base.name}_joined` : "");
  const creating = progress !== null;
  const resultFor = (c: Clause | undefined) => (c ? results.find((r) => r.key === c.key) : undefined);

  // Evaluate complete clauses in order on the base sample, each feeding the next.
  const chainKey = JSON.stringify(clauses.map(({ key, dataset_id, how, left_on, right_on }) => [key, dataset_id, how, left_on, right_on]));
  useEffect(() => {
    const start = baseSample.table;
    if (!start) { setResults([]); setEvaluating(false); return; }
    let cancelled = false;
    setEvaluating(true);
    const t = setTimeout(async () => {
      const out: ClauseResult[] = [];
      let current = start;
      for (const c of clauses) {
        if (!isComplete(c)) break;
        try {
          const { table, stats } = await previewJoin(current, { dataset_id: c.dataset_id, how: c.how, left_on: c.left_on, right_on: c.right_on }, authHeaders);
          if (cancelled) return;
          out.push({ key: c.key, table, stats });
          current = table;
        } catch (e) {
          if (cancelled) return;
          out.push({ key: c.key, error: (e as Error).message });
          break;
        }
      }
      setResults(out);
      setEvaluating(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSample.table, chainKey, authHeaders]);

  const joined = [...results].reverse().find((r) => r.table)?.table ?? baseSample.table;
  const finalTable = useMemo(() => {
    if (!joined || !keepSome) return joined;
    const idx = keepColumns.map((n) => joined.columns.findIndex((c) => c.name === n)).filter((i) => i >= 0);
    return { columns: idx.map((i) => joined.columns[i]), rows: joined.rows.map((r) => idx.map((i) => r[i])) };
  }, [joined, keepSome, keepColumns]);

  const evalError = baseSample.error || results.find((r) => r.error)?.error;
  const allComplete = clauses.length > 0 && clauses.every(isComplete);
  const canCreate = !!base && allComplete && !!name.trim() && !evalError && !evaluating && !creating && (!keepSome || keepColumns.length > 0);

  function updateClause(key: number, patch: Partial<Clause>) {
    setClauses((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  async function create() {
    if (!activeWorkspace || !base || !canCreate) return;
    const modelName = name.trim();
    setCreateError("");
    setProgress("Starting…");
    try {
      const transforms: Record<string, unknown>[] = clauses.map((c) => ({ type: "join", dataset_id: c.dataset_id, left_on: c.left_on, right_on: c.right_on, how: c.how }));
      if (keepSome) transforms.push({ type: "select", columns: keepColumns });
      const job = await combine(authHeaders, { workspaceId: activeWorkspace.id, primaryDatasetId: base.id, transforms, newDatasetName: modelName });
      setProgress(`Building ${modelName}…`);
      const done = await waitForJob(authHeaders, job.id);
      navigate("/app/models", { state: { select: done.dataset_id, notice: `Created ${modelName}.` } });
    } catch (e) {
      setCreateError((e as Error).message);
      setProgress(null);
    }
  }

  const topBar = (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <Link to="/app/models" className="btn-icon -ml-1" aria-label="Back to models" title="Back to models"><ArrowLeft size={16} /></Link>
      <h1 className="text-[15px] font-semibold">New model</h1>
      {datasets.length >= 2 && (
        <>
          <label htmlFor="model-name" className="sr-only">Model name</label>
          <input
            id="model-name"
            className="input h-8 w-64 font-mono text-[13px]"
            placeholder="model_name"
            value={name}
            disabled={creating}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <span className="flex-1" />
          {progress && <span className="flex items-center gap-2 text-[13px] text-text-secondary" role="status"><LoaderCircle size={14} className="animate-spin" /> {progress}</span>}
          <button className="btn btn-primary" onClick={create} disabled={!canCreate}
            title={!allComplete ? "Finish or remove incomplete joins first" : undefined}>
            Create model
          </button>
        </>
      )}
    </header>
  );

  if (loading && !datasets.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {topBar}
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-text-tertiary"><LoaderCircle size={15} className="animate-spin" /> Loading datasets…</div>
      </div>
    );
  }

  if (datasets.length < 2) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {topBar}
        <div className="mx-auto max-w-sm p-10 text-center">
          <Blocks size={20} className="mx-auto text-text-tertiary" />
          <p className="mt-3 font-medium">A model needs at least two datasets</p>
          <p className="mt-1 text-[13px] text-text-secondary">
            Models join tables into a new dataset. {datasets.length ? "This workspace has only one so far." : "This workspace has none yet."} Import another file or database table first.
          </p>
          <Link to="/app/data-import" className="btn btn-primary mt-4">Go to Data sources</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {topBar}
      {createError && <p role="alert" className="border-b border-danger/30 bg-danger-muted px-4 py-2 text-[13px] text-danger">{createError}</p>}

      <div className="flex min-h-0 flex-1">
        <aside className="w-[420px] shrink-0 overflow-y-auto border-r border-border bg-surface" aria-label="Model settings">
          <fieldset disabled={creating} className="space-y-4 p-4">
            <DatasetSelect id="model-base" label="Base table" value={baseId} datasets={datasets} onChange={setBaseId} />
            {baseSample.error && <p className="text-[13px] text-danger">{baseSample.error}</p>}

            {clauses.map((c, i) => (
              <JoinClause
                key={c.key}
                clause={c}
                index={i}
                datasets={datasets}
                left={i === 0 ? baseSample.table : resultFor(clauses[i - 1])?.table ?? null}
                result={resultFor(c)}
                evaluating={evaluating}
                onChange={(patch) => updateClause(c.key, patch)}
                onRemove={() => setClauses((cs) => cs.filter((x) => x.key !== c.key))}
              />
            ))}

            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClauses((cs) => [...cs, newClause()])}>
              <Plus size={14} /> Add a table
            </button>

            <div className="border-t border-border pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={keepSome}
                  onChange={(e) => {
                    setKeepSome(e.target.checked);
                    if (e.target.checked && joined) setKeepColumns(joined.columns.map((col) => col.name));
                  }}
                />
                Keep only some columns
              </label>
              {keepSome && joined && (
                <div className="mt-3">
                  <FieldInput
                    field={{ key: "columns", label: "Columns to keep", kind: "columns" }}
                    value={keepColumns.filter((n) => joined.columns.some((col) => col.name === n))}
                    columns={joined.columns}
                    onChange={(v) => setKeepColumns(Array.isArray(v) ? v : [])}
                  />
                </div>
              )}
            </div>
          </fieldset>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-bg" aria-label="Model preview">
          <Diagram base={base} clauses={clauses} datasets={datasets} name={name || "new model"} rows={finalTable?.rows.length ?? null} />
          <div className="min-h-0 flex-1 overflow-auto">
            {!base ? (
              <p className="p-6 text-[13px] text-text-tertiary">Choose a base table to start.</p>
            ) : !finalTable ? (
              <p className="flex items-center gap-2 p-6 text-[13px] text-text-tertiary"><LoaderCircle size={14} className="animate-spin" /> Loading preview…</p>
            ) : (
              <PreviewTable table={finalTable} />
            )}
          </div>
          {base && finalTable && baseSample.table && (
            <footer className="tabular flex h-8 shrink-0 items-center gap-2 border-t border-border bg-surface px-4 text-xs text-text-tertiary">
              {evaluating && <LoaderCircle size={12} className="animate-spin" />}
              Preview of the first {formatCount(baseSample.table.rows.length)} rows of {base.name} · {plural(finalTable.rows.length, "row")} · {plural(finalTable.columns.length, "column")}
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}

// ── One join clause ──────────────────────────────────────────────────────────

function JoinClause({ clause, index, datasets, left, result, evaluating, onChange, onRemove }: {
  clause: Clause;
  index: number;
  datasets: DatasetSummary[];
  /** The table so far (after previous clauses); null until those are evaluated. */
  left: Table | null;
  result?: ClauseResult;
  evaluating: boolean;
  onChange: (patch: Partial<Clause>) => void;
  onRemove: () => void;
}) {
  const other = useOtherDataset(clause.dataset_id, 50);
  const otherName = datasets.find((d) => d.id === clause.dataset_id)?.name ?? "the joined table";
  const leftNames = left?.columns.map((c) => c.name) ?? [];
  const leftKeySig = leftNames.join("\u0000");

  // Suggest keys when the joined table (or the table so far) changes — only if both share a column name.
  useEffect(() => {
    if (!other.table || !left) return;
    const rightNames = other.table.columns.map((c) => c.name);
    const leftOk = leftNames.includes(clause.left_on);
    if (leftOk && rightNames.includes(clause.right_on)) return;
    const k = suggestJoinKeys(leftNames, rightNames);
    onChange({ left_on: k?.left_on ?? (leftOk ? clause.left_on : ""), right_on: k?.right_on ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other.table, leftKeySig]);

  const leftType = left?.columns.find((c) => c.name === clause.left_on)?.type;
  const rightType = other.table?.columns.find((c) => c.name === clause.right_on)?.type;
  const numeric = (t?: string) => t === "integer" || t === "decimal";
  const typeMismatch = leftType && rightType && leftType !== rightType && !(numeric(leftType) && numeric(rightType));
  const stats = result?.stats;
  const id = `join-${clause.key}`;

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <span className="text-[13px] font-medium">Join {index + 1}</span>
        <button type="button" className="btn-icon -mr-1.5" onClick={onRemove} aria-label={`Remove join ${index + 1}`} title="Remove"><Trash2 size={14} /></button>
      </div>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2">
          <DatasetSelect id={`${id}-dataset`} label="Join" value={clause.dataset_id} datasets={datasets} onChange={(v) => onChange({ dataset_id: v, right_on: "" })} />
          <div>
            <label className="field-label" htmlFor={`${id}-how`}>Kind</label>
            <select id={`${id}-how`} className="input" value={clause.how} onChange={(e) => onChange({ how: e.target.value })}>
              {Object.entries(JOIN_KIND_LABEL).map(([how, label]) => <option key={how} value={how}>{label}</option>)}
            </select>
          </div>
        </div>
        <p className="field-hint -mt-1.5">{JOIN_HINT[clause.how]}</p>

        {clause.dataset_id && (
          <div>
            <span className="field-label">Match rows where</span>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <div aria-label="Column in the table so far">
                <ColumnSelect columns={left?.columns ?? []} value={clause.left_on} onChange={(v) => onChange({ left_on: v })} placeholder="This column" />
              </div>
              <span className="font-mono text-text-tertiary">=</span>
              <div aria-label={`Column in ${otherName}`}>
                <ColumnSelect columns={other.table?.columns ?? []} value={clause.right_on} onChange={(v) => onChange({ right_on: v })} placeholder="Other column" />
              </div>
            </div>
            {other.loading && <p className="field-hint flex items-center gap-1.5"><LoaderCircle size={12} className="animate-spin" /> Loading {otherName}…</p>}
            {other.error && <p className="mt-1 text-[13px] text-danger">{other.error}</p>}
            {(clause.left_on || clause.right_on) && (
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 font-mono text-[11.5px] text-text-tertiary">
                <span className="truncate">{sampleValues(left, clause.left_on)}</span>
                <span className="invisible">=</span>
                <span className="truncate">{sampleValues(other.table, clause.right_on)}</span>
              </div>
            )}
          </div>
        )}

        {isComplete(clause) && (
          <div className="space-y-1.5 text-[13px]" aria-live="polite">
            {evaluating && !result ? (
              <p className="flex items-center gap-2 text-text-tertiary"><LoaderCircle size={13} className="animate-spin" /> Checking matches…</p>
            ) : result?.error ? (
              <p className="text-danger">{result.error}</p>
            ) : stats ? (
              <>
                <p className={cn(stats.matchedLeft === 0 ? "text-danger" : "text-text-secondary")}>
                  {stats.matchedLeft === 0
                    ? "No rows match. Check that the columns hold the same values."
                    : `${formatCount(stats.matchedLeft)} of ${plural(stats.leftRows, "row")} found a match.`}
                </p>
                {duplicatesRows(clause.how, stats) && (
                  <p className="flex gap-2 rounded-md border border-signal/30 bg-signal-muted px-2.5 py-1.5 text-signal">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Rows will be duplicated: {formatCount(stats.leftRows)} → {formatCount(stats.resultRows)}. Use a key that's unique in {otherName}, or group it first.</span>
                  </p>
                )}
              </>
            ) : !left ? (
              <p className="text-text-tertiary">Finish the join above first.</p>
            ) : null}
            {typeMismatch && (
              <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-muted px-2.5 py-1.5 text-warning">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>The columns have different types ({leftType} and {rightType}), so values may not match.</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sampleValues(table: Table | null, column: string): string {
  const i = table?.columns.findIndex((c) => c.name === column) ?? -1;
  if (!table || i < 0) return "";
  const seen = [...new Set(table.rows.map((r) => r[i]).filter((v) => v !== null && v !== undefined).map(String))].slice(0, 3);
  return seen.length ? `e.g. ${seen.join(", ")}` : "all empty";
}

// ── Diagram strip ────────────────────────────────────────────────────────────

function Diagram({ base, clauses, datasets, name, rows }: {
  base: DatasetSummary | null; clauses: Clause[]; datasets: DatasetSummary[]; name: string; rows: number | null;
}) {
  if (!base) return null;
  const chosen = clauses.filter((c) => c.dataset_id);
  return (
    <div className="h-[150px] shrink-0 overflow-x-auto border-b border-border bg-surface" aria-label="Model diagram">
      <div className="flex h-full w-max items-center px-5">
        <DiagramCard title={base.name} detail={`${formatCount(base.latest_row_count)} rows · base`} />
        {chosen.map((c) => {
          const d = datasets.find((x) => x.id === c.dataset_id);
          return (
            <Fragment key={c.key}>
              <Arrow label={`${c.how} join${c.left_on && c.right_on ? ` · ${c.left_on} = ${c.right_on}` : ""}`} />
              <DiagramCard title={d?.name ?? "—"} detail={`${formatCount(d?.latest_row_count)} rows`} />
            </Fragment>
          );
        })}
        <Arrow label="result" />
        <DiagramCard title={name} detail={rows === null ? "—" : `${formatCount(rows)} rows in preview`} primary />
      </div>
    </div>
  );
}

function DiagramCard({ title, detail, primary }: { title: string; detail: string; primary?: boolean }) {
  return (
    <div className={cn("w-44 shrink-0 rounded-md border bg-surface px-3 py-2", primary ? "border-primary" : "border-border")}>
      <p className={cn("truncate text-[13px] font-medium", primary && "text-primary")} title={title}>{title}</p>
      <p className="tabular truncate text-[11px] text-text-tertiary">{detail}</p>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex w-40 shrink-0 flex-col items-center px-1">
      <span className="max-w-full truncate font-mono text-[10.5px] text-text-secondary" title={label}>{label}</span>
      <span aria-hidden="true" className="mt-1 flex w-full items-center text-text-tertiary">
        <span className="h-[1.5px] flex-1 bg-current" />
        <svg width="7" height="10" className="-ml-px"><path d="M0,1 L6,5 L0,9" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </span>
    </div>
  );
}

// ── Result preview ───────────────────────────────────────────────────────────

function PreviewTable({ table }: { table: Table }) {
  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c.name} className="sticky top-0 border-b border-r border-border bg-surface-2 px-2 py-1.5 text-left font-medium last:border-r-0">{c.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.slice(0, 50).map((r, i) => (
          <tr key={i}>
            {r.map((v, j) => (
              <td key={j} className={cn("max-w-[220px] truncate border-b border-r border-border-subtle bg-surface px-2 py-1 font-mono last:border-r-0", v == null && "italic text-text-tertiary")}>
                {v == null ? "empty" : String(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
