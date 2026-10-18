import { useMemo } from "react";
import { Blocks, Database, FileSpreadsheet } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { isFileSource } from "../../lib/api/ingest";
import type { GraphEdge, GraphNode } from "../../lib/api/models";
import { NODE_H, NODE_W, layoutGraph, relatedNodes } from "./layout";

interface LineageGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const EDGE_STYLE: Record<GraphEdge["role"], { stroke: string; dash?: string }> = {
  base: { stroke: "hsl(var(--text-secondary))" },
  join: { stroke: "hsl(var(--primary))" },
  append: { stroke: "hsl(var(--text-tertiary))", dash: "5 4" },
};

export function LineageGraph({ nodes, edges, selectedId, onSelect }: LineageGraphProps) {
  const names = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n.name])), [nodes]);
  const { positions, width, height } = useMemo(() => layoutGraph(nodes.map((n) => n.id), edges, names), [nodes, edges, names]);
  const related = useMemo(() => (selectedId ? relatedNodes(selectedId, edges) : null), [selectedId, edges]);
  const dim = (id: string) => related !== null && !related.has(id);

  return (
    <div className="relative" style={{ width, height }} onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
        <defs>
          {(["base", "join", "append"] as const).map((r) => (
            <marker key={r} id={`arrow-${r}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={EDGE_STYLE[r].stroke} />
            </marker>
          ))}
        </defs>
        {edges.map((e, i) => {
          const a = positions.get(e.source);
          const b = positions.get(e.target);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x - 2, y2 = b.y + NODE_H / 2;
          const dx = Math.max(40, (x2 - x1) / 2);
          const faded = related !== null && !(related.has(e.source) && related.has(e.target));
          const s = EDGE_STYLE[e.role];
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={s.stroke}
              strokeWidth={1.5}
              strokeDasharray={s.dash}
              markerEnd={`url(#arrow-${e.role})`}
              opacity={faded ? 0.15 : 0.9}
            />
          );
        })}
      </svg>

      {/* Join labels on the highlighted path */}
      {related && edges.filter((e) => e.role === "join" && related.has(e.source) && related.has(e.target)).map((e, i) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        return (
          <span
            key={`l${i}`}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-border bg-surface px-1.5 py-px font-mono text-[10.5px] text-text-secondary"
            style={{ left: (a.x + NODE_W + b.x) / 2, top: (a.y + b.y + NODE_H) / 2 }}
          >
            {e.how} · {e.left_on} = {e.right_on}
          </span>
        );
      })}

      {nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const selected = n.id === selectedId;
        const Icon = n.kind === "model" ? Blocks : isFileSource(n.source_type) ? FileSpreadsheet : Database;
        return (
          <button
            key={n.id}
            onClick={() => onSelect(selected ? null : n.id)}
            aria-pressed={selected}
            className={cn(
              "absolute flex items-center gap-2.5 rounded-md border bg-surface px-3 text-left shadow-soft-sm transition-opacity",
              selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-text-tertiary",
              dim(n.id) && "opacity-35",
            )}
            style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
          >
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded", n.kind === "model" ? "bg-primary-muted text-primary" : "bg-surface-2 text-text-tertiary")}>
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{n.name}</span>
              <span className="tabular block truncate text-[11px] text-text-tertiary">
                {n.kind === "model" ? "Model" : "Source"} · {formatCount(n.row_count)} rows{n.version ? ` · v${n.version}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function GraphLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-text-tertiary">
      {(["base", "join", "append"] as const).map((r) => (
        <span key={r} className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={EDGE_STYLE[r].stroke} strokeWidth="1.5" strokeDasharray={EDGE_STYLE[r].dash} /></svg>
          {r === "base" ? "Base table" : r === "join" ? "Joined in" : "Rows appended"}
        </span>
      ))}
    </div>
  );
}
