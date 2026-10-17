import { useEffect, useRef, useState } from "react";
import { OPS, SERVER_ONLY_OPS, previewStep, type Table, type TransformParams } from "../../lib/transforms/transforms";

export interface StepEntry {
  id: string;
  op: string;
  params: TransformParams;
}

export interface Snapshot {
  table: Table;
  /** Set when the step couldn't be applied; the table then passes through unchanged. */
  error?: string;
}

/** Run `table` through one step. Local ops apply instantly; join/append go to the server. */
export async function runStep(
  table: Table,
  step: Pick<StepEntry, "op" | "params">,
  authHeaders: () => Record<string, string>,
): Promise<Snapshot> {
  try {
    if (SERVER_ONLY_OPS.has(step.op)) return { table: await previewStep(table, step.op, step.params, authHeaders) };
    const apply = OPS[step.op]?.apply;
    if (!apply) return { table, error: "This step can't be previewed." };
    return { table: apply(table, step.params) };
  } catch (e) {
    return { table, error: (e as Error).message };
  }
}

/**
 * Evaluate the whole pipeline over the preview sample, keeping a snapshot after
 * every step so the rail can show what each step did. Server-previewed steps are
 * cached by their input so editing a later step doesn't refetch earlier joins.
 */
export function usePipeline(src: Table | null, steps: StepEntry[], authHeaders: () => Record<string, string>) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const cache = useRef(new Map<string, Snapshot>());

  useEffect(() => {
    cache.current.clear();
  }, [src]);

  useEffect(() => {
    if (!src) { setSnapshots([]); return; }
    let cancelled = false;
    const needsServer = steps.some((s) => SERVER_ONLY_OPS.has(s.op));
    if (needsServer) setEvaluating(true);
    (async () => {
      const out: Snapshot[] = [];
      let current = src;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        let snap: Snapshot;
        if (SERVER_ONLY_OPS.has(step.op)) {
          const key = JSON.stringify(steps.slice(0, i + 1).map((s) => [s.op, s.params]));
          snap = cache.current.get(key) ?? (await runStep(current, step, authHeaders));
          if (!snap.error) cache.current.set(key, snap);
        } else {
          snap = await runStep(current, step, authHeaders);
        }
        if (cancelled) return;
        out.push(snap);
        current = snap.table;
      }
      if (!cancelled) { setSnapshots(out); setEvaluating(false); }
    })();
    return () => { cancelled = true; };
    // steps are compared by content so re-renders with the same plan don't re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, JSON.stringify(steps.map((s) => [s.op, s.params])), authHeaders]);

  // Until a new evaluation lands, keep the list aligned with `steps` (drop removed tails).
  return { snapshots: snapshots.slice(0, steps.length), evaluating };
}
