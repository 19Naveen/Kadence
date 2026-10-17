import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import type { Table, TransformParams } from "../../lib/transforms/transforms";
import { TypeChip } from "./StepEditor";

export interface QuickAction {
  label: string;
  op: string;
  params?: TransformParams;   // instant actions apply these directly
  instant?: boolean;
}

function quickActions(col: string, type: string, nulls: number): QuickAction[] {
  const isText = type === "string";
  const isNum = type === "integer" || type === "decimal";
  return [
    { label: "Sort ascending", op: "sort", params: { column: col, direction: "asc" }, instant: true },
    { label: "Sort descending", op: "sort", params: { column: col, direction: "desc" }, instant: true },
    { label: "Filter rows…", op: "filter" },
    { label: "Rename…", op: "rename" },
    { label: "Change type…", op: "cast" },
    ...(nulls > 0
      ? [
          { label: "Remove rows where empty", op: "dropnulls", params: { column: col }, instant: true },
          { label: "Fill empty values…", op: "fillna" },
        ]
      : []),
    ...(isText
      ? [
          { label: "Trim whitespace", op: "trim", params: { column: col }, instant: true },
          { label: "Find & replace…", op: "replace" },
          { label: "Split column…", op: "split" },
        ]
      : []),
    ...(isNum ? [{ label: "Round…", op: "round" }, { label: "Calculated column…", op: "calc" }] : []),
    { label: "Group by this column…", op: "group" },
    { label: "Drop column", op: "drop", params: { column: col }, instant: true },
  ];
}

interface DataGridProps {
  table: Table;
  /** Columns present before the step being viewed; new ones are highlighted. */
  previousColumns?: string[];
  maxRows?: number;
  onAction: (column: string, action: QuickAction) => void;
}

export function DataGrid({ table, previousColumns, maxRows = 100, onAction }: DataGridProps) {
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [menu]);

  const rows = table.rows.slice(0, maxRows);
  const prev = previousColumns ? new Set(previousColumns) : null;

  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-20 w-12 border-b border-r border-border bg-surface-2 px-3 py-2 text-right font-mono text-[11px] font-medium text-text-tertiary">#</th>
          {table.columns.map((col, ci) => {
            const nulls = table.rows.reduce((n, r) => n + (r[ci] === null || r[ci] === undefined ? 1 : 0), 0);
            const filled = table.rows.length ? Math.round(((table.rows.length - nulls) / table.rows.length) * 100) : 100;
            const isNew = prev && !prev.has(col.name);
            const open = menu === col.name;
            return (
              <th key={col.name + ci} className={cn("sticky top-0 border-b border-r border-border bg-surface-2 p-0 text-left font-normal", open ? "z-30" : "z-10")}>
                <button
                  onClick={() => setMenu(open ? null : col.name)}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={cn("block w-full min-w-[140px] px-3 pb-1.5 pt-2 text-left hover:bg-surface-3", isNew && "shadow-[inset_0_-2px_0_hsl(var(--signal))]")}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1 font-semibold text-text">
                      <span className="truncate">{col.name}</span>
                      <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
                    </span>
                    <TypeChip type={col.type} />
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-signal/25" title={`${filled}% filled · ${nulls} empty`}>
                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${filled}%` }} />
                  </span>
                </button>
                {open && (
                  <div ref={menuRef} role="menu" className="absolute left-2 top-full z-40 mt-1 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-soft-lg animate-scale-in">
                    <p className="section-label px-2 pb-1 pt-1.5">{col.name}</p>
                    {quickActions(col.name, col.type, nulls).map((a) => (
                      <button
                        key={a.label}
                        role="menuitem"
                        onClick={() => { setMenu(null); onAction(col.name, a); }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
                      >
                        {a.label}
                        {a.instant && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">instant</span>}
                      </button>
                    ))}
                  </div>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="hover:bg-surface-2/60">
            <td className="sticky left-0 border-b border-r border-border-subtle bg-surface px-3 py-1.5 text-right font-mono text-[11px] text-text-tertiary">{ri + 1}</td>
            {row.map((cell, ci) => {
              const empty = cell === null || cell === undefined;
              return (
                <td key={ci} className={cn("max-w-[320px] truncate border-b border-r border-border-subtle px-3 py-1.5 font-mono", empty ? "italic text-text-tertiary" : "text-text")}>
                  {empty ? "empty" : String(cell)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
