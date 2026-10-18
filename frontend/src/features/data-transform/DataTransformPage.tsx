import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Database, ListOrdered, LoaderCircle, Redo2, Save, Undo2, Upload } from "lucide-react";
import { Dialog } from "../../components/shared/Dialog";
import { cn } from "../../lib/cn";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { API_BASE, useDatasets, useQueryApi } from "../../lib/hooks/useDatasets";
import { readError } from "../../lib/http";
import { combine, commitJob, deleteDataset, waitForJob } from "../../lib/api/ingest";
import { formatCount, plural } from "../../lib/format";
import { OPS, defaultParams, fetchOpsFromApi, toApiStep, type Table, type TransformParams } from "../../lib/transforms/transforms";
import { AppliedSteps } from "./AppliedSteps";
import { DataGrid, type QuickAction } from "./DataGrid";
import { DatasetsPane } from "./DatasetsPane";
import { Ribbon, type Command } from "./Ribbon";
import { AppendDialog, MergeDialog, StepDialog } from "./StepDialogs";
import { StepPalette } from "./StepPalette";
import { readLaunch } from "./launch";
import { usePipeline, type StepEntry } from "./usePipeline";

const PREVIEW_ROWS = 200;

interface StagedPreview {
  columns: string[];
  dataset_schema: Record<string, string>;
  sample_rows: unknown[][];
  diff: {
    has_diff: boolean;
    added_columns: string[];
    missing_columns: string[];
    suggested_mappings: { column: string; suggested_target: string }[];
  } | null;
}

interface DialogState {
  op: string;
  params: TransformParams;
  index: number | null; // null = add at the end
}

let stepSeq = 0;
const newStep = (op: string, params: TransformParams): StepEntry => ({ id: `s${++stepSeq}`, op, params });
const withColumn = (params: TransformParams, col: string): TransformParams =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === "$col" ? col : v]));

