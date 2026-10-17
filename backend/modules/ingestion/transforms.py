"""Transform engine for the import wizard.

A transform plan is an ordered list of typed steps that the user builds in
DataForge and the ingestion pipeline applies to the incoming DataFrame before
a version is written. Pure: DataFrame in → DataFrame out, no DB or storage.

Public API:
    parse_steps(raw: list[dict]) -> list[TransformStep]   # validate a plan
    apply_transforms(df, steps) -> pd.DataFrame           # steps may be dicts or parsed models
    OPS_CATALOG -> dict                                    # canonical op definitions for the UI
"""

import uuid
from typing import Annotated, Any, Callable, Literal, Optional, Union

import pandas as pd
from pydantic import BaseModel, Field, TypeAdapter, model_validator

# Canonical type → pandas dtype (mirrors schema_diff.CAST_TYPE_MAP).
CAST_TYPE_MAP: dict[str, str] = {
    "string": "object",
    "integer": "int64",
    "decimal": "float64",
    "boolean": "bool",
    "timestamp": "datetime64[ns]",
}


class TransformStepError(Exception):
    """Raised when a specific step in a transform plan fails to apply."""

    def __init__(self, step_index: int, message: str):
        self.step_index = step_index
        super().__init__(f"Step {step_index}: {message}")


# ── Step models ────────────────────────────────────────────────────────────────

# ── Columns ──

class DropStep(BaseModel):
    type: Literal["drop"]
    column: str


class RenameStep(BaseModel):
    type: Literal["rename"]
    column: str
    to: str


class CastStep(BaseModel):
    type: Literal["cast"]
    column: str
    to_type: Literal["string", "integer", "decimal", "boolean", "timestamp"]


class DuplicateStep(BaseModel):
    type: Literal["duplicate"]
    column: str


class MergeStep(BaseModel):
    type: Literal["merge"]
    column: str
    column2: str
    sep: str = ""
    to: str = "merged"


# ── Rows ──

class FilterStep(BaseModel):
    type: Literal["filter"]
    column: str
    op: Literal["eq", "ne", "lt", "le", "gt", "ge", "isnull", "notnull"]
    value: Any = None

    @model_validator(mode="after")
    def _require_value(self) -> "FilterStep":
        if self.op not in ("isnull", "notnull") and self.value is None:
            raise ValueError(f"filter op '{self.op}' requires a value")
        return self


class DropnullsStep(BaseModel):
    type: Literal["dropnulls"]
    column: str


class DedupeStep(BaseModel):
    type: Literal["dedupe"]


class KeeptopStep(BaseModel):
    type: Literal["keeptop"]
    n: int = Field(default=5, ge=0)


class FillnaStep(BaseModel):
    type: Literal["fillna"]
    column: str
    strategy: Literal["value", "mean", "median", "mode"]
    value: Any = None

    @model_validator(mode="after")
    def _require_value(self) -> "FillnaStep":
        if self.strategy == "value" and self.value is None:
            raise ValueError("fillna strategy 'value' requires a value")
        return self


# ── Text ──

class UpperStep(BaseModel):
    type: Literal["upper"]
    column: str


class LowerStep(BaseModel):
    type: Literal["lower"]
    column: str


class CapitalizeStep(BaseModel):
    type: Literal["capitalize"]
    column: str


class TrimStep(BaseModel):
    type: Literal["trim"]
    column: str


class ReplaceStep(BaseModel):
    type: Literal["replace"]
    column: str
    find: str = ""
    repl: str = ""


class SplitStep(BaseModel):
    type: Literal["split"]
    column: str
    sep: str = ","


class ExtractStep(BaseModel):
    type: Literal["extract"]
    column: str
    start: int = 0
    len: int = 1


class LengthStep(BaseModel):
    type: Literal["length"]
    column: str


# ── Numeric ──

class RoundStep(BaseModel):
    type: Literal["round"]
    column: str
    n: int = 0


