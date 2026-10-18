import { previewStep, type Table, type TransformParams } from "../../lib/transforms/transforms";

export interface JoinStats {
  leftRows: number;
  resultRows: number;
  /** Distinct rows of the left table that found a match. */
  matchedLeft: number;
  addedColumns: string[];
}

const ROW_TAG = "__kadence_row";

/** Preview a join on the server and measure it exactly: each left row is tagged first, so
 *  matches are counted per original row even when a repeated key duplicates rows. */
export async function previewJoin(
  input: Table,
  params: TransformParams,
  authHeaders: () => Record<string, string>,
): Promise<{ table: Table; stats: JoinStats }> {
  const tagged: Table = { columns: [...input.columns, { name: ROW_TAG, type: "integer" }], rows: input.rows.map((r, i) => [...r, i]) };
  const out = await previewStep(tagged, "join", params, authHeaders);
  const tagIdx = out.columns.findIndex((c) => c.name === ROW_TAG);
  const leftNames = new Set(input.columns.map((c) => c.name));
  const added = out.columns.map((c, i) => ({ name: c.name, i })).filter((c) => !leftNames.has(c.name) && c.name !== ROW_TAG);
  const matched = new Set<unknown>();
  for (const r of out.rows) {
    if (r[tagIdx] !== null && added.some((c) => r[c.i] !== null && r[c.i] !== undefined)) matched.add(r[tagIdx]);
  }
  return {
    table: { columns: out.columns.filter((_, i) => i !== tagIdx), rows: out.rows.map((r) => r.filter((_, i) => i !== tagIdx)) },
    stats: { leftRows: input.rows.length, resultRows: out.rows.length, matchedLeft: matched.size, addedColumns: added.map((c) => c.name) },
  };
}

/** True when a left/inner join produced more rows than it started with (the key repeats on the right). */
export function duplicatesRows(how: unknown, stats: JoinStats): boolean {
  return (how === "left" || how === "inner") && stats.resultRows > stats.leftRows;
}
