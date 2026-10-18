import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Database, GitMerge, Info, LoaderCircle, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Dialog } from "../../components/shared/Dialog";
import { cn } from "../../lib/cn";
import { useDatasets, type DatasetSummary } from "../../lib/hooks/useDatasets";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { deleteDataset, isFileSource } from "../../lib/api/ingest";
import { formatCount, formatDate, plural } from "../../lib/format";
import type { StudioLaunch } from "../data-transform/launch";
import { AddDataDialog, type AddDataStart } from "./AddDataDialog";
import { DatasetDetail } from "./DatasetDetail";
import { ACCEPTED_FILES, SourceIcon, joinLaunch } from "./sources";

type SourceFilter = "all" | "files" | "databases";
type Notice = { tone: "info" | "error"; text: string };

const FILTERS: [SourceFilter, string][] = [["all", "All"], ["files", "Files"], ["databases", "Databases"]];

export function DataImportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading, refetch, authHeaders } = useDatasets({ includePending: true });

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false); // below lg the list and detail swap
  const [addData, setAddData] = useState<(AddDataStart & { key: number }) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DatasetSummary[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<DatasetSummary | undefined>(undefined);

  // Confirmation passed back from Pipeline Studio after an import/save.
  useEffect(() => {
    const text = (location.state as { notice?: string } | null)?.notice;
    if (!text) return;
    setNotice({ tone: "info", text });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // Drop selections that no longer exist after a refetch or workspace switch.
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => datasets.some((d) => d.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [datasets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return datasets.filter((d) => {
      if (filter === "files" && !isFileSource(d.source_type)) return false;
      if (filter === "databases" && isFileSource(d.source_type)) return false;
      return !q || d.name.toLowerCase().includes(q);
    });
  }, [datasets, filter, query]);

  const active =
    visible.find((d) => d.id === activeId) ?? visible.find((d) => d.version_count > 0) ?? visible[0] ?? null;
  const checkedList = datasets.filter((d) => checked.has(d.id));
  const joinable = checkedList.length === 2 && checkedList.every((d) => d.version_count > 0);

  const openAdd = (start: AddDataStart) => setAddData({ ...start, key: Date.now() });

  function pickFiles(target?: DatasetSummary) {
    pickTarget.current = target;
    fileRef.current?.click();
  }

  function newVersion(ds: DatasetSummary) {
    if (isFileSource(ds.source_type)) pickFiles(ds);
    else openAdd({ source: ds.source_type as AddDataStart["source"], target: ds });
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function select(id: string) {
    setActiveId(id);
    setShowDetail(true);
  }

  const openStudio = (launch: StudioLaunch) => navigate("/app/data-transform", { state: launch });

  async function joinChecked() {
    // The bigger table is usually the one to keep (e.g. orders), the smaller one the lookup (e.g. customers).
    const [base, other] = [...checkedList].sort((a, b) => (b.latest_row_count ?? 0) - (a.latest_row_count ?? 0));
    setJoinBusy(true);
    try {
      openStudio(await joinLaunch(authHeaders, base.id, other.id));
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
      setJoinBusy(false);
    }
  }

  const fileCount = datasets.filter((d) => isFileSource(d.source_type)).length;
  const counts: Record<SourceFilter, number> = { all: datasets.length, files: fileCount, databases: datasets.length - fileCount };
  const empty = !loading && datasets.length === 0;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (!addData) setDragOver(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!addData && e.dataTransfer.files.length) openAdd({ files: Array.from(e.dataTransfer.files) });
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) openAdd({ files, target: pickTarget.current });
        }}
      />

      {/* Toolbar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="text-[15px] font-semibold">Data sources</h1>
        {!loading && <span className="tabular hidden text-[13px] text-text-tertiary sm:inline">{plural(datasets.length, "dataset")}</span>}
        {datasets.length > 0 && (
          <>
            <label className="relative ml-2 min-w-0 max-w-64 flex-1">
              <span className="sr-only">Search datasets</span>
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
              <input className="input pl-8" type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div role="group" aria-label="Filter by source" className="hidden h-8 items-center rounded-md border border-border bg-surface-2 p-0.5 md:inline-flex">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "h-full rounded px-2.5 text-[13px] font-medium transition-colors",
                    filter === key ? "bg-surface text-text shadow-soft-sm" : "text-text-secondary hover:text-text",
                  )}
                >
                  {label} <span className="tabular text-text-tertiary">{counts[key]}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <button className="btn btn-primary ml-auto" onClick={() => openAdd({})}>
          <Plus size={15} /> Add data
        </button>
      </header>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex shrink-0 items-center gap-2.5 border-b px-4 py-1.5 text-[13px]",
            notice.tone === "error" ? "border-danger/20 bg-danger-muted text-danger" : "border-border bg-primary-muted text-text",
          )}
        >
          <Info size={14} className={notice.tone === "error" ? "shrink-0" : "shrink-0 text-primary"} aria-hidden />
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button className="btn-icon size-7 shrink-0" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {empty ? (
        <EmptyWorkspace onUpload={() => pickFiles()} onConnect={() => openAdd({ source: "postgres" })} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* List pane */}
          <section
            aria-label="Datasets"
            className={cn(
              "min-h-0 w-full flex-col bg-surface lg:flex lg:w-[340px] lg:shrink-0 lg:border-r lg:border-border",
              showDetail ? "hidden" : "flex",
            )}
          >
            {checkedList.length > 0 && (
              <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface-2 px-3 text-[13px]">
                <span className="tabular mr-1 text-text-secondary">{checkedList.length} selected</span>
                {joinable && (
                  <button className="btn btn-ghost btn-sm" onClick={joinChecked} disabled={joinBusy}>
                    {joinBusy ? <LoaderCircle size={14} className="animate-spin" /> : <GitMerge size={14} />} Join
                  </button>
                )}
                <button className="btn btn-ghost btn-sm text-danger" onClick={() => setConfirmDelete(checkedList)}>
                  <Trash2 size={14} /> Delete
                </button>
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setChecked(new Set())}>Clear</button>
              </div>
            )}

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {loading && datasets.length === 0
                ? Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="border-b border-border-subtle px-4 py-3">
                      <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface-2" />
                      <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-surface-2" />
                    </li>
                  ))
                : visible.map((ds) => (
                    <DatasetRow
                      key={ds.id}
                      dataset={ds}
                      active={active?.id === ds.id}
                      checked={checked.has(ds.id)}
                      anyChecked={checkedList.length > 0}
                      onSelect={() => select(ds.id)}
                      onToggle={() => toggle(ds.id)}
                      onDiscard={() => setConfirmDelete([ds])}
                    />
                  ))}
              {!loading && visible.length === 0 && (
                <li className="px-4 py-8 text-center text-[13px] text-text-secondary">
                  No datasets match.{" "}
                  <button className="font-medium text-primary hover:underline" onClick={() => { setQuery(""); setFilter("all"); }}>
                    Clear filters
                  </button>
                </li>
              )}
            </ul>
          </section>

          {/* Detail pane */}
          <section
            aria-label="Dataset details"
            className={cn("min-h-0 min-w-0 flex-1 flex-col bg-surface lg:flex", showDetail ? "flex" : "hidden")}
          >
            {active ? (
              <DatasetDetail
                dataset={active}
                authHeaders={authHeaders}
                onBack={() => setShowDetail(false)}
                onOpenStudio={() => openStudio({ mode: "shape", datasetId: active.id })}
                onNewVersion={() => newVersion(active)}
                onDelete={() => setConfirmDelete([active])}
              />
            ) : (
              !loading && <p className="px-6 py-6 text-[13px] text-text-tertiary">Select a dataset to see its rows, columns and history.</p>
            )}
          </section>
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary bg-primary-muted/80">
          <p className="flex items-center gap-2 text-[13px] font-medium text-primary">
            <Upload size={16} aria-hidden /> Drop CSV, Excel or Parquet files to add them
          </p>
        </div>
      )}

      {addData && activeWorkspace && (
        <AddDataDialog
          key={addData.key}
          start={addData}
          datasets={datasets}
          workspaceId={activeWorkspace.id}
          authHeaders={authHeaders}
          onClose={() => { setAddData(null); refetch(); }}
          onLaunch={openStudio}
          onImported={(text) => { setAddData(null); refetch(); setNotice({ tone: "info", text }); }}
        />
      )}

      {confirmDelete && activeWorkspace && (
        <DeleteDialog
          datasets={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              for (const d of confirmDelete) await deleteDataset(authHeaders, activeWorkspace.id, d.id);
            } finally {
              refetch();
            }
            setConfirmDelete(null);
            setChecked(new Set());
            setShowDetail(false);
          }}
        />
      )}
    </div>
  );
}

