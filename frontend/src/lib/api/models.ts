/** Client for the workspace lineage graph and model rebuilds. */

import { API_BASE } from "../hooks/useDatasets";
import { readError } from "../http";
import type { JobResponse } from "./ingest";

type Headers = () => Record<string, string>;

export interface GraphNode {
  id: string;
  name: string;
  source_type: string;
  /** "model" = built from other datasets (joins/appends); "source" = imported from a file or database. */
  kind: "source" | "model";
  row_count: number | null;
  column_count: number | null;
  version: number | null;
  updated_at: string | null;
  origin_detail: string | null;
  model: null | {
    base_dataset_id: string | null;
    steps: Record<string, unknown>[];
    built_at: string;
  };
}

export interface GraphEdge {
  source: string;
  target: string;
  role: "base" | "join" | "append";
  how: "left" | "inner" | "right" | "full" | null;
  left_on: string | null;
  right_on: string | null;
}

export interface LineageGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchLineageGraph(headers: Headers, workspaceId: string): Promise<LineageGraph> {
  const res = await fetch(`${API_BASE}/data-ingest/lineage-graph?workspace_id=${workspaceId}`, { headers: headers() });
  if (!res.ok) throw new Error(await readError(res, "Couldn't load the lineage graph"));
  return res.json();
}

/** Re-run a model's saved recipe on the latest versions of its inputs (saved as a new version). */
export async function rebuildModel(headers: Headers, workspaceId: string, datasetId: string): Promise<JobResponse> {
  const res = await fetch(`${API_BASE}/data-ingest/datasets/${datasetId}/rebuild?workspace_id=${workspaceId}`, { method: "POST", headers: headers() });
  if (!res.ok) throw new Error(await readError(res, "Couldn't start the rebuild"));
  return res.json();
}

export const JOIN_KIND_LABEL: Record<string, string> = {
  left: "Left join", inner: "Inner join", right: "Right join", full: "Full join",
};
