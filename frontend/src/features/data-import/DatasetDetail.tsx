import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, GitMerge, LoaderCircle, MoreHorizontal, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { cn } from "../../lib/cn";
import { useQueryApi, type DatasetPreview, type DatasetSummary } from "../../lib/hooks/useDatasets";
import { fetchLineage, isFileSource, listVersions, type DatasetVersion, type LineageNode } from "../../lib/api/ingest";
import { formatBytes, formatCount, formatDate, formatDateTime, plural } from "../../lib/format";
import { SourceIcon, sourceLabel } from "./sources";

const TABS = ["Preview", "Columns", "Versions", "Lineage"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  dataset: DatasetSummary;
  authHeaders: () => Record<string, string>;
  onBack: () => void;
  onOpenStudio: () => void;
  onNewVersion: () => void;
  onDelete: () => void;
}

export function DatasetDetail(props: Props) {
  const { dataset } = props;
  return dataset.version_count === 0 ? <NotImported {...props} /> : <ReadyDetail key={dataset.id} {...props} />;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="btn-icon -ml-2 shrink-0 lg:hidden" aria-label="Back to the list" onClick={onBack}>
      <ArrowLeft size={16} />
    </button>
  );
}

function NotImported({ dataset, onBack, onDelete }: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-border px-6 py-4">
        <BackButton onBack={onBack} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{dataset.name}</h2>
          <p className="text-[13px] text-text-secondary">
            {sourceLabel(dataset.source_type)} · staged {formatDate(dataset.created_at)} · <span className="text-signal">Not imported</span>
          </p>
        </div>
      </header>
      <div className="max-w-lg px-6 py-6 text-[13px] text-text-secondary">
        <p>
          This source was staged, but its import review in Pipeline Studio wasn't finished, so no data was saved.
          Discard it and add the source again to start a fresh review.
        </p>
        <button className="btn btn-secondary mt-4 text-danger" onClick={onDelete}>
          <Trash2 size={15} /> Discard
        </button>
      </div>
    </div>
  );
}

function ReadyDetail({ dataset, authHeaders, onBack, onOpenStudio, onNewVersion, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>("Preview");
  const [versions, setVersions] = useState<DatasetVersion[] | null>(null);
  const [versionsError, setVersionsError] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    setVersionsError("");
    listVersions(authHeaders, dataset.id)
      .then((v) => { if (!cancelled) setVersions(v); })
      .catch((e: Error) => { if (!cancelled) setVersionsError(e.message); });
    return () => { cancelled = true; };
  }, [dataset.id, dataset.version_count, authHeaders]);

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const n = (next + TABS.length) % TABS.length;
    setTab(TABS[n]);
    tabRefs.current[n]?.focus();
  }

  const file = isFileSource(dataset.source_type);

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-6 pb-3 pt-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BackButton onBack={onBack} />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{dataset.name}</h2>
            <p className="tabular truncate text-[13px] text-text-secondary">
              {sourceLabel(dataset.source_type)} · created {formatDate(dataset.created_at)} · {formatBytes(dataset.latest_file_size)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={onOpenStudio}><Workflow size={15} /> Open in Pipeline Studio</button>
          <button
            className="btn btn-secondary"
            onClick={onNewVersion}
            title={file ? "Upload a file as the next version" : "Read the table again as the next version"}
          >
            {file ? <Plus size={15} /> : <RefreshCw size={15} />} New version
          </button>
          <MoreMenu label={`More actions for ${dataset.name}`} onDelete={onDelete} />
        </div>
      </header>

      <div role="tablist" aria-label="Dataset details" onKeyDown={onTabKey} className="flex gap-5 border-b border-border px-6">
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            id={`ds-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`ds-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px h-10 border-b-2 text-[13px] font-medium transition-colors",
              tab === t ? "border-primary text-text" : "border-transparent text-text-secondary hover:text-text",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`ds-panel-${tab}`} aria-labelledby={`ds-tab-${tab}`} className="min-h-0 flex-1 overflow-auto">
        {tab === "Preview" && <PreviewTab dataset={dataset} />}
        {tab === "Columns" && <ColumnsTab versions={versions} error={versionsError} />}
        {tab === "Versions" && <VersionsTab versions={versions} error={versionsError} />}
        {tab === "Lineage" && <LineageTab datasetId={dataset.id} authHeaders={authHeaders} />}
      </div>
    </>
  );
}

