/**
 * Transform operations for the Data Transformation Pipeline.
 *
 * Each operation is a pure function that transforms a Table in-memory.
 * The canonical op definitions come from the backend API (GET /transforms/ops),
 * and local apply() implementations serve as the "turbo" preview layer.
 */

import { API_BASE } from "../../lib/hooks/useDatasets";

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
  kind: "column" | "select" | "text" | "number" | "dataset" | "column_right";
  options?: string[];
  placeholder?: string;
}

export type TransformParams = Record<string, string | number | undefined>;

export interface OpDef {
  cat: string;
  label: string;
  desc: string;
  fields: FieldDef[];
  lbl_template: string;
}

export interface TransformOp extends OpDef {
  apply: (t: Table, p: TransformParams) => Table;
  code: (p: TransformParams) => string;
}

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
      ops[key] = { ...def, apply: LOCAL_OPS[key]?.apply ?? defaultApply, code: LOCAL_OPS[key]?.code ?? defaultCode };
    }
    OPS = ops;
    const cats = new Set(Object.values(ops).map(o => o.cat));
    CATS = Array.from(cats);
    OP_KEYS = Object.keys(ops);
  } catch {
    // Fallback to local ops if API is unavailable
    OPS = { ...LOCAL_OPS };
    CATS = LOCAL_CATS;
    OP_KEYS = LOCAL_OP_KEYS;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatLabel(template: string, params: TransformParams): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

export function ci(t: Table, name: string): number {
  return t.columns.findIndex((c) => c.name === name);
}

export function need(t: Table, name: string): number {
  const i = ci(t, name);
  if (i < 0) throw new Error(`column '${name}' not found`);
  return i;
}

export function mapCol(
  t: Table,
  name: string,
  fn: (v: unknown) => unknown,
  newType?: string,
): Table {
  const i = need(t, name);
  return {
    columns: t.columns.map((c, j) =>
      j === i && newType ? { ...c, type: newType } : c,
    ),
    rows: t.rows.map((r) =>
      r.map((v, j) =>
        j === i ? (v === null || v === undefined ? v : fn(v)) : v,
      ),
    ),
  };
}

export function nums(t: Table, i: number): number[] {
  return t.rows
    .map((r) => r[i])
    .filter((v) => v !== null && v !== undefined && !isNaN(Number(v)))
    .map(Number);
}

export function defaultParams(
  opKey: string,
  columns: string[],
  selectedCol: string | null,
): TransformParams {
  const op = OPS[opKey];
  if (!op) return {};
  const p: TransformParams = {};
  for (const f of op.fields) {
    if (f.kind === "column")
      p[f.key] =
        f.key === "column" && selectedCol && columns.includes(selectedCol)
          ? selectedCol
          : columns[0] || "";
    else if (f.kind === "select") p[f.key] = f.options?.[0] ?? "";
    else p[f.key] = "";
  }
  return p;
}

// ── Fallback apply when no local handler exists ───────────────────────────────

const defaultApply: (t: Table, p: TransformParams) => Table = (t) => t;
const defaultCode: (p: TransformParams) => string = () => "/* transform */";

// ── Local (turbo) operations ──────────────────────────────────────────────────

export const LOCAL_OPS: Record<string, TransformOp> = {
  // ── Columns ──
  drop: {
    cat: "Columns", label: "Drop Column", desc: "Remove a column entirely",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Drop {column}",
    code: (p) => `df.drop(columns=['${p.column}'])`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return {
        columns: t.columns.filter((_, j) => j !== i),
        rows: t.rows.map((r) => r.filter((_, j) => j !== i)),
      };
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
      if (!p.to) throw new Error("name required");
      return {
        ...t,
        columns: t.columns.map((c, j) =>
          j === i ? { ...c, name: String(p.to) } : c,
        ),
      };
    },
  },
  cast: {
    cat: "Columns", label: "Cast Type", desc: "Convert to another data type",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      {
        key: "to_type", label: "Target type", kind: "select",
        options: ["string", "integer", "decimal", "boolean", "timestamp"],
      },
    ],
    lbl_template: "Cast {column} → {to_type}",
    code: (p) => `df['${p.column}'] = df['${p.column}'].astype('${p.to_type}')`,
    apply: (t, p) =>
      mapCol(t, String(p.column), (v) => {
        if (p.to_type === "string" || p.to_type === "timestamp") return String(v);
        if (p.to_type === "integer") return Math.trunc(Number(v));
        if (p.to_type === "decimal") return Number(v);
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
        columns: [
          ...t.columns.slice(0, i + 1),
          { name: String(p.column) + "_copy", type: t.columns[i].type },
          ...t.columns.slice(i + 1),
        ],
        rows: t.rows.map((r) => [
          ...r.slice(0, i + 1), r[i], ...r.slice(i + 1),
        ]),
      };
    },
  },
  merge: {
    cat: "Columns", label: "Merge Columns", desc: "Combine two columns into one",
    fields: [
      { key: "column", label: "First column", kind: "column" },
      { key: "column2", label: "Second column", kind: "column" },
      { key: "sep", label: "Separator", kind: "text", placeholder: "e.g. space or -" },
      { key: "to", label: "New column name", kind: "text", placeholder: "merged" },
    ],
    lbl_template: "Merge {column} + {column2}",
    code: (p) => `df['${p.to || "merged"}'] = df['${p.column}'] + '${p.sep || ""}' + df['${p.column2}']`,
    apply: (t, p) => {
      const a = need(t, String(p.column));
      const b = need(t, String(p.column2));
      return {
        columns: [...t.columns, { name: String(p.to) || "merged", type: "string" }],
        rows: t.rows.map((r) => [...r, `${r[a] ?? ""}${p.sep || ""}${r[b] ?? ""}`]),
      };
    },
  },

  // ── Rows ──
  filter: {
    cat: "Rows", label: "Filter Rows", desc: "Keep rows matching a condition",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      {
        key: "op", label: "Condition", kind: "select",
        options: ["equals", "not equals", "less than", "less or equal", "greater than", "greater or equal", "contains", "is null", "is not null"],
      },
      { key: "value", label: "Value", kind: "text", placeholder: "value" },
    ],
    lbl_template: "Filter {column} {op}{value}",
    code: (p) => `df[df['${p.column}'] ${p.op} ${p.value ?? ""}]`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const v = String(p.value ?? "");
      const num = Number(v);
      const test = (x: unknown): boolean => {
        if (p.op === "is null") return x === null || x === undefined;
        if (p.op === "is not null") return x !== null && x !== undefined;
        if (x === null || x === undefined) return false;
        if (p.op === "equals") return String(x) === v || Number(x) === num;
        if (p.op === "not equals") return String(x) !== v && Number(x) !== num;
        if (p.op === "contains") return String(x).toLowerCase().includes(String(v).toLowerCase());
        const xn = Number(x);
        if (isNaN(xn) || isNaN(num)) return false;
        if (p.op === "less than") return xn < num;
        if (p.op === "less or equal") return xn <= num;
        if (p.op === "greater than") return xn > num;
        if (p.op === "greater or equal") return xn >= num;
        return true;
      };
      return { ...t, rows: t.rows.filter((r) => test(r[i])) };
    },
  },
  dropnulls: {
    cat: "Rows", label: "Remove Null Rows", desc: "Drop rows where column is null",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Drop nulls in {column}",
    code: (p) => `df.dropna(subset=['${p.column}'])`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return { ...t, rows: t.rows.filter((r) => r[i] !== null && r[i] !== undefined) };
    },
  },
  dedupe: {
    cat: "Rows", label: "Remove Duplicates", desc: "Drop exact duplicate rows",
    fields: [],
    lbl_template: "Remove duplicates",
    code: () => "df.drop_duplicates()",
    apply: (t) => {
      const seen = new Set<string>();
      return { ...t, rows: t.rows.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }) };
    },
  },
  keeptop: {
    cat: "Rows", label: "Keep Top N", desc: "Keep only the first N rows",
    fields: [{ key: "n", label: "Number of rows", kind: "number", placeholder: "5" }],
    lbl_template: "Keep top {n}",
    code: (p) => `df.head(${p.n})`,
    apply: (t, p) => ({ ...t, rows: t.rows.slice(0, Math.max(0, Number(p.n) || 0)) }),
  },
  fillna: {
    cat: "Rows", label: "Fill Missing", desc: "Replace nulls with a value or stat",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "strategy", label: "Strategy", kind: "select", options: ["value", "mean", "median", "mode"] },
      { key: "value", label: "Fill value", kind: "text", placeholder: "used when strategy = value" },
    ],
    lbl_template: "Fill {column} ({strategy})",
    code: (p) => `df['${p.column}'].fillna(${p.strategy === "value" ? `'${p.value}'` : p.strategy + "()"})`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      let fill: unknown = p.value;
      if (p.strategy !== "value") {
        const n = nums(t, i);
        if (p.strategy === "mean") fill = n.length ? +(n.reduce((a, b) => a + b, 0) / n.length).toFixed(2) : 0;
        if (p.strategy === "median") { const s = [...n].sort((a, b) => a - b); fill = s.length ? s[Math.floor(s.length / 2)] : 0; }
        if (p.strategy === "mode") {
          const m: Record<string, number> = {}; let best: unknown = null; let bc = 0;
          t.rows.forEach((r) => { const v = r[i]; if (v == null) return; m[String(v)] = (m[String(v)] || 0) + 1; if (m[String(v)] > bc) { bc = m[String(v)]; best = v; } });
          fill = best;
        }
      }
      return { ...t, rows: t.rows.map((r) => r.map((v, j) => j === i && (v === null || v === undefined) ? fill : v)) };
    },
  },

  // ── Text ──
  upper: {
    cat: "Text", label: "UPPERCASE", desc: "Convert text to upper case",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Uppercase {column}",
    code: (p) => `df['${p.column}'].str.upper()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).toUpperCase()),
  },
  lower: {
    cat: "Text", label: "lowercase", desc: "Convert text to lower case",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Lowercase {column}",
    code: (p) => `df['${p.column}'].str.lower()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).toLowerCase()),
  },
  capitalize: {
    cat: "Text", label: "Capitalize Each Word", desc: "Title-case the text",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Capitalize {column}",
    code: (p) => `df['${p.column}'].str.title()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).replace(/\b\w/g, (c) => c.toUpperCase())),
  },
  trim: {
    cat: "Text", label: "Trim Whitespace", desc: "Strip leading/trailing spaces",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Trim {column}",
    code: (p) => `df['${p.column}'].str.strip()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).trim()),
  },
  replace: {
    cat: "Text", label: "Replace Value", desc: "Find and replace text",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "find", label: "Find", kind: "text", placeholder: "text to find" },
      { key: "repl", label: "Replace with", kind: "text", placeholder: "replacement" },
    ],
    lbl_template: "Replace '{find}' in {column}",
    code: (p) => `df['${p.column}'].str.replace('${p.find}', '${p.repl}')`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).split(String(p.find) || "").join(String(p.repl) || "")),
  },
  split: {
    cat: "Text", label: "Split Column", desc: "Split into two columns at a delimiter",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "sep", label: "Delimiter", kind: "text", placeholder: "e.g. @ or ," },
    ],
    lbl_template: "Split {column} on '{sep}'",
    code: (p) => `df['${p.column}'].str.split('${p.sep}', n=1, expand=True)`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      if (!p.sep) throw new Error("delimiter required");
      const sep = String(p.sep);
      return {
        columns: [
          ...t.columns.slice(0, i),
          { name: String(p.column) + ".1", type: "string" },
          { name: String(p.column) + ".2", type: "string" },
          ...t.columns.slice(i + 1),
        ],
        rows: t.rows.map((r) => {
          const v = r[i] == null ? "" : String(r[i]);
          const k = v.indexOf(sep);
          const a = k < 0 ? v : v.slice(0, k);
          const b = k < 0 ? null : v.slice(k + sep.length);
          return [...r.slice(0, i), a, b, ...r.slice(i + 1)];
        }),
      };
    },
  },
  extract: {
    cat: "Text", label: "Extract Substring", desc: "Take characters by position",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "start", label: "Start (0-based)", kind: "number", placeholder: "0" },
      { key: "len", label: "Length", kind: "number", placeholder: "4" },
    ],
    lbl_template: "Extract {column}[{start}:{len}]",
    code: (p) => `df['${p.column}'].str.slice(${p.start}, ${Number(p.start) + Number(p.len)})`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => String(v).substr(Number(p.start) || 0, Number(p.len) || 0)),
  },
  length: {
    cat: "Text", label: "Text Length", desc: "New column with character count",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Length of {column}",
    code: (p) => `df['${p.column}_len'] = df['${p.column}'].str.len()`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      return {
        columns: [...t.columns, { name: String(p.column) + "_len", type: "integer" }],
        rows: t.rows.map((r) => [...r, r[i] == null ? null : String(r[i]).length]),
      };
    },
  },

  // ── Numeric ──
  round: {
    cat: "Numeric", label: "Round", desc: "Round to N decimal places",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "n", label: "Decimals", kind: "number", placeholder: "0" },
    ],
    lbl_template: "Round {column} ({n})",
    code: (p) => `df['${p.column}'].round(${p.n})`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => +Number(v).toFixed(Number(p.n) || 0)),
  },
  abs: {
    cat: "Numeric", label: "Absolute Value", desc: "Remove sign",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Abs {column}",
    code: (p) => `df['${p.column}'].abs()`,
    apply: (t, p) => mapCol(t, String(p.column), (v) => Math.abs(Number(v))),
  },
  math: {
    cat: "Numeric", label: "Arithmetic", desc: "Add / subtract / multiply / divide",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "op", label: "Operator", kind: "select", options: ["add", "subtract", "multiply", "divide"] },
      { key: "operand", label: "Operand", kind: "number", placeholder: "e.g. 100" },
    ],
    lbl_template: "{op} {operand} → {column}",
    code: (p) => `df['${p.column}'] ${({ add: "+", subtract: "-", multiply: "*", divide: "/" })[String(p.op) as keyof typeof LOCAL_OPS]} ${p.operand}`,
    apply: (t, p) => {
      const n = Number(p.operand);
      return mapCol(t, String(p.column), (v) => {
        const x = Number(v);
        if (p.op === "add") return x + n;
        if (p.op === "subtract") return x - n;
        if (p.op === "multiply") return +(x * n).toFixed(4);
        return n === 0 ? null : +(x / n).toFixed(4);
      });
    },
  },
  zscore: {
    cat: "Numeric", label: "Z-Score Normalize", desc: "Standardize the distribution",
    fields: [{ key: "column", label: "Column", kind: "column" }],
    lbl_template: "Z-score {column}",
    code: (p) => `(df['${p.column}'] - mean) / std`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const n = nums(t, i);
      const mean = n.reduce((a, b) => a + b, 0) / (n.length || 1);
      const sd = Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / (n.length || 1)) || 1;
      return mapCol(t, String(p.column), (v) => +((Number(v) - mean) / sd).toFixed(3), "decimal");
    },
  },

  // ── Date & Time ──
  datepart: {
    cat: "Date & Time", label: "Extract Date Part", desc: "Year, month, or day as new column",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "part", label: "Part", kind: "select", options: ["year", "month", "day"] },
    ],
    lbl_template: "Extract {part} from {column}",
    code: (p) => `df['${p.column}_${p.part}'] = df['${p.column}'].dt.${p.part}`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const idx = { year: 0, month: 1, day: 2 }[String(p.part) as "year" | "month" | "day"]!;
      return {
        columns: [...t.columns, { name: `${String(p.column)}_${p.part}`, type: "integer" }],
        rows: t.rows.map((r) => {
          const v = r[i];
          if (v == null) return [...r, null];
          const parts = String(v).split("-");
          return [...r, Number(parts[idx]) || null];
        }),
      };
    },
  },
};

