import type { TransformParams } from "../../lib/transforms/transforms";

/** Router state for opening Pipeline Studio.
 *  - Import review: a staged (PENDING) job from Data sources.
 *  - Shape: an existing dataset, optionally with steps to start from (e.g. a prefilled join). */
export type StudioLaunch =
  | { mode: "import"; jobId: string; datasetId: string; datasetName: string }
  | { mode: "shape"; datasetId: string; presetSteps?: { op: string; params: TransformParams }[] };

export function readLaunch(state: unknown): StudioLaunch | null {
  const s = state as Partial<StudioLaunch> & { jobId?: string; datasetId?: string; datasetName?: string } | null;
  if (!s) return null;
  if (s.mode === "shape" && s.datasetId) return s as StudioLaunch;
  // Older callers passed `{ jobId, datasetId, datasetName }` without a mode.
  if (s.jobId && s.datasetId) return { mode: "import", jobId: s.jobId, datasetId: s.datasetId, datasetName: s.datasetName ?? "Staged import" };
  return null;
}