function MoreMenu({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button ref={trigger} className="btn-icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-md border border-border bg-surface py-1 shadow-soft-md">
          <button
            role="menuitem"
            autoFocus
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-danger hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
            onClick={() => { setOpen(false); onDelete(); }}
          >
            <Trash2 size={14} /> Delete dataset…
          </button>
        </div>
      )}
    </div>
  );
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 px-6 py-6 text-[13px] text-text-tertiary">
      <LoaderCircle size={14} className="animate-spin" /> {children}
    </p>
  );
}

function Failed({ children }: { children: ReactNode }) {
  return <p role="alert" className="px-6 py-6 text-[13px] text-danger">{children}</p>;
}

// ── Preview ──────────────────────────────────────────────────────────────────

const PREVIEW_ROWS = 50;

function PreviewTab({ dataset }: { dataset: DatasetSummary }) {
  const { preview } = useQueryApi();
  const [data, setData] = useState<DatasetPreview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    preview(dataset.id, PREVIEW_ROWS)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [dataset.id, dataset.version_count, preview]);

  if (error) return <Failed>{error}</Failed>;
  if (!data) return <Loading>Loading preview…</Loading>;
  if (!data.columns.length) return <p className="px-6 py-6 text-[13px] text-text-tertiary">This dataset has no columns.</p>;

  return (
    <div>
      <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-[12.5px]">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 w-12 border-b border-r border-border bg-surface-2 px-3 py-1.5 text-right font-normal text-text-tertiary">
              <span className="sr-only">Row</span>
            </th>
            {data.columns.map((c) => (
              <th key={c} className="sticky top-0 z-10 border-b border-r border-border-subtle bg-surface-2 px-3 py-1.5 text-left align-bottom last:border-r-0">
                <span className="block font-medium text-text">{c}</span>
                <span className="block text-[11px] font-normal text-text-tertiary">{data.dataset_schema[c] ?? ""}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r} className="hover:bg-surface-2/60">
              <td className="tabular border-b border-r border-border-subtle px-3 py-1 text-right text-text-tertiary">{r + 1}</td>
              {row.map((v, c) => (
                <td
                  key={c}
                  className={cn(
                    "max-w-80 truncate whitespace-nowrap border-b border-r border-border-subtle px-3 py-1 last:border-r-0",
                    typeof v === "number" && "tabular text-right",
                  )}
                >
                  {v === null || v === undefined ? <span className="text-text-tertiary">null</span> : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tabular px-6 py-2.5 text-xs text-text-tertiary">
        Showing {formatCount(data.rows.length)} of {plural(dataset.latest_row_count ?? data.rows.length, "row")} from the latest version.
      </p>
    </div>
  );
}

// ── Columns / Versions ───────────────────────────────────────────────────────

const th = "sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-1.5 text-left text-xs font-medium text-text-secondary first:pl-6";
const td = "border-b border-border-subtle px-3 py-1.5 first:pl-6";

function ColumnsTab({ versions, error }: { versions: DatasetVersion[] | null; error: string }) {
  if (error) return <Failed>{error}</Failed>;
  if (!versions) return <Loading>Loading columns…</Loading>;
  const latest = versions[versions.length - 1];
  if (!latest) return <p className="px-6 py-6 text-[13px] text-text-tertiary">No versions yet.</p>;

  // Version where each column first appeared (versions come oldest first).
  const since = new Map<string, number>();
  for (const v of versions) for (const c of Object.keys(v.dataset_schema ?? {})) if (!since.has(c)) since.set(c, v.version);
  const first = versions[0].version;

  return (
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          <th className={cn(th, "w-12 text-right")}>#</th>
          <th className={th}>Column</th>
          <th className={th}>Type</th>
          <th className={th}>Since</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(latest.dataset_schema ?? {}).map(([col, type], i) => {
          const v = since.get(col) ?? latest.version;
          return (
            <tr key={col} className="hover:bg-surface-2/60">
              <td className={cn(td, "tabular text-right font-mono text-text-tertiary")}>{i + 1}</td>
              <td className={cn(td, "font-mono")}>{col}</td>
              <td className={cn(td, "font-mono text-text-secondary")}>{type}</td>
              <td className={cn(td, "text-xs", v > first ? "text-signal" : "text-text-tertiary")}>
                {v > first ? `added in v${v}` : `v${v}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VersionsTab({ versions, error }: { versions: DatasetVersion[] | null; error: string }) {
  if (error) return <Failed>{error}</Failed>;
  if (!versions) return <Loading>Loading versions…</Loading>;
  const latest = versions[versions.length - 1]?.id;
  return (
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          <th className={th}>Version</th>
          <th className={cn(th, "text-right")}>Rows</th>
          <th className={cn(th, "text-right")}>Columns</th>
          <th className={cn(th, "text-right")}>Size</th>
          <th className={th}>Created</th>
        </tr>
      </thead>
      <tbody className="tabular font-mono">
        {[...versions].reverse().map((v) => (
          <tr key={v.id} className="hover:bg-surface-2/60">
            <td className={td}>
              v{v.version}
              {v.id === latest && <span className="badge ml-2 bg-surface-2 font-sans text-text-secondary">latest</span>}
            </td>
            <td className={cn(td, "text-right")}>{formatCount(v.row_count)}</td>
            <td className={cn(td, "text-right")}>{formatCount(v.column_count)}</td>
            <td className={cn(td, "text-right text-text-secondary")}>{formatBytes(v.file_size)}</td>
            <td className={cn(td, "text-text-secondary")}>{formatDateTime(v.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Lineage ──────────────────────────────────────────────────────────────────

function LineageTab({ datasetId, authHeaders }: { datasetId: string; authHeaders: () => Record<string, string> }) {
  const [lineage, setLineage] = useState<LineageNode | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLineage(undefined);
    fetchLineage(authHeaders, datasetId).then((l) => { if (!cancelled) setLineage(l); }, () => { if (!cancelled) setLineage(null); });
    return () => { cancelled = true; };
  }, [datasetId, authHeaders]);

  if (lineage === undefined) return <Loading>Loading lineage…</Loading>;
  if (!lineage) return <p className="px-6 py-6 text-[13px] text-text-tertiary">No lineage is recorded for this dataset.</p>;
  return (
    <div className="px-6 py-4">
      <NodeLine node={lineage} self />
      <EdgeList node={lineage} />
    </div>
  );
}

function origin(node: LineageNode) {
  if (node.sources.length) return "Built in Pipeline Studio";
  return node.origin_detail ? `${sourceLabel(node.source_type)} · ${node.origin_detail}` : sourceLabel(node.source_type);
}

function NodeLine({ node, self }: { node: LineageNode; self?: boolean }) {
  const combined = node.sources.length > 0;
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 text-[13px]">
      {combined ? <GitMerge size={16} className="shrink-0 text-text-secondary" aria-hidden /> : <SourceIcon type={node.source_type} className="shrink-0 text-text-secondary" />}
      <span className={cn("truncate font-medium", self && "text-primary")}>{node.dataset_name}</span>
      <span className="truncate text-text-tertiary">{origin(node)}</span>
    </div>
  );
}

/** Children drawn with 1px connectors: a vertical rail from the parent icon, and an elbow into each child. */
function EdgeList({ node }: { node: LineageNode }) {
  if (!node.sources.length) return null;
  return (
    <ul className="ml-[7px]">
      {node.sources.map((edge, i) => {
        const last = i === node.sources.length - 1;
        return (
          <li key={`${edge.dataset_id}-${i}`} className="relative pl-5">
            {/* rail down to this child's elbow (label line 20px + half the node line 16px), continuing past it unless last */}
            <span aria-hidden className={cn("absolute left-0 top-0 w-px bg-border", last ? "h-9" : "h-full")} />
            <span aria-hidden className="absolute left-0 top-9 h-px w-3.5 bg-border" />
            <p className="h-5 pt-1 font-mono text-[11.5px] leading-4 text-text-tertiary">
              {edge.how === "base" ? "base table" : edge.how === "append" ? "rows appended from" : `${edge.how} join on ${edge.left_on} = ${edge.right_on}`}
            </p>
            {edge.node ? (
              <>
                <NodeLine node={edge.node} />
                <EdgeList node={edge.node} />
              </>
            ) : (
              <p className="flex h-8 items-center text-[13px] text-text-tertiary">{edge.dataset_name} (no longer available)</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
