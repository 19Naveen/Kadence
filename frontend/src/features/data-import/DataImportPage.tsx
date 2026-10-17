import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight, ChevronRight, Database, FileSpreadsheet, GitMerge, Layers, LoaderCircle, Plus, Search,
  Trash2, Upload, Workflow,
} from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { Dialog } from "../../components/shared/Dialog";
import { cn } from "../../lib/cn";
import { useDatasets, type DatasetSummary } from "../../lib/hooks/useDatasets";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import {
  commitJob, createDbJob, deleteDataset, fetchLineage, fileSourceType, isFileSource, latestSchema, listVersions,
  uploadFile, waitForJob, type DatasetVersion, type DbSourceType, type LineageNode,
} from "../../lib/api/ingest";
import { suggestJoinKeys } from "../../lib/transforms/joinKeys";
import { formatBytes, formatCount, formatDate, formatDateTime, plural } from "../../lib/format";
import type { StudioLaunch } from "../data-transform/launch";

const SOURCE_LABEL: Record<string, string> = {
  csv: "CSV file", xlsx: "Excel file", parquet: "Parquet file",
  postgres: "PostgreSQL", mysql: "MySQL", snowflake: "Snowflake", mssql: "SQL Server",
};

const DB_DEFAULT_PORT: Record<DbSourceType, string> = { postgres: "5432", mysql: "3306", snowflake: "443", mssql: "1433" };

type SourceFilter = "all" | "files" | "databases";

function SourceIcon({ type, className }: { type: string; className?: string }) {
  const Icon = isFileSource(type) ? FileSpreadsheet : Database;
  return <Icon size={16} strokeWidth={1.75} className={className} />;
}

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────

