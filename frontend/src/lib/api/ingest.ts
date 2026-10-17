/** Client for the /data-ingest endpoints, shared by Data sources and Pipeline Studio. */

import { API_BASE } from "../hooks/useDatasets";
import { errMessage, readError } from "../http";

type Headers = () => Record<string, string>;

export interface JobResponse {
  id: string;
  dataset_id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | string;
  source_type: string;
  staging_metadata?: Record<string, unknown> | null;
  error_message?: string | null;
}

export interface DatasetVersion {
  id: string;
  version: number;
  row_count: number;
  column_count: number;
  file_size: number;
  created_at: string;
  dataset_schema: Record<string, string>;
}

export interface LineageSource {
  dataset_id: string;
  dataset_name: string;
  how: string;
  left_on: string;
  right_on: string;
}

export interface LineageNode {
  dataset_id: string;
  dataset_name: string;
  source_type: string;
  origin_detail: string | null;
  sources: (LineageSource & { node: LineageNode | null })[];
}

export type DbSourceType = "postgres" | "mysql" | "snowflake" | "mssql";

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  table: string;
}

export const FILE_TYPES: Record<string, "csv" | "xlsx" | "parquet"> = { csv: "csv", xlsx: "xlsx", xls: "xlsx", parquet: "parquet" };
export const isFileSource = (t: string) => ["csv", "xlsx", "parquet"].includes(t);

export function fileSourceType(name: string): "csv" | "xlsx" | "parquet" | null {
  return FILE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await readError(res, fallback));
  return res.json() as Promise<T>;
}

/** Stage a file. Returns a PENDING job to review in Pipeline Studio. */
export async function uploadFile(
  headers: Headers,
  args: { workspaceId: string; file: File; datasetId?: string; datasetName: string },
): Promise<JobResponse> {
  const sourceType = fileSourceType(args.file.name);
  if (!sourceType) throw new Error("Choose a CSV, Excel (.xlsx) or Parquet file.");
  const form = new FormData();
  form.append("dataset_id", args.datasetId ?? crypto.randomUUID());
  form.append("dataset_name", args.datasetName);
  form.append("workspace_id", args.workspaceId);
  form.append("source_type", sourceType);
  form.append("file", args.file);
  const res = await fetch(`${API_BASE}/data-ingest/jobs/upload`, { method: "POST", headers: headers(), body: form });
  return json(res, "Upload failed");
}

/** Stage a database table. Returns a PENDING job to review in Pipeline Studio. */
export async function createDbJob(
  headers: Headers,
  args: { workspaceId: string; sourceType: DbSourceType; config: DbConfig; datasetId?: string; datasetName: string },
): Promise<JobResponse> {
  const res = await fetch(`${API_BASE}/data-ingest/jobs`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset_id: args.datasetId ?? crypto.randomUUID(),
      dataset_name: args.datasetName,
      workspace_id: args.workspaceId,
      source_type: args.sourceType,
      db_config: args.config,
    }),
  });
  return json(res, "Couldn't connect to the database");
}

export async function commitJob(headers: Headers, jobId: string, transforms: Record<string, unknown>[]): Promise<JobResponse> {
  const res = await fetch(`${API_BASE}/data-ingest/jobs/${jobId}/commit`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ transforms }),
  });
  return json(res, "Import failed");
}

export async function combine(
  headers: Headers,
  args: { workspaceId: string; primaryDatasetId: string; transforms: Record<string, unknown>[]; newDatasetName?: string; targetDatasetId?: string },
): Promise<JobResponse> {
  const res = await fetch(`${API_BASE}/data-ingest/jobs/combine`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: args.workspaceId,
      primary_dataset_id: args.primaryDatasetId,
      transforms: args.transforms,
      new_dataset_name: args.newDatasetName ?? null,
      target_dataset_id: args.targetDatasetId ?? null,
    }),
  });
  return json(res, "Couldn't save the dataset");
}

/** Poll a job until it finishes. Resolves on SUCCESS, rejects with the pipeline error on FAILED. */
export function waitForJob(headers: Headers, jobId: string, signal?: AbortSignal, intervalMs = 1500): Promise<JobResponse> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
      try {
        const res = await fetch(`${API_BASE}/data-ingest/jobs/${jobId}`, { headers: headers(), signal });
        if (res.ok) {
          const job: JobResponse = await res.json();
          if (job.status === "SUCCESS") return resolve(job);
          if (job.status === "FAILED") return reject(new Error(errMessage(job.error_message, "The import failed")));
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return reject(e);
        /* transient network error: keep polling */
      }
      timer = setTimeout(tick, intervalMs);
    };
    signal?.addEventListener("abort", () => clearTimeout(timer));
    tick();
  });
}

export async function listVersions(headers: Headers, datasetId: string): Promise<DatasetVersion[]> {
  return json(await fetch(`${API_BASE}/data-ingest/datasets/${datasetId}/versions`, { headers: headers() }), "Couldn't load versions");
}

export async function latestSchema(headers: Headers, datasetId: string): Promise<Record<string, string>> {
  const versions = await listVersions(headers, datasetId);
  return versions[versions.length - 1]?.dataset_schema ?? {};
}

export async function deleteDataset(headers: Headers, workspaceId: string, datasetId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/data-ingest/datasets/${datasetId}?workspace_id=${workspaceId}`, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(await readError(res, "Couldn't delete the dataset"));
}

/** Multi-hop lineage built client-side from the single-hop endpoint. `visited` guards cycles. */
export async function fetchLineage(headers: Headers, datasetId: string, depth = 4, visited = new Set<string>()): Promise<LineageNode | null> {
  if (depth <= 0 || visited.has(datasetId)) return null;
  visited.add(datasetId);
  const res = await fetch(`${API_BASE}/data-ingest/datasets/${datasetId}/lineage`, { headers: headers() });
  if (!res.ok) return null;
  const data: Omit<LineageNode, "sources"> & { sources: LineageSource[] } = await res.json();
  const sources = await Promise.all(
    data.sources.map(async (s) => ({ ...s, node: await fetchLineage(headers, s.dataset_id, depth - 1, visited) })),
  );
  return { ...data, sources };
}
