import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import type { Table, TransformParams } from "../../lib/transforms/transforms";
import { TypeGlyph } from "./StepFields";

export interface QuickAction {
  label: string;
  op: string;
  params?: TransformParams;   // instant actions apply these directly
  instant?: boolean;
}

function quickActions(col: string, type: string, nulls: number): (QuickAction | "sep")[] {
  const isText = type === "string";
  const isNum = type === "integer" || type === "decimal";
  return [
    { label: "Sort ascending", op: "sort", params: { column: col, direction: "asc" }, instant: true },
    { label: "Sort descending", op: "sort", params: { column: col, direction: "desc" }, instant: true },
    "sep",
    { label: "Filter rows…", op: "filter" },
    ...(nulls > 0 ? [{ label: "Remove empty rows", op: "dropnulls", params: { column: col }, instant: true }, { label: "Fill empty values…", op: "fillna" }] : []),
    "sep",
    { label: "Rename…", op: "rename" },
    { label: "Change type…", op: "cast" },
    ...(isText ? [{ label: "Replace values…", op: "replace" }, { label: "Split column…", op: "split" }, { label: "Trim whitespace", op: "trim", params: { column: col }, instant: true }] : []),
    ...(isNum ? [{ label: "Round…", op: "round" }] : []),
    { label: "Group by…", op: "group" },
    "sep",
    { label: "Duplicate column", op: "duplicate", params: { column: col }, instant: true },
    { label: "Remove column", op: "drop", params: { column: col }, instant: true },
  ];
}

interface Profile { nulls: number; distinct: number; validPct: number }

interface DataGridProps {
  table: Table;
  /** Columns present before the step being viewed; new ones are highlighted. */
  previousColumns?: string[];
  selectedColumn: string | null;
  onSelectColumn: (name: string | null) => void;
  maxRows?: number;
  onAction: (column: string, action: QuickAction) => void;
}

export function DataGrid({ table, previousColumns, selectedColumn, onSelectColumn, maxRows = 100, onAction }: DataGridProps) {
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

  const profiles: Profile[] = useMemo(() => table.columns.map((_, ci) => {
    let nulls = 0;
    const seen = new Set<string>();
    for (const r of table.rows) {
      const v = r[ci];
      if (v === null || v === undefined) nulls += 1;
      else seen.add(String(v));
    }
    const n = table.rows.length;
    return { nulls, distinct: seen.size, validPct: n ? Math.round(((n - nulls) / n) * 100) : 100 };
  }), [table]);

  const rows = table.rows.slice(0, maxRows);
  const prev = previousColumns ? new Set(previousColumns) : null;

  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-20 w-11 border-b border-r border-border bg-surface-2" aria-label="Row number" />
          {table.columns.map((col, ci) => {
            const p = profiles[ci];
            const isNew = prev && !prev.has(col.name);
            const selected = selectedColumn === col.name;
            const open = menu === col.name;
            return (
              <th
                key={col.name + ci}
                onContextMenu={(e) => { e.preventDefault(); onSelectColumn(col.name); setMenu(col.name); }}
                className={cn(
                  "sticky top-0 border-b border-r border-border p-0 text-left font-normal",
                  open ? "z-30" : "z-10",
                  selected ? "bg-primary-muted" : "bg-surface-2",
                  isNew && "shadow-[inset_0_2px_0_hsl(var(--signal))]",
                )}
              >
                <div className="flex min-w-[150px] items-center">
                  <button
                    onClick={() => onSelectColumn(selected ? null : col.name)}
                    aria-pressed={selected}
                    title={isNew ? `${col.name} (added by this step)` : col.name}
                    className={cn("flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-1.5 text-left", selected && "text-primary")}
                  >
                    <TypeGlyph type={col.type} />
                    <span className="truncate font-medium">{col.name}</span>
                  </button>
                  <button
                    onClick={() => setMenu(open ? null : col.name)}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label={`${col.name} column options`}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded text-text-tertiary hover:bg-surface-3 hover:text-text"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
                <div className="px-2 pb-1.5" title={`${p.validPct}% valid · ${p.nulls} empty · ${p.distinct} distinct (preview rows)`}>
                  <div className="flex h-1 overflow-hidden rounded-sm bg-border">
                    <div className="bg-success/70" style={{ width: `${p.validPct}%` }} />
                  </div>
                  <div className="tabular mt-1 flex justify-between gap-2 text-[10.5px] text-text-tertiary">
                    <span className={p.nulls ? "text-signal" : ""}>{p.validPct}% valid</span>
                    <span>{formatCount(p.distinct)} distinct</span>
                  </div>
                </div>
                {open && (
                  <div ref={menuRef} role="menu" className="absolute left-1 top-full z-40 mt-1 w-52 rounded-lg border border-border bg-surface p-1 shadow-soft-lg animate-scale-in">
                    {quickActions(col.name, col.type, p.nulls).map((a, i) =>
                      a === "sep" ? (
                        <div key={`sep${i}`} className="my-1 h-px bg-border" />
                      ) : (
                        <button
                          key={a.label}
                          role="menuitem"
                          onClick={() => { setMenu(null); onAction(col.name, a); }}
                          className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-surface-2"
                        >
                          {a.label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="group">
            <td className="sticky left-0 border-b border-r border-border-subtle bg-surface px-2 py-1 text-right font-mono text-[11px] text-text-tertiary group-hover:bg-surface-2">{ri + 1}</td>
            {row.map((cell, ci) => {
              const empty = cell === null || cell === undefined;
              const selected = table.columns[ci]?.name === selectedColumn;
              return (
                <td
                  key={ci}
                  className={cn(
                    "max-w-[320px] truncate border-b border-r border-border-subtle px-2 py-1 font-mono",
                    selected ? "bg-primary-muted/40" : "group-hover:bg-surface-2/70",
                    empty ? "italic text-text-tertiary" : "text-text",
                  )}
                >
                  {empty ? "null" : String(cell)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
