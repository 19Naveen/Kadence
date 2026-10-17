import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Database, ListOrdered, LoaderCircle, Plus, Redo2, Save, Undo2, Upload } from "lucide-react";
import { Dialog } from "../../components/shared/Dialog";
import { cn } from "../../lib/cn";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { API_BASE, useDatasets, useQueryApi } from "../../lib/hooks/useDatasets";
import { readError } from "../../lib/http";
import { combine, commitJob, deleteDataset, waitForJob } from "../../lib/api/ingest";
import { formatCount, plural } from "../../lib/format";
import {
  SERVER_ONLY_OPS, defaultParams, fetchOpsFromApi, toApiStep, type Table, type TransformParams,
} from "../../lib/transforms/transforms";
import { DataGrid, type QuickAction } from "./DataGrid";
import { PipelineRail } from "./PipelineRail";
import { StepEditor } from "./StepEditor";
import { StepPalette } from "./StepPalette";
import { readLaunch } from "./launch";
import { runStep, usePipeline, type Snapshot, type StepEntry } from "./usePipeline";

const PREVIEW_ROWS = 200;

interface StagedPreview {
  columns: string[];
  dataset_schema: Record<string, string>;
  sample_rows: unknown[][];
  previous_schema: Record<string, string> | null;
  diff: {
    has_diff: boolean;
    added_columns: string[];
    missing_columns: string[];
    suggested_mappings: { column: string; suggested_target: string }[];
  } | null;
}

interface EditorState {
  op: string;
  params: TransformParams;
  index: number | null; // null = adding a new step at the end
}