// ── List row ─────────────────────────────────────────────────────────────────

function DatasetRow({
  dataset: ds, active, checked, anyChecked, onSelect, onToggle, onDiscard,
}: {
  dataset: DatasetSummary;
  active: boolean;
  checked: boolean;
  anyChecked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDiscard: () => void;
}) {
  const pending = ds.version_count === 0;
  return (
    <li
      className={cn(
        "group flex items-center gap-2 border-b border-border-subtle pl-3 pr-2",
        active ? "bg-primary-muted" : "hover:bg-surface-2",
      )}
    >
      <input
        type="checkbox"
        className={cn(
          "size-4 shrink-0 accent-primary transition-opacity focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
          checked || anyChecked ? "opacity-100" : "opacity-0",
        )}
        checked={checked}
        onChange={onToggle}
        aria-label={`Select ${ds.name}`}
      />
      <button
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 text-left focus-visible:outline-offset-[-2px]"
      >
        <SourceIcon type={ds.source_type} className={active ? "shrink-0 text-primary" : "shrink-0 text-text-tertiary"} />
        <span className="min-w-0">
          <span className={cn("block truncate text-[13px] font-medium", active && "text-primary")}>{ds.name}</span>
          <span className="tabular block truncate text-xs text-text-tertiary">
            {pending ? (
              <><span className="text-signal">Not imported</span> · {formatDate(ds.created_at)}</>
            ) : (
              `${formatCount(ds.latest_row_count)} rows · v${ds.version_count} · ${formatDate(ds.created_at)}`
            )}
          </span>
        </span>
      </button>
      {pending && (
        <button className="btn btn-ghost btn-sm shrink-0 text-danger" onClick={onDiscard}>Discard</button>
      )}
    </li>
  );
}

