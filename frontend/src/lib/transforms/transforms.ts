/**
 * Transform operations for the Data Transformation Pipeline.
 *
 * Each operation is a pure function that transforms a Table in-memory.
 * The canonical op definitions come from the backend API (GET /transforms/ops),
 * and local apply() implementations serve as the instant preview layer. Ops that
 * need another dataset (join, append) have no local apply and are previewed on
 * the server (see `previewStep`).
 */

import { API_BASE } from "../../lib/hooks/useDatasets";
import { readError } from "../http";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Column {
  name: string;
  type: string;
}

export interface Table {
  columns: Column[];
  rows: unknown[][];
}

export interface FieldDef {
  key: string;
  label: string;
  kind: "column" | "columns" | "select" | "text" | "number" | "dataset" | "column_right";
  options?: string[];
  /** Human labels for `options` codes (e.g. filter "ge" → "is at least"). */
  option_labels?: Record<string, string>;
  placeholder?: string;
}

export type ParamValue = string | number | string[] | undefined;
export type TransformParams = Record<string, ParamValue>;

export interface OpDef {
  cat: string;
  label: string;
  desc: string;
  fields: FieldDef[];
  lbl_template: string;
}

export interface TransformOp extends OpDef {
  apply?: (t: Table, p: TransformParams) => Table;
  code: (p: TransformParams) => string;
}

/** Ops that read another dataset; they can only be previewed server-side. */
export const SERVER_ONLY_OPS = new Set(["join", "append"]);

// ── Shared state (populated from API on boot) ─────────────────────────────────

export let OPS: Record<string, TransformOp> = {};
export let CATS: string[] = [];
export let OP_KEYS: string[] = [];

