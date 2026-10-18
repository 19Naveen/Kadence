import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowDownAZ, ArrowUpAZ, Calculator, CaseSensitive, ChevronDown, Columns3, Combine, Copy, Eraser, Filter, Hash,
  ListChecks, ListX, Merge, PaintBucket, Pencil, Rows3, Search, Sigma, SplitSquareHorizontal, Trash2, Type, CalendarDays,
  Replace, Ruler,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { TransformParams } from "../../lib/transforms/transforms";

/** A command either applies instantly (needs a selected column) or opens a dialog for `op`. */
export interface Command {
  label: string;
  op: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  /** Params for an instant step; `$col` is replaced by the selected column. */
  instant?: TransformParams;
  needsColumn?: boolean;
  title?: string;
}

type Item = Command | { menu: string; Icon: Command["Icon"]; items: Command[] };
type Group = Item[];

const TABS: { key: string; label: string; groups: Group[] }[] = [
  {
    key: "home",
    label: "Home",
    groups: [
      [
        { label: "Choose columns", op: "select", Icon: Columns3 },
        { label: "Remove column", op: "drop", Icon: Trash2, instant: { column: "$col" }, needsColumn: true },
      ],
      [
        { label: "Filter rows", op: "filter", Icon: Filter },
        { label: "Keep first rows", op: "keeptop", Icon: Rows3 },
        {
          menu: "Remove rows", Icon: ListX, items: [
            { label: "Remove empty rows", op: "dropnulls", Icon: Eraser, instant: { column: "$col" }, needsColumn: true, title: "Rows where the selected column is empty" },
            { label: "Remove duplicates", op: "dedupe", Icon: ListChecks, instant: {} },
          ],
        },
      ],
      [
        { label: "Sort ascending", op: "sort", Icon: ArrowDownAZ, instant: { column: "$col", direction: "asc" }, needsColumn: true },
        { label: "Sort descending", op: "sort", Icon: ArrowUpAZ, instant: { column: "$col", direction: "desc" }, needsColumn: true },
      ],
      [{ label: "Group by", op: "group", Icon: Sigma }],
    ],
  },
  {
    key: "transform",
    label: "Transform",
    groups: [
      [
        { label: "Data type", op: "cast", Icon: Hash },
        { label: "Rename", op: "rename", Icon: Pencil },
      ],
      [
        { label: "Replace values", op: "replace", Icon: Replace },
        { label: "Fill empty", op: "fillna", Icon: PaintBucket },
      ],
      [
        { label: "Split column", op: "split", Icon: SplitSquareHorizontal },
        {
          menu: "Format text", Icon: CaseSensitive, items: [
            { label: "UPPERCASE", op: "upper", Icon: Type, instant: { column: "$col" }, needsColumn: true },
            { label: "lowercase", op: "lower", Icon: Type, instant: { column: "$col" }, needsColumn: true },
            { label: "Capitalize Each Word", op: "capitalize", Icon: Type, instant: { column: "$col" }, needsColumn: true },
            { label: "Trim whitespace", op: "trim", Icon: Type, instant: { column: "$col" }, needsColumn: true },
            { label: "Extract characters…", op: "extract", Icon: Type },
          ],
        },
        {
          menu: "Number", Icon: Calculator, items: [
            { label: "Round…", op: "round", Icon: Calculator },
            { label: "Absolute value", op: "abs", Icon: Calculator, instant: { column: "$col" }, needsColumn: true },
            { label: "Arithmetic…", op: "math", Icon: Calculator },
            { label: "Standardize (z-score)", op: "zscore", Icon: Calculator, instant: { column: "$col" }, needsColumn: true },
          ],
        },
      ],
    ],
  },
  {
    key: "add",
    label: "Add column",
    groups: [
      [
        { label: "Calculated column", op: "calc", Icon: Calculator },
        { label: "Merge columns", op: "merge", Icon: Combine },
        { label: "Duplicate column", op: "duplicate", Icon: Copy, instant: { column: "$col" }, needsColumn: true },
      ],
      [
        { label: "Text length", op: "length", Icon: Ruler, instant: { column: "$col" }, needsColumn: true },
        { label: "Date part", op: "datepart", Icon: CalendarDays },
      ],
    ],
  },
  {
    key: "combine",
    label: "Combine",
    groups: [
      [
        { label: "Merge datasets", op: "join", Icon: Merge, title: "Add columns from another dataset by matching a key" },
        { label: "Append datasets", op: "append", Icon: Rows3, title: "Stack rows from another dataset" },
      ],
    ],
  },
];

