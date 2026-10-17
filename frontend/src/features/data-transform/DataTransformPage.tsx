import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDatasets, useQueryApi, API_BASE } from "../../lib/hooks/useDatasets";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { errMessage, readError } from "../../lib/http";
import {
  OPS, CATS, OP_KEYS, defaultParams, stepLabel, applyWithFallback, fetchOpsFromApi,
  type Table, type TransformParams,
} from "../../lib/transforms/transforms";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepEntry { op: string; params: TransformParams; }

interface SchemaDiff {
  dataset_id: string;
  has_diff: boolean;
  added_columns: string[];
  missing_columns: string[];
  type_changes: { column: string; old_type: string; new_type: string }[];
  suggested_mappings: { column: string; suggested_target: string }[];
}

interface StagedPreview {
  columns: string[];
  dataset_schema: Record<string, string>;
  sample_rows: unknown[][];
  previous_schema: Record<string, string> | null;
  diff: SchemaDiff | null;
}

interface JobResponse {
  id: string; dataset_id: string; status: string; source_type: string; error_message?: string;
}

interface ImportState { jobId?: string; datasetId?: string; datasetName?: string; }

// ── Mapping entry (import mode) ───────────────────────────────────────────────

interface MappingEntry { from: string; to: string; }

// ── Compute helper ────────────────────────────────────────────────────────────

function computeTable(src: Table, steps: StepEntry[], upto?: number): { table: Table; errors: Record<number, string> } {
  let t: Table = { columns: src.columns.map(c => ({ ...c })), rows: src.rows.map(r => [...r]) };
  const errors: Record<number, string> = {};
  steps.forEach((s, i) => {
    if (upto !== undefined && i > upto) return;
    try { t = OPS[s.op].apply(t, s.params); } catch (e: any) { errors[i] = e.message; }
  });
  return { table: t, errors };
}