export const LOCAL_CATS = ["Columns", "Rows", "Text", "Numeric", "Date & Time"];
export const LOCAL_OP_KEYS = Object.keys(LOCAL_OPS);

// Initialize OPS/CATS/OP_KEYS from local data as fallback
OPS = { ...LOCAL_OPS };
CATS = [...LOCAL_CATS];
OP_KEYS = [...LOCAL_OP_KEYS];

// ── Step helpers ──────────────────────────────────────────────────────────────

/** Human-readable label for a transform step. */
export function stepLabel(s: { type: string; [k: string]: unknown }): string {
  const op = OPS[s.type];
  if (op) return formatLabel(op.lbl_template, s as unknown as TransformParams);
  return s.type;
}

/**
 * Apply steps to a table, trying local apply first, falling back to server-side.
 */
export async function applyWithFallback(
  src: Table | null,
  steps: { op: string; params: TransformParams }[],
  authHeaders: () => Record<string, string>,
): Promise<{ table: Table; errors: Record<number, string> }> {
  if (!src) return { table: { columns: [], rows: [] }, errors: {} };

  // Try local apply for all ops first.
  let t: Table = { columns: src.columns.map(c => ({ ...c })), rows: src.rows.map(r => [...r]) };
  const errors: Record<number, string> = {};
  let allLocal = true;

  steps.forEach((s, i) => {
    const op = LOCAL_OPS[s.op];
    if (!op || !op.apply) {
      allLocal = false;
      errors[i] = `No local handler for '${s.op}'`;
      return;
    }
    try {
      t = op.apply(t, s.params);
    } catch (e: any) {
      allLocal = false;
      errors[i] = e.message;
    }
  });

  if (allLocal) {
    return { table: t, errors };
  }

  // Fallback: server-side preview
  try {
    const res = await fetch(`${API_BASE}/data-ingest/transforms/preview`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        columns: src.columns.map(c => c.name),
        rows: src.rows,
        steps: steps.map(s => ({ type: s.op, ...s.params })),
      }),
    });
    if (!res.ok) throw new Error("Server preview failed");
    const data = await res.json();
    return {
      table: {
        columns: data.columns.map((name: string) => ({ name, type: "string" })),
        rows: data.rows,
      },
      errors: data.errors ?? errors,
    };
  } catch (e: any) {
    return { table: t, errors: { ...errors, 0: e.message } };
  }
}
