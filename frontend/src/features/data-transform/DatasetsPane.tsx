import { Database, FileSpreadsheet, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { isFileSource } from "../../lib/api/ingest";
import type { DatasetSummary } from "../../lib/hooks/useDatasets";

interface DatasetsPaneProps {
  datasets: DatasetSummary[];
  currentId: string;
  /** In import review the staged data isn't a saved dataset yet; it's listed on its own. */
  importName?: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onMerge: (id: string) => void;
  onAppend: (id: string) => void;
  disabled?: boolean;
}

export function DatasetsPane({ datasets, currentId, importName, collapsed, onToggle, onOpen, onMerge, onAppend, disabled }: DatasetsPaneProps) {
  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-r border-border bg-surface-2 py-1.5">
        <button className="btn-icon size-7" onClick={onToggle} aria-label="Show datasets" title="Show datasets"><PanelLeftOpen size={15} /></button>
      </div>
    );
  }

  return (
    <aside aria-label="Datasets" className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-surface-2">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <h2 className="text-[13px] font-semibold">Datasets</h2>
        <button className="btn-icon size-7" onClick={onToggle} aria-label="Hide datasets" title="Hide datasets"><PanelLeftClose size={15} /></button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {importName && (
          <li>
            <div className="flex items-center gap-2 rounded-md bg-primary-muted px-2 py-1.5">
              <FileSpreadsheet size={14} className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-primary">{importName}</span>
                <span className="block text-[11px] text-text-tertiary">being imported</span>
              </span>
            </div>
          </li>
        )}
        {datasets.map((d) => {
          const current = !importName && d.id === currentId;
          const Icon = isFileSource(d.source_type) ? FileSpreadsheet : Database;
          return (
            <li key={d.id} className="group relative">
              <button
                onClick={() => !importName && onOpen(d.id)}
                disabled={disabled}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  current ? "bg-primary-muted" : "hover:bg-surface-3",
                  importName && "cursor-default",
                )}
                title={importName ? undefined : current ? d.name : `Open ${d.name}`}
              >
                <Icon size={14} className={cn("shrink-0", current ? "text-primary" : "text-text-tertiary")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px]", current ? "font-medium text-primary" : "text-text")}>{d.name}</span>
                  <span className="tabular block text-[11px] text-text-tertiary">{formatCount(d.latest_row_count)} rows</span>
                </span>
              </button>
              {!current && (
                <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-0.5 rounded-md bg-surface-3 p-0.5 group-hover:flex group-focus-within:flex">
                  <button className="h-6 rounded px-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface hover:text-text" onClick={() => onMerge(d.id)} disabled={disabled} title={`Merge columns from ${d.name}`}>Merge</button>
                  <button className="h-6 rounded px-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface hover:text-text" onClick={() => onAppend(d.id)} disabled={disabled} title={`Append rows from ${d.name}`}>Append</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