export async function fetchOpsFromApi(authHeaders: () => Record<string, string>): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/data-ingest/transforms/ops`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to fetch ops");
    const raw: Record<string, OpDef> = await res.json();
    const ops: Record<string, TransformOp> = {};
    for (const [key, def] of Object.entries(raw)) {
      ops[key] = { ...def, apply: LOCAL_OPS[key]?.apply, code: LOCAL_OPS[key]?.code ?? defaultCode };
    }
    OPS = ops;
    CATS = Array.from(new Set(Object.values(ops).map((o) => o.cat)));
    OP_KEYS = Object.keys(ops);
  } catch {
    // Fall back to the local catalog if the API is unavailable
    OPS = { ...LOCAL_OPS };
    CATS = [...LOCAL_CATS];
    OP_KEYS = [...LOCAL_OP_KEYS];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Display text for one param value: arrays joined, select codes mapped to labels. */
export function paramText(op: OpDef | undefined, key: string, value: ParamValue): string {
  if (Array.isArray(value)) return value.join(", ");
  const field = op?.fields.find((f) => f.key === key);
  const label = field?.option_labels?.[String(value)];
  return label ?? String(value ?? "");
}

export function formatLabel(op: OpDef, params: TransformParams): string {
  return op.lbl_template
    .replace(/\{(\w+)\}/g, (_, key) => paramText(op, key, params[key]) || "…")
    .replace(/\s+/g, " ")
    .trim();
}

export function ci(t: Table, name: string): number {
  return t.columns.findIndex((c) => c.name === name);
}

export function need(t: Table, name: string): number {
  const i = ci(t, name);
  if (i < 0) throw new Error(`column '${name}' not found`);
  return i;
}

export function mapCol(t: Table, name: string, fn: (v: unknown) => unknown, newType?: string): Table {
  const i = need(t, name);
  return {
    columns: t.columns.map((c, j) => (j === i && newType ? { ...c, type: newType } : c)),
    rows: t.rows.map((r) => r.map((v, j) => (j === i ? (v === null || v === undefined ? v : fn(v)) : v))),
  };
}

export function nums(t: Table, i: number): number[] {
  return t.rows
    .map((r) => r[i])
    .filter((v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v)))
    .map(Number);
}

const isNull = (v: unknown) => v === null || v === undefined;
const toNum = (v: unknown): number | null => (isNull(v) || v === "" || isNaN(Number(v)) ? null : Number(v));

/** Infer a column type from sample values (server previews return names only). */
export function inferType(values: unknown[]): string {
  const present = values.filter((v) => !isNull(v));
  if (!present.length) return "string";
  if (present.every((v) => typeof v === "boolean")) return "boolean";
  if (present.every((v) => typeof v === "number")) {
    return present.every((v) => Number.isInteger(v)) ? "integer" : "decimal";
  }
  if (present.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(v))) return "timestamp";
  return "string";
}

export function defaultParams(opKey: string, columns: string[], selectedCol: string | null): TransformParams {
  const op = OPS[opKey];
  if (!op) return {};
  const p: TransformParams = {};
  const firstCol = selectedCol && columns.includes(selectedCol) ? selectedCol : columns[0] || "";
  for (const f of op.fields) {
    if (f.kind === "column") p[f.key] = f.key === "column2" ? columns.find((c) => c !== firstCol) ?? firstCol : firstCol;
    else if (f.kind === "columns") p[f.key] = selectedCol ? [selectedCol] : [...columns];
    else if (f.kind === "select") p[f.key] = f.options?.[0] ?? "";
    else p[f.key] = "";
  }
  return p;
}

/** The payload shape the backend expects: `{type, ...params}`, with empty optional text omitted. */
export function toApiStep(op: string, params: TransformParams): Record<string, unknown> {
  const out: Record<string, unknown> = { type: op };
  for (const [k, v] of Object.entries(params)) {
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

const defaultCode: (p: TransformParams) => string = () => "/* runs on the server */";

// ── Filter semantics (mirrors backend FilterStep) ─────────────────────────────

export const FILTER_LABELS: Record<string, string> = {
  eq: "equals", ne: "does not equal", lt: "is less than", le: "is at most",
  gt: "is greater than", ge: "is at least", contains: "contains", not_contains: "does not contain",
  starts_with: "starts with", ends_with: "ends with", in: "is one of (comma separated)",
  isnull: "is empty", notnull: "is not empty",
};
const FILTER_CODES = Object.keys(FILTER_LABELS);
export const VALUELESS_FILTERS = new Set(["isnull", "notnull"]);

function filterTest(op: string, raw: unknown, numericCol: boolean): (x: unknown) => boolean {
  const v = String(raw ?? "");
  const lv = v.toLowerCase();
  const n = Number(v);
  const useNum = numericCol && v.trim() !== "" && !isNaN(n);
  switch (op) {
    case "isnull": return isNull;
    case "notnull": return (x) => !isNull(x);
    case "contains": return (x) => !isNull(x) && String(x).toLowerCase().includes(lv);
    case "not_contains": return (x) => !isNull(x) && !String(x).toLowerCase().includes(lv);
    case "starts_with": return (x) => !isNull(x) && String(x).toLowerCase().startsWith(lv);
    case "ends_with": return (x) => !isNull(x) && String(x).toLowerCase().endsWith(lv);
    case "in": {
      // Case-insensitive, like the backend
      const items = new Set(v.split(",").map((s) => s.trim().toLowerCase()));
      return (x) => !isNull(x) && items.has(String(x).toLowerCase());
    }
    case "eq": return (x) => !isNull(x) && (useNum ? Number(x) === n : String(x) === v);
    case "ne": return (x) => isNull(x) || (useNum ? Number(x) !== n : String(x) !== v);
  }
  const cmp = { lt: (a: number, b: number) => a < b, le: (a: number, b: number) => a <= b, gt: (a: number, b: number) => a > b, ge: (a: number, b: number) => a >= b }[op];
  if (!cmp) return () => true;
  return (x) => {
    if (isNull(x)) return false;
    if (useNum) return cmp(Number(x), n);
    return cmp(String(x).localeCompare(v), 0);
  };
}

// ── Local (instant) operations ────────────────────────────────────────────────

export const LOCAL_OPS: Record<string, TransformOp> = {
  // ── Columns ──
  drop: {
    cat: "Columns", label: "Drop Column", desc: "Remove a column entirely",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Drop {column}",
    code: (p) => `df.drop(columns=['${p.column}'])`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return { columns: t.columns.filter((_, j) => j !== i), rows: t.rows.map((r) => r.filter((_, j) => j !== i)) };
    },
  },
  select: {
    cat: "Columns", label: "Keep Columns", desc: "Keep only the chosen columns, in order",
    fields: [{ key: "columns", label: "Columns to keep", kind: "columns" }],
    lbl_template: "Keep {columns}",
    code: (p) => `df[[${(Array.isArray(p.columns) ? p.columns : []).map((c) => `'${c}'`).join(", ")}]]`,
    apply: (t, p) => {
      const wanted = (Array.isArray(p.columns) ? p.columns : []).map((c) => ci(t, c)).filter((i) => i >= 0);
      if (!wanted.length) throw new Error("choose at least one column");
      return { columns: wanted.map((i) => t.columns[i]), rows: t.rows.map((r) => wanted.map((i) => r[i])) };
    },
  },
  rename: {
    cat: "Columns", label: "Rename Column", desc: "Give a column a new name",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "to", label: "New name", kind: "text", placeholder: "new_name" },
    ],
    lbl_template: "Rename {column} → {to}",
    code: (p) => `df.rename(columns={'${p.column}': '${p.to}'})`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      if (!p.to) throw new Error("enter a new name");
      return { ...t, columns: t.columns.map((c, j) => (j === i ? { ...c, name: String(p.to) } : c)) };
    },
  },
  cast: {
    cat: "Columns", label: "Change Type", desc: "Convert to another data type",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "to_type", label: "New type", kind: "select", options: ["string", "integer", "decimal", "boolean", "timestamp"] },
    ],
    lbl_template: "{column} as {to_type}",
    code: (p) => `df['${p.column}'] = df['${p.column}'].astype('${p.to_type}')`,
    apply: (t, p) =>
      mapCol(t, String(p.column), (v) => {
        if (p.to_type === "string" || p.to_type === "timestamp") return String(v);
        if (p.to_type === "integer") return toNum(v) === null ? null : Math.trunc(Number(v));
        if (p.to_type === "decimal") return toNum(v);
        if (p.to_type === "boolean") return Boolean(v) && v !== "false" && v !== "0";
        return v;
      }, String(p.to_type)),
  },
  duplicate: {
    cat: "Columns", label: "Duplicate Column", desc: "Copy a column",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Duplicate {column}",
    code: (p) => `df['${p.column}_copy'] = df['${p.column}']`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return {
        columns: [...t.columns.slice(0, i + 1), { name: String(p.column) + "_copy", type: t.columns[i].type }, ...t.columns.slice(i + 1)],
        rows: t.rows.map((r) => [...r.slice(0, i + 1), r[i], ...r.slice(i + 1)]),
      };
    },
  },
  merge: {
    cat: "Columns", label: "Merge Columns", desc: "Join two text columns into one",
    fields: [
      { key: "column", label: "First column", kind: "column" },
      { key: "column2", label: "Second column", kind: "column" },
      { key: "sep", label: "Separator", kind: "text", placeholder: "e.g. a space or -" },
      { key: "to", label: "New column name", kind: "text", placeholder: "merged" },
    ],
    lbl_template: "Merge {column} + {column2}",
    code: (p) => `df['${p.to || "merged"}'] = df['${p.column}'] + '${p.sep || ""}' + df['${p.column2}']`,
    apply: (t, p) => {
      const a = need(t, String(p.column));
      const b = need(t, String(p.column2));
      return {
        columns: [...t.columns, { name: String(p.to || "merged"), type: "string" }],
        rows: t.rows.map((r) => [...r, `${r[a] ?? ""}${p.sep || ""}${r[b] ?? ""}`]),
      };
    },
  },

  // ── Rows ──
  filter: {
    cat: "Rows", label: "Filter Rows", desc: "Keep rows matching a condition",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "op", label: "Condition", kind: "select", options: FILTER_CODES, option_labels: FILTER_LABELS },
      { key: "value", label: "Value", kind: "text", placeholder: "value" },
    ],
    lbl_template: "Keep rows where {column} {op} {value}",
    code: (p) => `df[df['${p.column}'] ${p.op} ${p.value ?? ""}]`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const op = String(p.op);
      if (!VALUELESS_FILTERS.has(op) && String(p.value ?? "").trim() === "") throw new Error("enter a value");
      const numeric = ["integer", "decimal"].includes(t.columns[i].type);
      const test = filterTest(op, p.value, numeric);
      return { ...t, rows: t.rows.filter((r) => test(r[i])) };
    },
  },
  sort: {
    cat: "Rows", label: "Sort Rows", desc: "Order rows by a column",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "direction", label: "Order", kind: "select", options: ["asc", "desc"], option_labels: { asc: "ascending (A→Z, 0→9)", desc: "descending (Z→A, 9→0)" } },
    ],
    lbl_template: "Sort by {column} {direction}",
    code: (p) => `df.sort_values('${p.column}', ascending=${p.direction !== "desc" ? "True" : "False"})`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const dir = p.direction === "desc" ? -1 : 1;
      const numeric = ["integer", "decimal"].includes(t.columns[i].type);
      const rows = [...t.rows].sort((a, b) => {
        const x = a[i], y = b[i];
        if (isNull(x) || isNull(y)) return isNull(x) === isNull(y) ? 0 : isNull(x) ? 1 : -1; // nulls last
        const c = numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y));
        return c * dir;
      });
      return { ...t, rows };
    },
  },
  dropnulls: {
    cat: "Rows", label: "Remove Empty Rows", desc: "Drop rows where a column is empty",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Drop rows with empty {column}",
    code: (p) => `df.dropna(subset=['${p.column}'])`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return { ...t, rows: t.rows.filter((r) => !isNull(r[i])) };
    },
  },
  dedupe: {
    cat: "Rows", label: "Remove Duplicates", desc: "Drop exact duplicate rows",
    fields: [],
    lbl_template: "Remove duplicate rows",
    code: () => "df.drop_duplicates()",
    apply: (t) => {
      const seen = new Set<string>();
      return { ...t, rows: t.rows.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }) };
    },
  },
  keeptop: {
    cat: "Rows", label: "Keep First N Rows", desc: "Keep only the first N rows",
    fields: [{ key: "n", label: "Number of rows", kind: "number", placeholder: "100" }],
    lbl_template: "Keep first {n} rows",
    code: (p) => `df.head(${p.n})`,
    apply: (t, p) => ({ ...t, rows: t.rows.slice(0, Math.max(0, Number(p.n) || 0)) }),
  },
  fillna: {
    cat: "Rows", label: "Fill Empty Values", desc: "Replace empty cells with a value or statistic",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "strategy", label: "Fill with", kind: "select", options: ["value", "mean", "median", "mode"], option_labels: { value: "a fixed value", mean: "the average", median: "the median", mode: "the most common value" } },
      { key: "value", label: "Fixed value", kind: "text", placeholder: "used for “a fixed value”" },
    ],
    lbl_template: "Fill empty {column} with {strategy}",
    code: (p) => `df['${p.column}'].fillna(${p.strategy === "value" ? `'${p.value}'` : p.strategy + "()"})`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      let fill: unknown = p.value;
      if (p.strategy === "value" && String(p.value ?? "") === "") throw new Error("enter a fill value");
      if (p.strategy !== "value") {
        const n = nums(t, i);
        if (p.strategy === "mean") fill = n.length ? +(n.reduce((a, b) => a + b, 0) / n.length).toFixed(4) : null;
        if (p.strategy === "median") {
          const s = [...n].sort((a, b) => a - b);
          fill = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
        }
        if (p.strategy === "mode") {
          const m = new Map<string, { v: unknown; c: number }>();
          t.rows.forEach((r) => { const v = r[i]; if (isNull(v)) return; const k = String(v); m.set(k, { v, c: (m.get(k)?.c ?? 0) + 1 }); });
          fill = [...m.values()].sort((a, b) => b.c - a.c)[0]?.v ?? null;
        }
      }
      return { ...t, rows: t.rows.map((r) => r.map((v, j) => (j === i && isNull(v) ? fill : v))) };
    },
  },

  // ── Text ──
  upper: {
    cat: "Text", label: "UPPERCASE", desc: "Convert text to upper case",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Uppercase {column}",
    code: (p) => `df['${p.column}'].str.upper()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).toUpperCase(), "string"),
  },
  lower: {
    cat: "Text", label: "lowercase", desc: "Convert text to lower case",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Lowercase {column}",
    code: (p) => `df['${p.column}'].str.lower()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).toLowerCase(), "string"),
  },
  capitalize: {
    cat: "Text", label: "Capitalize Each Word", desc: "Title-case the text",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Capitalize {column}",
    code: (p) => `df['${p.column}'].str.title()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), "string"),
  },
  trim: {
    cat: "Text", label: "Trim Whitespace", desc: "Strip leading and trailing spaces",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Trim {column}",
    code: (p) => `df['${p.column}'].str.strip()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).trim(), "string"),
  },
  replace: {
    cat: "Text", label: "Find & Replace", desc: "Replace text inside a column",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "find", label: "Find", kind: "text", placeholder: "text to find" },
      { key: "repl", label: "Replace with", kind: "text", placeholder: "leave empty to remove" },
    ],
    lbl_template: "Replace “{find}” in {column}",
    code: (p) => `df['${p.column}'].str.replace('${p.find}', '${p.repl}')`,
    apply: (t, p) => {
      if (!p.find) throw new Error("enter the text to find");
      return mapCol(t, String(p.column), (v) => String(v).split(String(p.find)).join(String(p.repl ?? "")), "string");
    },
  },
  split: {
    cat: "Text", label: "Split Column", desc: "Split into two columns at a delimiter",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "sep", label: "Delimiter", kind: "text", placeholder: "e.g. @ or ," },
    ],
    lbl_template: "Split {column} on “{sep}”",
    code: (p) => `df['${p.column}'].str.split('${p.sep}', n=1, expand=True)`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      if (!p.sep) throw new Error("enter a delimiter");
      const sep = String(p.sep);
      return {
        columns: [...t.columns, { name: `${p.column}.1`, type: "string" }, { name: `${p.column}.2`, type: "string" }],
        rows: t.rows.map((r) => {
          if (isNull(r[i])) return [...r, null, null];
          const v = String(r[i]);
          const k = v.indexOf(sep);
          return [...r, k < 0 ? v : v.slice(0, k), k < 0 ? null : v.slice(k + sep.length)];
        }),
      };
    },
  },
  extract: {
    cat: "Text", label: "Extract Characters", desc: "Take characters by position",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "start", label: "Start position (0 = first)", kind: "number", placeholder: "0" },
      { key: "len", label: "Number of characters", kind: "number", placeholder: "4" },
    ],
    lbl_template: "Extract {len} characters of {column} from {start}",
    code: (p) => `df['${p.column}'].str.slice(${p.start}, ${Number(p.start) + Number(p.len)})`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).slice(Number(p.start) || 0, (Number(p.start) || 0) + (Number(p.len) || 0)), "string"),
  },
  length: {
    cat: "Text", label: "Text Length", desc: "New column with the character count",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Length of {column}",
    code: (p) => `df['${p.column}_len'] = df['${p.column}'].str.len()`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return {
        columns: [...t.columns, { name: String(p.column) + "_len", type: "integer" }],
        rows: t.rows.map((r) => [...r, isNull(r[i]) ? null : String(r[i]).length]),
      };
    },
  },

  // ── Numeric ──
  calc: {
    cat: "Numeric", label: "Calculated Column", desc: "New column from two columns (+ − × ÷)",
    fields: [
      { key: "column", label: "First column", kind: "column" },
      { key: "op", label: "Operation", kind: "select", options: ["add", "subtract", "multiply", "divide"], option_labels: { add: "+ plus", subtract: "− minus", multiply: "× times", divide: "÷ divided by" } },
      { key: "column2", label: "Second column", kind: "column" },
      { key: "to", label: "New column name", kind: "text", placeholder: "total" },
    ],
    lbl_template: "{to} = {column} {op} {column2}",
    code: (p) => `df['${p.to}'] = df['${p.column}'] ${({ add: "+", subtract: "-", multiply: "*", divide: "/" } as Record<string, string>)[String(p.op)]} df['${p.column2}']`,
    apply: (t, p) => {
      const a = need(t, String(p.column));
      const b = need(t, String(p.column2));
      if (!p.to) throw new Error("name the new column");
      const fn = ({
        add: (x: number, y: number) => x + y,
        subtract: (x: number, y: number) => x - y,
        multiply: (x: number, y: number) => x * y,
        divide: (x: number, y: number) => (y === 0 ? null : x / y),
      } as Record<string, (x: number, y: number) => number | null>)[String(p.op)];
      const values = t.rows.map((r) => {
        const x = toNum(r[a]), y = toNum(r[b]);
        return x === null || y === null ? null : fn(x, y);
      });
      const existing = ci(t, String(p.to));
      if (existing >= 0) {
        return {
          columns: t.columns.map((c, j) => (j === existing ? { ...c, type: "decimal" } : c)),
          rows: t.rows.map((r, k) => r.map((v, j) => (j === existing ? values[k] : v))),
        };
      }
      return { columns: [...t.columns, { name: String(p.to), type: "decimal" }], rows: t.rows.map((r, k) => [...r, values[k]]) };
    },
  },
  round: {
    cat: "Numeric", label: "Round", desc: "Round to N decimal places",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "n", label: "Decimal places", kind: "number", placeholder: "0" },
    ],
    lbl_template: "Round {column} to {n} places",
    code: (p) => `df['${p.column}'].round(${p.n})`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => (toNum(v) === null ? null : +Number(v).toFixed(Number(p.n) || 0)), "decimal"),
  },
  abs: {
    cat: "Numeric", label: "Absolute Value", desc: "Remove the sign",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Absolute {column}",
    code: (p) => `df['${p.column}'].abs()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => (toNum(v) === null ? null : Math.abs(Number(v)))),
  },
  math: {
    cat: "Numeric", label: "Arithmetic", desc: "Add, subtract, multiply or divide by a number",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "op", label: "Operation", kind: "select", options: ["add", "subtract", "multiply", "divide"], option_labels: { add: "+ plus", subtract: "− minus", multiply: "× times", divide: "÷ divided by" } },
      { key: "operand", label: "Number", kind: "number", placeholder: "e.g. 100" },
    ],
    lbl_template: "{column} {op} {operand}",
    code: (p) => `df['${p.column}'] ${({ add: "+", subtract: "-", multiply: "*", divide: "/" } as Record<string, string>)[String(p.op)]} ${p.operand}`,
    apply: (t, p) => {
      const n = Number(p.operand);
      return mapCol(t, String(p.column), (v) => {
        const x = toNum(v);
        if (x === null) return null;
        if (p.op === "add") return x + n;
        if (p.op === "subtract") return x - n;
        if (p.op === "multiply") return x * n;
        return n === 0 ? null : x / n;
      });
    },
  },
  zscore: {
    cat: "Numeric", label: "Standardize (z-score)", desc: "Rescale to mean 0, standard deviation 1",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Standardize {column}",
    code: (p) => `(df['${p.column}'] - mean) / std`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const n = nums(t, i);
      const mean = n.reduce((a, b) => a + b, 0) / (n.length || 1);
      const sd = Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n.length - 1)) || 1;
      return mapCol(t, String(p.column), (v) => (toNum(v) === null ? null : +((Number(v) - mean) / sd).toFixed(4)), "decimal");
    },
  },

  // ── Date & Time ──
  datepart: {
    cat: "Date & Time", label: "Extract Date Part", desc: "Year, month or day as a new column",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "part", label: "Part", kind: "select", options: ["year", "month", "day"] },
    ],
    lbl_template: "{part} of {column}",
    code: (p) => `df['${p.column}_${p.part}'] = df['${p.column}'].dt.${p.part}`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return {
        columns: [...t.columns, { name: `${String(p.column)}_${p.part}`, type: "integer" }],
        rows: t.rows.map((r) => {
          if (isNull(r[i])) return [...r, null];
          const d = new Date(String(r[i]));
          if (isNaN(d.getTime())) return [...r, null];
          return [...r, p.part === "year" ? d.getFullYear() : p.part === "month" ? d.getMonth() + 1 : d.getDate()];
        }),
      };
    },
  },

  // ── Summarize ──
  group: {
    cat: "Summarize", label: "Group & Summarize", desc: "One row per group with a count, sum, average, min or max",
    fields: [
      { key: "by", label: "Group by", kind: "column" },
      { key: "agg", label: "Summary", kind: "select", options: ["count", "sum", "avg", "min", "max", "count_distinct"], option_labels: { count: "count rows", sum: "sum", avg: "average", min: "minimum", max: "maximum", count_distinct: "count distinct values" } },
      { key: "column", label: "Of column (ignored for count)", kind: "column" },
      { key: "to", label: "Result column name", kind: "text", placeholder: "auto" },
    ],
    lbl_template: "Group by {by} → {agg} {column}",
    code: (p) => `df.groupby('${p.by}').agg(${p.agg})`,
    apply: (t, p) => {
      const g = need(t, String(p.by));
      const agg = String(p.agg);
      const c = agg === "count" ? -1 : need(t, String(p.column));
      const name = String(p.to || (agg === "count" ? "count" : `${agg}_${p.column}`));
      const groups = new Map<string, { key: unknown; rows: unknown[][] }>();
      for (const r of t.rows) {
        const k = isNull(r[g]) ? "\0null" : JSON.stringify(r[g]);
        if (!groups.has(k)) groups.set(k, { key: isNull(r[g]) ? null : r[g], rows: [] });
        groups.get(k)!.rows.push(r);
      }
      const summarize = (rows: unknown[][]): unknown => {
        if (agg === "count") return rows.length;
        const vals = rows.map((r) => r[c]).filter((v) => !isNull(v));
        if (agg === "count_distinct") return new Set(vals.map((v) => JSON.stringify(v))).size;
        const ns = vals.map(Number).filter((v) => !isNaN(v));
        if (!ns.length) return null;
        if (agg === "sum") return ns.reduce((a, b) => a + b, 0);
        if (agg === "avg") return ns.reduce((a, b) => a + b, 0) / ns.length;
        if (agg === "min") return Math.min(...ns);
        return Math.max(...ns);
      };
      const out = [...groups.values()].sort((a, b) => {
        if (isNull(a.key) || isNull(b.key)) return isNull(a.key) ? 1 : -1;
        return typeof a.key === "number" && typeof b.key === "number" ? a.key - b.key : String(a.key).localeCompare(String(b.key));
      });
      const outType = agg === "count" || agg === "count_distinct" ? "integer" : "decimal";
      return {
        columns: [t.columns[g], { name, type: outType }],
        rows: out.map((grp) => [grp.key, summarize(grp.rows)]),
      };
    },
  },

  // ── Combine (server-only; previewed via the API) ──
  join: {
    cat: "Combine", label: "Join Dataset", desc: "Add columns from another dataset by matching a key",
    fields: [
      { key: "dataset_id", label: "Dataset", kind: "dataset" },
      { key: "left_on", label: "This column", kind: "column" },
      { key: "right_on", label: "Other column", kind: "column_right" },
      { key: "how", label: "Join type", kind: "select", options: ["inner", "left", "right", "full"] },
    ],
    lbl_template: "Join on {left_on} = {right_on}",
    code: (p) => `df.merge(other, left_on='${p.left_on}', right_on='${p.right_on}', how='${p.how}')`,
  },
  append: {
    cat: "Combine", label: "Append Rows", desc: "Stack rows from another dataset (matching columns by name)",
    fields: [{ key: "dataset_id", label: "Dataset", kind: "dataset" }],
    lbl_template: "Append rows from dataset",
    code: () => "pd.concat([df, other], ignore_index=True)",
  },
};

