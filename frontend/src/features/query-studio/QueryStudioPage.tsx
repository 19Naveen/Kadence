import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, Check, ChevronDown, Copy, Database, LoaderCircle, Pencil, SquarePen, TriangleAlert } from "lucide-react";
import { PageLoading } from "../../components/shared/PageLoading";
import { useDatasets, useQueryApi, type DatasetSummary, type QueryResult } from "../../lib/hooks/useDatasets";
import { formatCount, plural } from "../../lib/format";

const ROW_LIMIT = 1000;
const NUMERIC_TYPE = /int|decimal|numeric|float|double|real|hugeint/i;
const TEXT_TYPE = /char|text|string|varchar/i;
const MAX_INPUT_PX = 8 * 20 + 16; // ~8 lines of 20px plus padding
const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

interface Turn {
  id: string;
  sql: string;
  datasetId: string;
  datasetName: string;
  status: "running" | "done" | "error";
  result?: QueryResult;
  error?: string;
  ms?: number;
}

interface Example {
  label: string;
  sql: string;
}

const quote = (col: string) => `"${col.replace(/"/g, '""')}"`;
const alias = (col: string) => col.toLowerCase().replace(/\W+/g, "_").replace(/^_|_$/g, "") || "value";

function cellText(cell: unknown): string {
  if (cell !== null && typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function toCsv(result: QueryResult): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [result.columns, ...result.rows.map((r) => r.map((c) => (c == null ? "" : cellText(c))))];
  return lines.map((l) => l.map(esc).join(",")).join("\n");
}

/** Example queries built from the dataset's real columns; falls back to generic SQL. */
function buildExamples(schema: Record<string, string>): Example[] {
  const cols = Object.entries(schema);
  const text = cols.find(([, t]) => TEXT_TYPE.test(t))?.[0];
  const num = cols.find(([, t]) => NUMERIC_TYPE.test(t))?.[0];
  const list: Example[] = [{ label: "Preview the first 20 rows", sql: "SELECT * FROM dataset LIMIT 20" }];

  if (text) {
    list.push({
      label: `Count rows by ${text}`,
      sql: `SELECT ${quote(text)}, COUNT(*) AS row_count\nFROM dataset\nGROUP BY ${quote(text)}\nORDER BY row_count DESC\nLIMIT 10`,
    });
  } else {
    list.push({ label: "Count all rows", sql: "SELECT COUNT(*) AS row_count FROM dataset" });
  }

  if (text && num) {
    const a = alias(num);
    list.push({
      label: `Average and total ${num} by ${text}`,
      sql: `SELECT ${quote(text)}, AVG(${quote(num)}) AS avg_${a}, SUM(${quote(num)}) AS sum_${a}\nFROM dataset\nGROUP BY ${quote(text)}\nORDER BY sum_${a} DESC\nLIMIT 10`,
    });
  } else if (num) {
    list.push({
      label: `Summarize ${num}`,
      sql: `SELECT MIN(${quote(num)}) AS min, AVG(${quote(num)}) AS avg, MAX(${quote(num)}) AS max\nFROM dataset`,
    });
  }
  return list;
}

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setState("copied");
    } catch {
      setState("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button type="button" onClick={copy} className="btn btn-ghost btn-sm">
      {state === "copied" ? <Check size={13} /> : state === "failed" ? <TriangleAlert size={13} /> : <Copy size={13} />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) {
    return <p className="rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-text-tertiary">No rows returned.</p>;
  }
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border bg-surface">
      <table className="w-full border-collapse font-mono text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr className="border-b border-border">
            <th scope="col" className="w-10 px-2 py-1.5 text-right font-normal text-text-tertiary"><span className="sr-only">Row</span></th>
            {result.columns.map((c, j) => (
              <th key={j} scope="col" className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-text-secondary">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="table-row last:border-0">
              <td className="tabular px-2 py-1 text-right text-text-tertiary">{i + 1}</td>
              {row.map((cell, j) => (
                <td key={j} className={`tabular whitespace-nowrap px-3 py-1 ${typeof cell === "number" ? "text-right" : ""}`}>
                  {cell === null || cell === undefined ? <span className="text-text-tertiary">null</span> : cellText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TurnView({ turn, onEdit }: { turn: Turn; onEdit: (turn: Turn) => void }) {
  return (
    <article className="space-y-2.5 py-6" aria-label={`Query on ${turn.datasetName}`}>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-3.5 py-2.5 text-[13px] leading-5 text-text">{turn.sql}</pre>

      {turn.status === "running" && (
        <p className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> Running on {turn.datasetName}…
        </p>
      )}

      {turn.status === "error" && (
        <div className="flex items-start gap-2 text-[13px] text-danger">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words font-mono text-[12.5px]">{turn.error}</p>
        </div>
      )}

      {turn.result && (
        <>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
            <Database size={12} aria-hidden="true" />
            <span className="text-text-secondary">{turn.datasetName}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular font-mono">{plural(turn.result.rows.length, "row")}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular font-mono">{plural(turn.result.columns.length, "column")}</span>
            {turn.ms != null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular font-mono">{formatCount(turn.ms)} ms</span>
              </>
            )}
            {turn.result.rows.length >= ROW_LIMIT && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-warning">stopped at {formatCount(ROW_LIMIT)} rows</span>
              </>
            )}
          </p>
          <ResultTable result={turn.result} />
        </>
      )}

      {turn.status !== "running" && (
        <div className="-ml-2 flex flex-wrap items-center gap-0.5">
          <CopyButton label="Copy SQL" getText={() => turn.sql} />
          {turn.result && turn.result.rows.length > 0 && <CopyButton label="Copy as CSV" getText={() => toCsv(turn.result!)} />}
          <button type="button" onClick={() => onEdit(turn)} className="btn btn-ghost btn-sm">
            <Pencil size={13} /> Edit
          </button>
        </div>
      )}
    </article>
  );
}

function DatasetPicker({ datasets, value, onChange }: { datasets: DatasetSummary[]; value: string; onChange: (id: string) => void }) {
  const current = datasets.find((d) => d.id === value);
  return (
    <label className="relative inline-flex h-7 min-w-0 max-w-64 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-primary">
      <Database size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{current?.name ?? "Choose a dataset"}</span>
      <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
      <select
        aria-label="Dataset to query"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}

export function QueryStudioPage() {
  const { datasets, loading: datasetsLoading } = useDatasets();
  const { execute, preview } = useQueryApi();

  const [selectedId, setSelectedId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [schema, setSchema] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selected = datasets.find((d) => d.id === selectedId);
  const isRunning = turns.some((t) => t.status === "running");

  // Keep the selection valid when the workspace (and so the dataset list) changes.
  useEffect(() => {
    if (datasets.some((d) => d.id === selectedId)) return;
    setSelectedId(datasets[0]?.id ?? "");
  }, [datasets, selectedId]);

  // Real column names for the example queries.
  useEffect(() => {
    setSchema({});
    if (!selectedId) return;
    let cancelled = false;
    preview(selectedId, 20)
      .then((p) => { if (!cancelled) setSchema(p.dataset_schema); })
      .catch(() => { /* examples fall back to generic SQL */ });
    return () => { cancelled = true; };
  }, [selectedId, preview]);

  const examples = useMemo(() => buildExamples(schema), [schema]);

  // Scroll the newest turn into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // Auto-grow the composer up to ~8 lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
  }, [input, datasetsLoading]);

  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());

  const handleRun = useCallback(async () => {
    const sql = input.trim();
    if (!sql || !selected || isRunning) return;

    const id = crypto.randomUUID();
    const patch = (p: Partial<Turn>) => setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
    setTurns((prev) => [...prev, { id, sql, datasetId: selected.id, datasetName: selected.name, status: "running" }]);
    setAnnouncement("");

    const started = performance.now();
    try {
      const result = await execute(selected.id, sql, ROW_LIMIT);
      patch({ status: "done", result, ms: Math.round(performance.now() - started) });
      // Clear only if the user hasn't started typing something else meanwhile.
      setInput((cur) => (cur.trim() === sql ? "" : cur));
      setAnnouncement(`${plural(result.rows.length, "row")} returned from ${selected.name}.`);
    } catch (e) {
      // Keep the SQL in the composer so it can be corrected and re-run.
      const error = e instanceof Error ? e.message : "Query failed";
      patch({ status: "error", error });
      setAnnouncement(`Query failed: ${error}`);
    } finally {
      focusInput();
    }
  }, [execute, input, isRunning, selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleRun();
    }
  };

  const editTurn = (turn: Turn) => {
    if (datasets.some((d) => d.id === turn.datasetId)) setSelectedId(turn.datasetId);
    setInput(turn.sql);
    focusInput();
  };

  const newQuery = () => {
    setTurns([]);
    setInput("");
    setAnnouncement("");
    focusInput();
  };

  const canRun = !!input.trim() && !!selected && !isRunning;

  let body;
  if (datasetsLoading && datasets.length === 0) {
    body = <div className="min-h-0 flex-1"><PageLoading /></div>;
  } else if (datasets.length === 0) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h2 className="text-base font-semibold">No datasets to query yet</h2>
          <p className="mt-1 text-[13px] text-text-secondary">Import a file or database table, then query its latest version here.</p>
          <Link to="/app/data-import" className="btn btn-primary mt-4">Add data</Link>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 sm:px-6">
            {turns.length === 0 ? (
              <div className="my-auto py-10">
                <h2 className="text-xl font-semibold">Ask {selected?.name ?? "a dataset"} with SQL</h2>
                <p className="mt-1.5 text-[13px] text-text-secondary">
                  Query the <code className="rounded bg-surface-2 px-1 text-[12.5px] text-text">dataset</code> view, which always points at the latest version.
                  Read-only: one SELECT per run.
                </p>
                <ul className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                  {examples.map((ex) => (
                    <li key={ex.sql}>
                      <button
                        type="button"
                        onClick={() => { setInput(ex.sql); focusInput(); }}
                        className="block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:-outline-offset-2"
                      >
                        <span className="block text-[13px] text-text">{ex.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-text-tertiary">{ex.sql.replace(/\n/g, " ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {turns.map((t) => <TurnView key={t.id} turn={t} onEdit={editTurn} />)}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 px-4 pb-3 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-lg border border-border bg-surface shadow-soft-sm transition-colors focus-within:border-text-tertiary/50">
              <textarea
                ref={inputRef}
                aria-label="SQL query"
                rows={2}
                spellCheck={false}
                autoFocus
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 font-mono text-[13px] leading-5 text-text placeholder:text-text-tertiary focus:outline-none"
                placeholder="SELECT * FROM dataset LIMIT 20"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
                <DatasetPicker datasets={datasets} value={selectedId} onChange={setSelectedId} />
                <div className="flex shrink-0 items-center gap-2.5">
                  <span className="hidden items-center gap-1 text-xs text-text-tertiary sm:inline-flex">
                    <kbd className="kbd">{MOD_KEY}</kbd><kbd className="kbd">⏎</kbd> to run
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRun()}
                    disabled={!canRun}
                    aria-label="Run query"
                    title="Run query"
                    className="btn btn-primary size-8 px-0"
                  >
                    {isRunning ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
                  </button>
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-center text-2xs text-text-tertiary">
              Read-only · single SELECT · up to {formatCount(ROW_LIMIT)} rows per run
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
        <h1 className="text-[15px] font-semibold">Query Studio</h1>
        <button type="button" onClick={newQuery} disabled={turns.length === 0 && !input} className="btn btn-ghost btn-sm">
          <SquarePen size={14} /> New query
        </button>
      </header>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {body}
    </div>
  );
}