// ── Empty workspace ──────────────────────────────────────────────────────────

function EmptyWorkspace({ onUpload, onConnect }: { onUpload: () => void; onConnect: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-surface px-6 py-10">
      <div className="w-full max-w-md">
        <h2 className="text-[15px] font-semibold">No data sources yet</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Upload a file or read a table from a database. You'll review the rows before anything is saved, and drop files anywhere on this page to start.
        </p>
        <dl className="mt-5 divide-y divide-border-subtle border-y border-border-subtle text-[13px]">
          <div className="flex gap-4 py-2">
            <dt className="w-20 shrink-0 text-text-tertiary">Files</dt>
            <dd>CSV, Excel (.xlsx), Parquet</dd>
          </div>
          <div className="flex gap-4 py-2">
            <dt className="w-20 shrink-0 text-text-tertiary">Databases</dt>
            <dd>PostgreSQL, MySQL, Snowflake, SQL Server</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={onUpload}><Upload size={15} /> Upload files</button>
          <button className="btn btn-secondary" onClick={onConnect}><Database size={15} /> Connect database</button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation ──────────────────────────────────────────────────────

function DeleteDialog({ datasets, onClose, onConfirm }: { datasets: DatasetSummary[]; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const many = datasets.length > 1;

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

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
          <button className="btn btn-danger" onClick={confirm} disabled={busy}>
            {busy && <LoaderCircle size={15} className="animate-spin" />} Delete
          </button>
        </>
      }
    >
      {many && (
        <ul className="mb-3 divide-y divide-border-subtle rounded-md border border-border text-[13px]">
          {datasets.map((d) => <li key={d.id} className="truncate px-3 py-1.5 font-medium">{d.name}</li>)}
        </ul>
      )}
      <p className="text-[13px] text-text-secondary">
        All versions and stored files are removed. Datasets built from {many ? "these" : "it"} keep their own copies. This can't be undone.
      </p>
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-muted px-3 py-2 text-[13px] text-danger">{error}</p>}
    </Dialog>
  );
}
