import { Link } from "react-router-dom";
import { ArrowRight, ChartColumn, Database, FileSpreadsheet, MessageSquareText, Upload, Workflow } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { useDatasets } from "../../lib/hooks/useDatasets";
import { isFileSource } from "../../lib/api/ingest";
import { formatCount, formatDate } from "../../lib/format";

const ACTIONS = [
  { to: "/app/data-import", Icon: Upload, title: "Bring in data", body: "Upload a file or read a database table." },
  { to: "/app/data-transform", Icon: Workflow, title: "Shape a dataset", body: "Clean, filter, join and summarize with a live preview." },
  { to: "/app/query-studio", Icon: MessageSquareText, title: "Ask with SQL", body: "Run read-only queries against the latest version." },
  { to: "/app/eda-dashboards", Icon: ChartColumn, title: "Chart it", body: "Build quick charts from any column." },
];

export function HomePage() {
  const { user } = useAuthContext();
  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading } = useDatasets();

  const totalRows = datasets.reduce((n, d) => n + (d.latest_row_count ?? 0), 0);
  const totalVersions = datasets.reduce((n, d) => n + d.version_count, 0);
  const recent = [...datasets].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title={user ? `Welcome back, ${user.username}` : "Welcome back"}
        subtitle="Pick up where you left off, or bring in something new."
        actions={<Link to="/app/data-import" className="btn btn-primary"><Upload size={15} /> Upload files</Link>}
      />

      <dl className="mb-8 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface">
        {[
          ["Datasets", loading ? "…" : formatCount(datasets.length)],
          ["Rows across latest versions", loading ? "…" : formatCount(totalRows)],
          ["Versions saved", loading ? "…" : formatCount(totalVersions)],
        ].map(([label, value], i) => (
          <div key={label} className={i ? "border-l border-border px-5 py-4" : "px-5 py-4"}>
            <dt className="text-xs text-text-tertiary">{label}</dt>
            <dd className="tabular mt-1 font-mono text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section aria-labelledby="recent-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-heading" className="text-base font-semibold">Recent datasets</h2>
            {datasets.length > 0 && <Link to="/app/data-import" className="text-sm font-semibold text-primary hover:underline">View all</Link>}
          </div>
          {!loading && datasets.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="font-semibold">No datasets in {activeWorkspace?.name ?? "this workspace"} yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-text-secondary">Upload a CSV, Excel or Parquet file, or connect a database. You'll review it before it's saved.</p>
              <Link to="/app/data-import" className="btn btn-primary mt-4"><Upload size={15} /> Bring in data</Link>
            </div>
          ) : (
            <ul className="card divide-y divide-border-subtle p-0">
              {(loading ? [] : recent).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
                    {isFileSource(d.source_type) ? <FileSpreadsheet size={16} /> : <Database size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block text-xs text-text-tertiary">
                      {formatCount(d.latest_row_count)} rows · v{d.version_count} · {formatDate(d.created_at)}
                    </span>
                  </span>
                  <Link
                    to="/app/data-transform"
                    state={{ mode: "shape", datasetId: d.id }}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Shape ${d.name} in Pipeline Studio`}
                  >
                    <Workflow size={14} /> Shape
                  </Link>
                </li>
              ))}
              {loading && <li className="px-4 py-6"><div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" /></li>}
            </ul>
          )}
        </section>

        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="mb-3 text-base font-semibold">What would you like to do?</h2>
          <ul className="space-y-2">
            {ACTIONS.map(({ to, Icon, title, body }) => (
              <li key={to}>
                <Link to={to} className="card card-hover group flex items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary"><Icon size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-xs text-text-secondary">{body}</span>
                  </span>
                  <ArrowRight size={16} className="text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
