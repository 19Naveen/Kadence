import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthContext } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import { readError } from "../http";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

/** Backend dataset summary (matches DatasetResponse). The latest version is always
 *  resolved server-side, so the frontend never sends a version number. */
export interface DatasetSummary {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  source_type: string;
  created_at: string;
  version_count: number;
  latest_row_count: number | null;
  latest_file_size: number | null;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

export interface DatasetPreview extends QueryResult {
  dataset_schema: Record<string, string>;
}

export interface AggregatePoint {
  label: string | null;
  value: number | null;
}

/** Fetch the real datasets in the active workspace. Source of truth for every
 *  downstream feature (EDA, Query, Transform, ML).
 *
 *  A dataset exists as soon as a file is staged, before its import is reviewed and
 *  saved; until then it has no versions and no data to read. Those are hidden unless
 *  `includePending` is set (Data sources shows them so they can be discarded). */
export function useDatasets({ includePending = false }: { includePending?: boolean } = {}) {
  const { session } = useAuthContext();
  const { activeWorkspace } = useWorkspaceContext();
  const [all, setAll] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const authHeaders = useCallback(
    (): Record<string, string> => ({ Authorization: `Bearer ${session?.accessToken}` }),
    [session],
  );

  const refetch = useCallback(async () => {
    const id = ++requestId.current;
    if (!activeWorkspace) {
      setAll([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/data-ingest/datasets?workspace_id=${activeWorkspace.id}`,
        { headers: authHeaders() },
      );
      // Ignore responses for a workspace the user has already switched away from.
      if (res.ok && id === requestId.current) setAll(await res.json());
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [activeWorkspace, authHeaders]);

  useEffect(() => {
    setAll([]);
    refetch();
  }, [refetch]);

  const datasets = useMemo(() => (includePending ? all : all.filter((d) => d.version_count > 0)), [all, includePending]);

  return { datasets, loading, refetch, authHeaders };
}

/** Thin client for the DuckDB-backed /query endpoints (always operate on the latest version). */
export function useQueryApi() {
  const { session } = useAuthContext();
  const headers = useCallback(
    (): Record<string, string> => ({
      Authorization: `Bearer ${session?.accessToken}`,
      "Content-Type": "application/json",
    }),
    [session],
  );

  const preview = useCallback(
    async (datasetId: string, limit = 50): Promise<DatasetPreview> => {
      const res = await fetch(
        `${API_BASE}/query/datasets/${datasetId}/preview?limit=${limit}`,
        { headers: { Authorization: `Bearer ${session?.accessToken}` } },
      );
      if (!res.ok) throw new Error(await readError(res, "Failed to load preview"));
      return res.json();
    },
    [session],
  );

  const execute = useCallback(
    async (datasetId: string, sql: string, rowLimit = 1000): Promise<QueryResult> => {
      const res = await fetch(`${API_BASE}/query/execute`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ dataset_id: datasetId, sql, row_limit: rowLimit }),
      });
      if (!res.ok) throw new Error(await readError(res, "Query failed"));
      return res.json();
    },
    [headers],
  );

  const aggregate = useCallback(
    async (
      datasetId: string,
      dimension: string,
      measure: string | null,
      aggregation: string,
      limit = 100,
    ): Promise<AggregatePoint[]> => {
      const res = await fetch(`${API_BASE}/query/aggregate`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dataset_id: datasetId,
          dimension,
          measure,
          aggregation,
          limit,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "Aggregation failed"));
      return (await res.json()).data;
    },
    [headers],
  );

  return { preview, execute, aggregate };
}
