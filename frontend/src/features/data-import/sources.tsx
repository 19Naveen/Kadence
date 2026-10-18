import { Database, FileSpreadsheet } from "lucide-react";
import { isFileSource, latestSchema, type DbSourceType } from "../../lib/api/ingest";
import { suggestJoinKeys } from "../../lib/transforms/joinKeys";
import type { StudioLaunch } from "../data-transform/launch";

export const SOURCE_LABEL: Record<string, string> = {
  csv: "CSV file", xlsx: "Excel file", parquet: "Parquet file",
  postgres: "PostgreSQL", mysql: "MySQL", snowflake: "Snowflake", mssql: "SQL Server",
};

export const DB_SOURCES: { type: DbSourceType; port: string; description: string }[] = [
  { type: "postgres", port: "5432", description: "Read a table or view from a PostgreSQL database" },
  { type: "mysql", port: "3306", description: "Read a table from a MySQL database" },
  { type: "snowflake", port: "443", description: "Read a table from a Snowflake warehouse" },
  { type: "mssql", port: "1433", description: "Read a table from Microsoft SQL Server" },
];

export const ACCEPTED_FILES = ".csv,.xlsx,.xls,.parquet";

export function sourceLabel(type: string) {
  return SOURCE_LABEL[type] ?? type;
}

export function SourceIcon({ type, className }: { type: string; className?: string }) {
  const Icon = isFileSource(type) ? FileSpreadsheet : Database;
  return <Icon size={16} strokeWidth={1.75} className={className} aria-hidden />;
}

export function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/** Pipeline Studio launch that joins `otherId` into `baseId`. Keys are only prefilled when both
 *  sides share a column name; otherwise they're left empty for the user to pick. */
export async function joinLaunch(headers: () => Record<string, string>, baseId: string, otherId: string): Promise<StudioLaunch> {
  const [l, r] = await Promise.all([latestSchema(headers, baseId), latestSchema(headers, otherId)]);
  const keys = suggestJoinKeys(Object.keys(l), Object.keys(r));
  const shared = keys && keys.left_on.toLowerCase() === keys.right_on.toLowerCase() ? keys : null;
  return {
    mode: "shape",
    datasetId: baseId,
    presetSteps: [{ op: "join", params: { dataset_id: otherId, left_on: shared?.left_on ?? "", right_on: shared?.right_on ?? "", how: "left" } }],
  };
}
