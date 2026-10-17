import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Database, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { PageLoading } from "../../components/shared/PageLoading";
import { useDatasets, useQueryApi } from "../../lib/hooks/useDatasets";

type Aggregation = "sum" | "avg" | "count" | "min" | "max";
type ChartType = "bar" | "line" | "kpi";
type Point = { label: string; value: number };

interface Widget {
  id: string;
  /** The dataset this chart was built from; its columns only make sense there. */
  datasetId: string;
  datasetName: string;
  type: ChartType;
  title: string;
  dimension: string;
  /** null means "count rows". */
  measure: string | null;
  aggregation: Aggregation;
  topN: number;
  data: Point[];
  /** KPI widgets: the aggregate over all rows. */
  kpi: number | null;
}

interface FormState {
  title: string;
  type: ChartType;
  dimension: string;
  measure: string; // "" = count rows
  aggregation: Exclude<Aggregation, "count">;
  topN: number;
}

const TOP_N_OPTIONS = [10, 25, 50, 100];
const INITIAL_FORM: FormState = { title: "", type: "bar", dimension: "", measure: "", aggregation: "sum", topN: 25 };
const NUMERIC_TYPES = new Set(["integer", "decimal"]);
const AGG_LABEL: Record<Aggregation, string> = { count: "Count", sum: "Sum", avg: "Average", min: "Min", max: "Max" };

const fmtNum = (n: number) => n.toLocaleString("en-SG", { maximumFractionDigits: 2 });
const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const describe = (w: Pick<Widget, "aggregation" | "measure">) => `${AGG_LABEL[w.aggregation]}${w.measure ? ` of ${w.measure}` : " of rows"}`;

