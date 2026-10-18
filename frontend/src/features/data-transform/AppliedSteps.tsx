import { CircleAlert, LoaderCircle, Plus, Settings2, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { OPS, stepLabel, type Table } from "../../lib/transforms/transforms";
import type { Snapshot, StepEntry } from "./usePipeline";

interface AppliedStepsProps {
  sourceName: string;
  src: Table | null;
  steps: StepEntry[];
  snapshots: Snapshot[];
  viewIndex: number;            // -1 = source
  datasetName: (id: string) => string;
  onView: (index: number) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

/** Power Query-style "Applied steps": what was done, in order, and what each step changed. */
export function AppliedSteps({ sourceName, src, steps, snapshots, viewIndex, datasetName, onView, onEdit, onRemove, onAdd }: AppliedStepsProps) {
  const sizeAt = (i: number) => {
    const t = i < 0 ? src : snapshots[i]?.table;
    return t ? { rows: t.rows.length, cols: t.columns.length } : null;
  };

  return (
    <section aria-label="Applied steps" className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <h2 className="text-[13px] font-semibold">Applied steps</h2>
        <button className="btn-icon size-7" onClick={onAdd} aria-label="Add step" title="Add step (Ctrl K)"><Plus size={15} /></button>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto py-1">
        <StepRow
          index={-1}
          name="Source"
          detail={sourceName}
          size={sizeAt(-1)}
          active={viewIndex === -1}
          onView={() => onView(-1)}
        />
        {steps.map((s, i) => {
          const isOther = s.op === "join" || s.op === "append";
          const detail = isOther
            ? `${datasetName(String(s.params.dataset_id ?? ""))}${s.op === "join" ? ` · ${s.params.left_on} = ${s.params.right_on}` : ""}`
            : stepLabel(s.op, s.params);
          return (
            <StepRow
              key={s.id}
              index={i}
              name={OPS[s.op]?.label ?? s.op}
              detail={detail}
              size={sizeAt(i)}
              before={sizeAt(i - 1)}
              pending={!snapshots[i]}
              error={snapshots[i]?.error}
              active={viewIndex === i}
              onView={() => onView(i)}
              onEdit={() => onEdit(i)}
              onRemove={() => onRemove(i)}
            />
          );
        })}
      </ol>
      {steps.length === 0 && (
        <p className="border-t border-border px-3 py-3 text-xs text-text-tertiary">
          No steps yet. Use the ribbon above, a column header menu, or Ctrl K.
        </p>
      )}
    </section>
  );
}

function delta(before: number, after: number, unit: string) {
  const d = after - before;
  if (!d) return null;
  return (
    <span className={d < 0 ? "text-signal" : "text-primary"}>
      {d > 0 ? "+" : "−"}{formatCount(Math.abs(d))} {unit}{Math.abs(d) === 1 ? "" : "s"}
    </span>
  );
}

function StepRow({ index, name, detail, size, before, pending, error, active, onView, onEdit, onRemove }: {
  index: number;
  name: string;
  detail: string;
  size: { rows: number; cols: number } | null;
  before?: { rows: number; cols: number } | null;
  pending?: boolean;
  error?: string;
  active: boolean;
  onView: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const rows = before && size ? delta(before.rows, size.rows, "row") : null;
  const cols = before && size ? delta(before.cols, size.cols, "column") : null;
  return (
    <li className={cn("group relative mx-1.5 rounded-md", active ? "bg-primary-muted" : "hover:bg-surface-2")}>
      <button onClick={onView} aria-current={active ? "step" : undefined} className="block w-full px-2.5 py-1.5 pr-16 text-left">
        <span className={cn("flex items-center gap-1.5 text-[13px]", active ? "font-medium text-primary" : "text-text")}>
          {error && <CircleAlert size={13} className="shrink-0 text-danger" />}
          <span className="truncate">{name}</span>
        </span>
        <span className="block truncate text-xs text-text-tertiary" title={detail}>{detail}</span>
        <span className="tabular mt-0.5 flex gap-2 text-[11px] text-text-tertiary">
          {pending ? (
            <span className="flex items-center gap-1"><LoaderCircle size={10} className="animate-spin" /> previewing</span>
          ) : error ? (
            <span className="text-danger">{error}</span>
          ) : (
            <>
              {index < 0 && size && <span>{formatCount(size.rows)} rows · {size.cols} columns</span>}
              {rows}{cols}
              {index >= 0 && !rows && !cols && <span>no change in size</span>}
            </>
          )}
        </span>
      </button>
      {onEdit && (
        <span className="absolute right-1.5 top-1.5 flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button className="btn-icon size-6" aria-label={`Edit step ${index + 1}: ${name}`} onClick={onEdit}><Settings2 size={13} /></button>
          <button className="btn-icon size-6 hover:text-danger" aria-label={`Remove step ${index + 1}: ${name}`} onClick={onRemove}><X size={13} /></button>
        </span>
      )}
    </li>
  );
}