// ── Type badge colours ────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, [string, string]> = {
  integer:   ["#eff6ff", "#2563eb"],
  decimal:   ["#eff6ff", "#2563eb"],
  string:    ["#f4f4f5", "#52525b"],
  boolean:   ["#fdf4ff", "#a21caf"],
  timestamp: ["#fffbeb", "#b45309"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Root component — decides which sub-mode to render
// ─────────────────────────────────────────────────────────────────────────────

export function DataTransformPage() {
  const location = useLocation();
  const importState = (location.state ?? {}) as ImportState;
  return <PipelineStudio importState={importState} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline Studio
// ─────────────────────────────────────────────────────────────────────────────

function PipelineStudio({ importState }: { importState: ImportState }) {
  const navigate = useNavigate();
  const { session } = useAuthContext();
  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading: datasetsLoading } = useDatasets();
  const { preview: fetchPreview } = useQueryApi();

  const jobId = importState.jobId;
  const importMode = Boolean(jobId);

  // Tab state
  const [tab, setTab] = useState<"preview" | "import">(importMode ? "import" : "preview");

  // Source data per tab
  const [previewSrc, setPreviewSrc] = useState<Table | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");

  const [stagedSrc, setStagedSrc] = useState<Table | null>(null);
  const [stagedMeta, setStagedMeta] = useState<StagedPreview | null>(null);
  const [stagedLoading, setStagedLoading] = useState(false);
  const [stagedError, setStagedError] = useState("");

  // Transform state
  const [steps, setSteps] = useState<StepEntry[]>([]);
  const [past, setPast] = useState<StepEntry[][]>([]);
  const [future, setFuture] = useState<StepEntry[][]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState(-1);

  // UI state
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openColMenu, setOpenColMenu] = useState<string | null>(null);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [mappingCollapsed, setMappingCollapsed] = useState(false);
  const [transformCollapsed, setTransformCollapsed] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftOp, setDraftOp] = useState("drop");
  const [draftParams, setDraftParams] = useState<TransformParams>({});

  // Commit state (import only)
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [commitProgress, setCommitProgress] = useState("");

  // Save-as-dataset state (preview tab only — combining existing datasets)
  const [saveTargetOpen, setSaveTargetOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"new" | "existing">("new");
  const [saveName, setSaveName] = useState("");
  const [saveExistingId, setSaveExistingId] = useState("");

  const authHeaders = useCallback(
    (): Record<string, string> => ({ Authorization: `Bearer ${session?.accessToken}` }),
    [session],
  );

  // ── Load the canonical op catalog from the backend ──────────────────────────
  // OPS/CATS/OP_KEYS are module-level live bindings (not React state); fetching
  // merges in server-only ops (e.g. "join", category "Combine") that have no
  // local implementation. opsVersion forces a re-render once that resolves.
  const [, setOpsVersion] = useState(0);
  useEffect(() => {
    fetchOpsFromApi(authHeaders).then(() => setOpsVersion(v => v + 1));
  }, [authHeaders]);

  // ── Load preview data ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedDatasetId && datasets.length > 0) setSelectedDatasetId(datasets[0].id);
  }, [datasets, selectedDatasetId]);

  useEffect(() => {
    if (!selectedDatasetId || tab !== "preview") return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    fetchPreview(selectedDatasetId, 200)
      .then((p) => {
        if (cancelled) return;
        setPreviewSrc({
          columns: p.columns.map(name => ({ name, type: p.dataset_schema[name] ?? "string" })),
          rows: p.rows,
        });
      })
      .catch((e) => { if (!cancelled) { setPreviewSrc(null); setPreviewError(e.message); } })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDatasetId, tab, fetchPreview]);

  // ── Load staged preview data ────────────────────────────────────────────────

  useEffect(() => {
    if (!jobId || tab !== "import") return;
    let cancelled = false;
    setStagedLoading(true);
    setStagedError("");
    fetch(`${API_BASE}/data-ingest/jobs/${jobId}/staged-preview?limit=200`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, "Failed to load staged preview"));
        return res.json() as Promise<StagedPreview>;
      })
      .then((p) => {
        if (cancelled) return;
        setStagedMeta(p);
        setStagedSrc({
          columns: p.columns.map(name => ({ name, type: p.dataset_schema[name] ?? "string" })),
          rows: p.sample_rows,
        });
      })
      .catch((e) => { if (!cancelled) setStagedError(e.message); })
      .finally(() => { if (!cancelled) setStagedLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, tab, authHeaders]);

  // ── Right-dataset schema for join builder (kind "column_right") ────────────

  const [rightSchemaColumns, setRightSchemaColumns] = useState<string[]>([]);
  const [rightSchemaLoading, setRightSchemaLoading] = useState(false);
  const joinDatasetId = draftOp === "join" ? String(draftParams.dataset_id ?? "") : "";

  useEffect(() => {
    if (!joinDatasetId) { setRightSchemaColumns([]); return; }
    let cancelled = false;
    setRightSchemaLoading(true);
    fetch(`${API_BASE}/data-ingest/datasets/${joinDatasetId}/versions`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, "Failed to load dataset schema"));
        return res.json() as Promise<{ dataset_schema: Record<string, string> }[]>;
      })
      .then((versions) => {
        if (cancelled) return;
        const latest = versions[versions.length - 1];
        const cols = latest ? Object.keys(latest.dataset_schema) : [];
        setRightSchemaColumns(cols);
        // Auto-select a right-side column once loaded (mirrors defaultParams' handling
        // of "column" fields) — otherwise the <select> visually shows the first option
        // while draftParams stays "", producing a join with an empty right_on.
        if (cols.length) {
          setDraftParams(p => {
            const next = { ...p };
            for (const f of OPS[draftOp]?.fields ?? []) {
              if (f.kind === "column_right" && !cols.includes(String(next[f.key] ?? ""))) {
                next[f.key] = cols[0];
              }
            }
            return next;
          });
        }
      })
      .catch(() => { if (!cancelled) setRightSchemaColumns([]); })
      .finally(() => { if (!cancelled) setRightSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [joinDatasetId, authHeaders]);

  // ── Derived source table ────────────────────────────────────────────────────

  const src: Table | null = tab === "import" ? stagedSrc : previewSrc;
  const loading = tab === "import" ? stagedLoading : previewLoading;
  const loadError = tab === "import" ? stagedError : previewError;

  const diff = stagedMeta?.diff?.has_diff ? stagedMeta.diff : null;

  const MAPPINGS: MappingEntry[] = diff?.suggested_mappings.map(m => ({
    from: m.suggested_target,
    to: m.column,
  })) ?? [];

  // ── Compute ─────────────────────────────────────────────────────────────────
  // Join steps have no client-side apply() (they need real backend data), so any
  // plan containing one routes through applyWithFallback (server /transforms/preview)
  // instead of the synchronous computeTable. Non-join plans keep the instant path.

  const emptyTable: Table = { columns: [], rows: [] };
  const viewingPast = activeStepIndex >= 0 && activeStepIndex < steps.length - 1;
  const viewSteps = viewingPast ? steps.slice(0, activeStepIndex + 1) : steps;
  const hasJoin = steps.some(s => s.op === "join");
  const viewHasJoin = viewSteps.some(s => s.op === "join");

  const syncFull = src ? computeTable(src, steps) : { table: emptyTable, errors: {} };

  const [asyncFull, setAsyncFull] = useState<{ table: Table; errors: Record<number, string> } | null>(null);
  const [asyncFullLoading, setAsyncFullLoading] = useState(false);
  useEffect(() => {
    if (!hasJoin || !src) { setAsyncFull(null); return; }
    let cancelled = false;
    setAsyncFullLoading(true);
    applyWithFallback(src, steps, authHeaders)
      .then(res => { if (!cancelled) setAsyncFull(res); })
      .finally(() => { if (!cancelled) setAsyncFullLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, hasJoin, JSON.stringify(steps), authHeaders]);

  const [asyncView, setAsyncView] = useState<{ table: Table; errors: Record<number, string> } | null>(null);
  const [asyncViewLoading, setAsyncViewLoading] = useState(false);
  useEffect(() => {
    if (!viewingPast || !viewHasJoin || !src) { setAsyncView(null); return; }
    let cancelled = false;
    setAsyncViewLoading(true);
    applyWithFallback(src, viewSteps, authHeaders)
      .then(res => { if (!cancelled) setAsyncView(res); })
      .finally(() => { if (!cancelled) setAsyncViewLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, viewingPast, viewHasJoin, JSON.stringify(viewSteps), authHeaders]);

  const full = hasJoin ? (asyncFull ?? syncFull) : syncFull;
  const joinPreviewLoading = (hasJoin && asyncFullLoading) || (viewingPast && viewHasJoin && asyncViewLoading);
  const viewTable = viewingPast
    ? (viewHasJoin ? (asyncView ?? syncFull).table : (src ? computeTable(src, steps, activeStepIndex).table : emptyTable))
    : full.table;

  // ── Step mutations ──────────────────────────────────────────────────────────

  function mutateSteps(fn: (prev: StepEntry[]) => StepEntry[], afterFn?: (next: StepEntry[]) => Partial<{ activeStepIndex: number }>) {
    setSteps(prev => {
      const next = fn(prev);
      setPast(p => [...p, prev]);
      setFuture([]);
      if (afterFn) {
        const result = afterFn(next);
        if (result.activeStepIndex !== undefined) setActiveStepIndex(result.activeStepIndex);
      }
      return next;
    });
  }

  function undo() {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setFuture(f => [steps, ...f]);
    setPast(p => p.slice(0, -1));
    setSteps(prev);
    setActiveStepIndex(i => Math.min(i, prev.length - 1));
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setPast(p => [...p, steps]);
    setFuture(f => f.slice(1));
    setSteps(next);
    setActiveStepIndex(next.length - 1);
  }

  // ── Tab switch ──────────────────────────────────────────────────────────────

  function switchTab(t: "preview" | "import") {
    if (tab === t) return;
    setTab(t);
    setSteps([]); setPast([]); setFuture([]);
    setActiveStepIndex(-1); setBuilderOpen(false); setEditingIndex(null);
    setOpenMenu(null); setOpenColMenu(null);
  }

  // ── Column menus & op picking ───────────────────────────────────────────────

  function closeMenus() { setOpenMenu(null); setOpenColMenu(null); }

  function pickOp(key: string) {
    setOpenMenu(null); setOpenColMenu(null);
    setBuilderOpen(true); setEditingIndex(null);
    setDraftOp(key);
    setDraftParams(defaultParams(key, full.table.columns.map(c => c.name), null));
  }

  function instantStep(op: string, params: TransformParams) {
    mutateSteps(prev => [...prev, { op, params }], next => ({ activeStepIndex: next.length - 1 }));
    setOpenColMenu(null);
  }

  function openBuilderFor(op: string, column: string) {
    setOpenColMenu(null);
    setBuilderOpen(true); setEditingIndex(null);
    setDraftOp(op);
    setDraftParams(defaultParams(op, full.table.columns.map(c => c.name), column));
    setSettingsCollapsed(false);
  }

  function commitBuilder() {
    const step: StepEntry = { op: draftOp, params: { ...draftParams } };
    mutateSteps(
      prev => editingIndex !== null && editingIndex >= 0
        ? prev.map((s, i) => i === editingIndex ? step : s)
        : [...prev, step],
      next => ({ activeStepIndex: editingIndex !== null && editingIndex >= 0 ? editingIndex : next.length - 1 }),
    );
    setBuilderOpen(false); setEditingIndex(null);
  }

  function editStep(i: number, e: React.MouseEvent) {
    e.stopPropagation();
    const s = steps[i];
    setBuilderOpen(true); setEditingIndex(i);
    setDraftOp(s.op); setDraftParams({ ...s.params });
  }

  function removeStep(i: number, e: React.MouseEvent) {
    e.stopPropagation();
    mutateSteps(prev => prev.filter((_, j) => j !== i), (next, ) => ({ activeStepIndex: Math.min(activeStepIndex, next.length - 1) }));
  }

  function applyMapping(m: MappingEntry, e: React.MouseEvent) {
    e.stopPropagation();
    mutateSteps(prev => [...prev, { op: "rename", params: { column: m.from, to: m.to } }], next => ({ activeStepIndex: next.length - 1 }));
  }

  function applyAllMappings(e: React.MouseEvent) {
    e.stopPropagation();
    const pending = MAPPINGS.filter(m => !steps.some(s => s.op === "rename" && s.params.column === m.from && s.params.to === m.to));
    if (pending.length) mutateSteps(prev => [...prev, ...pending.map(m => ({ op: "rename", params: { column: m.from, to: m.to } }))], next => ({ activeStepIndex: next.length - 1 }));
  }

  // ── Save & Apply (import mode) / Save as dataset (preview mode) ────────────

  function pollJob(id: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/data-ingest/jobs/${id}`, { headers: authHeaders() });
          if (!r.ok) return;
          const job: JobResponse = await r.json();
          if (job.status === "SUCCESS") { clearInterval(poll); resolve(); }
          else if (job.status === "FAILED") { clearInterval(poll); reject(new Error(errMessage(job.error_message, "Pipeline failed"))); }
        } catch { /* transient */ }
      }, 2000);
    });
  }

  async function saveAndApply() {
    if (!jobId) return;
    setCommitting(true); setCommitError(""); setCommitProgress("Dispatching pipeline…");
    try {
      const res = await fetch(`${API_BASE}/data-ingest/jobs/${jobId}/commit`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ transforms: steps.map(s => ({ type: s.op, ...s.params })) }),
      });
      if (!res.ok) throw new Error(await readError(res, "Commit failed"));
      setCommitProgress("Running pipeline…");
      await pollJob(jobId);
      navigate("/app/data-import");
    } catch (e: any) { setCommitError(e.message); setCommitting(false); setCommitProgress(""); }
  }

  async function saveCombine() {
    if (!selectedDatasetId || !activeWorkspace) return;
    setCommitting(true); setCommitError(""); setCommitProgress("Dispatching pipeline…");
    try {
      const res = await fetch(`${API_BASE}/data-ingest/jobs/combine`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          primary_dataset_id: selectedDatasetId,
          transforms: steps.map(s => ({ type: s.op, ...s.params })),
          new_dataset_name: saveMode === "new" ? saveName : null,
          target_dataset_id: saveMode === "existing" ? saveExistingId : null,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "Combine failed"));
      const job: JobResponse = await res.json();
      setCommitProgress("Running pipeline…");
      await pollJob(job.id);
      navigate("/app/data-import");
    } catch (e: any) { setCommitError(e.message); setCommitting(false); setCommitProgress(""); }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const t = viewTable;
  let nullCells = 0;
  const colStats = t.columns.map((col, i) => {
    const vals = t.rows.map(r => r[i]);
    const nullCount = vals.filter(v => v === null || v === undefined).length;
    nullCells += nullCount;
    const validPct = t.rows.length ? Math.round(((t.rows.length - nullCount) / t.rows.length) * 100) : 100;
    const [bg, fg] = TYPE_COLORS[col.type] || ["#f4f4f5", "#52525b"];
    const isStr = col.type === "string";
    const isNum = col.type === "integer" || col.type === "decimal";
    return { col, nullCount, validPct, bg, fg, isStr, isNum };
  });

  const errCount = Object.keys(full.errors).length;
  const srcActive = activeStepIndex === -1;
  const activeStep = steps[activeStepIndex];
  const activeStepCode = srcActive || !activeStep ? "SELECT * FROM dataset" : OPS[activeStep.op]?.code(activeStep.params) ?? "";

  const mappingApplied = (m: MappingEntry) =>
    steps.some(s => s.op === "rename" && s.params.column === m.from && s.params.to === m.to);
  const mappingCount = MAPPINGS.filter(m => !mappingApplied(m)).length;

  const currentColNames = full.table.columns.map(c => c.name);

  const def = OPS[draftOp];
  const builderFields = def?.fields ?? [];

  const opGroups = CATS.map(cat => ({
    cat,
    ops: OP_KEYS.filter(k => OPS[k].cat === cat).map(k => ({ key: k, label: OPS[k].label, desc: OPS[k].desc })),
  }));

  const selectedDatasetName = datasets.find(d => d.id === selectedDatasetId)?.name ?? "dataset";
  const currentDatasetId = tab === "import" ? importState.datasetId : selectedDatasetId;

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ display: "flex", height: "100vh", width: "100%", overflow: "hidden", background: "#fafafa", color: "#0a0a0b", fontFamily: "Inter,system-ui,sans-serif" }}
      onClick={closeMenus}
    >
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 28px 13px", borderBottom: "1px solid #ececef", background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Pipeline Studio</h1>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#71717a" }}>Steps run live on the preview. Save &amp; Apply processes the full dataset in the background.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Tab switcher */}
            <div style={{ display: "flex", padding: 3, background: "#f4f4f5", borderRadius: 9, gap: 2 }}>
              <button
                onClick={(e) => { e.stopPropagation(); switchTab("preview"); }}
                style={{ border: "none", padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", background: tab === "preview" ? "#0a0a0b" : "transparent", color: tab === "preview" ? "#fff" : "#71717a" }}
              >Preview</button>
              <button
                onClick={(e) => { e.stopPropagation(); switchTab("import"); }}
                disabled={!importMode}
                style={{ border: "none", padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: importMode ? "pointer" : "not-allowed", background: tab === "import" ? "#0a0a0b" : "transparent", color: tab === "import" ? "#fff" : importMode ? "#71717a" : "#d4d4d8" }}
              >Import Review</button>
            </div>

            {/* Dataset badge / job badge */}
            {tab === "preview" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 9, background: "#f4f4f5", border: "1px solid #ececef" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>
                <select
                  value={selectedDatasetId}
                  onChange={e => { e.stopPropagation(); setSelectedDatasetId(e.target.value); }}
                  onClick={e => e.stopPropagation()}
                  disabled={datasetsLoading || datasets.length === 0}
                  style={{ background: "transparent", border: "none", outline: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {datasets.length === 0 && <option value="">No datasets</option>}
                  {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 9, background: "#f4f4f5", border: "1px solid #ececef" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{importState.datasetName ?? "staged"}</span>
              </div>
            )}

            {tab === "import" ? (
              <button
                onClick={saveAndApply}
                disabled={committing || stagedLoading || !!stagedError}
                style={{ background: "#0a0a0b", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: !committing ? "pointer" : "not-allowed", opacity: committing || stagedLoading || !!stagedError ? 0.5 : 1 }}
              >{committing ? "Applying…" : "Save & Apply"}</button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setSaveTargetOpen(v => !v); }}
                disabled={committing || !selectedDatasetId || previewLoading || !!previewError}
                style={{ background: "#0a0a0b", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: !committing ? "pointer" : "not-allowed", opacity: committing || !selectedDatasetId || previewLoading || !!previewError ? 0.5 : 1 }}
              >{committing ? "Saving…" : "Save as dataset"}</button>
            )}
          </div>
        </div>

        {/* ── Combine & Save modal (preview tab) ──────────────────────────────── */}
        {tab === "preview" && saveTargetOpen && (
          <div
            onClick={() => !committing && setSaveTargetOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(10,10,11,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Combine &amp; Save as Dataset</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#71717a" }}>
                    Saves <strong>{selectedDatasetName}</strong>{steps.length > 0 ? ` with your ${steps.length} pipeline step${steps.length > 1 ? "s" : ""}` : ""} applied. Add a <strong>Join Dataset</strong> step from the Combine menu above to merge in other datasets before saving.
                  </p>
                </div>
                <button onClick={() => setSaveTargetOpen(false)} disabled={committing} style={{ background: "none", border: "none", color: "#a1a1aa", cursor: "pointer", fontSize: 15, padding: 4 }}>✕</button>
              </div>

              {!hasJoin && (
                <div style={{ fontSize: 12, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px" }}>
                  No join steps yet — this will save {selectedDatasetName} on its own. Close this dialog, add a Join Dataset step, then reopen to combine multiple tables.
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#71717a", marginBottom: 6 }}>Save as</label>
                <div style={{ display: "flex", padding: 3, background: "#f4f4f5", borderRadius: 9, gap: 2 }}>
                  <button onClick={() => setSaveMode("new")} style={{ flex: 1, border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: saveMode === "new" ? "#0a0a0b" : "transparent", color: saveMode === "new" ? "#fff" : "#71717a" }}>New dataset</button>
                  <button onClick={() => setSaveMode("existing")} style={{ flex: 1, border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: saveMode === "existing" ? "#0a0a0b" : "transparent", color: saveMode === "existing" ? "#fff" : "#71717a" }}>Existing dataset (new version)</button>
                </div>
              </div>

              <div>
                {saveMode === "new" ? (
                  <input autoFocus value={saveName} onInput={e => setSaveName((e.target as HTMLInputElement).value)} placeholder="New dataset name"
                    style={{ width: "100%", padding: "9px 11px", border: "1px solid #ececef", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                ) : (
                  <select value={saveExistingId} onChange={e => setSaveExistingId(e.target.value)}
                    style={{ width: "100%", padding: "9px 11px", border: "1px solid #ececef", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}>
                    <option value="">Select dataset…</option>
                    {datasets.filter(d => d.id !== selectedDatasetId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                )}
              </div>

              {commitError && <div style={{ fontSize: 12, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 11px" }}>{commitError}</div>}
              {committing && commitProgress && <div style={{ fontSize: 12, color: "#71717a" }}>{commitProgress}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => setSaveTargetOpen(false)} disabled={committing} style={{ background: "transparent", color: "#52525b", border: "1px solid #ececef", padding: "9px 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button
                  onClick={saveCombine}
                  disabled={committing || (saveMode === "new" ? !saveName.trim() : !saveExistingId)}
                  style={{ background: "#0a0a0b", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: committing || (saveMode === "new" ? !saveName.trim() : !saveExistingId) ? 0.5 : 1 }}
                >{committing ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Workspace ───────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, margin: "14px 28px 20px", border: "1px solid #ececef", borderRadius: 12, background: "#fff", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>

          {/* Menu bar */}
          <div style={{ height: 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 2, padding: "0 12px", borderBottom: "1px solid #ececef" }} onClick={e => e.stopPropagation()}>
            {opGroups.map(({ cat, ops }) => (
              <div key={cat} style={{ position: "relative" }}>
                <button
                  onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === cat ? null : cat); setOpenColMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 5, border: "none", padding: "8px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: openMenu === cat ? "#f4f4f5" : "transparent", color: "#3f3f46" }}
                >
                  {cat}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                {openMenu === cat && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, minWidth: 214, background: "#fff", border: "1px solid #ececef", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.08)", padding: 5, display: "flex", flexDirection: "column" }}>
                    {ops.map(op => (
                      <button
                        key={op.key}
                        onClick={e => { e.stopPropagation(); pickOp(op.key); }}
                        style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, border: "none", background: "transparent", padding: "8px 10px", borderRadius: 7, cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f4f4f5")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#27272a" }}>{op.label}</span>
                        <span style={{ fontSize: 11, color: "#a1a1aa" }}>{op.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div style={{ width: 1, alignSelf: "stretch", margin: "10px 6px", background: "#ececef" }} />

            <button
              onClick={e => { e.stopPropagation(); undo(); }}
              disabled={!past.length}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: "8px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: past.length ? "pointer" : "default", color: past.length ? "#3f3f46" : "#d4d4d8" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M9 14l-4-4 4-4M5 10h9a5 5 0 010 10h-1" /></svg>
              Undo
            </button>
            <button
              onClick={e => { e.stopPropagation(); redo(); }}
              disabled={!future.length}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: "8px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: future.length ? "pointer" : "default", color: future.length ? "#3f3f46" : "#d4d4d8" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M15 14l4-4-4-4M19 10h-9a5 5 0 000 10h1" /></svg>
              Redo
            </button>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
              <button
                onClick={e => { e.stopPropagation(); setSettingsCollapsed(v => !v); }}
                style={{ display: "flex", alignItems: "center", gap: 6, border: "none", padding: "8px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", background: settingsCollapsed ? "transparent" : "#f4f4f5", color: "#3f3f46" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
                Query Settings
              </button>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {/* ── Grid ──────────────────────────────────────────────────────── */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

              {/* Viewing-past banner */}
              {viewingPast && (
                <div style={{ flexShrink: 0, padding: "7px 16px", background: "#fffbeb", borderBottom: "1px solid #fde68a", fontSize: 11.5, color: "#b45309", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Viewing data at step <strong>{stepLabel({ type: steps[activeStepIndex].op, ...steps[activeStepIndex].params })}</strong> — later steps are not applied.</span>
                  <button onClick={() => setActiveStepIndex(steps.length - 1)} style={{ border: "none", background: "transparent", color: "#b45309", fontWeight: 700, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>Jump to latest</button>
                </div>
              )}

              {/* Join preview refresh (server-side, since join has no local apply) */}
              {joinPreviewLoading && <div style={{ flexShrink: 0, padding: "7px 16px", background: "#f4f4f5", borderBottom: "1px solid #ececef", fontSize: 11.5, color: "#71717a" }}>Refreshing joined preview…</div>}

              {/* Commit error / progress */}
              {commitError && <div style={{ flexShrink: 0, padding: "7px 16px", background: "#fef2f2", borderBottom: "1px solid #fecaca", fontSize: 11.5, color: "#ef4444" }}>{commitError}</div>}
              {committing && commitProgress && <div style={{ flexShrink: 0, padding: "7px 16px", background: "#f4f4f5", borderBottom: "1px solid #ececef", fontSize: 11.5, color: "#71717a" }}>{commitProgress}</div>}

              <div style={{ flex: 1, overflow: "auto" }} onClick={closeMenus}>
                {loading ? (
                  <div style={{ padding: 32, fontSize: 13, color: "#a1a1aa" }}>Loading preview…</div>
                ) : loadError ? (
                  <div style={{ padding: 32, fontSize: 13, color: "#ef4444" }}>{loadError}</div>
                ) : !src ? (
                  <div style={{ padding: 32, fontSize: 13, color: "#a1a1aa" }}>
                    {tab === "preview" ? "Select a dataset to begin." : "No staged data available."}
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ position: "sticky", top: 0, background: "#fafafa", zIndex: 2, padding: "9px 14px", borderBottom: "1px solid #ececef", borderRight: "1px solid #ececef", textAlign: "right", fontSize: 11, color: "#a1a1aa", fontWeight: 600, width: 44 }}>#</th>
                        {colStats.map(({ col, nullCount, validPct, bg, fg, isStr, isNum }) => (
                          <th
                            key={col.name}
                            style={{ position: "sticky", top: 0, zIndex: openColMenu === col.name ? 30 : 2, padding: "8px 14px 7px", borderBottom: "1px solid #ececef", borderRight: "1px solid #ececef", whiteSpace: "nowrap", background: openColMenu === col.name ? "#f4f4f5" : "#fafafa", textAlign: "left" }}
                          >
                            <div onClick={e => { e.stopPropagation(); setOpenColMenu(openColMenu === col.name ? null : col.name); setOpenMenu(null); }} style={{ cursor: "pointer" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                                  {col.name}
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                                </span>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 600, background: bg, color: fg, padding: "1px 6px", borderRadius: 5 }}>{col.type}</span>
                              </div>
                              <div title={`${validPct}% valid · ${nullCount} nulls`} style={{ marginTop: 6, height: 3, borderRadius: 2, background: "#fecaca", overflow: "hidden" }}>
                                <div style={{ height: "100%", background: "#16a34a", width: `${validPct}%` }} />
                              </div>
                            </div>
                            {openColMenu === col.name && (
                              <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% - 4px)", left: 8, zIndex: 40, minWidth: 186, background: "#fff", border: "1px solid #ececef", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", padding: 5, display: "flex", flexDirection: "column", fontWeight: 400, textAlign: "left" }}>
                                <div style={{ padding: "6px 10px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: "#c1c1c6", textTransform: "uppercase" }}>Quick transforms</div>
                                {[
                                  { label: "Drop column", instant: true, op: "drop", params: { column: col.name } },
                                  { label: "Rename…", instant: false, op: "rename", col: col.name },
                                  { label: "Cast type…", instant: false, op: "cast", col: col.name },
                                  ...(nullCount > 0 ? [
                                    { label: "Remove null rows", instant: true, op: "dropnulls", params: { column: col.name } },
                                    { label: "Fill missing…", instant: false, op: "fillna", col: col.name },
                                  ] : []),
                                  ...(isStr ? [
                                    { label: "Trim whitespace", instant: true, op: "trim", params: { column: col.name } },
                                    { label: "lowercase", instant: true, op: "lower", params: { column: col.name } },
                                    { label: "Split column…", instant: false, op: "split", col: col.name },
                                  ] : []),
                                  ...(isNum ? [
                                    { label: "Z-score normalize", instant: true, op: "zscore", params: { column: col.name } },
                                    { label: "Round…", instant: false, op: "round", col: col.name },
                                  ] : []),
                                  { label: "Filter rows…", instant: false, op: "filter", col: col.name },
                                ].map((act, idx) => (
                                  <button
                                    key={idx}
                                    onClick={e => {
                                      e.stopPropagation();
                                      if ((act as any).instant) instantStep((act as any).op, (act as any).params);
                                      else openBuilderFor((act as any).op, (act as any).col ?? col.name);
                                    }}
                                    style={{ border: "none", background: "transparent", padding: "7px 10px", borderRadius: 7, cursor: "pointer", textAlign: "left", fontSize: 12.5, fontWeight: 500, color: "#27272a", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
                                    onMouseEnter={e => (e.currentTarget.style.background = "#f4f4f5")}
                                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                  >
                                    {act.label}
                                    {(act as any).instant && <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 700 }}>instant</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.slice(0, 50).map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          <td style={{ padding: "8px 14px", borderBottom: "1px solid #f4f4f5", borderRight: "1px solid #ececef", textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "#c1c1c6" }}>{rowIdx + 1}</td>
                          {row.map((cell, j) => {
                            const isNull = cell === null || cell === undefined;
                            return (
                              <td key={j} style={{ padding: "8px 14px", borderBottom: "1px solid #f4f4f5", borderRight: "1px solid #ececef", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, whiteSpace: "nowrap", color: isNull ? "#c1c1c6" : "#27272a", fontStyle: isNull ? "italic" : "normal" }}>
                                {isNull ? "null" : String(cell)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {src && t.rows.length === 0 && !loading && (
                  <div style={{ padding: 32, fontSize: 13, color: "#a1a1aa" }}>All rows were filtered out by the current pipeline.</div>
                )}
              </div>

              {/* fx bar */}
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderTop: "1px solid #ececef", background: "#fafafa" }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: "#a1a1aa" }}>fx</span>
                <div style={{ flex: 1, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#52525b", background: "#fff", border: "1px solid #ececef", borderRadius: 7, padding: "6px 11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeStepCode}</div>
              </div>

              {/* Status bar */}
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 16, padding: "6px 16px", borderTop: "1px solid #ececef", background: "#fff", fontSize: 11, color: "#a1a1aa" }}>
                <span>{t.rows.length} rows</span>
                <span>{t.columns.length} columns</span>
                <span>{nullCells} null cells</span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: errCount ? "#ef4444" : "#16a34a", display: "inline-block" }} />
                  {errCount ? `${errCount} step error${errCount > 1 ? "s" : ""}` : "Pipeline healthy"}
                </span>
              </div>
            </div>

            {/* ── Collapsed rail ─────────────────────────────────────────────── */}
            {settingsCollapsed && (
              <div style={{ width: 42, minWidth: 42, borderLeft: "1px solid #ececef", background: "#fdfdfd", display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 10 }}>
                <button onClick={e => { e.stopPropagation(); setSettingsCollapsed(false); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#71717a", padding: 6, borderRadius: 7 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <span style={{ writingMode: "vertical-rl", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: "#a1a1aa", textTransform: "uppercase" }}>Query Settings · {steps.length} steps</span>
              </div>
            )}

            {/* ── Query Settings panel ───────────────────────────────────────── */}
            {!settingsCollapsed && (
              <div style={{ width: 312, minWidth: 312, borderLeft: "1px solid #ececef", display: "flex", flexDirection: "column", background: "#fdfdfd", overflow: "hidden" }}>
                <div style={{ padding: "11px 12px 11px 16px", borderBottom: "1px solid #ececef", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: "#a1a1aa", textTransform: "uppercase" }}>Query Settings</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{tab === "preview" ? (selectedDatasetName) : (importState.datasetName ?? "staged")}</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setSettingsCollapsed(true); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#a1a1aa", padding: 5, borderRadius: 6 }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#f4f4f5"; e.currentTarget.style.color = "#0a0a0b"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#a1a1aa"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: "auto" }}>

                  {/* Mapping section (import mode) */}
                  {tab === "import" && MAPPINGS.length > 0 && (
                    <div style={{ borderBottom: "1px solid #ececef" }}>
                      <div onClick={e => { e.stopPropagation(); setMappingCollapsed(v => !v); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", cursor: "pointer", background: "#fafafa" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2.4" style={{ transform: mappingCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .15s" }}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#52525b", textTransform: "uppercase", flex: 1 }}>Mapping</span>
                        <span style={{ fontSize: 10, fontWeight: 700, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", padding: "1px 7px", borderRadius: 99 }}>{mappingCount} pending</span>
                        <button onClick={e => applyAllMappings(e)} style={{ border: "none", background: "#0a0a0b", color: "#fff", fontSize: 10.5, fontWeight: 600, padding: "4px 9px", borderRadius: 6, cursor: "pointer" }}>Apply all</button>
                      </div>
                      {!mappingCollapsed && (
                        <div style={{ padding: "11px 16px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                          {diff && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {diff.added_columns.map(c => <span key={c} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 5, padding: "2px 6px" }}>+ {c}</span>)}
                              {diff.missing_columns.map(c => <span key={c} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 5, padding: "2px 6px" }}>- {c}</span>)}
                            </div>
                          )}
                          {MAPPINGS.map((m, idx) => {
                            const applied = mappingApplied(m);
                            return (
                              <button key={idx} onClick={e => !applied && applyMapping(m, e)} disabled={applied}
                                style={{ textAlign: "left", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", border: `1px solid ${applied ? "#bbf7d0" : "#ececef"}`, borderRadius: 7, padding: "7px 9px", background: applied ? "#f0fdf4" : "#fafafa", cursor: applied ? "default" : "pointer", color: applied ? "#16a34a" : "#27272a" }}
                              >
                                <span style={{ color: "#a1a1aa" }}>rename</span> {m.from} → {m.to}
                                {applied && <span style={{ color: "#16a34a", fontWeight: 700, float: "right" }}>✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transformation section */}
                  <div style={{ borderBottom: "1px solid #ececef" }}>
                    <div onClick={e => { e.stopPropagation(); setTransformCollapsed(v => !v); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", cursor: "pointer", background: "#fafafa" }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2.4" style={{ transform: transformCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .15s" }}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#52525b", textTransform: "uppercase", flex: 1 }}>Transformation</span>
                      <span style={{ fontSize: 10, fontWeight: 700, background: "#f4f4f5", color: "#52525b", border: "1px solid #ececef", padding: "1px 7px", borderRadius: 99 }}>{steps.length}</span>
                      <button onClick={e => { e.stopPropagation(); if (steps.length) { mutateSteps(() => [], () => ({ activeStepIndex: -1 })); setActiveStepIndex(-1); } }} style={{ border: "none", background: "transparent", color: "#a1a1aa", fontSize: 10.5, fontWeight: 600, padding: "4px 6px", borderRadius: 6, cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={e => (e.currentTarget.style.color = "#a1a1aa")}
                      >Clear</button>
                    </div>
                    {!transformCollapsed && (
                      <div style={{ padding: "9px 12px 13px", display: "flex", flexDirection: "column", gap: 4 }}>
                        {/* Source node */}
                        <div onClick={() => setActiveStepIndex(-1)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 8, cursor: "pointer", background: srcActive ? "#f4f4f5" : "transparent" }}>
                          <div style={{ width: 19, height: 19, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, background: srcActive ? "#0a0a0b" : "#ececef", color: srcActive ? "#fff" : "#71717a" }}>◆</div>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500 }}>Source</div>
                        </div>

                        {steps.map((step, i) => {
                          const active = activeStepIndex === i;
                          const err = full.errors[i];
                          return (
                            <div key={i} onClick={() => setActiveStepIndex(i)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 8, cursor: "pointer", background: active ? "#f4f4f5" : "transparent" }}>
                              <div style={{ width: 19, height: 19, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: err ? "#fef2f2" : active ? "#0a0a0b" : "#ececef", color: err ? "#ef4444" : active ? "#fff" : "#71717a" }}>{i + 1}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stepLabel({ type: step.op, ...step.params })}</div>
                                {err && <div style={{ fontSize: 10.5, color: "#ef4444" }}>{err}</div>}
                              </div>
                              <button onClick={e => editStep(i, e)} style={{ background: "none", border: "none", padding: 3, cursor: "pointer", color: "#a1a1aa", display: "flex" }}
                                onMouseEnter={e => (e.currentTarget.style.color = "#0a0a0b")}
                                onMouseLeave={e => (e.currentTarget.style.color = "#a1a1aa")}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5m-1.5-6.5a2.121 2.121 0 013 3L12 17l-4 1 1-4 8.5-8.5z" /></svg>
                              </button>
                              <button onClick={e => removeStep(i, e)} style={{ background: "none", border: "none", padding: 3, cursor: "pointer", color: "#a1a1aa", display: "flex" }}
                                onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                                onMouseLeave={e => (e.currentTarget.style.color = "#a1a1aa")}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                          );
                        })}

                        {steps.length === 0 && (
                          <div style={{ fontSize: 11.5, color: "#c1c1c6", fontStyle: "italic", padding: "5px 4px" }}>No steps yet. Use the transform menus above, or click a column header for instant transforms.</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Builder */}
                {builderOpen ? (
                  <div style={{ borderTop: "1px solid #ececef", background: "#fff", padding: "13px 16px", display: "flex", flexDirection: "column", gap: 9, maxHeight: "55%", overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", color: "#a1a1aa", textTransform: "uppercase" }}>{editingIndex !== null ? `Edit Step ${editingIndex + 1}` : "Add Step"}</span>
                      <button onClick={() => { setBuilderOpen(false); setEditingIndex(null); }} style={{ background: "none", border: "none", color: "#a1a1aa", cursor: "pointer", fontSize: 13 }}>✕</button>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#71717a", marginBottom: 4 }}>Operation</label>
                      <select
                        value={draftOp}
                        onChange={e => { const key = e.target.value; setDraftOp(key); setDraftParams(defaultParams(key, currentColNames, null)); }}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12.5, outline: "none", background: "#fafafa", color: "#27272a" }}
                      >
                        {opGroups.map(({ cat, ops }) => (
                          <optgroup key={cat} label={cat}>
                            {ops.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {builderFields.map(f => (
                      <div key={f.key}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#71717a", marginBottom: 4 }}>{f.label}</label>
                        {f.kind === "column" && (
                          <select value={String(draftParams[f.key] ?? "")} onChange={e => setDraftParams(p => ({ ...p, [f.key]: e.target.value }))}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12, outline: "none", background: "#fafafa", color: "#27272a", fontFamily: "'JetBrains Mono',monospace" }}>
                            {currentColNames.map(cn => <option key={cn} value={cn}>{cn}</option>)}
                          </select>
                        )}
                        {f.kind === "select" && (
                          <select value={String(draftParams[f.key] ?? "")} onChange={e => setDraftParams(p => ({ ...p, [f.key]: e.target.value }))}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12.5, outline: "none", background: "#fafafa", color: "#27272a" }}>
                            {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        )}
                        {f.kind === "dataset" && (
                          <select value={String(draftParams[f.key] ?? "")}
                            onChange={e => setDraftParams(p => ({ ...p, [f.key]: e.target.value }))}
                            disabled={datasetsLoading}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12.5, outline: "none", background: "#fafafa", color: "#27272a" }}>
                            <option value="">{datasetsLoading ? "Loading…" : "Select dataset…"}</option>
                            {datasets.filter(d => d.id !== currentDatasetId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        )}
                        {f.kind === "column_right" && (
                          <select value={String(draftParams[f.key] ?? "")}
                            onChange={e => setDraftParams(p => ({ ...p, [f.key]: e.target.value }))}
                            disabled={rightSchemaColumns.length === 0}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12, outline: "none", background: "#fafafa", color: "#27272a", fontFamily: "'JetBrains Mono',monospace" }}>
                            {rightSchemaColumns.length === 0
                              ? <option value="">{rightSchemaLoading ? "Loading…" : "Select a dataset first"}</option>
                              : rightSchemaColumns.map(cn => <option key={cn} value={cn}>{cn}</option>)}
                          </select>
                        )}
                        {f.kind === "text" && (
                          <input value={String(draftParams[f.key] ?? "")} onInput={e => setDraftParams(p => ({ ...p, [f.key]: (e.target as HTMLInputElement).value }))}
                            placeholder={f.placeholder}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12, outline: "none", background: "#fafafa", color: "#27272a", fontFamily: "'JetBrains Mono',monospace", boxSizing: "border-box" }} />
                        )}
                        {f.kind === "number" && (
                          <input type="number" value={String(draftParams[f.key] ?? "")} onInput={e => setDraftParams(p => ({ ...p, [f.key]: (e.target as HTMLInputElement).value }))}
                            placeholder={f.placeholder}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ececef", borderRadius: 7, fontSize: 12, outline: "none", background: "#fafafa", color: "#27272a", fontFamily: "'JetBrains Mono',monospace", boxSizing: "border-box" }} />
                        )}
                      </div>
                    ))}

                    <button onClick={commitBuilder} style={{ marginTop: 2, background: "#0a0a0b", color: "#fff", border: "none", borderRadius: 8, padding: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                      {editingIndex !== null ? "Save Changes" : "Add to Pipeline"}
                    </button>
                  </div>
                ) : (
                  <div style={{ borderTop: "1px solid #ececef", padding: "12px 16px" }}>
                    <button
                      onClick={e => { e.stopPropagation(); setBuilderOpen(true); setEditingIndex(null); setDraftOp("drop"); setDraftParams(defaultParams("drop", currentColNames, null)); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "1px dashed #d4d4d8", borderRadius: 8, padding: 9, fontSize: 12.5, fontWeight: 600, color: "#52525b", background: "#fff", cursor: "pointer" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#0a0a0b"; e.currentTarget.style.color = "#0a0a0b"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#d4d4d8"; e.currentTarget.style.color = "#52525b"; }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Add Step
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