interface RibbonProps {
  selectedColumn: string | null;
  disabled: boolean;
  onCommand: (cmd: Command) => void;
  onSearch: () => void;
}

export function Ribbon({ selectedColumn, disabled, onCommand, onSearch }: RibbonProps) {
  const [tab, setTab] = useState("home");
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="border-b border-border bg-surface">
      <div role="tablist" aria-label="Commands" className="flex items-end gap-1 px-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px h-8 border-b-2 px-2.5 text-[13px] transition-colors",
              tab === t.key ? "border-primary font-medium text-text" : "border-transparent text-text-secondary hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={onSearch} className="mb-1 flex h-7 items-center gap-2 rounded-md border border-border px-2 text-xs text-text-tertiary hover:bg-surface-2 hover:text-text-secondary">
          <Search size={13} /> Search steps <span className="kbd">Ctrl K</span>
        </button>
      </div>
      <div role="toolbar" aria-label={`${current.label} commands`} className="flex h-11 items-center gap-1 overflow-x-auto border-t border-border-subtle px-2">
        {current.groups.map((group, gi) => (
          <div key={gi} className={cn("flex shrink-0 items-center gap-0.5", gi > 0 && "ml-0.5 border-l border-border pl-1.5")}>
            {group.map((item) =>
              "menu" in item ? (
                <MenuButton key={item.menu} label={item.menu} Icon={item.Icon} items={item.items} selectedColumn={selectedColumn} disabled={disabled} onCommand={onCommand} />
              ) : (
                <CommandButton key={item.label} cmd={item} selectedColumn={selectedColumn} disabled={disabled} onCommand={onCommand} />
              ),
            )}
          </div>
        ))}
        <span className="ml-auto hidden min-w-0 shrink truncate pl-3 text-xs text-text-tertiary xl:block">
          {selectedColumn ? <>Column: <span className="font-mono text-text-secondary">{selectedColumn}</span></> : "Select a column to use column commands"}
        </span>
      </div>
    </div>
  );
}

function CommandButton({ cmd, selectedColumn, disabled, onCommand }: { cmd: Command; selectedColumn: string | null; disabled: boolean; onCommand: (c: Command) => void }) {
  const off = disabled || (cmd.instant && cmd.needsColumn && !selectedColumn && !hasDialogFallback(cmd));
  return (
    <button
      onClick={() => onCommand(cmd)}
      disabled={off}
      title={cmd.title ?? (cmd.needsColumn && !selectedColumn ? `${cmd.label} — select a column first` : cmd.label)}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-text hover:bg-surface-2 disabled:opacity-40"
    >
      <cmd.Icon size={15} className="text-text-secondary" />
      {cmd.label}
    </button>
  );
}

/** Column commands that also have a dialog (drop, sort…) stay enabled without a selection. */
function hasDialogFallback(cmd: Command) {
  return ["drop", "sort", "dropnulls", "duplicate", "length", "upper", "lower", "capitalize", "trim", "abs", "zscore"].includes(cmd.op);
}

function MenuButton({ label, Icon, items, selectedColumn, disabled, onCommand }: {
  label: string; Icon: Command["Icon"]; items: Command[]; selectedColumn: string | null; disabled: boolean; onCommand: (c: Command) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-text hover:bg-surface-2 disabled:opacity-40"
      >
        <Icon size={15} className="text-text-secondary" /> {label} <ChevronDown size={12} className="text-text-tertiary" />
      </button>
      {open && (
        <div role="menu" className="fixed z-50 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-soft-lg">
          {items.map((c) => (
            <button
              key={c.label}
              role="menuitem"
              onClick={() => { setOpen(false); onCommand(c); }}
              className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[13px] hover:bg-surface-2"
            >
              {c.label}
              {c.instant && c.needsColumn && selectedColumn && <span className="text-xs text-text-tertiary">{selectedColumn}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
