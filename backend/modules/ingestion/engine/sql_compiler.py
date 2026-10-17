"""Compile a transform plan (the 23 ops in modules.ingestion.transforms) into a
single chained-CTE DuckDB SQL query, with pandas-parity semantics.

`compile_plan(steps, source_rel) -> str` builds:

    WITH __s0 AS (SELECT * FROM <source_rel>),
         __s1 AS (<step 0 applied to __s0>),
         ...
    SELECT * FROM __sN

Each step is one `SELECT` over the previous CTE, using DuckDB star-modifiers
(`* EXCLUDE / REPLACE / RENAME` and appended expressions) so we never need to
enumerate the source columns.

Column tracking / "skip if missing": pandas `apply_transforms` silently skips a
step whose column is absent. We cannot know the *source* columns statically, so
we track only what the steps themselves add/remove:

  - `known`  = columns we are sure exist (added by a step, or a source column a
               step has referenced and found present).
  - `absent` = columns a prior step removed (dropped / renamed away).

A step whose required column is in `absent` (removed earlier) emits a pass-through
CTE, exactly like pandas. A reference to a column that is simply absent from the
*source* (never seen) is not statically detectable — the SQL errors at run time
and the Celery task maps it to a TransformStepError. This is the one documented
gap versus pandas' silent skip.

All identifiers are double-quote escaped and all step values are emitted as typed
SQL literals (single-quote doubled) — step values cannot inject SQL.
"""

from modules.ingestion import transforms as _T


# ── escaping ─────────────────────────────────────────────────────────────────

def q(name: str) -> str:
    """Quote an identifier (double-quote, doubling embedded quotes)."""
    return '"' + str(name).replace('"', '""') + '"'