class AbsStep(BaseModel):
    type: Literal["abs"]
    column: str


class MathStep(BaseModel):
    type: Literal["math"]
    column: str
    op: Literal["add", "subtract", "multiply", "divide"]
    operand: float = 0.0


class ZscoreStep(BaseModel):
    type: Literal["zscore"]
    column: str


# ── Date & Time ──

class DatepartStep(BaseModel):
    type: Literal["datepart"]
    column: str
    part: Literal["year", "month", "day"]


# ── Combine ──

class JoinStep(BaseModel):
    type: Literal["join"]
    dataset_id: uuid.UUID
    left_on: str
    right_on: str
    how: Literal["inner", "left", "right", "full"] = "inner"


# ── Union ──────────────────────────────────────────────────────────────────────

TransformStep = Annotated[
    Union[
        DropStep, RenameStep, CastStep, DuplicateStep, MergeStep,
        FilterStep, DropnullsStep, DedupeStep, KeeptopStep, FillnaStep,
        UpperStep, LowerStep, CapitalizeStep, TrimStep, ReplaceStep,
        SplitStep, ExtractStep, LengthStep,
        RoundStep, AbsStep, MathStep, ZscoreStep,
        DatepartStep, JoinStep,
    ],
    Field(discriminator="type"),
]

_STEP_ADAPTER: TypeAdapter = TypeAdapter(TransformStep)
_PLAN_ADAPTER: TypeAdapter = TypeAdapter(list[TransformStep])

_STEP_MODELS = (
    DropStep, RenameStep, CastStep, DuplicateStep, MergeStep,
    FilterStep, DropnullsStep, DedupeStep, KeeptopStep, FillnaStep,
    UpperStep, LowerStep, CapitalizeStep, TrimStep, ReplaceStep,
    SplitStep, ExtractStep, LengthStep,
    RoundStep, AbsStep, MathStep, ZscoreStep,
    DatepartStep, JoinStep,
)

# ── Step type keys ─────────────────────────────────────────────────────────────

STEP_TYPES: dict[str, type[BaseModel]] = {m.model_fields["type"].default: m for m in _STEP_MODELS}  # type: ignore


def parse_steps(raw: list[dict]) -> list:
    """Validate a raw transform plan into typed step models (raises ValidationError)."""
    return _PLAN_ADAPTER.validate_python(raw)


def _coerce(step) -> Any:
    return step if isinstance(step, _STEP_MODELS) else _STEP_ADAPTER.validate_python(step)


_FILTER_OPS = {
    "eq": lambda s, v: s == v,
    "ne": lambda s, v: s != v,
    "lt": lambda s, v: s < v,
    "le": lambda s, v: s <= v,
    "gt": lambda s, v: s > v,
    "ge": lambda s, v: s >= v,
    "isnull": lambda s, v: s.isna(),
    "notnull": lambda s, v: s.notna(),
}


