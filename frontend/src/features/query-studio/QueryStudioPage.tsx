import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Database, LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { PageLoading } from "../../components/shared/PageLoading";
import { useDatasets, useQueryApi, type QueryResult } from "../../lib/hooks/useDatasets";
import { formatCount, plural } from "../../lib/format";
import { cn } from "../../lib/cn";

const ROW_LIMIT = 1000;
const NUMERIC_TYPE = /int|decimal|numeric|float|double|real/i;

interface Run {
  id: string;
  sql: string;
  datasetName: string;
  ranAt: string;
  result?: QueryResult;
  error?: string;
}

const timeFmt = new Intl.DateTimeFormat("en-SG", { hour: "2-digit", minute: "2-digit" });

function cellText(cell: unknown): string {
  if (cell !== null && typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function toCsv(result: QueryResult): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [result.columns, ...result.rows.map((r) => r.map((c) => (c == null ? "" : cellText(c))))];
  return lines.map((l) => l.map(esc).join(",")).join("\n");
}

function ResultTable({ result }: { result: QueryResult }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(result));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 2500);
  };

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">
          <span className="tabular font-semibold text-text">{plural(result.rows.length, "row")}</span>
          {" · "}{plural(result.columns.length, "column")}
          {result.rows.length >= ROW_LIMIT && <span className="text-warning"> · limit of {formatCount(ROW_LIMIT)} rows reached</span>}
        </p>
        {result.rows.length > 0 && (
          <button type="button" onClick={copy} className="btn btn-secondary btn-sm">
            {copyState === "copied" ? <Check size={14} /> : copyState === "failed" ? <TriangleAlert size={14} /> : <Copy size={14} />}
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy as CSV"}
          </button>
        )}
      </div>
      {result.rows.length === 0 ? (
        <p className="text-sm text-text-tertiary">The query returned no rows.</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-2">
                {result.columns.map((c, j) => (
                  <th key={j} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-mono font-semibold text-text-secondary">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="table-row last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-text">
                      {cell === null || cell === undefined ? <span className="italic text-text-tertiary">null</span> : cellText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function QueryStudioPage() {
  const { datasets, loading: datasetsLoading } = useDatasets();
  const { execute, preview } = useQueryApi();

  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [schema, setSchema] = useState<Record<string, string>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the selection valid when the workspace (and so the dataset list) changes.
  useEffect(() => {
    if (datasets.some((d) => d.id === selectedDatasetId)) return;
    setSelectedDatasetId(datasets[0]?.id ?? "");
  }, [datasets, selectedDatasetId]);

  // Column names for the GROUP BY example.
  useEffect(() => {
    setSchema({});
    if (!selectedDatasetId) return;
    let cancelled = false;
    preview(selectedDatasetId, 1)
      .then((p) => { if (!cancelled) setSchema(p.dataset_schema); })
      .catch(() => { /* examples fall back to generic SQL */ });
    return () => { cancelled = true; };
  }, [selectedDatasetId, preview]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [runs, isRunning]);

  const examples = useMemo(() => {
    const list = ["SELECT * FROM dataset LIMIT 20", "SELECT COUNT(*) AS row_count FROM dataset"];
    const cols = Object.entries(schema);
    const dim = cols.find(([, t]) => !NUMERIC_TYPE.test(t)) ?? cols[0];
    if (dim) {
      const q = `"${dim[0].replace(/"/g, '""')}"`;
      list.push(`SELECT ${q}, COUNT(*) AS n FROM dataset GROUP BY ${q} ORDER BY n DESC LIMIT 10`);
    }
    return list;
  }, [schema]);

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId);

  const handleRun = useCallback(async () => {
    const sql = input.trim();
    const dataset = datasets.find((d) => d.id === selectedDatasetId);
    if (!sql || !dataset || isRunning) return;

    setIsRunning(true);
    const base = { id: crypto.randomUUID(), sql, datasetName: dataset.name, ranAt: timeFmt.format(new Date()) };
    try {
      const result = await execute(dataset.id, sql, ROW_LIMIT);
      setRuns((prev) => [...prev, { ...base, result }]);
      setInput("");
    } catch (e) {
      // Keep the SQL in the composer so it can be corrected and re-run.
      setRuns((prev) => [...prev, { ...base, error: e instanceof Error ? e.message : "Query failed" }]);
    } finally {
      setIsRunning(false);
      inputRef.current?.focus();
    }
  }, [datasets, execute, input, isRunning, selectedDatasetId]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleRun();
    }
  };

  const noDatasets = !datasetsLoading && datasets.length === 0;
  const canRun = !!input.trim() && !!selectedDataset && !isRunning;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-6 sm:px-6 lg:px-10">
        <PageHeader
          title="Query Studio"
          subtitle={<>Run read-only SQL against the latest version of a dataset. Refer to it as the <code className="rounded bg-surface-2 px-1 text-[13px]">dataset</code> view.</>}
          actions={
            <div className="flex items-center gap-2">
              <Database size={16} className="text-text-tertiary" aria-hidden="true" />
              <select
                aria-label="Dataset to query"
                className="input w-auto min-w-48 max-w-72"
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                disabled={datasetsLoading || datasets.length === 0}
              >
                {datasets.length === 0 && <option value="">{datasetsLoading ? "Loading…" : "No datasets"}</option>}
                {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          }
        />
      </div>

      {datasetsLoading ? (
        <div className="min-h-0 flex-1"><PageLoading /></div>
      ) : noDatasets ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-10 sm:px-6 lg:px-10">
          <div className="card max-w-md text-center">
            <Database size={22} className="mx-auto mb-3 text-text-tertiary" aria-hidden="true" />
            <h2 className="text-base font-semibold">No datasets to query yet</h2>
            <p className="mt-1 text-sm text-text-secondary">Import a dataset first, then query its latest version here.</p>
            <Link to="/app/data-import" className="btn btn-primary mt-4">Import data</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 lg:px-10">
            <div className="mx-auto w-full max-w-5xl space-y-5 py-4" aria-live="polite">
              <p className="text-sm text-text-secondary">
                Write a single SELECT against <code className="rounded bg-surface-2 px-1 text-[13px]">dataset</code>.
                It always points at the latest version of the selected dataset.
              </p>

              {runs.map((run) => (
                <section key={run.id} className="card p-4" aria-label={`Query on ${run.datasetName}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                    <span className="badge bg-primary-muted text-primary"><Database size={11} aria-hidden="true" /> {run.datasetName}</span>
                    <span className="tabular">{run.ranAt}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-mono text-xs text-text">{run.sql}</pre>
                  {run.error && (
                    <div role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger-muted p-3 font-mono text-xs text-danger">{run.error}</div>
                  )}
                  {run.result && <ResultTable result={run.result} />}
                </section>
              ))}

              {isRunning && (
                <div role="status" className="flex items-center gap-2 text-sm text-text-tertiary">
                  <LoaderCircle size={15} className="animate-spin" /> Running query…
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <div className="border-t border-border bg-surface px-4 py-3 sm:px-6 lg:px-10">
            <div className="mx-auto w-full max-w-5xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="section-label">Examples</span>
                {examples.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="btn btn-secondary btn-sm max-w-full min-w-0 font-mono text-xs font-normal"
                  >
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  aria-label="SQL query"
                  rows={3}
                  spellCheck={false}
                  className={cn("input h-auto min-h-20 max-h-48 flex-1 resize-y py-2 font-mono")}
                  placeholder="SELECT * FROM dataset LIMIT 20"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <button type="button" onClick={() => void handleRun()} disabled={!canRun} aria-label="Run query" title="Run query" className="btn btn-primary size-9 px-0">
                  {isRunning ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                </button>
              </div>
              <p className="field-hint">
                <kbd className="kbd">Ctrl</kbd> / <kbd className="kbd">⌘</kbd> + <kbd className="kbd">Enter</kbd> to run · Read-only, single SELECT, up to {formatCount(ROW_LIMIT)} rows
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