def lit(value) -> str:
    """Emit a Python value as a typed SQL literal. NULL / bool / number / string."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value:            # NaN
            return "NULL"
        if value in (float("inf"), float("-inf")):
            return "'Infinity'" if value > 0 else "'-Infinity'"
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


# ── SQL type mapping ─────────────────────────────────────────────────────────

_CAST_SQL = {
    "string": "VARCHAR",
    "integer": "BIGINT",
    "decimal": "DOUBLE",
    "boolean": "BOOLEAN",
    "timestamp": "TIMESTAMP",
}

_FILTER_OPS = {"lt": "<", "le": "<=", "gt": ">", "ge": ">="}


# ── expression helpers ───────────────────────────────────────────────────────

def _s(col: str) -> str:
    """The column cast to VARCHAR (mirrors pandas `.astype(str)` for text ops).

    pandas 3.0 keeps NaN as NaN under astype(str); DuckDB keeps NULL as NULL —
    so text ops agree on nulls (no 'nan'/'None' literal strings)."""
    return f"CAST({q(col)} AS VARCHAR)"


def _num(col: str) -> str:
    """The column coerced to DOUBLE (mirrors pandas `pd.to_numeric(errors='coerce')`)."""
    return f"TRY_CAST({q(col)} AS DOUBLE)"


def _title(v: str) -> str:
    # Space-word title case, matching pandas .str.title() for whitespace-separated
    # words (incl. unicode). Divergence: pandas also capitalizes after digits /
    # punctuation ("abc123def" -> "Abc123Def"); we only break on spaces.
    return (
        f"array_to_string(list_transform(string_split({v}, ' '), "
        f"w -> upper(w[1:1]) || lower(w[2:])), ' ')"
    )


def _project(prev: str, assigns: list[tuple[str, str]], known: set) -> str:
    """SELECT applying column assignments over `prev`.

    Names already `known` (present) become `* REPLACE (...)`; new names are
    appended. Mutates `known` to include every assigned name."""
    repl = [(n, e) for n, e in assigns if n in known]
    app = [(n, e) for n, e in assigns if n not in known]
    star = "*"
    if repl:
        star += " REPLACE (" + ", ".join(f"{e} AS {q(n)}" for n, e in repl) + ")"
    sel = f"SELECT {star}"
    for n, e in app:
        sel += f", {e} AS {q(n)}"
        known.add(n)
    return sel + f" FROM {prev}"


def _passthrough(prev: str) -> str:
    return f"SELECT * FROM {prev}"


# ── per-op compilation ───────────────────────────────────────────────────────

_JOIN_SQL = {
    "inner": "INNER JOIN",
    "left": "LEFT JOIN",
    "right": "RIGHT JOIN",
    "full": "FULL OUTER JOIN",
}


def _compile_one(step, prev: str, known: set, absent: set, join_sources, describe) -> str:
    t = step.type

    # ── Combine ──
    if t == "join":
        if step.left_on in absent:
            return _passthrough(prev)  # missing left key → skip (pandas semantics)
        if join_sources is None or describe is None:
            raise ValueError("join step requires join_sources and describe")
        right_rel = join_sources[str(step.dataset_id)]
        right_cols = describe(right_rel)
        left_cols = known  # complete: seeded from source + step-tracked
        equal_key = step.left_on == step.right_on
        # pandas keeps left key; on equal names the right key is merged away and,
        # for right/full joins, coalesced into the surviving key.
        if equal_key:
            star = (
                f"__l.* REPLACE (COALESCE(__l.{q(step.left_on)}, __r.{q(step.right_on)}) "
                f"AS {q(step.left_on)})"
            )
        else:
            star = "__l.*"
        right_sel = []
        for rc in right_cols:
            if equal_key and rc == step.right_on:
                continue  # right key dropped when names are equal
            alias = f"{rc}_right" if rc in left_cols else rc
            right_sel.append(f"__r.{q(rc)} AS {q(alias)}")
            known.add(alias)
        sel = f"SELECT {star}"
        if right_sel:
            sel += ", " + ", ".join(right_sel)
        on = f"__l.{q(step.left_on)} = __r.{q(step.right_on)}"
        return f"{sel} FROM {prev} __l {_JOIN_SQL[step.how]} {right_rel} __r ON {on}"

    # helper: is `col` provably removed?
    def missing(col: str) -> bool:
        return col in absent

    def touch(col: str) -> None:
        """Mark a referenced source column as present."""
        known.add(col)
        absent.discard(col)

    # ── Columns ──
    if t == "drop":
        if missing(step.column):
            return _passthrough(prev)
        absent.add(step.column)
        known.discard(step.column)
        return f"SELECT * EXCLUDE ({q(step.column)}) FROM {prev}"

    if t == "rename":
        if missing(step.column):
            return _passthrough(prev)
        absent.add(step.column)
        known.discard(step.column)
        known.add(step.to)
        absent.discard(step.to)
        return f"SELECT * RENAME ({q(step.column)} AS {q(step.to)}) FROM {prev}"

    if t == "cast":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        sqltype = _CAST_SQL[step.to_type]
        # TRY_CAST: bad values -> NULL (per-value). pandas astype(errors='ignore')
        # is whole-column all-or-nothing — documented divergence.
        expr = f"TRY_CAST({q(step.column)} AS {sqltype})"
        return _project(prev, [(step.column, expr)], known)

    if t == "duplicate":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return _project(prev, [(f"{step.column}_copy", q(step.column))], known)

    if t == "merge":
        if missing(step.column) or missing(step.column2):
            return _passthrough(prev)
        touch(step.column)
        touch(step.column2)
        expr = (
            f"COALESCE({_s(step.column)}, '') || {lit(step.sep)} || "
            f"COALESCE({_s(step.column2)}, '')"
        )
        return _project(prev, [(step.to, expr)], known)

    # ── Rows ──
    if t == "filter":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        c = q(step.column)
        if step.op == "eq":
            where = f"{c} = {lit(step.value)}"
        elif step.op == "ne":
            # pandas: NaN != v is True (row kept); IS DISTINCT FROM keeps NULLs too.
            where = f"{c} IS DISTINCT FROM {lit(step.value)}"
        elif step.op == "isnull":
            where = f"{c} IS NULL"
        elif step.op == "notnull":
            where = f"{c} IS NOT NULL"
        else:
            where = f"{c} {_FILTER_OPS[step.op]} {lit(step.value)}"
        return f"SELECT * FROM {prev} WHERE {where}"

    if t == "dropnulls":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return f"SELECT * FROM {prev} WHERE {q(step.column)} IS NOT NULL"

    if t == "dedupe":
        return f"SELECT DISTINCT * FROM {prev}"

    if t == "keeptop":
        return f"SELECT * FROM {prev} LIMIT {int(step.n)}"

    if t == "fillna":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        c = q(step.column)
        if step.strategy == "value":
            fill = lit(step.value)
        elif step.strategy == "mean":
            fill = f"avg({_num(step.column)}) OVER ()"
        elif step.strategy == "median":
            fill = f"median({_num(step.column)}) OVER ()"
        else:  # mode — DuckDB mode() picks an arbitrary most-frequent on ties;
                # pandas picks the smallest. Documented divergence (ties only).
            fill = f"mode({c}) OVER ()"
        return _project(prev, [(step.column, f"COALESCE({c}, {fill})")], known)

    # ── Text ──
    if t == "upper":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return _project(prev, [(step.column, f"upper({_s(step.column)})")], known)

    if t == "lower":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return _project(prev, [(step.column, f"lower({_s(step.column)})")], known)

    if t == "capitalize":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return _project(prev, [(step.column, _title(_s(step.column)))], known)

    if t == "trim":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        # \s matches pandas str.strip() whitespace class (space/tab/newline/...).
        expr = f"regexp_replace({_s(step.column)}, '^\\s+|\\s+$', '', 'g')"
        return _project(prev, [(step.column, expr)], known)

    if t == "replace":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        # pandas 3.0 str.replace defaults regex=False -> literal replace-all,
        # matching DuckDB replace().
        expr = f"replace({_s(step.column)}, {lit(step.find)}, {lit(step.repl)})"
        return _project(prev, [(step.column, expr)], known)

    if t == "split":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        v = _s(step.column)
        sep = lit(step.sep)
        n = len(step.sep)
        pos = f"strpos({v}, {sep})"
        part1 = f"CASE WHEN {pos} > 0 THEN substr({v}, 1, {pos} - 1) ELSE {v} END"
        part2 = f"CASE WHEN {pos} > 0 THEN substr({v}, {pos} + {n}) ELSE NULL END"
        return _project(prev, [(f"{step.column}.1", part1), (f"{step.column}.2", part2)], known)

    if t == "extract":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        # pandas str[start:start+len] is 0-based; substr is 1-based.
        expr = f"substr({_s(step.column)}, {int(step.start) + 1}, {int(step.len)})"
        return _project(prev, [(step.column, expr)], known)

    if t == "length":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return _project(prev, [(f"{step.column}_len", f"length({_s(step.column)})")], known)

    # ── Numeric ──
    if t == "round":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        # DuckDB round() is half-away-from-zero; pandas/numpy is banker's rounding
        # — they differ only on exact .5 ties (documented).
        return _project(prev, [(step.column, f"round({_num(step.column)}, {int(step.n)})")], known)

    if t == "abs":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        return _project(prev, [(step.column, f"abs({_num(step.column)})")], known)

    if t == "math":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        x = _num(step.column)
        operand = lit(float(step.operand))
        if step.op == "add":
            expr = f"({x}) + {operand}"
        elif step.op == "subtract":
            expr = f"({x}) - {operand}"
        elif step.op == "multiply":
            expr = f"({x}) * {operand}"
        else:  # divide — pandas sets whole column NULL when operand == 0
            expr = "NULL" if step.operand == 0 else f"({x}) / {operand}"
        return _project(prev, [(step.column, expr)], known)

    if t == "zscore":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        x = _num(step.column)
        # stddev_samp = pandas .std() (ddof=1). NULLIF -> zero-variance yields NULL
        # (pandas leaves the column unchanged in that case; documented divergence).
        expr = f"(({x}) - avg({x}) OVER ()) / NULLIF(stddev_samp({x}) OVER (), 0)"
        return _project(prev, [(step.column, expr)], known)

    # ── Date & Time ──
    if t == "datepart":
        if missing(step.column):
            return _passthrough(prev)
        touch(step.column)
        dt = f"TRY_CAST({q(step.column)} AS TIMESTAMP)"
        expr = f"{step.part}({dt})"
        return _project(prev, [(f"{step.column}_{step.part}", expr)], known)

    raise ValueError(f"Unknown transform step type: {t!r}")


def _coerce(step):
    return step if isinstance(step, _T._STEP_MODELS) else _T._STEP_ADAPTER.validate_python(step)


def compile_plan(steps: list, source_rel: str, join_sources=None, describe=None) -> str:
    """Compile a transform plan into one chained-CTE DuckDB SELECT over `source_rel`.

    `source_rel` is any valid FROM expression (a relation name or a
    `read_parquet('s3://...')` call). `steps` may be parsed models or raw dicts.

    Join steps need two extra inputs (DuckDB cannot replicate pandas' collision
    suffixing without knowing the column sets):
      - `join_sources`: {dataset_id_str: right-relation SQL string}
      - `describe`: callable rel-string -> list of that relation's column names
    When any join is present the left column set is seeded from `source_rel` via
    `describe`, so collision detection sees every live column.
    """
    steps = [_coerce(raw) for raw in steps]
    if not steps:
        return f"SELECT * FROM {source_rel}"

    known: set = set()
    absent: set = set()
    if any(s.type == "join" for s in steps):
        if describe is None:
            raise ValueError("join step requires a describe callable")
        known.update(describe(source_rel))  # seed complete left column set
    ctes = [f"__s0 AS (SELECT * FROM {source_rel})"]
    prev = "__s0"
    for i, step in enumerate(steps):
        body = _compile_one(step, prev, known, absent, join_sources, describe)
        nxt = f"__s{i + 1}"
        ctes.append(f"{nxt} AS ({body})")
        prev = nxt
    return "WITH " + ",\n     ".join(ctes) + f"\nSELECT * FROM {prev}"