def apply_transforms(
    df: pd.DataFrame,
    steps,
    join_loader: Optional[Callable[["JoinStep"], pd.DataFrame]] = None,
) -> pd.DataFrame:
    """Apply transform steps in order, returning a new DataFrame (input untouched).

    `join_loader(step) -> pd.DataFrame` resolves the right-hand frame for a join
    step; required whenever the plan contains a join.
    """
    out = df.copy()
    for i, raw_step in enumerate(steps):
        step = _coerce(raw_step)
        # ── Combine ──
        if isinstance(step, JoinStep):
            if step.left_on not in out.columns:
                continue  # missing left key → skip, like other missing-column ops
            if join_loader is None:
                raise TransformStepError(i, "join requires a loader")
            right = join_loader(step)
            if step.right_on not in right.columns:
                raise TransformStepError(
                    i, f"right dataset has no column '{step.right_on}'"
                )
            how = "outer" if step.how == "full" else step.how
            out = pd.merge(
                out, right,
                left_on=step.left_on, right_on=step.right_on,
                how=how, suffixes=("", "_right"),
            )
            continue

        # ── Columns ──
        if isinstance(step, DropStep):
            if step.column in out.columns:
                out = out.drop(columns=[step.column])

        elif isinstance(step, RenameStep):
            if step.column in out.columns:
                out = out.rename(columns={step.column: step.to})

        elif isinstance(step, CastStep):
            col = step.column
            if col in out.columns:
                if step.to_type == "timestamp":
                    out[col] = pd.to_datetime(out[col], errors="coerce")
                else:
                    target = CAST_TYPE_MAP[step.to_type]
                    try:
                        out[col] = out[col].astype(target, errors="ignore")
                    except TypeError:
                        try:
                            out[col] = out[col].astype(target)
                        except (ValueError, TypeError):
                            pass

        elif isinstance(step, DuplicateStep):
            if step.column in out.columns:
                new_col = f"{step.column}_copy"
                out[new_col] = out[step.column]

        elif isinstance(step, MergeStep):
            if step.column in out.columns and step.column2 in out.columns:
                out[step.to] = out[step.column].fillna("").astype(str) + step.sep + out[step.column2].fillna("").astype(str)

        # ── Rows ──
        elif isinstance(step, FilterStep):
            if step.column in out.columns:
                mask = _FILTER_OPS[step.op](out[step.column], step.value)
                out = out[mask].copy()

        elif isinstance(step, DropnullsStep):
            if step.column in out.columns:
                out = out.dropna(subset=[step.column])

        elif isinstance(step, DedupeStep):
            out = out.drop_duplicates()

        elif isinstance(step, KeeptopStep):
            out = out.head(step.n)

        elif isinstance(step, FillnaStep):
            col = step.column
            if col in out.columns:
                if step.strategy == "value":
                    fill = step.value
                elif step.strategy == "mean":
                    fill = out[col].mean()
                elif step.strategy == "median":
                    fill = out[col].median()
                else:
                    modes = out[col].mode()
                    fill = modes.iloc[0] if not modes.empty else None
                if fill is not None:
                    out[col] = out[col].fillna(fill)

        # ── Text ──
        elif isinstance(step, UpperStep):
            if step.column in out.columns:
                out[step.column] = out[step.column].astype(str).str.upper()

        elif isinstance(step, LowerStep):
            if step.column in out.columns:
                out[step.column] = out[step.column].astype(str).str.lower()

        elif isinstance(step, CapitalizeStep):
            if step.column in out.columns:
                out[step.column] = out[step.column].astype(str).str.title()

        elif isinstance(step, TrimStep):
            if step.column in out.columns:
                out[step.column] = out[step.column].astype(str).str.strip()

        elif isinstance(step, ReplaceStep):
            if step.column in out.columns:
                out[step.column] = out[step.column].astype(str).str.replace(step.find, step.repl)

        elif isinstance(step, SplitStep):
            if step.column in out.columns:
                split = out[step.column].astype(str).str.split(step.sep, n=1, expand=True)
                out[f"{step.column}.1"] = split[0]
                out[f"{step.column}.2"] = split[1] if 1 in split else None

        elif isinstance(step, ExtractStep):
            if step.column in out.columns:
                out[step.column] = out[step.column].astype(str).str[step.start:step.start + step.len]

        elif isinstance(step, LengthStep):
            if step.column in out.columns:
                out[f"{step.column}_len"] = out[step.column].astype(str).str.len()

        # ── Numeric ──
        elif isinstance(step, RoundStep):
            if step.column in out.columns:
                out[step.column] = pd.to_numeric(out[step.column], errors="coerce").round(step.n)

        elif isinstance(step, AbsStep):
            if step.column in out.columns:
                out[step.column] = pd.to_numeric(out[step.column], errors="coerce").abs()

        elif isinstance(step, MathStep):
            if step.column in out.columns:
                col = pd.to_numeric(out[step.column], errors="coerce")
                if step.op == "add":
                    out[step.column] = col + step.operand
                elif step.op == "subtract":
                    out[step.column] = col - step.operand
                elif step.op == "multiply":
                    out[step.column] = col * step.operand
                elif step.op == "divide":
                    out[step.column] = col / step.operand if step.operand != 0 else None

        elif isinstance(step, ZscoreStep):
            if step.column in out.columns:
                col = pd.to_numeric(out[step.column], errors="coerce")
                mean, std = col.mean(), col.std()
                out[step.column] = ((col - mean) / std) if std else col

        # ── Date & Time ──
        elif isinstance(step, DatepartStep):
            if step.column in out.columns:
                dt = pd.to_datetime(out[step.column], errors="coerce")
                if step.part == "year":
                    out[f"{step.column}_year"] = dt.dt.year
                elif step.part == "month":
                    out[f"{step.column}_month"] = dt.dt.month
                elif step.part == "day":
                    out[f"{step.column}_day"] = dt.dt.day

    return out


