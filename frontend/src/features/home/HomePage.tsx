import { Link } from "react-router-dom";
import { ChartColumn, ChevronRight, Database, FileSpreadsheet, SquareTerminal, Upload, Workflow } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { useDatasets } from "../../lib/hooks/useDatasets";
import { isFileSource } from "../../lib/api/ingest";
import { formatCount, formatDate } from "../../lib/format";

const ACTIONS = [
  { to: "/app/data-import", Icon: Upload, title: "Bring in data", body: "Upload a CSV, Excel or Parquet file, or read a database table." },
  { to: "/app/data-transform", Icon: Workflow, title: "Shape a dataset", body: "Clean, filter, join and summarize with a live preview." },
  { to: "/app/query-studio", Icon: SquareTerminal, title: "Query with SQL", body: "Run read-only queries against the latest version." },
  { to: "/app/eda-dashboards", Icon: ChartColumn, title: "Chart a column", body: "Build quick charts from any dataset." },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const SOURCE_LABELS: Record<string, string> = {
  csv: "CSV", xlsx: "Excel", parquet: "Parquet", postgres: "PostgreSQL", mysql: "MySQL", snowflake: "Snowflake", mssql: "SQL Server",
};
const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

export function HomePage() {
  const { user } = useAuthContext();
  const { activeWorkspace } = useWorkspaceContext();
  const { datasets, loading } = useDatasets();

  const totalRows = datasets.reduce((n, d) => n + (d.latest_row_count ?? 0), 0);
  const totalVersions = datasets.reduce((n, d) => n + d.version_count, 0);
  const recent = [...datasets].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  const empty = !loading && datasets.length === 0;

  return (
    <div>
      <PageHeader
        title={user ? `${greeting()}, ${user.username}` : greeting()}
        subtitle={activeWorkspace?.name}
        actions={
          <>
            <Link to="/app/data-transform" className="btn btn-secondary">Open Pipeline Studio</Link>
            <Link to="/app/data-import" className="btn btn-primary"><Upload size={14} /> Add data</Link>
          </>
        }
      />

      {!empty && (
        <p className="-mt-2 mb-6 text-[13px] text-text-tertiary">
          {loading ? "Loading…" : (
            <>
              <span className="tabular font-mono text-text-secondary">{formatCount(datasets.length)}</span> {datasets.length === 1 ? "dataset" : "datasets"}
              {" · "}<span className="tabular font-mono text-text-secondary">{formatCount(totalRows)}</span> {totalRows === 1 ? "row" : "rows"}
              {" · "}<span className="tabular font-mono text-text-secondary">{formatCount(totalVersions)}</span> {totalVersions === 1 ? "version" : "versions"}
            </>
          )}
        </p>
      )}

      {empty ? (
        <section className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <h2 className="text-base font-semibold">No datasets in {activeWorkspace?.name ?? "this workspace"} yet</h2>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">
            Upload a CSV, Excel or Parquet file, or read a table from a database. You review the columns before anything is saved.
          </p>
          <Link to="/app/data-import" className="btn btn-primary mt-4"><Upload size={14} /> Add data</Link>
        </section>
      ) : (
        <section aria-labelledby="recent-heading" className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="recent-heading" className="text-sm font-semibold">Recent datasets</h2>
            <Link to="/app/data-import" className="text-[13px] text-primary hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-tertiary">
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Rows</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Versions</th>
                  <th scope="col" className="px-3 py-2 font-medium">Created</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="px-4 py-4"><div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" /></td></tr>
                )}
                {recent.map((d) => (
                  <tr key={d.id} className="table-row last:border-0">
                    <td className="max-w-72 px-4 py-2">
                      <span className="flex items-center gap-2">
                        {isFileSource(d.source_type)
                          ? <FileSpreadsheet size={14} className="shrink-0 text-text-tertiary" aria-hidden="true" />
                          : <Database size={14} className="shrink-0 text-text-tertiary" aria-hidden="true" />}
                        <span className="truncate font-medium">{d.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{sourceLabel(d.source_type)}</td>
                    <td className="tabular px-3 py-2 text-right font-mono text-[12.5px]">{formatCount(d.latest_row_count)}</td>
                    <td className="tabular px-3 py-2 text-right font-mono text-[12.5px]">{d.version_count}</td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-text-secondary">{formatDate(d.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <Link to="/app/data-transform" state={{ mode: "shape", datasetId: d.id }} className="btn btn-ghost btn-sm" aria-label={`Shape ${d.name} in Pipeline Studio`}>
                        Shape
                      </Link>
                      <Link to="/app/query-studio" className="btn btn-ghost btn-sm" aria-label={`Query ${d.name} in Query Studio`}>
                        Query
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="start-heading" className={empty ? "mt-8" : undefined}>
        <h2 id="start-heading" className="mb-2 text-sm font-semibold">Start something</h2>
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface">
          {ACTIONS.map(({ to, Icon, title, body }) => (
            <li key={to}>
              <Link to={to} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 focus-visible:-outline-offset-2">
                <Icon size={16} className="shrink-0 text-text-tertiary group-hover:text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{title}</span>
                  <span className="block truncate text-xs text-text-tertiary">{body}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-text-tertiary" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