let stepSeq = 0;
const newStep = (op: string, params: TransformParams): StepEntry => ({ id: `s${++stepSeq}`, op, params });

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
    if (importMode ? !launch?.mode : !datasetId) return;
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
  const [steps, setSteps] = useState<StepEntry[]>(() =>
    launch?.mode === "shape" ? (launch.presetSteps ?? []).map((s) => newStep(s.op, s.params)) : [],
  );
  const [past, setPast] = useState<StepEntry[][]>([]);
  const [future, setFuture] = useState<StepEntry[][]>([]);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = latest
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  // A preset join (from "Join these two") opens in the editor so the keys can be checked.
  const presetOpened = useRef(false);
  useEffect(() => {
    if (presetOpened.current || launch?.mode !== "shape" || !launch.presetSteps?.length) return;
    presetOpened.current = true;
    const last = launch.presetSteps.length - 1;
    setSteps((prev) => prev.slice(0, last));
    setEditor({ op: launch.presetSteps[last].op, params: launch.presetSteps[last].params, index: null });
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
    setEditor(null);
    setViewIndex(null);
  }, [past, steps]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, steps]);
    setSteps(future[0]);
    setFuture((f) => f.slice(1));
    setEditor(null);
    setViewIndex(null);
  }, [future, steps]);

  const { snapshots, evaluating } = usePipeline(src, steps, authHeaders);
  const tableAt = (i: number): Table | null => (i < 0 ? src : snapshots[i]?.table ?? null);
  const latestIndex = steps.length - 1;
  const shownIndex = viewIndex ?? latestIndex;

  // ── Editor draft preview ───────────────────────────────────────────────────
  const editorInput: Table | null = editor ? tableAt((editor.index ?? steps.length) - 1) : null;
  const [draft, setDraft] = useState<Snapshot | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);

  useEffect(() => {
    if (!editor || !editorInput) { setDraft(null); return; }
    const p = editor.params;
    const server = SERVER_ONLY_OPS.has(editor.op);
    const ready = !server || (p.dataset_id && (editor.op !== "join" || (p.left_on && p.right_on)));
    if (!ready) { setDraft(null); setDraftLoading(false); return; }
    let cancelled = false;
    if (server) setDraftLoading(true);
    const t = setTimeout(async () => {
      const snap = await runStep(editorInput, editor, authHeaders);
      if (!cancelled) { setDraft(snap); setDraftLoading(false); }
    }, server ? 450 : 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.op, JSON.stringify(editor?.params), editor?.index, editorInput, authHeaders]);

  function openEditor(op: string, column: string | null, index: number | null = null) {
    const input = tableAt((index ?? steps.length) - 1) ?? src;
    setEditor({ op, params: defaultParams(op, input?.columns.map((c) => c.name) ?? [], column), index });
    setPaletteOpen(false);
    setRailOpen(false);
  }

  function submitEditor() {
    if (!editor) return;
    const entry = editor.index === null ? newStep(editor.op, editor.params) : { ...steps[editor.index], op: editor.op, params: editor.params };
    commitSteps(editor.index === null ? [...steps, entry] : steps.map((s, i) => (i === editor.index ? entry : s)));
    setEditor(null);
  }

  function onQuickAction(column: string, action: QuickAction) {
    if (action.instant && action.params) {
      commitSteps([...steps, newStep(action.op, action.params)]);
      setEditor(null);
    } else {
      openEditor(action.op, column);
    }
  }

  // ── Shape mode: switching dataset resets the pipeline ──────────────────────
  function requestSwitch(id: string) {
    if (id === datasetId) return;
    if (steps.length) setPendingSwitch(id);
    else doSwitch(id);
  }
  function doSwitch(id: string) {
    setDatasetId(id);
    setSteps([]); setPast([]); setFuture([]); setEditor(null); setViewIndex(null); setPendingSwitch(null);
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // progress text
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

  // Warn before closing the tab with unsaved steps.
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
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── Derived view ───────────────────────────────────────────────────────────
  const showingDraft = !!(editor && draft && !draft.error);
  const viewTable: Table | null = showingDraft ? draft!.table : tableAt(shownIndex) ?? (snapshots.length < steps.length ? tableAt(snapshots.length - 1) : null);
  const previousColumns = showingDraft
    ? editorInput?.columns.map((c) => c.name)
    : shownIndex >= 0 ? tableAt(shownIndex - 1)?.columns.map((c) => c.name) : undefined;
  const errorCount = snapshots.filter((s) => s.error).length;
  const joinCandidates = datasets.filter((d) => d.id !== (launch?.mode === "import" ? launch.datasetId : datasetId));

  const diff = staged?.diff?.has_diff ? staged.diff : null;
  const pendingMappings = (diff?.suggested_mappings ?? []).filter(
    (m) => !steps.some((s) => s.op === "rename" && s.params.column === m.suggested_target && s.params.to === m.column),
  );

  // ── Empty: nothing to shape yet ────────────────────────────────────────────
  if (!importMode && !datasetsLoading && datasets.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary-muted text-primary"><Database size={22} /></span>
        <h1 className="text-[22px] font-semibold">Nothing to shape yet</h1>
        <p className="mt-1.5 text-sm text-text-secondary">Pipeline Studio works on datasets in this workspace. Import a file or a database table first.</p>
        <Link to="/app/data-import" className="btn btn-primary mt-5"><Upload size={15} /> Go to Data sources</Link>
      </div>
    );
  }

  const rail = (
    <PipelineRail
      sourceLabel={importMode ? "Staged import" : currentName}
      src={src}
      steps={steps}
      snapshots={snapshots}
      viewIndex={showingDraft ? -99 : shownIndex}
      editingIndex={editor?.index ?? null}
      datasetName={datasetName}
      onView={(i) => { setEditor(null); setViewIndex(i === latestIndex ? null : i); setRailOpen(false); }}
      onEdit={(i) => { setEditor({ op: steps[i].op, params: { ...steps[i].params }, index: i }); setRailOpen(false); }}
      onRemove={(i) => { commitSteps(steps.filter((_, j) => j !== i)); if (editor?.index === i) setEditor(null); }}
      onAdd={() => setPaletteOpen(true)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-surface px-4 py-3 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {importMode && (
            <Link to="/app/data-import" className="btn-icon" aria-label="Back to Data sources"><ArrowLeft size={17} /></Link>
          )}
          <div className="min-w-0">
            <p className="section-label">{importMode ? "Review import" : "Shape"}</p>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="shrink-0 text-lg font-semibold">Pipeline Studio</h1>
              <span className="text-text-tertiary">/</span>
              {importMode ? (
                <span className="truncate text-sm font-semibold">{currentName}</span>
              ) : (
                <label className="min-w-0">
                  <span className="sr-only">Dataset</span>
                  <select
                    className="h-8 max-w-[260px] truncate rounded-lg border border-border bg-surface px-2 text-sm font-semibold"
                    value={datasetId}
                    onChange={(e) => requestSwitch(e.target.value)}
                    disabled={datasetsLoading || !!saving}
                  >
                    {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button className="btn btn-secondary btn-sm md:hidden" onClick={() => setRailOpen(true)}>
            <ListOrdered size={14} /> Steps · {steps.length}
          </button>
          <button className="btn-icon" onClick={undo} disabled={!past.length || !!saving} aria-label="Undo" title="Undo (⌘Z)"><Undo2 size={16} /></button>
          <button className="btn-icon" onClick={redo} disabled={!future.length || !!saving} aria-label="Redo" title="Redo (⇧⌘Z)"><Redo2 size={16} /></button>
          <button className="btn btn-secondary btn-sm ml-1 hidden sm:inline-flex" onClick={() => setPaletteOpen(true)} disabled={!src || !!saving}>
            <Plus size={14} /> Add step
          </button>
          {importMode && (
            <button className="btn btn-ghost ml-1" onClick={discardImport} disabled={!!saving || datasetsLoading}>Discard import</button>
          )}
          {importMode ? (
            <button className="btn btn-primary ml-1" onClick={saveImport} disabled={!src || !!saving || !!editor || evaluating}>
              {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />} Import dataset
            </button>
          ) : (
            <button className="btn btn-primary ml-1" onClick={() => setSaveOpen(true)} disabled={!src || !steps.length || !!saving || !!editor}>
              <Save size={15} /> Save
            </button>
          )}
        </div>
      </header>

      {(saving || saveError) && (
        <div role={saveError ? "alert" : "status"} className={cn("flex items-center gap-2 border-b px-4 py-2 text-sm lg:px-6", saveError ? "border-danger/30 bg-danger-muted text-danger" : "border-primary/20 bg-primary-muted text-primary")}>
          {saving && <LoaderCircle size={14} className="animate-spin" />}
          {saving ?? saveError}
          {saveError && <button className="ml-auto text-xs font-semibold underline" onClick={() => setSaveError("")}>Dismiss</button>}
        </div>
      )}

      {importMode && diff && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/30 bg-warning-muted px-4 py-2.5 text-sm lg:px-6">
          <span className="font-semibold text-warning">Columns differ from the current version.</span>
          {diff.added_columns.length > 0 && <span className="font-mono text-xs text-text-secondary">new: {diff.added_columns.join(", ")}</span>}
          {diff.missing_columns.length > 0 && <span className="font-mono text-xs text-text-secondary">missing: {diff.missing_columns.join(", ")}</span>}
          {pendingMappings.map((m) => (
            <button
              key={m.suggested_target}
              className="btn btn-secondary btn-sm"
              onClick={() => commitSteps([...steps, newStep("rename", { column: m.suggested_target, to: m.column })])}
            >
              Rename {m.suggested_target} → {m.column}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[290px] shrink-0 border-r border-border bg-surface md:block">{rail}</aside>

        <section className="flex min-w-0 flex-1 flex-col bg-surface" aria-label="Data preview">
          {!editor && viewIndex !== null && viewIndex < latestIndex && (
            <div className="flex items-center gap-3 border-b border-signal/30 bg-signal-muted px-4 py-2 text-[13px]">
              <span>Showing the data {viewIndex < 0 ? "before any steps" : `after step ${viewIndex + 1}`}. Later steps aren't applied in this view.</span>
              <button className="font-semibold text-signal underline" onClick={() => setViewIndex(null)}>Show latest</button>
            </div>
          )}
          {editor && (
            <div className="border-b border-primary/20 bg-primary-muted px-4 py-2 text-[13px] text-primary">
              {draftLoading ? "Previewing…" : draft?.error ? "Fix the step settings to see a preview." : "Previewing this step — it's not added until you confirm."}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {srcLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-text-tertiary"><LoaderCircle size={16} className="animate-spin" /> Loading preview…</div>
            ) : srcError ? (
              <div className="mx-auto max-w-md p-10 text-center">
                <p className="font-semibold">Couldn't load the data</p>
                <p className="mt-1 text-sm text-text-secondary">{srcError}</p>
              </div>
            ) : viewTable ? (
              viewTable.rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-text-secondary">No rows left at this point in the pipeline. Check the filters in the steps above.</div>
              ) : (
                <DataGrid table={viewTable} previousColumns={previousColumns} onAction={onQuickAction} />
              )
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-text-tertiary"><LoaderCircle size={16} className="animate-spin" /> Applying steps…</div>
            )}
          </div>

          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-text-tertiary">
            {viewTable && (
              <span className="tabular">
                {viewTable.rows.length > 100 ? `First 100 of ${formatCount(viewTable.rows.length)} preview rows` : plural(viewTable.rows.length, "row")} · {plural(viewTable.columns.length, "column")}
              </span>
            )}
            <span>The preview uses the first {PREVIEW_ROWS} rows. Saving runs every step on the full dataset.</span>
            <span className={cn("ml-auto flex items-center gap-1.5", errorCount ? "text-danger" : "")}>
              {evaluating ? <LoaderCircle size={12} className="animate-spin" /> : <span className={cn("size-1.5 rounded-full", errorCount ? "bg-danger" : "bg-success")} />}
              {evaluating ? "Updating preview" : errorCount ? `${plural(errorCount, "step")} need attention` : "All steps OK"}
            </span>
          </footer>
        </section>

        {editor && editorInput && (
          <aside className="fixed inset-0 z-50 bg-surface md:static md:z-auto md:w-[360px] md:shrink-0 md:border-l md:border-border">
            <StepEditor
              op={editor.op}
              params={editor.params}
              onChange={(params) => setEditor((e) => (e ? { ...e, params } : e))}
              input={editorInput}
              draft={draft}
              draftLoading={draftLoading}
              datasets={joinCandidates}
              editing={editor.index !== null}
              onSubmit={submitEditor}
              onCancel={() => setEditor(null)}
            />
          </aside>
        )}
      </div>

      <StepPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={(op) => openEditor(op, null)} />

      <Dialog open={railOpen} onClose={() => setRailOpen(false)} variant="side" title="Pipeline steps">
        <div className="-mx-6 -my-5">{rail}</div>
      </Dialog>

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
        <p className="text-sm text-text-secondary">Your {plural(steps.length, "step")} on {currentName} haven't been saved and will be discarded.</p>
      </Dialog>

      {saveOpen && activeWorkspace && (
        <SaveDialog
          datasetName={currentName}
          stepCount={steps.length}
          busy={!!saving}
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
      title="Save your pipeline"
      description={`Runs ${plural(stepCount, "step")} on the full ${datasetName} dataset in the background.`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => onSave(kind === "new" ? { kind, name: name.trim() } : { kind })}>
            <Save size={15} /> Save
          </button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Save as</legend>
        {([
          ["version", `A new version of ${datasetName}`, "Earlier versions stay available."],
          ["new", "A new dataset", "Leaves the original untouched."],
        ] as const).map(([k, title, body]) => (
          <label key={k} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5", kind === k ? "border-primary bg-primary-muted/50" : "border-border hover:bg-surface-2")}>
            <input type="radio" className="mt-1 accent-primary" checked={kind === k} onChange={() => setKind(k)} />
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-xs text-text-secondary">{body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {kind === "new" && (
        <label className="mt-4 block">
          <span className="field-label">Dataset name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
    </Dialog>
  );
}
