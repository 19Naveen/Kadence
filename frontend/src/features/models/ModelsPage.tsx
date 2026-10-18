import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Blocks, LoaderCircle, Plus, RefreshCw, RotateCw, Workflow, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { useDatasets, useQueryApi, type DatasetPreview } from "../../lib/hooks/useDatasets";
import { waitForJob } from "../../lib/api/ingest";
import { JOIN_KIND_LABEL, fetchLineageGraph, rebuildModel, type GraphNode, type LineageGraph as Graph } from "../../lib/api/models";
import { formatCount, formatDateTime } from "../../lib/format";
import { stepLabel, type TransformParams } from "../../lib/transforms/transforms";
import { GraphLegend, LineageGraph } from "./LineageGraph";

export function ModelsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceContext();
  const { authHeaders } = useDatasets();
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>((location.state as { select?: string } | null)?.select ?? null);
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);

  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const load = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError("");
    try {
      setGraph(await fetchLineageGraph(authHeaders, activeWorkspace.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, authHeaders]);

  useEffect(() => { load(); }, [load]);

  const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;
  const modelCount = graph?.nodes.filter((n) => n.kind === "model").length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="text-[15px] font-semibold">Models</h1>
        <span className="hidden text-[13px] text-text-tertiary sm:inline">
          {graph ? `${graph.nodes.length - modelCount} sources · ${modelCount} models` : "How your tables are built from each other"}
        </span>
        <span className="flex-1" />
        <span className="hidden lg:block"><GraphLegend /></span>
        <button className="btn-icon" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw size={15} className={cn(loading && "animate-spin")} /></button>
        <Link to="/app/models/new" className="btn btn-primary"><Plus size={14} /> New model</Link>
      </header>

      {notice && (
        <div role="status" className="flex items-center gap-2 border-b border-primary/20 bg-primary-muted px-4 py-1.5 text-[13px] text-primary">
          {notice}
          <button className="ml-auto text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-auto bg-bg" aria-label="Lineage graph">
          {loading && !graph ? (
            <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-tertiary"><LoaderCircle size={15} className="animate-spin" /> Loading lineage…</div>
          ) : error ? (
            <div className="mx-auto max-w-md p-10 text-center">
              <p className="font-medium">Couldn't load the lineage graph</p>
              <p className="mt-1 text-[13px] text-text-secondary">{error}</p>
              <button className="btn btn-secondary mt-4" onClick={load}>Try again</button>
            </div>
          ) : graph && graph.nodes.length === 0 ? (
            <div className="mx-auto max-w-sm p-10 text-center">
              <p className="font-medium">No datasets yet</p>
              <p className="mt-1 text-[13px] text-text-secondary">Import files or database tables first; then join them into models here.</p>
              <Link to="/app/data-import" className="btn btn-primary mt-4">Go to Data sources</Link>
            </div>
          ) : graph ? (
            <>
              {modelCount === 0 && (
                <div className="mx-6 mt-5 flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-[13px]">
                  <Blocks size={16} className="shrink-0 text-text-tertiary" />
                  <span className="text-text-secondary">
                    No models yet. A model joins or appends tables into a new dataset that you can rebuild when its sources change.
                  </span>
                  <Link to="/app/models/new" className="btn btn-secondary btn-sm ml-auto shrink-0">Create a model</Link>
                </div>
              )}
              <LineageGraph nodes={graph.nodes} edges={graph.edges} selectedId={selectedId} onSelect={setSelectedId} />
            </>
          ) : null}
        </section>

        {selected && graph && (
          <aside className="fixed inset-0 z-40 overflow-y-auto bg-surface md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-border">
            <NodeDetail
              node={selected}
              graph={graph}
              onClose={() => setSelectedId(null)}
              onSelect={setSelectedId}
              onRebuilt={(msg) => { setNotice(msg); load(); }}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function NodeDetail({ node, graph, onClose, onSelect, onRebuilt }: {
  node: GraphNode; graph: Graph; onClose: () => void; onSelect: (id: string) => void; onRebuilt: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceContext();
  const { authHeaders } = useDatasets();
  const { preview } = useQueryApi();
  const [sample, setSample] = useState<DatasetPreview | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState("");

  const name = useCallback((id: string | null | undefined) => graph.nodes.find((n) => n.id === id)?.name ?? "a deleted dataset", [graph]);
  const usedBy = useMemo(() => graph.edges.filter((e) => e.source === node.id).map((e) => e.target), [graph, node.id]);

  useEffect(() => {
    let cancelled = false;
    setSample(null);
    setRebuildError("");
    preview(node.id, 8).then((p) => { if (!cancelled) setSample(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [node.id, preview]);

  async function rebuild() {
    if (!activeWorkspace) return;
    setRebuilding(true);
    setRebuildError("");
    try {
      const job = await rebuildModel(authHeaders, activeWorkspace.id, node.id);
      await waitForJob(authHeaders, job.id);
      onRebuilt(`Rebuilt ${node.name} from the latest versions of its inputs.`);
    } catch (e) {
      setRebuildError((e as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

  const recipe = node.model?.steps ?? [];

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-tertiary">{node.kind === "model" ? "Model" : "Source"}</p>
          <h2 className="truncate text-base font-semibold">{node.name}</h2>
          <p className="tabular text-xs text-text-tertiary">
            {formatCount(node.row_count)} rows · {node.column_count ?? "—"} columns{node.version ? ` · v${node.version}` : ""} · updated {formatDateTime(node.updated_at)}
          </p>
        </div>
        <button className="btn-icon -mr-1" onClick={onClose} aria-label="Close details"><X size={16} /></button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
        {node.kind === "model" && (
          <button className="btn btn-primary" onClick={rebuild} disabled={rebuilding || !node.model?.base_dataset_id}
            title={node.model?.base_dataset_id ? "Re-run this model on the latest versions of its inputs" : "The base table wasn't recorded for this model"}>
            {rebuilding ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCw size={14} />} Rebuild
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => navigate("/app/data-transform", { state: { mode: "shape", datasetId: node.id } })}>
          <Workflow size={14} /> Open in Pipeline Studio
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/app/models/new", { state: { baseId: node.id } })}>
          <Plus size={14} /> New model from this
        </button>
      </div>
      {rebuildError && <p role="alert" className="border-b border-danger/30 bg-danger-muted px-4 py-2 text-[13px] text-danger">{rebuildError}</p>}

      {node.kind === "model" ? (
        <section className="border-b border-border px-4 py-3">
          <h3 className="mb-2 text-[13px] font-semibold">How it's built</h3>
          <ol className="space-y-1.5 text-[13px]">
            <RecipeStep n={1}>
              {node.model?.base_dataset_id ? (
                <>Start from <DatasetLink id={node.model.base_dataset_id} name={name(node.model.base_dataset_id)} onSelect={onSelect} /></>
              ) : (
                <span className="text-text-tertiary">Base table not recorded (combined before lineage tracking). Save it again from Pipeline Studio to enable rebuilds.</span>
              )}
            </RecipeStep>
            {recipe.map((raw, i) => {
              const { type, ...params } = raw as { type: string } & TransformParams;
              let text;
              if (type === "join") {
                text = <>{JOIN_KIND_LABEL[String(params.how)] ?? "Join"} <DatasetLink id={String(params.dataset_id)} name={name(String(params.dataset_id))} onSelect={onSelect} /> on <code className="font-mono text-[12px]">{String(params.left_on)} = {String(params.right_on)}</code></>;
              } else if (type === "append") {
                text = <>Append rows from <DatasetLink id={String(params.dataset_id)} name={name(String(params.dataset_id))} onSelect={onSelect} /></>;
              } else {
                text = stepLabel(type, params);
              }
              return <RecipeStep key={i} n={i + 2}>{text}</RecipeStep>;
            })}
          </ol>
          {node.model?.built_at && <p className="mt-2 text-xs text-text-tertiary">Last built {formatDateTime(node.model.built_at)}</p>}
        </section>
      ) : (
        <section className="border-b border-border px-4 py-3 text-[13px]">
          <h3 className="mb-1 font-semibold">Origin</h3>
          <p className="text-text-secondary">
            {["csv", "xlsx", "parquet"].includes(node.source_type) ? `Uploaded ${node.source_type.toUpperCase()} file` : `${node.source_type} table${node.origin_detail ? ` ${node.origin_detail}` : ""}`}
          </p>
        </section>
      )}

      <section className="border-b border-border px-4 py-3 text-[13px]">
        <h3 className="mb-1 font-semibold">Used by</h3>
        {usedBy.length ? (
          <ul className="space-y-0.5">{usedBy.map((id) => <li key={id}><DatasetLink id={id} name={name(id)} onSelect={onSelect} /></li>)}</ul>
        ) : (
          <p className="text-text-tertiary">No models use this dataset yet.</p>
        )}
      </section>

      <section className="px-4 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Preview</h3>
        {!sample ? (
          <p className="flex items-center gap-2 text-[13px] text-text-tertiary"><LoaderCircle size={13} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="overflow-auto rounded-md border border-border">
            <table className="w-max min-w-full text-[12px]">
              <thead className="bg-surface-2">
                <tr>{sample.columns.map((c) => <th key={c} className="border-b border-border px-2 py-1 text-left font-medium">{c}</th>)}</tr>
              </thead>
              <tbody>
                {sample.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    {r.map((v, j) => <td key={j} className={cn("max-w-[160px] truncate px-2 py-1 font-mono", v == null && "italic text-text-tertiary")}>{v == null ? "null" : String(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RecipeStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="tabular w-4 shrink-0 text-right font-mono text-xs leading-5 text-text-tertiary">{n}</span>
      <span className="min-w-0 leading-5">{children}</span>
    </li>
  );
}

function DatasetLink({ id, name, onSelect }: { id: string; name: string; onSelect: (id: string) => void }) {
  return <button className="font-medium text-primary hover:underline" onClick={() => onSelect(id)}>{name}</button>;
}
