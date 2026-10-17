import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "../../lib/cn";
import { CATS, OPS, OP_KEYS } from "../../lib/transforms/transforms";

interface StepPaletteProps {
  open: boolean;
  onClose: () => void;
  onPick: (op: string) => void;
}

/** Searchable list of every transform, grouped by category. Arrow keys + Enter to pick. */
export function StepPalette({ open, onClose, onPick }: StepPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQuery(""); setCursor(0); } }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATS.map((cat) => ({
      cat,
      ops: OP_KEYS.filter((k) => OPS[k].cat === cat).filter((k) => {
        if (!q) return true;
        const o = OPS[k];
        return `${o.label} ${o.desc} ${cat} ${k}`.toLowerCase().includes(q);
      }),
    })).filter((g) => g.ops.length);
  }, [query, open]); // `open` re-reads OPS after the API catalog loads

  const flat = groups.flatMap((g) => g.ops);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && flat[cursor]) { e.preventDefault(); onPick(flat[cursor]); }
    if (e.key === "Escape") onClose();
  }

  let i = -1;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-text/35 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Add a step" className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg animate-scale-in">
        <label className="flex items-center gap-3 border-b border-border px-4">
          <Search size={17} className="text-text-tertiary" />
          <span className="sr-only">Search steps</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search steps — filter, join, rename, group…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
            role="combobox"
            aria-expanded="true"
            aria-controls="step-palette-list"
            aria-activedescendant={flat[cursor] ? `step-opt-${flat[cursor]}` : undefined}
          />
          <span className="kbd">Esc</span>
        </label>
        <div ref={listRef} id="step-palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.cat} className="mb-1">
              <p className="section-label px-2.5 pb-1 pt-2">{g.cat}</p>
              {g.ops.map((k) => {
                i += 1;
                const idx = i;
                const active = idx === cursor;
                return (
                  <button
                    key={k}
                    id={`step-opt-${k}`}
                    data-index={idx}
                    role="option"
                    aria-selected={active}
                    onMouseMove={() => setCursor(idx)}
                    onClick={() => onPick(k)}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left", active ? "bg-primary-muted" : "")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm font-semibold", active && "text-primary")}>{OPS[k].label}</span>
                      <span className="block truncate text-xs text-text-secondary">{OPS[k].desc}</span>
                    </span>
                    {active && <CornerDownLeft size={14} className="shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          ))}
          {!flat.length && <p className="px-3 py-8 text-center text-sm text-text-secondary">No step matches “{query}”.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