# ── Canonical op catalog (served via GET /transforms/ops) ───────────────────────

def _build_catalog() -> dict:
    return {
        "drop": {
            "cat": "Columns", "label": "Drop Column", "desc": "Remove a column entirely",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Drop {column}",
        },
        "rename": {
            "cat": "Columns", "label": "Rename Column", "desc": "Give a column a new name",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "to", "label": "New name", "kind": "text", "placeholder": "new_name"},
            ],
            "lbl_template": "Rename {column} → {to}",
        },
        "cast": {
            "cat": "Columns", "label": "Cast Type", "desc": "Convert to another data type",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "to_type", "label": "Target type", "kind": "select", "options": ["string", "integer", "decimal", "boolean", "timestamp"]},
            ],
            "lbl_template": "Cast {column} → {to_type}",
        },
        "duplicate": {
            "cat": "Columns", "label": "Duplicate Column", "desc": "Copy a column",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Duplicate {column}",
        },
        "merge": {
            "cat": "Columns", "label": "Merge Columns", "desc": "Combine two columns into one",
            "fields": [
                {"key": "column", "label": "First column", "kind": "column"},
                {"key": "column2", "label": "Second column", "kind": "column"},
                {"key": "sep", "label": "Separator", "kind": "text", "placeholder": "e.g. space or -"},
                {"key": "to", "label": "New column name", "kind": "text", "placeholder": "merged"},
            ],
            "lbl_template": "Merge {column} + {column2}",
        },
        "filter": {
            "cat": "Rows", "label": "Filter Rows", "desc": "Keep rows matching a condition",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "op", "label": "Condition", "kind": "select", "options": ["equals", "not equals", "less than", "less or equal", "greater than", "greater or equal", "contains", "is null", "is not null"]},
                {"key": "value", "label": "Value", "kind": "text", "placeholder": "value"},
            ],
            "lbl_template": "Filter {column} {op} {value}",
        },
        "dropnulls": {
            "cat": "Rows", "label": "Remove Null Rows", "desc": "Drop rows where column is null",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Drop nulls in {column}",
        },
        "dedupe": {
            "cat": "Rows", "label": "Remove Duplicates", "desc": "Drop exact duplicate rows",
            "fields": [],
            "lbl_template": "Remove duplicates",
        },
        "keeptop": {
            "cat": "Rows", "label": "Keep Top N", "desc": "Keep only the first N rows",
            "fields": [{"key": "n", "label": "Number of rows", "kind": "number", "placeholder": "5"}],
            "lbl_template": "Keep top {n}",
        },
        "fillna": {
            "cat": "Rows", "label": "Fill Missing", "desc": "Replace nulls with a value or stat",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "strategy", "label": "Strategy", "kind": "select", "options": ["value", "mean", "median", "mode"]},
                {"key": "value", "label": "Fill value", "kind": "text", "placeholder": "used when strategy = value"},
            ],
            "lbl_template": "Fill {column} ({strategy})",
        },
        "upper": {
            "cat": "Text", "label": "UPPERCASE", "desc": "Convert text to upper case",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Uppercase {column}",
        },
        "lower": {
            "cat": "Text", "label": "lowercase", "desc": "Convert text to lower case",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Lowercase {column}",
        },
        "capitalize": {
            "cat": "Text", "label": "Capitalize Each Word", "desc": "Title-case the text",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Capitalize {column}",
        },
        "trim": {
            "cat": "Text", "label": "Trim Whitespace", "desc": "Strip leading/trailing spaces",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Trim {column}",
        },
        "replace": {
            "cat": "Text", "label": "Replace Value", "desc": "Find and replace text",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "find", "label": "Find", "kind": "text", "placeholder": "text to find"},
                {"key": "repl", "label": "Replace with", "kind": "text", "placeholder": "replacement"},
            ],
            "lbl_template": "Replace '{find}' in {column}",
        },
        "split": {
            "cat": "Text", "label": "Split Column", "desc": "Split into two columns at a delimiter",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "sep", "label": "Delimiter", "kind": "text", "placeholder": "e.g. @ or ,"},
            ],
            "lbl_template": "Split {column} on '{sep}'",
        },
        "extract": {
            "cat": "Text", "label": "Extract Substring", "desc": "Take characters by position",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "start", "label": "Start (0-based)", "kind": "number", "placeholder": "0"},
                {"key": "len", "label": "Length", "kind": "number", "placeholder": "4"},
            ],
            "lbl_template": "Extract {column}[{start}:{len}]",
        },
        "length": {
            "cat": "Text", "label": "Text Length", "desc": "New column with character count",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Length of {column}",
        },
        "round": {
            "cat": "Numeric", "label": "Round", "desc": "Round to N decimal places",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "n", "label": "Decimals", "kind": "number", "placeholder": "0"},
            ],
            "lbl_template": "Round {column} ({n})",
        },
        "abs": {
            "cat": "Numeric", "label": "Absolute Value", "desc": "Remove sign",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Abs {column}",
        },
        "math": {
            "cat": "Numeric", "label": "Arithmetic", "desc": "Add / subtract / multiply / divide",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "op", "label": "Operator", "kind": "select", "options": ["add", "subtract", "multiply", "divide"]},
                {"key": "operand", "label": "Operand", "kind": "number", "placeholder": "e.g. 100"},
            ],
            "lbl_template": "{op} {operand} → {column}",
        },
        "zscore": {
            "cat": "Numeric", "label": "Z-Score Normalize", "desc": "Standardize the distribution",
            "fields": [{"key": "column", "label": "Column", "kind": "column"}],
            "lbl_template": "Z-score {column}",
        },
        "datepart": {
            "cat": "Date & Time", "label": "Extract Date Part", "desc": "Year, month, or day as new column",
            "fields": [
                {"key": "column", "label": "Column", "kind": "column"},
                {"key": "part", "label": "Part", "kind": "select", "options": ["year", "month", "day"]},
            ],
            "lbl_template": "Extract {part} from {column}",
        },
        "join": {
            "cat": "Combine", "label": "Join Dataset", "desc": "Combine rows from another dataset on a key",
            "fields": [
                {"key": "dataset_id", "label": "Dataset", "kind": "dataset"},
                {"key": "left_on", "label": "This column", "kind": "column"},
                {"key": "right_on", "label": "Other column", "kind": "column_right"},
                {"key": "how", "label": "Join type", "kind": "select", "options": ["inner", "left", "right", "full"]},
            ],
            "lbl_template": "Join {how} on {left_on}={right_on}",
        },
    }


OPS_CATALOG = _build_catalog()
