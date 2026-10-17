import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/shared/PageHeader";
import { Database, FileSpreadsheet, Upload, Plus, ArrowRight, Loader2, AlertCircle, RefreshCw, ChevronRight, Trash2, GitMerge } from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { readError } from "../../lib/http";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

type Step = "list" | "choose_dataset" | "db_creds" | "uploading" | "error";

interface DatasetSummary {
  id: string;
  name: string;
  source_type: string;
  version_count: number;
  latest_row_count: number | null;
  latest_file_size: number | null;
  created_at: string;
}

interface JobResponse {
  id: string;
  dataset_id: string;
  status: string;
  source_type: string;
  error_message?: string;
}

interface DatasetVersion {
  id: string;
  version: number;
  row_count: number;
  column_count: number;
  file_size: number;
  created_at: string;
  dataset_schema: Record<string, string>;
}

interface LineageSource {
  dataset_id: string;
  dataset_name: string;
  how: string;
  left_on: string;
  right_on: string;
}

interface LineageNode {
  dataset_id: string;
  dataset_name: string;
  source_type: string;
  origin_detail: string | null;
  // Each edge into this dataset, with the upstream node it points at (null if
  // that upstream dataset was unreachable/deleted/already visited — cycle guard).
  sources: (LineageSource & { node: LineageNode | null })[];
}

/** Human label for where a dataset's data originally came from. A dataset with join
 * sources was produced by a combine in Pipeline Studio, not a raw file upload — even
 * though it's stored as source_type "parquet" like any other, so that takes priority. */
function originLabel(sourceType: string, detail: string | null, hasSources: boolean): string {
  if (hasSources) return "Combined dataset (Pipeline Studio)";
  if (["csv", "xlsx", "parquet"].includes(sourceType)) {
    return `Uploaded ${sourceType.toUpperCase()} file`;
  }
  return detail ? `${sourceType} · ${detail}` : `${sourceType} connection`;
}

/** Single-hop lineage endpoint, called recursively to build a multi-hop graph
 * client-side. `visited` guards against cycles (shouldn't occur, but a join
 * plan is user-authored data, not a DAG the server verifies is acyclic). */
async function fetchLineageTree(
  datasetId: string,
  authHeaders: () => Record<string, string>,
  depth: number,
  visited: Set<string>,
): Promise<LineageNode | null> {
  if (depth <= 0 || visited.has(datasetId)) return null;
  visited.add(datasetId);
  const res = await fetch(`${API_BASE}/data-ingest/datasets/${datasetId}/lineage`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data: { dataset_id: string; dataset_name: string; source_type: string; origin_detail: string | null; sources: LineageSource[] } = await res.json();
  const sources = await Promise.all(
    data.sources.map(async (s) => ({ ...s, node: await fetchLineageTree(s.dataset_id, authHeaders, depth - 1, visited) })),
  );
  return {
    dataset_id: data.dataset_id, dataset_name: data.dataset_name,
    source_type: data.source_type, origin_detail: data.origin_detail,
    sources,
  };
}

interface DbForm {
  source_type: "postgres" | "mysql" | "snowflake" | "mssql";
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  table: string;
  dataset_name: string;
}

/** Icon + color for a node's origin: file upload, DB connection, or a Pipeline
 * Studio combine result (which also happens to be stored as source_type "parquet",
 * so "has join sources" must take priority over source_type when picking a look). */
function originVisual(sourceType: string, hasSources: boolean) {
  if (hasSources) return { Icon: GitMerge, className: "bg-primary/10 text-primary" };
  const isFile = ["csv", "xlsx", "parquet"].includes(sourceType);
  return isFile
    ? { Icon: FileSpreadsheet, className: "bg-accent-light text-accent" }
    : { Icon: Database, className: "bg-warning-muted text-warning" };
}

/** Small colored pill showing where a node's data originated. */
function OriginBadge({ sourceType, detail, hasSources }: { sourceType: string; detail: string | null; hasSources: boolean }) {
  const { Icon, className } = originVisual(sourceType, hasSources);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", className)}>
      <Icon size={10} />
      {originLabel(sourceType, detail, hasSources)}
    </span>
  );
}