export function DataImportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading, refetch, authHeaders } = useDatasets({ includePending: true });

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [uploadTarget, setUploadTarget] = useState<DatasetSummary | null>(null);
  const [connectTarget, setConnectTarget] = useState<DatasetSummary | null | "new">(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DatasetSummary[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Confirmation passed back from Pipeline Studio after an import/save.
  useEffect(() => {
    const text = (location.state as { notice?: string } | null)?.notice;
    if (!text) return;
    setNotice({ tone: "info", text });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // Selection is per workspace; drop ids that no longer exist after a refetch.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => datasets.some((d) => d.id === id))));
  }, [datasets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return datasets.filter((d) => {
      if (filter === "files" && !isFileSource(d.source_type)) return false;
      if (filter === "databases" && isFileSource(d.source_type)) return false;
      return !q || d.name.toLowerCase().includes(q);
    });
  }, [datasets, filter, query]);

  const selectedList = datasets.filter((d) => selected.has(d.id));
  const detail = datasets.find((d) => d.id === detailId) ?? null;

  function pickFiles(target: DatasetSummary | null) {
    setUploadTarget(target);
    fileRef.current?.click();
  }

  function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    const bad = files.find((f) => !fileSourceType(f.name));
    if (bad) {
      setNotice({ tone: "error", text: `“${bad.name}” isn't a supported file. Use CSV, Excel (.xlsx) or Parquet.` });
      return;
    }
    setNotice(null);
    setPendingFiles(uploadTarget ? files.slice(0, 1) : files);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openStudio(launch: StudioLaunch) {
    navigate("/app/data-transform", { state: launch });
  }

  async function joinSelected() {
    // The bigger table is usually the one to keep (e.g. orders), the smaller one the lookup (e.g. customers).
    const [left, right] = [...selectedList].sort((a, b) => (b.latest_row_count ?? 0) - (a.latest_row_count ?? 0));
    if (!left || !right) return;
    setJoinBusy(true);
    try {
      const [ls, rs] = await Promise.all([latestSchema(authHeaders, left.id), latestSchema(authHeaders, right.id)]);
      const keys = suggestJoinKeys(Object.keys(ls), Object.keys(rs));
      openStudio({
        mode: "shape",
        datasetId: left.id,
        presetSteps: [{ op: "join", params: { dataset_id: right.id, left_on: keys?.left_on ?? "", right_on: keys?.right_on ?? "", how: "left" } }],
      });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    } finally {
      setJoinBusy(false);
    }
  }

  const fileCount = datasets.filter((d) => isFileSource(d.source_type)).length;

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); setUploadTarget(null); onFiles(e.dataTransfer.files); }}
      className="relative"
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept=".csv,.xlsx,.xls,.parquet"
        onChange={(e) => onFiles(e.target.files)}
      />

      <PageHeader
        eyebrow="Bring in"
        title="Data sources"
        subtitle="Upload files or connect a database. Every import is reviewed in Pipeline Studio and saved as a new version."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setConnectTarget("new")}>
              <Database size={15} /> Connect database
            </button>
            <button className="btn btn-primary" onClick={() => pickFiles(null)}>
              <Upload size={15} /> Upload files
            </button>
          </>
        }
      />

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mb-4 flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm",
            notice.tone === "error" ? "border-danger/30 bg-danger-muted text-danger" : "border-primary/20 bg-primary-muted text-primary",
          )}
        >
          <span>{notice.text}</span>
          <button className="text-xs font-semibold underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {!loading && datasets.length === 0 ? (
        <EmptyLibrary onUpload={() => pickFiles(null)} onConnect={() => setConnectTarget("new")} />
      ) : (
        <section className="card overflow-hidden p-0" aria-label="Datasets">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center">
            <label className="relative flex-1 md:max-w-xs">
              <span className="sr-only">Search datasets</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input className="input h-8 pl-8" placeholder="Search datasets" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="Filter by source">
              {([["all", `All · ${datasets.length}`], ["files", `Files · ${fileCount}`], ["databases", `Databases · ${datasets.length - fileCount}`]] as const).map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "h-8 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                    filter === key ? "bg-text text-surface" : "text-text-secondary hover:bg-surface-2",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {selectedList.length > 0 && (
              <div className="flex items-center gap-2 md:ml-auto">
                <span className="text-[13px] text-text-secondary">{selectedList.length} selected</span>
                {selectedList.length === 2 && (
                  <button className="btn btn-primary btn-sm" onClick={joinSelected} disabled={joinBusy}>
                    {joinBusy ? <LoaderCircle size={14} className="animate-spin" /> : <GitMerge size={14} />} Join these two
                  </button>
                )}
                {selectedList.length === 1 && (
                  <button className="btn btn-secondary btn-sm" onClick={() => openStudio({ mode: "shape", datasetId: selectedList[0].id })}>
                    <Workflow size={14} /> Open in Pipeline Studio
                  </button>
                )}
                <button className="btn btn-secondary btn-sm text-danger" onClick={() => setConfirmDelete(selectedList)}>
                  <Trash2 size={14} /> Delete
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-text-tertiary">
                  <th className="w-10 px-4 py-2.5"><span className="sr-only">Select</span></th>
                  <th className="px-2 py-2.5">Name</th>
                  <th className="px-3 py-2.5 text-right">Rows</th>
                  <th className="px-3 py-2.5 text-right">Versions</th>
                  <th className="hidden px-3 py-2.5 text-right md:table-cell">Size</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">Created</th>
                  <th className="px-4 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && datasets.length === 0
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-border-subtle">
                        <td colSpan={7} className="px-4 py-4"><div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" /></td>
                      </tr>
                    ))
                  : visible.map((ds) => (
                      <tr key={ds.id} className={cn("table-row", selected.has(ds.id) && "bg-primary-muted/50")}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary disabled:opacity-30"
                            checked={selected.has(ds.id)}
                            onChange={() => toggle(ds.id)}
                            disabled={ds.version_count === 0}
                            aria-label={`Select ${ds.name}`}
                          />
                        </td>
                        <td className="px-2 py-3">
                          <button onClick={() => setDetailId(ds.id)} className="group flex min-w-0 items-center gap-3 text-left">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
                              <SourceIcon type={ds.source_type} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold group-hover:text-primary group-hover:underline">{ds.name}</span>
                              <span className="block text-xs text-text-tertiary">
                                {SOURCE_LABEL[ds.source_type] ?? ds.source_type}
                                {ds.version_count === 0 && <span className="badge ml-2 bg-signal-muted text-signal">Not imported</span>}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="tabular px-3 py-3 text-right font-mono text-[13px]">{formatCount(ds.latest_row_count)}</td>
                        <td className="tabular px-3 py-3 text-right font-mono text-[13px]">{ds.version_count}</td>
                        <td className="tabular hidden px-3 py-3 text-right font-mono text-[13px] text-text-secondary md:table-cell">{formatBytes(ds.latest_file_size)}</td>
                        <td className="hidden px-3 py-3 text-text-secondary lg:table-cell">{formatDate(ds.created_at)}</td>
                        <td className="px-4 py-3">
                          {ds.version_count === 0 ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="hidden text-xs text-text-tertiary xl:inline">The review wasn't finished</span>
                              <button className="btn btn-ghost btn-sm text-danger" onClick={() => setConfirmDelete([ds])}>
                                <Trash2 size={14} /> Discard
                              </button>
                            </div>
                          ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              className="btn btn-ghost btn-sm"
                              title={isFileSource(ds.source_type) ? "Upload a file as a new version" : "Re-import from the database as a new version"}
                              onClick={() => (isFileSource(ds.source_type) ? pickFiles(ds) : setConnectTarget(ds))}
                            >
                              <Plus size={14} /> <span className="hidden xl:inline">New version</span>
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openStudio({ mode: "shape", datasetId: ds.id })}>
                              <Workflow size={14} /> <span className="hidden xl:inline">Shape</span>
                            </button>
                            <button className="btn-icon" aria-label={`Details for ${ds.name}`} onClick={() => setDetailId(ds.id)}>
                              <ChevronRight size={16} />
                            </button>
                          </div>
                          )}
                        </td>
                      </tr>
                    ))}
                {!loading && datasets.length > 0 && visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-text-secondary">
                      No datasets match “{query}”.{" "}
                      <button className="font-semibold text-primary underline" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2.5 text-xs text-text-tertiary">
            Tip: select two datasets to join them, or drop files anywhere on this page to upload.
          </p>
        </section>
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 p-8 lg:pl-(--sidebar-w)">
          <div className="rounded-2xl border-2 border-dashed border-primary bg-surface px-10 py-8 text-center shadow-soft-lg">
            <Upload className="mx-auto mb-2 text-primary" size={28} />
            <p className="font-semibold">Drop to upload</p>
            <p className="text-sm text-text-secondary">CSV, Excel or Parquet. Drop two files to join them.</p>
          </div>
        </div>
      )}

      {pendingFiles && activeWorkspace && (
        <UploadDialog
          files={pendingFiles}
          target={uploadTarget}
          datasets={datasets}
          workspaceId={activeWorkspace.id}
          authHeaders={authHeaders}
          onClose={() => { setPendingFiles(null); setUploadTarget(null); }}
          onReview={(launch) => openStudio(launch)}
          onImported={(msg) => { setPendingFiles(null); setUploadTarget(null); refetch(); setNotice({ tone: "info", text: msg }); }}
        />
      )}

      {connectTarget && activeWorkspace && (
        <ConnectDialog
          target={connectTarget === "new" ? null : connectTarget}
          workspaceId={activeWorkspace.id}
          authHeaders={authHeaders}
          onClose={() => setConnectTarget(null)}
          onReview={(launch) => openStudio(launch)}
        />
      )}

      {detail && (
        <DatasetDetail
          dataset={detail}
          authHeaders={authHeaders}
          onClose={() => setDetailId(null)}
          onShape={() => openStudio({ mode: "shape", datasetId: detail.id })}
          onDelete={() => setConfirmDelete([detail])}
        />
      )}

      {confirmDelete && activeWorkspace && (
        <DeleteDialog
          datasets={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            for (const d of confirmDelete) await deleteDataset(authHeaders, activeWorkspace.id, d.id);
            setConfirmDelete(null);
            setDetailId(null);
            setSelected(new Set());
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyLibrary({ onUpload, onConnect }: { onUpload: () => void; onConnect: () => void }) {
  return (
    <section className="card grid gap-6 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
      <div>
        <h2 className="text-lg font-semibold">Bring in your first dataset</h2>
        <p className="mt-1.5 max-w-md text-sm text-text-secondary">
          Upload a spreadsheet or connect a database table. You'll review the data and add any clean-up steps before it's saved.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={onUpload}><Upload size={15} /> Upload files</button>
          <button className="btn btn-secondary" onClick={onConnect}><Database size={15} /> Connect database</button>
        </div>
      </div>
      <ol className="space-y-3 border-t border-border pt-6 text-sm md:border-l md:border-t-0 md:pl-8 md:pt-0">
        {[
          ["Bring in", "Upload CSV, Excel or Parquet, or read a table from PostgreSQL, MySQL, Snowflake or SQL Server."],
          ["Review", "Preview the rows, fix types and names, filter, join other datasets."],
          ["Save", "The full dataset is processed in the background and stored as version 1."],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-muted font-mono text-xs font-semibold text-primary">{i + 1}</span>
            <span><span className="font-semibold">{title}.</span> <span className="text-text-secondary">{body}</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── Upload dialog ────────────────────────────────────────────────────────────

type FileProgress = "waiting" | "uploading" | "processing" | "done" | "error";

function UploadDialog({
  files, target, datasets, workspaceId, authHeaders, onClose, onReview, onImported,
}: {
  files: File[];
  target: DatasetSummary | null;
  datasets: DatasetSummary[];
  workspaceId: string;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onReview: (launch: StudioLaunch) => void;
  onImported: (message: string) => void;
}) {
  const single = files.length === 1;
  const fileDatasets = datasets.filter((d) => isFileSource(d.source_type) && d.version_count > 0);
  const [names, setNames] = useState(files.map((f) => stripExt(f.name)));
  const [destination, setDestination] = useState<"new" | "existing">(target ? "existing" : "new");
  const [existingId, setExistingId] = useState(target?.id ?? fileDatasets[0]?.id ?? "");
  const [joinAfter, setJoinAfter] = useState(files.length === 2);
  const [progress, setProgress] = useState<FileProgress[]>(files.map(() => "waiting"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const setStatus = (i: number, s: FileProgress) => setProgress((p) => p.map((v, j) => (j === i ? s : v)));

  async function reviewSingle() {
    setBusy(true);
    setError("");
    try {
      const toExisting = destination === "existing" && existingId;
      const ds = toExisting ? datasets.find((d) => d.id === existingId) : null;
      const job = await uploadFile(authHeaders, {
        workspaceId, file: files[0], datasetId: toExisting ? existingId : undefined,
        datasetName: ds?.name ?? (names[0].trim() || stripExt(files[0].name)),
      });
      onReview({ mode: "import", jobId: job.id, datasetId: job.dataset_id, datasetName: ds?.name ?? names[0] });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  /** Several files: import each as-is (no review), then optionally open the first two joined. */
  async function importAll() {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    const created: { id: string; name: string }[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setStatus(i, "uploading");
        const name = names[i].trim() || stripExt(files[i].name);
        const job = await uploadFile(authHeaders, { workspaceId, file: files[i], datasetName: name });
        setStatus(i, "processing");
        await commitJob(authHeaders, job.id, []);
        await waitForJob(authHeaders, job.id, abort.current.signal);
        setStatus(i, "done");
        created.push({ id: job.dataset_id, name });
      }
      if (joinAfter && created.length >= 2) {
        const [ls, rs] = await Promise.all([latestSchema(authHeaders, created[0].id), latestSchema(authHeaders, created[1].id)]);
        const keys = suggestJoinKeys(Object.keys(ls), Object.keys(rs));
        onReview({
          mode: "shape",
          datasetId: created[0].id,
          presetSteps: [{ op: "join", params: { dataset_id: created[1].id, left_on: keys?.left_on ?? "", right_on: keys?.right_on ?? "", how: "left" } }],
        });
      } else {
        onImported(`Imported ${plural(created.length, "dataset")}.`);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setProgress((p) => p.map((s) => (s === "uploading" || s === "processing" ? "error" : s)));
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={target ? `New version of ${target.name}` : single ? "Upload a file" : `Upload ${files.length} files`}
      description={single ? "Next you'll review the rows and add clean-up steps before anything is saved." : "Each file is imported as its own dataset."}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {single ? (
            <button className="btn btn-primary" onClick={reviewSingle} disabled={busy || (destination === "existing" && !existingId)}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />} Continue to review
            </button>
          ) : (
            <button className="btn btn-primary" onClick={importAll} disabled={busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />}
              {joinAfter ? "Import and join" : `Import ${files.length} files`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={f.name + i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <FileSpreadsheet size={18} className="shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                {single && destination === "existing" ? (
                  <p className="truncate text-sm font-semibold">{f.name}</p>
                ) : (
                  <label className="block">
                    <span className="sr-only">Dataset name for {f.name}</span>
                    <input
                      className="input h-8 font-semibold"
                      value={names[i]}
                      disabled={busy}
                      onChange={(e) => setNames((n) => n.map((v, j) => (j === i ? e.target.value : v)))}
                    />
                  </label>
                )}
                <p className="mt-1 text-xs text-text-tertiary">{f.name} · {formatBytes(f.size)}</p>
              </div>
              {!single && <ProgressPill status={progress[i]} />}
            </li>
          ))}
        </ul>

        {single && fileDatasets.length > 0 && (
          <fieldset>
            <legend className="field-label">Save as</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice checked={destination === "new"} onChange={() => setDestination("new")} title="A new dataset" body="Starts at version 1." disabled={busy} />
              <Choice checked={destination === "existing"} onChange={() => setDestination("existing")} title="A new version" body="Of a dataset you already have." disabled={busy} />
            </div>
            {destination === "existing" && (
              <label className="mt-3 block">
                <span className="field-label">Dataset</span>
                <select className="input" value={existingId} onChange={(e) => setExistingId(e.target.value)} disabled={busy}>
                  {fileDatasets.map((d) => <option key={d.id} value={d.id}>{d.name} (v{d.version_count})</option>)}
                </select>
                <span className="field-hint">If columns differ from the current version, you'll be asked how to map them.</span>
              </label>
            )}
          </fieldset>
        )}

        {files.length >= 2 && (
          <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-3">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={joinAfter} onChange={(e) => setJoinAfter(e.target.checked)} disabled={busy} />
            <span>
              <span className="block text-sm font-semibold">Join “{names[0] || files[0].name}” with “{names[1] || files[1].name}”</span>
              <span className="block text-xs text-text-secondary">After importing, open Pipeline Studio with a join step ready. We'll suggest the matching column.</span>
            </span>
          </label>
        )}

        {error && <p role="alert" className="rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function ProgressPill({ status }: { status: FileProgress }) {
  const map: Record<FileProgress, [string, string]> = {
    waiting: ["Waiting", "bg-surface-2 text-text-tertiary"],
    uploading: ["Uploading", "bg-primary-muted text-primary"],
    processing: ["Processing", "bg-primary-muted text-primary"],
    done: ["Imported", "bg-success-muted text-success"],
    error: ["Failed", "bg-danger-muted text-danger"],
  };
  const [label, cls] = map[status];
  return (
    <span className={cn("badge shrink-0", cls)}>
      {(status === "uploading" || status === "processing") && <LoaderCircle size={11} className="animate-spin" />}
      {label}
    </span>
  );
}

function Choice({ checked, onChange, title, body, disabled }: { checked: boolean; onChange: () => void; title: string; body: string; disabled?: boolean }) {
  return (
    <label className={cn(
      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
      checked ? "border-primary bg-primary-muted/60" : "border-border hover:bg-surface-2",
      disabled && "pointer-events-none opacity-60",
    )}>
      <input type="radio" className="mt-0.5 accent-primary" checked={checked} onChange={onChange} />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-text-secondary">{body}</span>
      </span>
    </label>
  );
}

// ── Database dialog ──────────────────────────────────────────────────────────

function ConnectDialog({
  target, workspaceId, authHeaders, onClose, onReview,
}: {
  target: DatasetSummary | null;
  workspaceId: string;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onReview: (launch: StudioLaunch) => void;
}) {
  const initialType = (target && !isFileSource(target.source_type) ? target.source_type : "postgres") as DbSourceType;
  const [sourceType, setSourceType] = useState<DbSourceType>(initialType);
  const [form, setForm] = useState({ host: "", port: DB_DEFAULT_PORT[initialType], database: "", user: "", password: "", table: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function changeType(t: DbSourceType) {
    // Only replace the port if the user hadn't typed their own.
    setForm((f) => ({ ...f, port: Object.values(DB_DEFAULT_PORT).includes(f.port) || !f.port ? DB_DEFAULT_PORT[t] : f.port }));
    setSourceType(t);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const port = Number(form.port);
      if (!Number.isInteger(port) || port <= 0) throw new Error("Port must be a whole number.");
      const datasetName = target?.name ?? (form.name.trim() || form.table.split(".").pop() || form.table);
      const job = await createDbJob(authHeaders, {
        workspaceId, sourceType, datasetId: target?.id, datasetName,
        config: { host: form.host.trim(), port, database: form.database.trim(), user: form.user.trim(), password: form.password, table: form.table.trim() },
      });
      onReview({ mode: "import", jobId: job.id, datasetId: job.dataset_id, datasetName });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title={target ? `Re-import ${target.name}` : "Connect a database"}
      description="Kadence reads the table with a read-only session. Credentials are encrypted and only used for this import."
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="connect-form" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />} Continue to review
          </button>
        </>
      }
    >
      <form id="connect-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
        <Field label="Database type" className="sm:col-span-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(DB_DEFAULT_PORT) as DbSourceType[]).map((t) => (
              <button
                type="button"
                key={t}
                aria-pressed={sourceType === t}
                onClick={() => changeType(t)}
                className={cn(
                  "h-9 rounded-lg border text-sm font-medium transition-colors",
                  sourceType === t ? "border-primary bg-primary-muted text-primary" : "border-border hover:bg-surface-2",
                )}
              >
                {SOURCE_LABEL[t]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Host" className="sm:col-span-4">
          <input className="input" required autoFocus placeholder="db.example.com" value={form.host} onChange={set("host")} />
        </Field>
        <Field label="Port" className="sm:col-span-2">
          <input className="input font-mono" required inputMode="numeric" value={form.port} onChange={set("port")} />
        </Field>
        <Field label="Database" className="sm:col-span-3">
          <input className="input" required placeholder="analytics" value={form.database} onChange={set("database")} />
        </Field>
        <Field label="Table" hint="Include the schema, e.g. public.orders" className="sm:col-span-3">
          <input className="input font-mono" required placeholder="public.orders" value={form.table} onChange={set("table")} />
        </Field>
        <Field label="Username" className="sm:col-span-3">
          <input className="input" required autoComplete="username" placeholder="readonly_user" value={form.user} onChange={set("user")} />
        </Field>
        <Field label="Password" className="sm:col-span-3">
          <input className="input" type="password" required autoComplete="current-password" value={form.password} onChange={set("password")} />
        </Field>
        {!target && (
          <Field label="Dataset name" hint="Optional. Defaults to the table name." className="sm:col-span-6">
            <input className="input" placeholder="orders" value={form.name} onChange={set("name")} />
          </Field>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger sm:col-span-6">{error}</p>}
      </form>
    </Dialog>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint block">{hint}</span>}
    </label>
  );
}

// ── Dataset detail panel ─────────────────────────────────────────────────────

function DatasetDetail({
  dataset, authHeaders, onClose, onShape, onDelete,
}: {
  dataset: DatasetSummary;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onShape: () => void;
  onDelete: () => void;
}) {
  const [versions, setVersions] = useState<DatasetVersion[] | null>(null);
  const [lineage, setLineage] = useState<LineageNode | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setLineage(undefined);
    listVersions(authHeaders, dataset.id)
      .then((v) => { if (!cancelled) { setVersions(v); setOpen(v[v.length - 1]?.id ?? null); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    fetchLineage(authHeaders, dataset.id).then((l) => { if (!cancelled) setLineage(l); });
    return () => { cancelled = true; };
  }, [dataset.id, authHeaders]);

  return (
    <Dialog
      open
      variant="side"
      onClose={onClose}
      title={dataset.name}
      description={`${SOURCE_LABEL[dataset.source_type] ?? dataset.source_type} · created ${formatDate(dataset.created_at)}`}
      footer={
        <>
          <button className="btn btn-ghost mr-auto text-danger" onClick={onDelete}><Trash2 size={15} /> Delete dataset</button>
          <button className="btn btn-primary" onClick={onShape} disabled={dataset.version_count === 0}><Workflow size={15} /> Open in Pipeline Studio</button>
        </>
      }
    >
      <div className="space-y-7">
        <dl className="grid grid-cols-3 gap-3">
          {[["Rows", formatCount(dataset.latest_row_count)], ["Versions", String(dataset.version_count)], ["Size", formatBytes(dataset.latest_file_size)]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-surface-2 px-3 py-2.5">
              <dt className="text-xs text-text-tertiary">{k}</dt>
              <dd className="tabular mt-0.5 font-mono text-[15px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <section>
          <h3 className="section-label mb-3 flex items-center gap-1.5"><GitMerge size={12} /> Where this data comes from</h3>
          {lineage === undefined ? (
            <p className="flex items-center gap-2 text-sm text-text-tertiary"><LoaderCircle size={14} className="animate-spin" /> Loading lineage…</p>
          ) : lineage ? (
            <div className="rounded-xl border border-border p-3">
              <LineageChip node={lineage} emphasis />
              {lineage.sources.map((s, i) => <LineageEdge key={i} edge={s} />)}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">Lineage isn't available for this dataset.</p>
          )}
        </section>

        <section>
          <h3 className="section-label mb-3 flex items-center gap-1.5"><Layers size={12} /> Versions</h3>
          {error && <p className="text-sm text-danger">{error}</p>}
          {!versions && !error && <p className="flex items-center gap-2 text-sm text-text-tertiary"><LoaderCircle size={14} className="animate-spin" /> Loading versions…</p>}
          <ol className="space-y-2">
            {[...(versions ?? [])].reverse().map((v) => {
              const isOpen = open === v.id;
              return (
                <li key={v.id} className="overflow-hidden rounded-xl border border-border">
                  <button
                    onClick={() => setOpen(isOpen ? null : v.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-surface-2"
                  >
                    <ChevronRight size={14} className={cn("shrink-0 text-text-tertiary transition-transform", isOpen && "rotate-90")} />
                    <span className="w-9 font-mono font-semibold text-primary">v{v.version}</span>
                    <span className="tabular text-text-secondary">{plural(v.row_count, "row")} · {plural(v.column_count, "column")}</span>
                    <span className="ml-auto text-xs text-text-tertiary">{formatDateTime(v.created_at)}</span>
                  </button>
                  {isOpen && (
                    <table className="w-full border-t border-border text-[13px]">
                      <tbody>
                        {Object.entries(v.dataset_schema ?? {}).map(([col, type]) => (
                          <tr key={col} className="border-b border-border-subtle last:border-0">
                            <td className="px-3.5 py-1.5 font-mono">{col}</td>
                            <td className="px-3.5 py-1.5 text-right text-text-tertiary">{type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </Dialog>
  );
}

function originText(node: LineageNode): string {
  if (node.sources.length) return node.sources.some((s) => s.how === "append") ? "Combined (appended rows)" : "Combined (joined)";
  return SOURCE_LABEL[node.source_type] ? `${SOURCE_LABEL[node.source_type]}${node.origin_detail ? ` · ${node.origin_detail}` : ""}` : node.source_type;
}

function LineageChip({ node, emphasis }: { node: LineageNode; emphasis?: boolean }) {
  const combined = node.sources.length > 0;
  return (
    <div className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2", emphasis ? "bg-primary-muted/60" : "bg-surface-2")}>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", combined ? "bg-primary text-white" : "bg-surface text-text-secondary")}>
        {combined ? <GitMerge size={13} /> : <SourceIcon type={node.source_type} className="size-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{node.dataset_name}{emphasis && " (this dataset)"}</span>
        <span className="block truncate text-xs text-text-secondary">{originText(node)}</span>
      </span>
    </div>
  );
}

function LineageEdge({ edge }: { edge: LineageNode["sources"][number] }) {
  return (
    <div className="relative pl-6">
      <div className="absolute bottom-0 left-[13px] top-0 w-px bg-border" />
      <div className="absolute left-[13px] top-[26px] h-px w-3 bg-border" />
      <div className="pt-2">
        <p className="mb-1 pl-1 font-mono text-[11px] text-text-tertiary">
          {edge.how === "append" ? "rows appended from" : `${edge.how} join on ${edge.left_on} = ${edge.right_on}`}
        </p>
        {edge.node ? <LineageChip node={edge.node} /> : <p className="px-2.5 py-2 text-sm italic text-text-tertiary">{edge.dataset_name} (no longer available)</p>}
      </div>
      {edge.node?.sources.map((s, i) => <LineageEdge key={i} edge={s} />)}
    </div>
  );
}

// ── Delete confirmation ──────────────────────────────────────────────────────

function DeleteDialog({ datasets, onClose, onConfirm }: { datasets: DatasetSummary[]; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const many = datasets.length > 1;
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!busy}
      title={many ? `Delete ${datasets.length} datasets?` : `Delete ${datasets[0].name}?`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try { await onConfirm(); } catch (e) { setError((e as Error).message); setBusy(false); }
            }}
          >
            {busy && <LoaderCircle size={15} className="animate-spin" />} Delete {many ? "datasets" : "dataset"}
          </button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">
        All versions and stored files are removed. Datasets built from {many ? "these" : "it"} keep their own copies. This can't be undone.
      </p>
      {many && (
        <ul className="mt-3 space-y-1 text-sm">
          {datasets.map((d) => <li key={d.id} className="truncate font-semibold">· {d.name}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>}
    </Dialog>
  );
}