export const LOCAL_CATS = ["Columns", "Rows", "Text", "Numeric", "Date & Time", "Summarize", "Combine"];
export const LOCAL_OP_KEYS = Object.keys(LOCAL_OPS);

// Initialize OPS/CATS/OP_KEYS from local data until the API catalog arrives
OPS = { ...LOCAL_OPS };
CATS = [...LOCAL_CATS];
OP_KEYS = [...LOCAL_OP_KEYS];

// ── Step helpers ──────────────────────────────────────────────────────────────

/** Human-readable label for a transform step. */
export function stepLabel(op: string, params: TransformParams): string {
  const def = OPS[op];
  return def ? formatLabel(def, params) : op;
}

/** Apply one server-only step (join/append) to `table` via POST /transforms/preview. */
export async function previewStep(
  table: Table,
  op: string,
  params: TransformParams,
  authHeaders: () => Record<string, string>,
): Promise<Table> {
  const res = await fetch(`${API_BASE}/data-ingest/transforms/preview`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      columns: table.columns.map((c) => c.name),
      rows: table.rows,
      steps: [toApiStep(op, params)],
    }),
  });
  if (!res.ok) throw new Error(await readError(res, "Preview failed"));
  const data: { columns: string[]; rows: unknown[][]; errors?: Record<string, string> } = await res.json();
  const err = data.errors && Object.values(data.errors)[0];
  if (err) throw new Error(err);
  const known = new Map(table.columns.map((c) => [c.name, c.type]));
  return {
    columns: data.columns.map((name, i) => ({ name, type: known.get(name) ?? inferType(data.rows.map((r) => r[i])) })),
    rows: data.rows,
  };
}
