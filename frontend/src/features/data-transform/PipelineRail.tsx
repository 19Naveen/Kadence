import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { OPS, stepLabel, type Table } from "../../lib/transforms/transforms";
import type { Snapshot, StepEntry } from "./usePipeline";

interface PipelineRailProps {
  sourceLabel: string;
  src: Table | null;
  steps: StepEntry[];
  snapshots: Snapshot[];
  viewIndex: number;            // -1 = source
  editingIndex: number | null;
  datasetName: (id: string) => string;
  onView: (index: number) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

/** The signature element: the pipeline as a line of stations, each labelled with what it did to the data. */
export function PipelineRail({
  sourceLabel, src, steps, snapshots, viewIndex, editingIndex, datasetName, onView, onEdit, onRemove, onAdd,
}: PipelineRailProps) {
  const sizeAt = (i: number) => {
    const t = i < 0 ? src : snapshots[i]?.table;
    return t ? { rows: t.rows.length, cols: t.columns.length } : null;
  };

  return (
    <nav aria-label="Pipeline steps" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="section-label">Pipeline</h2>
        <span className="text-xs text-text-tertiary">{steps.length ? `${steps.length} step${steps.length > 1 ? "s" : ""}` : "No steps yet"}</span>
      </div>

      <ol className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <Station
          index={-1}
          title="Source"
          subtitle={sourceLabel}
          size={sizeAt(-1)}
          active={viewIndex === -1}
          onClick={() => onView(-1)}
          last={steps.length === 0}
        />
        {steps.map((s, i) => {
          const before = sizeAt(i - 1);
          const after = sizeAt(i);
          const snap = snapshots[i];
          const label = s.op === "join" || s.op === "append"
            ? `${OPS[s.op]?.label ?? s.op}: ${datasetName(String(s.params.dataset_id ?? ""))}`
            : stepLabel(s.op, s.params);
          return (
            <Station
              key={s.id}
              index={i}
              title={label}
              subtitle={s.op === "join" ? `${s.params.how} join on ${s.params.left_on} = ${s.params.right_on}` : OPS[s.op]?.label}
              size={after}
              before={before}
              pending={!snap}
              error={snap?.error}
              active={viewIndex === i}
              editing={editingIndex === i}
              onClick={() => onView(i)}
              onEdit={() => onEdit(i)}
              onRemove={() => onRemove(i)}
              last={i === steps.length - 1}
            />
          );
        })}
        <li className="relative pl-7 pt-3">
          <button onClick={onAdd} className="btn btn-secondary btn-sm w-full justify-start border-dashed">
            <Plus size={14} /> Add step <span className="kbd ml-auto">/</span>
          </button>
        </li>
      </ol>
    </nav>
  );
}

function Delta({ before, after, unit }: { before: number; after: number; unit: string }) {
  const d = after - before;
  if (d === 0) return null;
  return (
    <span className={cn("badge font-mono", d < 0 ? "bg-signal-muted text-signal" : "bg-primary-muted text-primary")}>
      {d > 0 ? "+" : "−"}{formatCount(Math.abs(d))} {unit}{Math.abs(d) === 1 ? "" : "s"}
    </span>
  );
}

function Station({
  index, title, subtitle, size, before, pending, error, active, editing, onClick, onEdit, onRemove, last,
}: {
  index: number;
  title: string;
  subtitle?: string;
  size: { rows: number; cols: number } | null;
  before?: { rows: number; cols: number } | null;
  pending?: boolean;
  error?: string;
  active: boolean;
  editing?: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  last: boolean;
}) {
  const isSource = index < 0;
  return (
    <li className="group relative pl-7">
      {/* The line connecting stations */}
      {!last && <span aria-hidden className="absolute bottom-0 left-[9px] top-5 w-0.5 bg-signal/35" />}
      {!isSource && <span aria-hidden className="absolute left-[9px] top-0 h-5 w-0.5 bg-signal/35" />}
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-3.5 flex size-[16px] items-center justify-center rounded-full border-2 bg-surface",
          error ? "border-danger" : active ? "border-signal bg-signal" : "border-signal",
        )}
      />
      <div
        className={cn(
          "my-1 rounded-lg border px-3 py-2 transition-colors",
          editing ? "border-primary bg-primary-muted/50" : active ? "border-signal/50 bg-signal-muted/50" : "border-transparent hover:bg-surface-2",
        )}
      >
        <div className="flex items-start gap-2">
          <button onClick={onClick} className="min-w-0 flex-1 text-left" aria-current={active ? "step" : undefined}>
            <span className="block truncate text-sm font-semibold" title={title}>{title}</span>
            {subtitle && <span className="block truncate text-xs text-text-tertiary">{subtitle}</span>}
          </button>
          {!isSource && (
            <span className="flex shrink-0 gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button className="btn-icon size-7" aria-label={`Edit step ${index + 1}`} onClick={onEdit}><Pencil size={13} /></button>
              <button className="btn-icon size-7 hover:text-danger" aria-label={`Remove step ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></button>
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {pending ? (
            <span className="flex items-center gap-1 text-xs text-text-tertiary"><LoaderCircle size={11} className="animate-spin" /> previewing</span>
          ) : error ? (
            <span className="text-xs text-danger">{error}</span>
          ) : size ? (
            <>
              <span className="tabular font-mono text-[11px] text-text-tertiary">{formatCount(size.rows)} × {size.cols}</span>
              {before && <Delta before={before.rows} after={size.rows} unit="row" />}
              {before && <Delta before={before.cols} after={size.cols} unit="col" />}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