export function DataTransformPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const launch = useMemo(() => readLaunch(location.state), [location.state]);
  const importMode = launch?.mode === "import";

  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading: datasetsLoading, authHeaders } = useDatasets();
  const { preview } = useQueryApi();

  // Merge the server's op catalog (labels, option_labels, server-only ops) into OPS.
  const [, setOpsVersion] = useState(0);
  useEffect(() => { fetchOpsFromApi(authHeaders).then(() => setOpsVersion((v) => v + 1)); }, [authHeaders]);

  // ── Dataset / source ───────────────────────────────────────────────────────
  const [datasetId, setDatasetId] = useState(launch?.datasetId ?? "");
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  useEffect(() => {
    if (!importMode && !datasetId && datasets.length) setDatasetId(datasets[0].id);
  }, [importMode, datasetId, datasets]);

  const [src, setSrc] = useState<Table | null>(null);
  const [staged, setStaged] = useState<StagedPreview | null>(null);
  const [srcLoading, setSrcLoading] = useState(false);
  const [srcError, setSrcError] = useState("");

  useEffect(() => {
    if (!importMode && !datasetId) return;
    let cancelled = false;
    setSrcLoading(true);
    setSrcError("");
    const load = async (): Promise<Table> => {
      if (launch?.mode === "import") {
        const res = await fetch(`${API_BASE}/data-ingest/jobs/${launch.jobId}/staged-preview?limit=${PREVIEW_ROWS}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(await readError(res, "Couldn't load the staged data"));
        const p: StagedPreview = await res.json();
        if (!cancelled) setStaged(p);
        return { columns: p.columns.map((name) => ({ name, type: p.dataset_schema[name] ?? "string" })), rows: p.sample_rows };
      }
      const p = await preview(datasetId, PREVIEW_ROWS);
      return { columns: p.columns.map((name) => ({ name, type: p.dataset_schema[name] ?? "string" })), rows: p.rows };
    };
    load()
      .then((t) => { if (!cancelled) setSrc(t); })
      .catch((e) => { if (!cancelled) { setSrc(null); setSrcError(e.message); } })
      .finally(() => { if (!cancelled) setSrcLoading(false); });
    return () => { cancelled = true; };
  }, [importMode, launch, datasetId, preview, authHeaders]);

  // ── Steps + history ────────────────────────────────────────────────────────
  const [steps, setSteps] = useState<StepEntry[]>([]);
  const [past, setPast] = useState<StepEntry[][]>([]);
  const [future, setFuture] = useState<StepEntry[][]>([]);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = latest
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false); // small screens
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [datasetsCollapsed, setDatasetsCollapsed] = useState(false);

  // A preset (from "Join" in Data sources) opens its dialog so the keys can be checked.
  const presetOpened = useRef(false);
  useEffect(() => {
    if (presetOpened.current || launch?.mode !== "shape" || !launch.presetSteps?.length) return;
    presetOpened.current = true;
    const preset = launch.presetSteps;
    setSteps(preset.slice(0, -1).map((s) => newStep(s.op, s.params)));
    setDialog({ op: preset[preset.length - 1].op, params: preset[preset.length - 1].params, index: null });
  }, [launch]);

  const commitSteps = useCallback((next: StepEntry[]) => {
    setPast((p) => [...p, steps]);
    setFuture([]);
    setSteps(next);
    setViewIndex(null);
  }, [steps]);

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [steps, ...f]);
    setSteps(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setViewIndex(null);
  }, [past, steps]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, steps]);
    setSteps(future[0]);
    setFuture((f) => f.slice(1));
    setViewIndex(null);
  }, [future, steps]);

  const { snapshots, evaluating } = usePipeline(src, steps, authHeaders);
  const tableAt = (i: number): Table | null => (i < 0 ? src : snapshots[i]?.table ?? null);
  const latestIndex = steps.length - 1;
  const shownIndex = viewIndex ?? latestIndex;
  const viewTable = tableAt(shownIndex) ?? (snapshots.length < steps.length ? tableAt(snapshots.length - 1) : null);
  const latestTable = tableAt(latestIndex);

  // Keep the selected column valid for the table on screen.
  useEffect(() => {
    if (selectedColumn && viewTable && !viewTable.columns.some((c) => c.name === selectedColumn)) setSelectedColumn(null);
  }, [viewTable, selectedColumn]);

  // ── Opening steps ──────────────────────────────────────────────────────────
  function openDialog(op: string, column: string | null, index: number | null = null, params?: TransformParams) {
    const input = tableAt((index ?? steps.length) - 1) ?? src;
    setDialog({ op, params: params ?? defaultParams(op, input?.columns.map((c) => c.name) ?? [], column), index });
    setPaletteOpen(false);
  }

  function addStep(op: string, params: TransformParams) {
    commitSteps([...steps, newStep(op, params)]);
  }

  function onCommand(cmd: Command) {
    if (cmd.instant && (!cmd.needsColumn || selectedColumn)) {
      addStep(cmd.op, withColumn(cmd.instant, selectedColumn ?? ""));
      return;
    }
    openDialog(cmd.op, selectedColumn);
  }

  function onQuickAction(column: string, action: QuickAction) {
    setSelectedColumn(column);
    if (action.instant && action.params) addStep(action.op, action.params);
    else openDialog(action.op, column);
  }

  function submitDialog(params: TransformParams) {
    if (!dialog) return;
    const entry = dialog.index === null ? newStep(dialog.op, params) : { ...steps[dialog.index], params };
    commitSteps(dialog.index === null ? [...steps, entry] : steps.map((s, i) => (i === dialog.index ? entry : s)));
    setDialog(null);
  }

  // ── Shape mode: switching dataset resets the pipeline ──────────────────────
  function requestSwitch(id: string) {
    if (id === datasetId) return;
    if (steps.length) setPendingSwitch(id);
    else doSwitch(id);
  }
  function doSwitch(id: string) {
    setDatasetId(id);
    setSteps([]); setPast([]); setFuture([]); setViewIndex(null); setPendingSwitch(null); setSelectedColumn(null);
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const saved = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const datasetName = (id: string) => datasets.find((d) => d.id === id)?.name ?? "dataset";
  const currentName = launch?.mode === "import" ? launch.datasetName : datasetName(datasetId);
  const apiSteps = () => steps.map((s) => toApiStep(s.op, s.params));

  async function runSave(start: () => Promise<{ id: string }>, done: string) {
    setSaveError("");
    setSaving("Starting…");
    abort.current = new AbortController();
    try {
      const job = await start();
      setSaving("Processing the full dataset…");
      await waitForJob(authHeaders, job.id, abort.current.signal);
      saved.current = true;
      navigate("/app/data-import", { state: { notice: done } });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setSaveError((e as Error).message);
      setSaving(null);
    }
  }

  function saveImport() {
    if (launch?.mode !== "import") return;
    runSave(() => commitJob(authHeaders, launch.jobId, apiSteps()), `Imported ${launch.datasetName}.`);
  }

  /** Leave an import without saving. A brand-new dataset (no versions yet) is removed so it
   *  doesn't linger in the library; a new version of an existing dataset just isn't saved. */
  async function discardImport() {
    if (launch?.mode !== "import" || !activeWorkspace) return;
    const isNewDataset = !datasets.some((d) => d.id === launch.datasetId); // `datasets` lists only imported ones
    setSaving("Discarding…");
    try {
      if (isNewDataset) await deleteDataset(authHeaders, activeWorkspace.id, launch.datasetId);
      saved.current = true;
      navigate("/app/data-import", { state: { notice: `Discarded the import of ${launch.datasetName}.` } });
    } catch (e) {
      setSaveError((e as Error).message);
      setSaving(null);
    }
  }

  useEffect(() => {
    if (!steps.length) return;
    const h = (e: BeforeUnloadEvent) => { if (!saved.current) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [steps.length]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable=true]");
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      if (typing || document.querySelector("[role=dialog]")) return;
      if (e.key === "/") { e.preventDefault(); setPaletteOpen(true); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
      else if (e.key === "Escape") setSelectedColumn(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const previousColumns = shownIndex >= 0 ? tableAt(shownIndex - 1)?.columns.map((c) => c.name) : undefined;
  const errorCount = snapshots.filter((s) => s.error).length;
  const otherDatasets = datasets.filter((d) => d.id !== (launch?.mode === "import" ? launch.datasetId : datasetId));
  const shownStep = shownIndex >= 0 ? steps[shownIndex] : null;
  const formula = shownStep
    ? OPS[shownStep.op]?.code(shownStep.params) ?? shownStep.op
    : importMode ? `staged_upload("${currentName}")` : `dataset("${currentName}")  # latest version`;
  const busy = !!saving;

  const diff = staged?.diff?.has_diff ? staged.diff : null;
  const pendingMappings = (diff?.suggested_mappings ?? []).filter(
    (m) => !steps.some((s) => s.op === "rename" && s.params.column === m.suggested_target && s.params.to === m.column),
  );

  if (!importMode && !datasetsLoading && datasets.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-1 flex-col items-center justify-center px-6 text-center">
        <Database size={22} className="mb-3 text-text-tertiary" />
        <h1 className="text-lg font-semibold">Nothing to shape yet</h1>
        <p className="mt-1 text-[13px] text-text-secondary">Pipeline Studio works on datasets in this workspace. Import a file or a database table first.</p>
        <Link to="/app/data-import" className="btn btn-primary mt-4"><Upload size={14} /> Add data</Link>
      </div>
    );
  }

  const appliedSteps = (
    <AppliedSteps
      sourceName={currentName}
      src={src}
      steps={steps}
      snapshots={snapshots}
      viewIndex={shownIndex}
      datasetName={datasetName}
      onView={(i) => { setViewIndex(i === latestIndex ? null : i); setStepsOpen(false); }}
      onEdit={(i) => { setStepsOpen(false); openDialog(steps[i].op, null, i, { ...steps[i].params }); }}
      onRemove={(i) => commitSteps(steps.filter((_, j) => j !== i))}
      onAdd={() => setPaletteOpen(true)}
    />
  );

  const dialogInput = dialog ? tableAt((dialog.index ?? steps.length) - 1) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {/* Title bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        {importMode && <Link to="/app/data-import" className="btn-icon" aria-label="Back to Data sources"><ArrowLeft size={16} /></Link>}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="shrink-0 text-[15px] font-semibold">Pipeline Studio</h1>
          <span className="truncate text-[13px] text-text-secondary">
            {importMode ? <>Reviewing import · <span className="font-medium text-text">{currentName}</span></> : currentName}
          </span>
        </div>
        <button className="btn btn-ghost btn-sm lg:hidden" onClick={() => setStepsOpen(true)}><ListOrdered size={14} /> Steps · {steps.length}</button>
        <button className="btn-icon" onClick={undo} disabled={!past.length || busy} aria-label="Undo" title="Undo (Ctrl Z)"><Undo2 size={15} /></button>
        <button className="btn-icon" onClick={redo} disabled={!future.length || busy} aria-label="Redo" title="Redo (Ctrl Shift Z)"><Redo2 size={15} /></button>
        <span className="mx-1 h-5 w-px bg-border" />
        {importMode ? (
          <>
            <button className="btn btn-ghost" onClick={discardImport} disabled={busy || datasetsLoading}>Discard import</button>
            <button className="btn btn-primary" onClick={saveImport} disabled={!src || busy || evaluating}>
              {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} Import dataset
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setSaveOpen(true)} disabled={!src || !steps.length || busy}>
            <Save size={14} /> Save
          </button>
        )}
      </header>

      <Ribbon selectedColumn={selectedColumn} disabled={!src || busy} onCommand={onCommand} onSearch={() => setPaletteOpen(true)} />

      {(saving || saveError) && (
        <div role={saveError ? "alert" : "status"} className={cn("flex items-center gap-2 border-b px-3 py-1.5 text-[13px]", saveError ? "border-danger/30 bg-danger-muted text-danger" : "border-primary/20 bg-primary-muted text-primary")}>
          {saving && <LoaderCircle size={13} className="animate-spin" />}
          {saving ?? saveError}
          {saveError && <button className="ml-auto text-xs underline" onClick={() => setSaveError("")}>Dismiss</button>}
        </div>
      )}

      {importMode && diff && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning/30 bg-warning-muted px-3 py-1.5 text-[13px]">
          <span className="font-medium text-warning">Columns differ from the current version.</span>
          {diff.added_columns.length > 0 && <span className="font-mono text-xs text-text-secondary">new: {diff.added_columns.join(", ")}</span>}
          {diff.missing_columns.length > 0 && <span className="font-mono text-xs text-text-secondary">missing: {diff.missing_columns.join(", ")}</span>}
          {pendingMappings.map((m) => (
            <button key={m.suggested_target} className="btn btn-secondary btn-sm" onClick={() => addStep("rename", { column: m.suggested_target, to: m.column })}>
              Rename {m.suggested_target} → {m.column}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:block">
          <DatasetsPane
            datasets={datasets}
            currentId={datasetId}
            importName={importMode ? currentName : undefined}
            collapsed={datasetsCollapsed}
            onToggle={() => setDatasetsCollapsed((c) => !c)}
            onOpen={requestSwitch}
            onMerge={(id) => openDialog("join", null, null, { dataset_id: id, left_on: "", right_on: "", how: "left" })}
            onAppend={(id) => openDialog("append", null, null, { dataset_id: id })}
            disabled={busy || !src}
          />
        </div>

        <section className="flex min-w-0 flex-1 flex-col" aria-label="Data preview">
          {/* Formula bar */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="font-mono text-xs italic text-text-tertiary">fx</span>
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-secondary" title={formula}>{formula}</code>
            {viewIndex !== null && viewIndex < latestIndex && (
              <button className="shrink-0 text-xs text-primary hover:underline" onClick={() => setViewIndex(null)}>
                Viewing step {viewIndex + 2} of {steps.length + 1} · show latest
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {srcLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-tertiary"><LoaderCircle size={15} className="animate-spin" /> Loading preview…</div>
            ) : srcError ? (
              <div className="mx-auto max-w-md p-10 text-center">
                <p className="font-medium">Couldn't load the data</p>
                <p className="mt-1 text-[13px] text-text-secondary">{srcError}</p>
              </div>
            ) : viewTable ? (
              viewTable.rows.length === 0 ? (
                <div className="p-10 text-center text-[13px] text-text-secondary">No rows left at this step. Check the filters in Applied steps.</div>
              ) : (
                <DataGrid
                  table={viewTable}
                  previousColumns={previousColumns}
                  selectedColumn={selectedColumn}
                  onSelectColumn={setSelectedColumn}
                  onAction={onQuickAction}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-tertiary"><LoaderCircle size={15} className="animate-spin" /> Applying steps…</div>
            )}
          </div>

          <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface-2 px-3 text-[11.5px] text-text-tertiary">
            {viewTable && (
              <span className="tabular">{formatCount(viewTable.rows.length)} rows · {viewTable.columns.length} columns{viewTable.rows.length > 100 && " · showing first 100"}</span>
            )}
            <span className="hidden sm:inline">Column profile based on the first {PREVIEW_ROWS} rows. Saving runs every step on the full dataset.</span>
            <span className={cn("ml-auto flex items-center gap-1.5", errorCount > 0 && "text-danger")}>
              {evaluating ? <LoaderCircle size={11} className="animate-spin" /> : <span className={cn("size-1.5 rounded-full", errorCount ? "bg-danger" : "bg-success")} />}
              {evaluating ? "Updating preview" : errorCount ? `${plural(errorCount, "step")} need attention` : latestTable ? "Ready" : ""}
            </span>
          </footer>
        </section>

        <aside className="hidden w-64 shrink-0 border-l border-border lg:block">{appliedSteps}</aside>
      </div>

      <StepPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={(op) => openDialog(op, selectedColumn)} />

      <Dialog open={stepsOpen} onClose={() => setStepsOpen(false)} variant="side" title="Applied steps">
        <div className="-mx-5 -my-4">{appliedSteps}</div>
      </Dialog>

      {dialog && dialogInput && (
        dialog.op === "join" ? (
          <MergeDialog initial={dialog.params} input={dialogInput} editing={dialog.index !== null} datasets={otherDatasets} authHeaders={authHeaders} onClose={() => setDialog(null)} onSubmit={submitDialog} />
        ) : dialog.op === "append" ? (
          <AppendDialog initial={dialog.params} input={dialogInput} editing={dialog.index !== null} datasets={otherDatasets} authHeaders={authHeaders} onClose={() => setDialog(null)} onSubmit={submitDialog} />
        ) : (
          <StepDialog op={dialog.op} initial={dialog.params} input={dialogInput} editing={dialog.index !== null} authHeaders={authHeaders} onClose={() => setDialog(null)} onSubmit={submitDialog} />
        )
      )}

      <Dialog
        open={!!pendingSwitch}
        size="sm"
        onClose={() => setPendingSwitch(null)}
        title="Switch dataset?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPendingSwitch(null)}>Keep working</button>
            <button className="btn btn-danger" onClick={() => pendingSwitch && doSwitch(pendingSwitch)}>Discard steps and switch</button>
          </>
        }
      >
        <p className="text-[13px] text-text-secondary">Your {plural(steps.length, "step")} on {currentName} haven't been saved and will be discarded.</p>
      </Dialog>

      {saveOpen && activeWorkspace && (
        <SaveDialog
          datasetName={currentName}
          stepCount={steps.length}
          busy={busy}
          onClose={() => setSaveOpen(false)}
          onSave={(target) => {
            setSaveOpen(false);
            runSave(
              () => combine(authHeaders, {
                workspaceId: activeWorkspace.id,
                primaryDatasetId: datasetId,
                transforms: apiSteps(),
                ...(target.kind === "new" ? { newDatasetName: target.name } : { targetDatasetId: datasetId }),
              }),
              target.kind === "new" ? `Saved ${target.name}.` : `Saved a new version of ${currentName}.`,
            );
          }}
        />
      )}
    </div>
  );
}

function SaveDialog({ datasetName, stepCount, busy, onClose, onSave }: {
  datasetName: string;
  stepCount: number;
  busy: boolean;
  onClose: () => void;
  onSave: (target: { kind: "version" } | { kind: "new"; name: string }) => void;
}) {
  const [kind, setKind] = useState<"version" | "new">("version");
  const [name, setName] = useState(`${datasetName}_shaped`);
  const valid = kind === "version" || name.trim().length > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title="Save"
      description={`Runs ${plural(stepCount, "step")} on the full ${datasetName} dataset in the background.`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => onSave(kind === "new" ? { kind, name: name.trim() } : { kind })}>Save</button>
        </>
      }
    >
      <fieldset className="space-y-1">
        <legend className="field-label">Save as</legend>
        {([
          ["version", `New version of ${datasetName}`, "Earlier versions stay available."],
          ["new", "New dataset", "Leaves the original untouched."],
        ] as const).map(([k, title, body]) => (
          <label key={k} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2">
            <input type="radio" className="mt-0.5 accent-primary" checked={kind === k} onChange={() => setKind(k)} />
            <span>
              <span className="block text-[13px] font-medium">{title}</span>
              <span className="block text-xs text-text-secondary">{body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {kind === "new" && (
        <label className="mt-3 block">
          <span className="field-label">Dataset name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
    </Dialog>
  );
}