/** One node in the lineage graph: an icon chip, dataset name, and its origin badge. */
function LineageNodeChip({ name, sourceType, detail, hasSources, emphasis }: {
  name: string; sourceType: string; detail: string | null; hasSources: boolean; emphasis?: boolean;
}) {
  const { Icon, className } = originVisual(sourceType, hasSources);
  return (
    <div className={cn(
      "flex items-center gap-2.5 rounded-lg border px-3 py-2 min-w-0",
      emphasis ? "border-primary/25 bg-primary/5" : "border-border-subtle bg-surface",
    )}>
      <div className={cn("size-6 rounded-full flex items-center justify-center shrink-0", className)}>
        <Icon size={12} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold truncate">{name}</p>
        <OriginBadge sourceType={sourceType} detail={detail} hasSources={hasSources} />
      </div>
    </div>
  );
}

/** One join edge feeding into a dataset, rendered as a connector line down to a
 * source node chip, recursing for any upstream joins that fed *that* source. */
function LineageEdge({ edge }: { edge: LineageSource & { node: LineageNode | null } }) {
  return (
    <div className="relative pl-6">
      {/* Connector: vertical trunk + curved elbow into the node, git-graph style */}
      <div className="absolute left-[9px] top-0 bottom-0 w-px bg-border" />
      <div className="absolute left-[9px] top-[18px] w-3 h-px bg-border" />
      <div className="py-1.5">
        {edge.node ? (
          <LineageNodeChip
            name={edge.node.dataset_name} sourceType={edge.node.source_type}
            detail={edge.node.origin_detail} hasSources={edge.node.sources.length > 0}
          />
        ) : (
          <div className="text-xs text-text-tertiary italic px-3 py-2">{edge.dataset_name} (unavailable)</div>
        )}
        <div className="flex items-center gap-1.5 pl-1 mt-1 text-[10px] font-mono text-text-tertiary">
          <GitMerge size={10} className="text-primary" />
          {edge.how} join · {edge.left_on} = {edge.right_on}
        </div>
      </div>
      {edge.node && edge.node.sources.length > 0 && (
        <div className="pl-3">
          {edge.node.sources.map((s, i) => <LineageEdge key={i} edge={s} />)}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataImportPage() {
  const navigate = useNavigate();
  const { session } = useAuthContext();
  const { activeWorkspace } = useWorkspaceContext();

  const [activeTab, setActiveTab] = useState<"file" | "db">("file");
  const [step, setStep] = useState<Step>("list");
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [detailDatasetId, setDetailDatasetId] = useState<string | null>(null);
  const [detailVersions, setDetailVersions] = useState<DatasetVersion[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedVersionIds, setExpandedVersionIds] = useState<Set<string>>(new Set());
  const [detailLineage, setDetailLineage] = useState<LineageNode | null>(null);
  const [detailLineageLoading, setDetailLineageLoading] = useState(false);

  // For append-to-existing flow
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  // Ref so "Add Data" dataset ID is available synchronously when onChange fires
  const appendToDatasetRef = useRef<string | null>(null);

  const [dbForm, setDbForm] = useState<DbForm>({
    source_type: "postgres", host: "", port: "5432",
    database: "", user: "", password: "", table: "", dataset_name: "",
  });

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${session?.accessToken}`,
  }), [session]);

  // ── Fetch datasets ─────────────────────────────────────────────────────────
  const fetchDatasets = useCallback(async () => {
    if (!activeWorkspace) return;
    setDatasetsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/data-ingest/datasets?workspace_id=${activeWorkspace.id}`,
        { headers: authHeaders() }
      );
      if (res.ok) setDatasets(await res.json());
    } finally {
      setDatasetsLoading(false);
    }
  }, [activeWorkspace, authHeaders]);

  useEffect(() => { fetchDatasets(); }, [fetchDatasets]);

  // ── File picked ────────────────────────────────────────────────────────────
  function onFilePicked(file: File) {
    // If triggered via "Add Data" button, appendToDatasetRef is set synchronously
    const targetDatasetId = appendToDatasetRef.current;
    appendToDatasetRef.current = null;

    if (targetDatasetId) {
      // Direct append — skip chooser
      uploadFile(file, targetDatasetId);
    } else if (datasets.filter((d) => ["csv", "xlsx", "parquet"].includes(d.source_type)).length > 0) {
      setPendingFile(file);
      setStep("choose_dataset");
    } else {
      uploadFile(file, null);
    }
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function uploadFile(file: File, datasetId: string | null) {
    setStep("uploading");
    setError("");

    const ext = file.name.split(".").pop()?.toLowerCase();
    const sourceTypeMap: Record<string, string> = { csv: "csv", xlsx: "xlsx", xls: "xlsx", parquet: "parquet" };
    const source_type = sourceTypeMap[ext ?? ""] ?? "csv";

    const resolvedDatasetId = datasetId ?? crypto.randomUUID();
    const datasetName = file.name.replace(/\.[^.]+$/, "");
    const form = new FormData();
    form.append("dataset_id", resolvedDatasetId);
    form.append("dataset_name", datasetName);
    form.append("workspace_id", activeWorkspace!.id);
    form.append("source_type", source_type);
    form.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/data-ingest/jobs/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) throw new Error(await readError(res, "Upload failed"));
      const data: JobResponse = await res.json();
      // Job is staged (PENDING) — hand off to DataForge for review & commit.
      navigate("/app/data-transform", {
        state: { jobId: data.id, datasetId: data.dataset_id, datasetName },
      });
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    }
  }

  // ── DB ingestion ───────────────────────────────────────────────────────────
  async function submitDbJob(e: React.FormEvent) {
    e.preventDefault();
    setStep("uploading");
    setError("");

    const datasetId = selectedDatasetId ?? crypto.randomUUID();
    const datasetName = dbForm.dataset_name || `${dbForm.source_type}_${dbForm.table}`;
    const payload = {
      dataset_id: datasetId,
      dataset_name: datasetName,
      workspace_id: activeWorkspace!.id,
      source_type: dbForm.source_type,
      db_config: {
        host: dbForm.host, port: parseInt(dbForm.port),
        database: dbForm.database, user: dbForm.user,
        password: dbForm.password, table: dbForm.table,
      },
    };

    try {
      const res = await fetch(`${API_BASE}/data-ingest/jobs`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to start ingestion"));
      const data: JobResponse = await res.json();
      // Job is staged (PENDING) — hand off to DataForge for review & commit.
      navigate("/app/data-transform", {
        state: { jobId: data.id, datasetId: data.dataset_id, datasetName },
      });
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    }
  }

  function reset() {
    if (fileRef.current) fileRef.current.value = "";
    appendToDatasetRef.current = null;
    setStep("list");
    setError("");
    setSelectedDatasetId(null);
    setPendingFile(null);
  }

  async function openDetail(datasetId: string) {
    if (detailDatasetId === datasetId) { setDetailDatasetId(null); return; }
    setDetailDatasetId(datasetId);
    setDetailLoading(true);
    setDetailVersions([]);
    setExpandedVersionIds(new Set());
    setDetailLineage(null);
    setDetailLineageLoading(true);
    fetchLineageTree(datasetId, authHeaders, 4, new Set())
      .then(setDetailLineage)
      .finally(() => setDetailLineageLoading(false));
    try {
      const res = await fetch(`${API_BASE}/data-ingest/datasets/${datasetId}/versions`, { headers: authHeaders() });
      if (res.ok) setDetailVersions(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }

  async function deleteDataset(datasetId: string) {
    setDeletingId(datasetId);
    setConfirmDeleteId(null);
    try {
      await fetch(
        `${API_BASE}/data-ingest/datasets/${datasetId}?workspace_id=${activeWorkspace!.id}`,
        { method: "DELETE", headers: authHeaders() }
      );
      setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
    } finally {
      setDeletingId(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFilePicked(file);
  }

  const sourceTypeIcon = (type: string) =>
    ["csv", "xlsx", "parquet"].includes(type)
      ? <FileSpreadsheet size={16} />
      : <Database size={16} />;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col animate-in fade-in duration-500">
      <PageHeader
        title="Data Ingestion"
        subtitle="Upload files or connect a database. All data is versioned and stored in Parquet."
        actions={
          step === "list" && (
            <button
              onClick={fetchDatasets}
              className="btn btn-secondary text-xs flex items-center gap-2"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          )
        }
      />

      <div className="flex-1 p-8 overflow-y-auto space-y-8">

        {/* ── Dataset list ─────────────────────────────────────────────────── */}
        {step === "list" && (
          <>
            {/* Upload / connect section */}
            <div>
              <div className="flex gap-6 border-b border-border mb-6">
                {(["file", "db"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={cn(
                      "pb-3 text-xs font-black uppercase tracking-widest transition-all relative",
                      activeTab === t ? "text-primary" : "text-text-tertiary hover:text-text"
                    )}
                  >
                    {t === "file" ? "File Upload" : "Database Connection"}
                    {activeTab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                  </button>
                ))}
              </div>

              {activeTab === "file" && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    "card p-10 text-center border-2 border-dashed cursor-pointer transition-all",
                    dragOver ? "border-primary bg-primary/5" : "border-border-subtle hover:border-primary"
                  )}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx,.xls,.parquet"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePicked(f); }}
                  />
                  <Upload className="text-text-tertiary mx-auto mb-3" size={28} />
                  <p className="font-bold text-sm">Drop a file or click to browse</p>
                  <p className="text-xs text-text-secondary mt-1">CSV · Excel · Parquet</p>
                </div>
              )}

              {activeTab === "db" && (
                <button
                  onClick={() => { setSelectedDatasetId(null); setStep("db_creds"); }}
                  className="card p-6 w-full text-left flex items-center gap-5 hover:border-primary/50 transition-all group"
                >
                  <div className="size-11 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                    <Database size={20} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">Connect a Database</p>
                    <p className="text-xs text-text-secondary mt-0.5">PostgreSQL · MySQL · Snowflake · MSSQL</p>
                  </div>
                  <Plus size={16} className="text-text-tertiary" />
                </button>
              )}
            </div>

            {/* Existing datasets */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-text-tertiary">
                  Datasets in this workspace
                </h3>
                {!datasetsLoading && (
                  <span className="text-xs text-text-tertiary">
                    {datasets.filter((d) => activeTab === "file"
                      ? ["csv", "xlsx", "parquet"].includes(d.source_type)
                      : !["csv", "xlsx", "parquet"].includes(d.source_type)
                    ).length} total
                  </span>
                )}
              </div>

              {datasetsLoading ? (
                <div className="flex items-center gap-3 py-8 text-text-tertiary text-sm">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              ) : datasets.filter((d) => activeTab === "file"
                  ? ["csv", "xlsx", "parquet"].includes(d.source_type)
                  : !["csv", "xlsx", "parquet"].includes(d.source_type)
                ).length === 0 ? (
                <div className="card p-10 text-center text-text-tertiary">
                  {activeTab === "file"
                    ? <><FileSpreadsheet size={28} className="mx-auto mb-3 opacity-30" /><p className="text-sm">No file uploads yet. Drop a file above to get started.</p></>
                    : <><Database size={28} className="mx-auto mb-3 opacity-30" /><p className="text-sm">No database connections yet. Connect one above.</p></>
                  }
                </div>
              ) : (
                <div className="card divide-y divide-border-subtle overflow-hidden">
                  {datasets.filter((d) => activeTab === "file"
                    ? ["csv", "xlsx", "parquet"].includes(d.source_type)
                    : !["csv", "xlsx", "parquet"].includes(d.source_type)
                  ).map((ds) => (
                    <div key={ds.id}>
                    <div className="flex items-center gap-5 px-6 py-4 hover:bg-surface-2/50 transition-all group">
                      <div className="size-9 rounded-xl bg-surface-2 border border-border flex items-center justify-center text-text-tertiary shrink-0">
                        {sourceTypeIcon(ds.source_type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{ds.name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{ds.source_type}</span>
                          <span className="text-[10px] text-text-tertiary">·</span>
                          <span className="text-[10px] text-text-tertiary">{ds.version_count} version{ds.version_count !== 1 ? "s" : ""}</span>
                          {ds.latest_row_count != null && (
                            <>
                              <span className="text-[10px] text-text-tertiary">·</span>
                              <span className="text-[10px] text-text-tertiary">{ds.latest_row_count.toLocaleString()} rows</span>
                            </>
                          )}
                          {ds.latest_file_size != null && (
                            <>
                              <span className="text-[10px] text-text-tertiary">·</span>
                              <span className="text-[10px] text-text-tertiary">{formatBytes(ds.latest_file_size)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => {
                            if (activeTab === "file") {
                              appendToDatasetRef.current = ds.id; // set synchronously before click
                              fileRef.current?.click();
                            } else {
                              setSelectedDatasetId(ds.id);
                              setDbForm((f) => ({ ...f, dataset_name: ds.name }));
                              setStep("db_creds");
                            }
                          }}
                          className="btn btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"
                        >
                          <Plus size={12} /> Add Data
                        </button>

                        {confirmDeleteId === ds.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deleteDataset(ds.id)}
                              disabled={deletingId === ds.id}
                              className="text-xs font-bold text-danger border border-danger/30 bg-danger/5 hover:bg-danger/10 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              {deletingId === ds.id ? <Loader2 size={12} className="animate-spin" /> : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-text-tertiary hover:text-text font-semibold px-2 py-1.5"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(ds.id)}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-danger hover:bg-danger/5 transition-colors"
                            title="Delete dataset"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => openDetail(ds.id)}
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors opacity-0 group-hover:opacity-100"
                        title="View schema & versions"
                      >
                        <ChevronRight size={15} className={cn("transition-transform", detailDatasetId === ds.id && "rotate-90")} />
                      </button>
                    </div>

                    {/* Detail panel */}
                    {detailDatasetId === ds.id && (
                      <div className="border-t border-border-subtle bg-surface-2/40 px-6 py-5 space-y-5">
                        {/* Data origin & lineage — always shown; a plain import just shows one line */}
                        {detailLineageLoading ? (
                          <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
                            <Loader2 size={14} className="animate-spin" /> Loading lineage…
                          </div>
                        ) : detailLineage && (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary mb-3 flex items-center gap-1.5">
                              <GitMerge size={11} /> Data Origin &amp; Lineage
                            </p>
                            <div className="rounded-xl border border-border-subtle bg-surface-2/40 p-4">
                              <LineageNodeChip
                                name={`${ds.name} (this dataset)`}
                                sourceType={detailLineage.source_type}
                                detail={detailLineage.origin_detail}
                                hasSources={detailLineage.sources.length > 0}
                                emphasis
                              />
                              {detailLineage.sources.length > 0 && (
                                <div className="mt-1">
                                  {detailLineage.sources.map((s, i) => <LineageEdge key={i} edge={s} />)}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {detailLoading ? (
                          <div className="flex items-center gap-2 text-text-tertiary text-sm py-2">
                            <Loader2 size={14} className="animate-spin" /> Loading versions…
                          </div>
                        ) : detailVersions.length === 0 ? (
                          <p className="text-sm text-text-tertiary py-2">No versions found.</p>
                        ) : (
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary mb-3">
                              Version History
                            </p>
                            <div className="space-y-2">
                              {[...detailVersions].reverse().map((v) => {
                                const open = expandedVersionIds.has(v.id);
                                return (
                                  <div key={v.id} className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
                                    <button
                                      onClick={() => setExpandedVersionIds((prev) => {
                                        const next = new Set(prev);
                                        next.has(v.id) ? next.delete(v.id) : next.add(v.id);
                                        return next;
                                      })}
                                      className="w-full flex items-center gap-4 px-4 py-3 text-xs hover:bg-surface-2/50 transition-colors text-left"
                                      title="View schema for this version"
                                    >
                                      <ChevronRight size={13} className={cn("text-text-tertiary transition-transform shrink-0", open && "rotate-90")} />
                                      <span className="font-bold text-primary w-8">v{v.version}</span>
                                      <span className="text-text-tertiary">{v.row_count.toLocaleString()} rows</span>
                                      <span className="text-border-subtle">·</span>
                                      <span className="text-text-tertiary">{v.column_count} cols</span>
                                      <span className="text-border-subtle">·</span>
                                      <span className="text-text-tertiary">{formatBytes(v.file_size)}</span>
                                      <span className="ml-auto text-text-tertiary">{new Date(v.created_at).toLocaleDateString()}</span>
                                    </button>
                                    {open && (
                                      <table className="w-full text-xs border-t border-border-subtle">
                                        <thead>
                                          <tr className="bg-surface-2 border-b border-border-subtle">
                                            <th className="text-left px-4 py-2 font-bold text-text-secondary">Column</th>
                                            <th className="text-left px-4 py-2 font-bold text-text-secondary">Type</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {Object.entries(v.dataset_schema ?? {}).map(([col, type]) => (
                                            <tr key={col} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
                                              <td className="px-4 py-2 font-mono text-text">{col}</td>
                                              <td className="px-4 py-2 text-text-tertiary">{type}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Choose: new dataset or append ────────────────────────────────── */}
        {step === "choose_dataset" && pendingFile && (
          <div className="max-w-lg mx-auto space-y-4 animate-in slide-in-from-bottom duration-300">
            <div className="card p-5 flex items-center gap-4 bg-surface-2/50">
              <FileSpreadsheet size={18} className="text-primary shrink-0" />
              <div>
                <p className="font-bold text-sm">{pendingFile.name}</p>
                <p className="text-xs text-text-secondary">{formatBytes(pendingFile.size)}</p>
              </div>
            </div>

            <p className="text-xs font-black uppercase tracking-widest text-text-tertiary">Add to existing dataset or create new?</p>

            {/* Existing file datasets only */}
            <div className="card divide-y divide-border-subtle overflow-hidden">
              {datasets.filter((d) => ["csv", "xlsx", "parquet"].includes(d.source_type)).map((ds) => (
                <button
                  key={ds.id}
                  onClick={() => uploadFile(pendingFile, ds.id)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2 transition-all text-left group"
                >
                  <div className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-tertiary shrink-0">
                    {sourceTypeIcon(ds.source_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{ds.name}</p>
                    <p className="text-[10px] text-text-tertiary">{ds.version_count} version{ds.version_count !== 1 ? "s" : ""} · {ds.latest_row_count?.toLocaleString() ?? "—"} rows</p>
                  </div>
                  <span className="text-xs text-primary font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    Append <ArrowRight size={12} />
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => uploadFile(pendingFile, null)}
              className="btn btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus size={15} /> Create New Dataset
            </button>

            <button onClick={reset} className="text-sm text-text-tertiary hover:text-text font-semibold w-full text-center">
              Cancel
            </button>
          </div>
        )}

        {/* ── DB credentials ────────────────────────────────────────────────── */}
        {step === "db_creds" && (
          <div className="max-w-2xl mx-auto card p-8 animate-in slide-in-from-right duration-400">
            <h3 className="text-lg font-bold tracking-tight flex items-center gap-3 mb-6">
              <Database size={18} className="text-primary" />
              {selectedDatasetId ? "Add Data from Database" : "New Database Connection"}
            </h3>
            <form onSubmit={submitDbJob} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Source Type</label>
                <select className="input w-full" value={dbForm.source_type} onChange={(e) => setDbForm((f) => ({ ...f, source_type: e.target.value as any }))}>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="snowflake">Snowflake</option>
                  <option value="mssql">MSSQL</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Host</label>
                  <input className="input w-full" placeholder="db.example.com" required value={dbForm.host} onChange={(e) => setDbForm((f) => ({ ...f, host: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Port</label>
                  <input className="input w-full" placeholder="5432" required value={dbForm.port} onChange={(e) => setDbForm((f) => ({ ...f, port: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Database</label>
                <input className="input w-full" placeholder="production" required value={dbForm.database} onChange={(e) => setDbForm((f) => ({ ...f, database: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Username</label>
                  <input className="input w-full" placeholder="readonly_user" required value={dbForm.user} onChange={(e) => setDbForm((f) => ({ ...f, user: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Password</label>
                  <input type="password" className="input w-full" placeholder="••••••••" required value={dbForm.password} onChange={(e) => setDbForm((f) => ({ ...f, password: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Table</label>
                <input className="input w-full" placeholder="public.users" required value={dbForm.table} onChange={(e) => setDbForm((f) => ({ ...f, table: e.target.value }))} />
              </div>
              {!selectedDatasetId && (
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Dataset Name (optional)</label>
                  <input className="input w-full" placeholder="Auto-generated from table name" value={dbForm.dataset_name} onChange={(e) => setDbForm((f) => ({ ...f, dataset_name: e.target.value }))} />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={reset} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary flex items-center gap-2">
                  Start Ingestion <ArrowRight size={15} />
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Uploading ─────────────────────────────────────────────────────── */}
        {step === "uploading" && (
          <div className="max-w-sm mx-auto mt-20 text-center space-y-4">
            <Loader2 size={36} className="animate-spin text-primary mx-auto" />
            <p className="font-bold">Staging source &amp; opening DataForge…</p>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {step === "error" && (
          <div className="max-w-md mx-auto mt-16 card p-10 text-center space-y-4">
            <div className="size-14 bg-danger/10 text-danger rounded-full flex items-center justify-center mx-auto border border-danger/20">
              <AlertCircle size={26} />
            </div>
            <h3 className="text-xl font-bold">Ingestion Failed</h3>
            <p className="text-sm text-text-secondary bg-surface-2 rounded-xl p-3 font-mono">{error}</p>
            <button onClick={reset} className="btn btn-secondary mt-2">Try Again</button>
          </div>
        )}

      </div>
    </div>
  );
}
