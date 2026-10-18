/** Left-to-right DAG layout for the lineage graph: column = dependency depth. */

export const NODE_W = 232;
export const NODE_H = 58;
const GAP_X = 96;
const GAP_Y = 18;
const PAD = 24;

export interface LayoutEdge { source: string; target: string }
export interface Point { x: number; y: number }

export function layoutGraph(nodeIds: string[], edges: LayoutEdge[], names: Record<string, string> = {}) {
  const ids = new Set(nodeIds);
  const inputs = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    inputs.set(e.target, [...(inputs.get(e.target) ?? []), e.source]);
  }

  // Depth = 1 + deepest input; a node on a cycle is treated as a root (depth 0).
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(inputs.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  nodeIds.forEach(depthOf);

  const columns: string[][] = [];
  for (const id of nodeIds) (columns[depth.get(id)!] ??= []).push(id);

  // First column alphabetical; later columns ordered by the average row of their inputs.
  const row = new Map<string, number>();
  const byName = (a: string, b: string) => (names[a] ?? a).localeCompare(names[b] ?? b);
  columns.forEach((col, ci) => {
    if (ci === 0) col.sort(byName);
    else {
      const bary = (id: string) => {
        const ins = (inputs.get(id) ?? []).filter((s) => row.has(s));
        return ins.length ? ins.reduce((n, s) => n + row.get(s)!, 0) / ins.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => bary(a) - bary(b) || byName(a, b));
    }
    col.forEach((id, i) => row.set(id, i));
  });

  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0));
  const blockH = (n: number) => n * NODE_H + (n - 1) * GAP_Y;
  const positions = new Map<string, Point>();
  columns.forEach((col, ci) => {
    const offset = (blockH(tallest) - blockH(col.length)) / 2; // centre shorter columns
    col.forEach((id, i) => positions.set(id, { x: PAD + ci * (NODE_W + GAP_X), y: PAD + offset + i * (NODE_H + GAP_Y) }));
  });

  return {
    positions,
    width: PAD * 2 + Math.max(1, columns.length) * NODE_W + Math.max(0, columns.length - 1) * GAP_X,
    height: PAD * 2 + blockH(tallest),
  };
}

/** Every node upstream and downstream of `id` (inclusive), for highlighting a path. */
export function relatedNodes(id: string, edges: LayoutEdge[]): Set<string> {
  const out = new Set([id]);
  const walk = (start: string, next: (n: string) => string[]) => {
    const stack = [start];
    while (stack.length) {
      for (const n of next(stack.pop()!)) if (!out.has(n)) { out.add(n); stack.push(n); }
    }
  };
  walk(id, (n) => edges.filter((e) => e.target === n).map((e) => e.source));
  walk(id, (n) => edges.filter((e) => e.source === n).map((e) => e.target));
  return out;
}