function MiniLineChart({ data }: { data: Point[] }) {
  const gradId = useId();
  if (data.length < 2) return <p className="py-10 text-center text-sm text-text-tertiary">Not enough points to plot a line.</p>;
  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const width = 300;
  const height = 120;
  const pad = 8;
  const pts = data.map((d, i) => ({
    x: (i / (data.length - 1)) * (width - pad * 2) + pad,
    y: height - pad - ((d.value - min) / range) * (height - pad * 2),
    d,
  }));
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-text-tertiary tabular">
        <span>High {fmtNum(max)}</span>
        <span>Low {fmtNum(min)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Line chart of ${data.length} points`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={area} fill={`url(#${gradId})`} />
        <polyline points={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="hsl(var(--primary))">
            <title>{`${p.d.label}: ${fmtNum(p.d.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between gap-2 text-xs text-text-tertiary">
        <span className="truncate">{data[0].label}</span>
        <span className="truncate text-right">{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

function MiniBarChart({ data }: { data: Point[] }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-text-tertiary">No data to chart.</p>;
  // Scale to the widest positive and negative bars so negatives are drawn left of a shared baseline.
  const posMax = Math.max(0, ...data.map((d) => d.value));
  const negMax = Math.max(0, ...data.map((d) => -d.value));
  const span = posMax + negMax || 1;
  const zero = (negMax / span) * 100;

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
      {data.map((d, i) => {
        const w = (Math.abs(d.value) / span) * 100;
        const left = d.value < 0 ? zero - w : zero;
        return (
          <div key={i} className="flex items-center gap-2 text-xs" title={`${d.label}: ${fmtNum(d.value)}`}>
            <span className="w-24 shrink-0 truncate text-right text-text-secondary">{d.label}</span>
            <div className="relative h-5 flex-1">
              <div className="absolute inset-y-0 w-px bg-border" style={{ left: `${zero}%` }} aria-hidden="true" />
              <div
                className={d.value < 0 ? "absolute inset-y-0.5 rounded-sm bg-text-tertiary" : "absolute inset-y-0.5 rounded-sm bg-primary"}
                style={{ left: `${left}%`, width: `${w}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right font-mono tabular text-text">{fmtNum(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function KPICard({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="py-4">
      <div className="text-4xl font-semibold tracking-tight tabular">{value == null ? "—" : fmtNum(value)}</div>
      <p className="mt-2 text-sm text-text-secondary">{label}, across all rows</p>
    </div>
  );
}

function WidgetCard({ widget, datasetName, removed, onRemove }: {
  widget: Widget;
  datasetName: string;
  removed: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const summary = widget.type === "kpi"
    ? describe(widget)
    : `${describe(widget)} by ${widget.dimension} · top ${widget.topN} groups`;

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{widget.title}</h3>
          <p className="mt-0.5 truncate text-xs text-text-secondary" title={summary}>{summary}</p>
        </div>
        {confirming ? (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Confirm removing ${widget.title}`}>
            <span className="text-xs text-text-secondary">Remove?</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Yes</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>No</button>
          </div>
        ) : (
          <button type="button" className="btn-icon shrink-0" aria-label={`Remove chart ${widget.title}`} onClick={() => setConfirming(true)}>
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="min-h-32 flex-1">
        {widget.type === "line" && <MiniLineChart data={widget.data} />}
        {widget.type === "bar" && <MiniBarChart data={widget.data} />}
        {widget.type === "kpi" && <KPICard value={widget.kpi} label={describe(widget)} />}
      </div>

      <p className="flex items-center gap-1.5 border-t border-border-subtle pt-3 text-xs text-text-tertiary">
        <Database size={12} aria-hidden="true" />
        <span className="truncate">{datasetName}</span>
        {removed && <span className="badge bg-warning-muted text-warning">Dataset removed</span>}
      </p>
    </div>
  );
}

export function EDADashboardsPage() {
  const { datasets, loading: datasetsLoading } = useDatasets();
  const { preview, aggregate, execute } = useQueryApi();
  const formId = useId();

  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [schema, setSchema] = useState<Record<string, string>>({});
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [columnsError, setColumnsError] = useState("");

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  // Keep the selection valid when the dataset list changes (e.g. another workspace).
  useEffect(() => {
    if (datasets.some((d) => d.id === selectedDatasetId)) return;
    setSelectedDatasetId(datasets[0]?.id ?? "");
  }, [datasets, selectedDatasetId]);

  // Column list (with types) for the selected dataset's latest version.
  useEffect(() => {
    setSchema({});
    setColumnsError("");
    if (!selectedDatasetId) { setColumnsLoading(false); return; }
    let cancelled = false;
    setColumnsLoading(true);
    preview(selectedDatasetId, 1)
      .then((p) => { if (!cancelled) setSchema(p.dataset_schema); })
      .catch((e) => { if (!cancelled) setColumnsError(e instanceof Error ? e.message : "Failed to load columns"); })
      .finally(() => { if (!cancelled) setColumnsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDatasetId, preview]);

  const columns = useMemo(() => Object.keys(schema), [schema]);
  const numericColumns = useMemo(() => columns.filter((c) => NUMERIC_TYPES.has(schema[c])), [columns, schema]);
  const datasetNames = useMemo(() => new Map(datasets.map((d) => [d.id, d.name])), [datasets]);

  const patchForm = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const selectDataset = (id: string) => {
    setSelectedDatasetId(id);
    setForm((f) => ({ ...f, dimension: "", measure: "" }));
    setFormError("");
  };

  const handleAddWidget = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    // Capture everything at click time so switching datasets mid-load can't misattribute the chart.
    const datasetId = selectedDatasetId;
    const datasetName = datasetNames.get(datasetId) ?? "";
    const f = form;
    const measure = f.measure || null;
    const aggregation: Aggregation = measure ? f.aggregation : "count";
    if (!datasetId || !f.title.trim() || (f.type !== "kpi" && !f.dimension)) return;

    setSubmitting(true);
    setFormError("");
    try {
      let data: Point[] = [];
      let kpi: number | null = null;
      if (f.type === "kpi") {
        const expr = aggregation === "count" ? "COUNT(*)" : `${aggregation.toUpperCase()}(${quoteIdent(measure!)})`;
        const res = await execute(datasetId, `SELECT ${expr} AS value FROM dataset`, 1);
        const raw = res.rows[0]?.[0];
        kpi = raw == null ? null : Number(raw);
      } else {
        const points = await aggregate(datasetId, f.dimension, measure, aggregation, f.topN);
        data = points.map((p) => ({ label: p.label ?? "(empty)", value: Number(p.value ?? 0) }));
        // The API returns groups ordered by value; a line reads left to right, so order by label.
        if (f.type === "line") data.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      }
      setWidgets((prev) => [...prev, {
        id: crypto.randomUUID(),
        datasetId,
        datasetName,
        type: f.type,
        title: f.title.trim(),
        dimension: f.dimension,
        measure,
        aggregation,
        topN: f.topN,
        data,
        kpi,
      }]);
      setIsAdding(false);
      setForm(INITIAL_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not build this chart");
    } finally {
      setSubmitting(false);
    }
  };

  const closeForm = () => { setIsAdding(false); setFormError(""); };
  const noDatasets = !datasetsLoading && datasets.length === 0;
  const addDisabled = !selectedDatasetId || columnsLoading || !!columnsError || columns.length === 0;

  return (
    <div>
      <PageHeader
        title="Dashboards"
        subtitle="Build charts from the latest version of a dataset. Charts are not saved yet: they reset when you leave this page."
        actions={
          <>
            <select
              aria-label="Dataset for new charts"
              className="input w-auto min-w-48 max-w-72"
              value={selectedDatasetId}
              onChange={(e) => selectDataset(e.target.value)}
              disabled={datasetsLoading || datasets.length === 0}
            >
              {datasets.length === 0 && <option value="">{datasetsLoading ? "Loading…" : "No datasets"}</option>}
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button type="button" onClick={() => setIsAdding(true)} disabled={addDisabled} className="btn btn-primary">
              {columnsLoading ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
              {columnsLoading ? "Loading columns…" : "Add chart"}
            </button>
          </>
        }
      />

      {columnsError && (
        <div role="alert" className="mb-6 rounded-lg border border-danger/20 bg-danger-muted p-3 text-sm text-danger">{columnsError}</div>
      )}

      {isAdding && (
        <form onSubmit={handleAddWidget} className="card mb-6" aria-label="New chart">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">New chart</h2>
            <button type="button" onClick={closeForm} className="btn-icon" aria-label="Close new chart form"><X size={17} /></button>
          </div>
          <fieldset disabled={submitting} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor={`${formId}-title`} className="field-label">Title</label>
              <input id={`${formId}-title`} type="text" required className="input" value={form.title}
                onChange={(e) => patchForm({ title: e.target.value })} placeholder="e.g. Orders by region" />
            </div>
            <div>
              <label htmlFor={`${formId}-type`} className="field-label">Chart type</label>
              <select id={`${formId}-type`} className="input" value={form.type} onChange={(e) => patchForm({ type: e.target.value as ChartType })}>
                <option value="bar">Bar chart</option>
                <option value="line">Line chart</option>
                <option value="kpi">Single number</option>
              </select>
            </div>
            {form.type !== "kpi" && (
              <div>
                <label htmlFor={`${formId}-dim`} className="field-label">Group by</label>
                <select id={`${formId}-dim`} className="input" required value={form.dimension} onChange={(e) => patchForm({ dimension: e.target.value })}>
                  <option value="">Select a column…</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor={`${formId}-measure`} className="field-label">Value</label>
              <select id={`${formId}-measure`} className="input" value={form.measure} onChange={(e) => patchForm({ measure: e.target.value })}>
                <option value="">Count rows</option>
                {numericColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {numericColumns.length === 0 && <p className="field-hint">This dataset has no numeric columns.</p>}
            </div>
            <div>
              <label htmlFor={`${formId}-agg`} className="field-label">Calculation</label>
              <select id={`${formId}-agg`} className="input" value={form.measure ? form.aggregation : "count"} disabled={!form.measure}
                onChange={(e) => patchForm({ aggregation: e.target.value as FormState["aggregation"] })}>
                {!form.measure && <option value="count">Count</option>}
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
              </select>
            </div>
            {form.type !== "kpi" && (
              <div>
                <label htmlFor={`${formId}-top`} className="field-label">Groups to show</label>
                <select id={`${formId}-top`} className="input" value={form.topN} onChange={(e) => patchForm({ topN: Number(e.target.value) })}>
                  {TOP_N_OPTIONS.map((n) => <option key={n} value={n}>Top {n}</option>)}
                </select>
              </div>
            )}
          </fieldset>
          {formError && (
            <div role="alert" className="mt-4 rounded-lg border border-danger/20 bg-danger-muted p-3 text-sm text-danger">{formError}</div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={closeForm}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <LoaderCircle size={15} className="animate-spin" />}
              {submitting ? "Adding…" : "Add chart"}
            </button>
          </div>
        </form>
      )}

      {datasetsLoading ? (
        <PageLoading />
      ) : noDatasets && widgets.length === 0 ? (
        <div className="card mx-auto max-w-md text-center">
          <BarChart3 size={22} className="mx-auto mb-3 text-text-tertiary" aria-hidden="true" />
          <h2 className="text-base font-semibold">No datasets yet</h2>
          <p className="mt-1 text-sm text-text-secondary">Import a dataset first, then build charts on its latest version here.</p>
          <Link to="/app/data-import" className="btn btn-primary mt-4">Import data</Link>
        </div>
      ) : widgets.length === 0 ? (
        !isAdding && (
          <div className="card mx-auto max-w-md text-center">
            <BarChart3 size={22} className="mx-auto mb-3 text-text-tertiary" aria-hidden="true" />
            <h2 className="text-base font-semibold">No charts yet</h2>
            <p className="mt-1 text-sm text-text-secondary">Add a chart to explore the selected dataset. Values are calculated from its latest version.</p>
            <button type="button" onClick={() => setIsAdding(true)} disabled={addDisabled} className="btn btn-primary mt-4">
              {columnsLoading ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
              {columnsLoading ? "Loading columns…" : "Add your first chart"}
            </button>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {widgets.map((w) => {
            const live = datasetNames.get(w.datasetId);
            return (
              <WidgetCard
                key={w.id}
                widget={w}
                datasetName={live ?? w.datasetName}
                removed={!datasetsLoading && live === undefined}
                onRemove={() => setWidgets((prev) => prev.filter((x) => x.id !== w.id))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
