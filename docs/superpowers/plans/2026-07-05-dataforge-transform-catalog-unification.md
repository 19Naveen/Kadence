# DataForge Transform Catalog Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend the single source of truth for the transform-op catalog and preview execution, fix the broken engine-abstraction scaffold, and switch the frontend from live-recompute-on-every-edit to an explicit "Apply Preview" action driven by the backend.

**Architecture:** `backend/modules/ingestion/transforms.py` already defines 23 step models and a hand-written `OPS_CATALOG`; `GET /transforms/ops` and `POST /transforms/preview` already exist but are unused by the frontend. The frontend currently ships its own parallel hardcoded `OPS` catalog (`frontend/src/lib/transforms/transforms.ts`) with client-side `apply` functions and recomputes the full pipeline synchronously on every render. This plan: (1) fixes the currently-broken `engine/__init__.py` import and aligns naming, (2) hardens the preview endpoint's error/schema reporting, (3) reconciles the 3 known backend/frontend semantic divergences (`split`, `math.divide`, `replace`), (4) adds test coverage for the 18 untested ops and the new endpoints, (5) fetches the op catalog from the backend in `DataTransformPage.tsx` and renders menus from it while keeping the existing client-side `apply` functions only as an optimization, (6) replaces always-on synchronous recompute with an explicit "Apply Preview" flow with a stale-preview indicator, and (7) updates the three project READMEs per project convention.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, pandas, Celery 5, React, TypeScript, native `fetch`.

## Global Constraints

- Backend: Pydantic v2 `BaseModel`, `model_config = {"from_attributes": True}` for ORM-facing responses (existing schemas already comply — do not change unrelated schemas).
- Frontend: no axios, no Redux/Zustand — use native `fetch` and local component state, matching existing `DataTransformPage.tsx` conventions.
- Every backend module/API/DB/storage change and every frontend page/route/API-integration change must get a same-response README update (`backend/README.md` and/or `frontend/README.md`) with a dated Changelog entry, per `CLAUDE.md`.
- Do not touch `schema_diff.py`, `test_schema_diff.py`, `test_staged_preview.py`, auth, or unrelated ingestion code — out of scope.
- Do not implement DuckDB/Polars engines in this pass — `select_engine()` stays pandas-only; only fix its scaffolding so it is honest about that.

---

### Task 1: Fix broken `engine/__init__.py` import and align engine naming

**Context:** `engine/__init__.py` imports `PandasEngine` from `pandas_engine.py`, but `pandas_engine.py` only exports free functions (`load_source`, `apply`, `schema_of`, `write_parquet`, `row_count_of`, `column_count_of`) — no `PandasEngine` class exists. Any code that does `import modules.ingestion.engine` or `from modules.ingestion.engine import PandasEngine` will raise `ImportError` at import time. `tasks.py` currently sidesteps this by importing `from modules.ingestion.engine.select import select_engine` directly (bypassing `__init__.py`), so this bug is latent, not yet triggered — but it must be fixed before the package is more widely used (e.g., by tests importing `modules.ingestion.engine`).

**Files:**
- Modify: `backend/modules/ingestion/engine/__init__.py`
- Test: `backend/tests/test_engine_select.py` (new)

**Interfaces:**
- Consumes: `select_engine` from `backend/modules/ingestion/engine/select.py` (existing, unchanged signature `select_engine(staging_metadata: dict | None) -> dict`)
- Produces: `modules.ingestion.engine` package that imports cleanly; `select_engine` re-exported from the package root for later tasks.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_engine_select.py
import importlib


def test_engine_package_imports_cleanly():
    module = importlib.import_module("modules.ingestion.engine")
    assert hasattr(module, "select_engine")


def test_select_engine_returns_pandas_callable_dict():
    from modules.ingestion.engine import select_engine

    engine = select_engine({"row_count": 10, "file_size": 100})
    for key in ("load_source", "apply", "schema", "write_parquet", "row_count", "column_count"):
        assert key in engine
        assert callable(engine[key])


def test_select_engine_handles_none_metadata():
    from modules.ingestion.engine import select_engine

    engine = select_engine(None)
    assert callable(engine["apply"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_engine_select.py -v`
Expected: FAIL on `test_engine_package_imports_cleanly` with `ImportError: cannot import name 'PandasEngine' from 'modules.ingestion.engine.pandas_engine'`.

- [ ] **Step 3: Fix the package `__init__.py`**

```python
# backend/modules/ingestion/engine/__init__.py
from modules.ingestion.engine.base import DataContainer, TransformEngine
from modules.ingestion.engine.select import select_engine

__all__ = ["DataContainer", "TransformEngine", "select_engine"]
```

(Removes the nonexistent `PandasEngine` import. The `pandas_engine` module stays function-based — see Task 2 for why we keep it that way rather than forcing it into the `TransformEngine` Protocol shape right now.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_engine_select.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/modules/ingestion/engine/__init__.py backend/tests/test_engine_select.py
git commit -m "fix(ingestion): remove broken PandasEngine import from engine package"
```

---

### Task 2: Document the engine-function-dict pattern and add a docstring bridging it to the `TransformEngine` Protocol

**Context:** `engine/base.py` defines a `TransformEngine` Protocol with method names `apply_transforms`, `infer_schema`, `row_count`, `column_count`. `pandas_engine.py` instead exposes free functions named `apply`, `schema_of`, `row_count_of`, `column_count_of`, collected into a plain dict in `select.py`. The Protocol is never actually checked against this dict, so it currently documents an aspirational shape that doesn't match the real one. Rather than force a class rewrite (out of scope — "finish the abstraction first" per the spec, but minimally, so future DuckDB engine authors aren't misled), align the dict keys to the Protocol names so the codebase has one naming convention, and note in `base.py` that the Protocol is realized as a dict-of-callables, not a class instance, until a second engine exists.

**Files:**
- Modify: `backend/modules/ingestion/engine/pandas_engine.py`
- Modify: `backend/modules/ingestion/engine/select.py`
- Modify: `backend/modules/ingestion/engine/base.py`
- Modify: `backend/modules/ingestion/tasks.py`
- Modify: `backend/tests/test_engine_select.py`
- Modify: `backend/tests/test_commit_pipeline.py` (repair monkeypatches broken by the Task 1/prior engine refactor — see Step 5)

**Interfaces:**
- Consumes: nothing new
- Produces: engine dict keys renamed to `load_source`, `apply_transforms`, `infer_schema`, `write_parquet`, `row_count`, `column_count` (dropping the old `apply`/`schema` short names so they match `TransformEngine` Protocol method names exactly). `tasks.py` call sites updated to match.

- [ ] **Step 1: Update `pandas_engine.py` function names to match the Protocol**

```python
# backend/modules/ingestion/engine/pandas_engine.py
"""Pandas-backed TransformEngine (function-based; see engine/base.py for the target Protocol shape)."""

import pandas as pd

from modules.ingestion.schema_inference import infer_schema as _infer_schema
from modules.ingestion.source_loader import load_source as _load_source
from modules.ingestion.storage.minio_client import upload_dataframe_as_parquet
from modules.ingestion.transforms import apply_transforms as _apply_transforms


def load_source(job, nrows: int | None = None) -> pd.DataFrame:
    """Load source into a pandas DataFrame."""
    return _load_source(job, nrows=nrows)


def apply_transforms(data: pd.DataFrame, steps: list) -> pd.DataFrame:
    """Apply transform steps in order, returning a new DataFrame (input untouched)."""
    return _apply_transforms(data, steps)


def infer_schema(data: pd.DataFrame) -> dict[str, str]:
    """Infer schema from a DataFrame."""
    return _infer_schema(data)


def write_parquet(data: pd.DataFrame, storage_path: str) -> int:
    """Write DataFrame → Parquet → MinIO. Returns byte size."""
    return upload_dataframe_as_parquet(data, storage_path)


def row_count(data: pd.DataFrame) -> int:
    return len(data)


def column_count(data: pd.DataFrame) -> int:
    return len(data.columns)
```

- [ ] **Step 2: Update `select.py` to use the renamed functions and matching keys**

```python
# backend/modules/ingestion/engine/select.py
"""Select the appropriate transform engine based on data size."""

from modules.ingestion.engine.pandas_engine import (
    apply_transforms,
    column_count,
    infer_schema,
    load_source,
    row_count,
    write_parquet,
)

_PANDAS_ENGINE = {
    "load_source": load_source,
    "apply_transforms": apply_transforms,
    "infer_schema": infer_schema,
    "write_parquet": write_parquet,
    "row_count": row_count,
    "column_count": column_count,
}


def select_engine(staging_metadata: dict | None) -> dict:
    """Return a dict of engine functions suitable for the data size.

    Currently only the pandas engine is implemented.
    DuckDB and Polars engines will be added as future backends,
    selected here based on staging_metadata (e.g. row_count, file_size).
    """
    return _PANDAS_ENGINE
```

- [ ] **Step 3: Add a bridging note to `base.py`**

Insert after the `TransformEngine` class docstring line (`"""Pluggable engine for the ingestion pipeline."""`):

```python
    # NOTE: today, `select_engine()` returns a plain dict of callables whose
    # keys match these method names, rather than a class instance implementing
    # this Protocol. This is intentional until a second engine (DuckDB) exists —
    # see modules/ingestion/engine/select.py.
```

- [ ] **Step 4: Update `tasks.py` call sites**

```python
# backend/modules/ingestion/tasks.py — replace lines 26-34
        engine = select_engine(job.staging_metadata)
        df = engine["load_source"](job)

        # Apply the transform plan the user built in the import wizard (DataForge).
        transforms = (job.source_config or {}).get("_transforms") or []
        if transforms:
            df = engine["apply_transforms"](df, transforms)

        inferred_schema = engine["infer_schema"](df)
```

(Leave `write_parquet`, `row_count`, `column_count` keys as-is — already matching.)

- [ ] **Step 5: Repair `test_commit_pipeline.py` monkeypatches**

Read `backend/tests/test_commit_pipeline.py` in full first. It was written against the pre-engine `tasks.py` and likely does `monkeypatch.setattr(tasks_mod, "load_source", ...)` / `"apply_transforms"` / `"infer_schema"` etc. directly on the `tasks` module namespace — these names no longer exist at module level in `tasks.py` (only `select_engine` is imported there now). Update each such monkeypatch to instead patch the pandas_engine functions at their source, e.g.:

```python
# was: monkeypatch.setattr(tasks_mod, "load_source", fake_load_source)
monkeypatch.setattr(
    "modules.ingestion.engine.pandas_engine.load_source", fake_load_source
)
```
Apply the same pattern for whichever of `apply_transforms`/`infer_schema`/`write_parquet` that test file patches. Since `select.py` imports these by name at module load time (`from modules.ingestion.engine.pandas_engine import (...)`), patching `modules.ingestion.engine.pandas_engine.load_source` after `select.py` has already bound its own reference will **not** affect `_PANDAS_ENGINE`'s dict values (they were bound at import time). Instead, patch the dict values directly:

```python
monkeypatch.setitem(
    __import__("modules.ingestion.engine.select", fromlist=["_PANDAS_ENGINE"])._PANDAS_ENGINE,
    "load_source",
    fake_load_source,
)
```
Or more simply, patch `modules.ingestion.tasks.select_engine` itself to return a fake dict for the test:

```python
def fake_select_engine(staging_metadata):
    return {
        "load_source": fake_load_source,
        "apply_transforms": fake_apply_transforms,
        "infer_schema": fake_infer_schema,
        "write_parquet": fake_write_parquet,
        "row_count": len,
        "column_count": lambda df: len(df.columns),
    }

monkeypatch.setattr(tasks_mod, "select_engine", fake_select_engine)
```
Use this last approach — it's the simplest and matches "mock at the seam `tasks.py` actually calls." Apply it to both `test_pipeline_applies_transform_plan` and `test_pipeline_no_transforms_versions_as_is`.

- [ ] **Step 6: Run full backend test suite to verify no regressions**

Run: `cd backend && pytest tests/ -v`
Expected: all tests PASS, including the repaired `test_commit_pipeline.py` cases and Task 1's `test_engine_select.py`.

- [ ] **Step 7: Commit**

```bash
git add backend/modules/ingestion/engine/pandas_engine.py backend/modules/ingestion/engine/select.py backend/modules/ingestion/engine/base.py backend/modules/ingestion/tasks.py backend/tests/test_commit_pipeline.py backend/tests/test_engine_select.py
git commit -m "refactor(ingestion): align pandas engine function names with TransformEngine protocol"
```

---

### Task 3: Fix `TransformPreviewResponse` error attribution and add schema info

**Context:** `POST /transforms/preview` currently catches any exception from `apply_transforms` and always reports it under key `0` in the `errors` dict, regardless of which step actually failed — losing per-step attribution. It also returns only `columns`/`rows`, so the frontend loses column type badges after a preview. Per the spec's item 19, the response should include a `schema` field, and per item 4, "partial failures are handled cleanly."

**Files:**
- Modify: `backend/modules/ingestion/transforms.py` (make `apply_transforms` fail with the offending step index attached)
- Modify: `backend/modules/ingestion/schemas.py` (`TransformPreviewResponse` gains `schema` field)
- Modify: `backend/modules/ingestion/router.py` (`transform_preview` endpoint)
- Test: `backend/tests/test_transform_preview_endpoint.py` (new — also covers Task 6's catalog tests)

**Interfaces:**
- Consumes: `apply_transforms(df, steps)` (existing), `infer_schema` from `modules.ingestion.schema_inference` (existing, already used elsewhere in the codebase per Task 2)
- Produces: `TransformPreviewResponse{columns: list[str], rows: list[list], schema: dict[str, str], errors: dict[int, str]}` — new `schema` field; `errors` now correctly keyed by the failing step's index.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_transform_preview_endpoint.py
import pandas as pd
import pytest

from modules.ingestion.transforms import apply_transforms, TransformStepError


def test_apply_transforms_raises_with_failing_step_index():
    df = pd.DataFrame({"a": [1, 2]})
    steps = [
        {"type": "drop", "column": "a"},
        {"type": "drop", "column": "a"},  # second drop fails: already dropped
    ]
    with pytest.raises(TransformStepError) as exc_info:
        apply_transforms(df, steps)
    assert exc_info.value.step_index == 1


def test_apply_transforms_succeeds_without_raising_error_wrapper():
    df = pd.DataFrame({"a": [1, 2]})
    steps = [{"type": "drop", "column": "a"}]
    result = apply_transforms(df, steps)
    assert list(result.columns) == []
```

```python
# append to backend/tests/test_transform_preview_endpoint.py
import anyio

from modules.ingestion.router import transform_preview
from modules.ingestion.schemas import TransformPreviewRequest


def test_preview_endpoint_returns_schema_and_transformed_rows():
    payload = TransformPreviewRequest(
        columns=["a", "b"],
        rows=[[1, "x"], [2, "y"]],
        steps=[{"type": "drop", "column": "b"}],
    )
    response = anyio.run(transform_preview, payload)
    assert response.columns == ["a"]
    assert response.rows == [[1], [2]]
    assert response.schema == {"a": "integer"}
    assert response.errors == {}


def test_preview_endpoint_reports_correct_failing_step_index():
    payload = TransformPreviewRequest(
        columns=["a"],
        rows=[[1], [2]],
        steps=[
            {"type": "drop", "column": "a"},
            {"type": "drop", "column": "a"},
        ],
    )
    response = anyio.run(transform_preview, payload)
    assert response.errors == {1: pytest_error_substring(response.errors[1])}


def pytest_error_substring(msg: str) -> str:
    # helper so the assertion above just checks the key exists with a non-empty message
    assert isinstance(msg, str) and len(msg) > 0
    return msg
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_transform_preview_endpoint.py -v`
Expected: FAIL — `ImportError: cannot import name 'TransformStepError'` and `AttributeError`/`AssertionError` on `response.schema` not existing.

- [ ] **Step 3: Add `TransformStepError` and wire it into `apply_transforms`**

In `backend/modules/ingestion/transforms.py`, near the top (after `CAST_TYPE_MAP`):

```python
class TransformStepError(Exception):
    """Raised when a specific step in a transform plan fails to apply."""

    def __init__(self, step_index: int, message: str):
        self.step_index = step_index
        super().__init__(f"Step {step_index}: {message}")
```

Wrap the per-step application loop inside `apply_transforms` (the existing `for i, step in enumerate(steps):` — inspect current loop variable name; if it currently iterates without an index, add `enumerate`) so each step's `elif isinstance(...)` block is inside a `try/except Exception as e: raise TransformStepError(i, str(e)) from e`. Concretely, locate the loop that currently begins the long if/elif chain (around line 235 per the current file) and restructure as:

```python
    for i, raw_step in enumerate(steps):
        step = _coerce(raw_step)
        try:
            if isinstance(step, DropStep):
                ...
            elif isinstance(step, RenameStep):
                ...
            # ...(keep all existing elif branches unchanged, just indented one level under the try)...
        except TransformStepError:
            raise
        except Exception as e:
            raise TransformStepError(i, str(e)) from e
```

Do not change any op's internal logic — only wrap the dispatch loop.

- [ ] **Step 4: Update `TransformPreviewResponse` schema**

```python
# backend/modules/ingestion/schemas.py
class TransformPreviewResponse(BaseModel):
    columns: list[str]
    rows: list[list]
    schema: dict[str, str] = Field(default_factory=dict)
    errors: dict[int, str] = Field(default_factory=dict)
```

(Confirm `Field` is already imported in this file — it is, used by `CommitJobRequest`.)

- [ ] **Step 5: Update the `transform_preview` router function**

```python
# backend/modules/ingestion/router.py
@router.post("/transforms/preview", response_model=TransformPreviewResponse)
async def transform_preview(payload: TransformPreviewRequest) -> TransformPreviewResponse:
    df = pd.DataFrame(payload.rows, columns=payload.columns)
    steps_dicts = [s.model_dump() if hasattr(s, "model_dump") else s for s in payload.steps]
    try:
        result = apply_transforms(df, steps_dicts)
    except TransformStepError as e:
        inferred = infer_schema(df)
        return TransformPreviewResponse(
            columns=payload.columns,
            rows=payload.rows,
            schema=inferred,
            errors={e.step_index: str(e)},
        )
    rows = result.where(result.notna(), None).values.tolist()
    inferred = infer_schema(result)
    return TransformPreviewResponse(columns=list(result.columns), rows=rows, schema=inferred, errors={})
```

Add the needed imports at the top of `router.py`: `from modules.ingestion.transforms import OPS_CATALOG, apply_transforms, parse_steps, TransformStepError` (extend the existing import line) and `from modules.ingestion.schema_inference import infer_schema` (add if not already imported — check first; it is likely already imported for the pipeline elsewhere in this file, reuse if so).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_transform_preview_endpoint.py -v`
Expected: PASS (4 passed)

- [ ] **Step 7: Run full backend suite**

Run: `cd backend && pytest tests/ -v`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add backend/modules/ingestion/transforms.py backend/modules/ingestion/schemas.py backend/modules/ingestion/router.py backend/tests/test_transform_preview_endpoint.py
git commit -m "fix(ingestion): attribute preview errors to the failing step and return inferred schema"
```

---

### Task 4: Fix `math` divide-by-zero to act per-cell instead of nulling the whole column

**Context:** Current `MathStep` divide branch does `out[step.column] = col / step.operand if step.operand != 0 else None`, which assigns Python `None` to the entire column when `operand == 0`, destroying all values instead of only the (non-existent, since divide-by-zero only matters when operand is the literal zero scalar, not per-row) — actually since `operand` is a fixed scalar for the whole step, this "whole column is null when operand==0" is arguably correct given operand is constant across rows. But it silently produces a column of Python `None`s mixed into a numeric dtype (object dtype), which is inconsistent with every other op's null-handling (which uses `pd.NA`/`np.nan`). Align it with the rest of the module and add a test.

**Files:**
- Modify: `backend/modules/ingestion/transforms.py` (`MathStep` divide branch)
- Modify: `backend/tests/test_transforms.py` (add math tests)

**Interfaces:**
- Consumes: nothing new
- Produces: `MathStep` with `op="divide"` and `operand=0` now sets the column to `float("nan")` (via `pd.NA` is not needed here — plain `float("nan")` keeps dtype `float64` rather than degrading to `object`), consistent with numeric-NaN semantics used by `zscore`'s zero-std guard.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_transforms.py
def test_math_divide_by_operand_zero_sets_column_to_nan_not_none():
    import pandas as pd
    from modules.ingestion.transforms import apply_transforms

    df = pd.DataFrame({"a": [1, 2, 3]})
    result = apply_transforms(df, [{"type": "math", "column": "a", "op": "divide", "operand": 0}])
    assert result["a"].dtype == "float64"
    assert result["a"].isna().all()


def test_math_add_subtract_multiply_divide_happy_path():
    import pandas as pd
    from modules.ingestion.transforms import apply_transforms

    df = pd.DataFrame({"a": [10, 20]})
    add = apply_transforms(df, [{"type": "math", "column": "a", "op": "add", "operand": 5}])
    assert add["a"].tolist() == [15, 25]
    sub = apply_transforms(df, [{"type": "math", "column": "a", "op": "subtract", "operand": 5}])
    assert sub["a"].tolist() == [5, 15]
    mul = apply_transforms(df, [{"type": "math", "column": "a", "op": "multiply", "operand": 2}])
    assert mul["a"].tolist() == [20, 40]
    div = apply_transforms(df, [{"type": "math", "column": "a", "op": "divide", "operand": 2}])
    assert div["a"].tolist() == [5.0, 10.0]
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `cd backend && pytest tests/test_transforms.py::test_math_divide_by_operand_zero_sets_column_to_nan_not_none -v`
Expected: FAIL — dtype is `object`, not `float64` (or values are `None` not `nan`).

- [ ] **Step 3: Fix the divide branch**

Locate the `MathStep` handling inside `apply_transforms` and change the divide case:

```python
            elif isinstance(step, MathStep):
                col = out[step.column]
                if step.op == "add":
                    out[step.column] = col + step.operand
                elif step.op == "subtract":
                    out[step.column] = col - step.operand
                elif step.op == "multiply":
                    out[step.column] = col * step.operand
                elif step.op == "divide":
                    if step.operand == 0:
                        out[step.column] = float("nan")
                    else:
                        out[step.column] = col / step.operand
```

(Match indentation/structure to whatever the existing branch does for add/subtract/multiply — only replace the divide sub-branch's `else None` with `float("nan")`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_transforms.py -v -k math`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/modules/ingestion/transforms.py backend/tests/test_transforms.py
git commit -m "fix(ingestion): math divide-by-zero yields NaN column, not object-dtype None"
```

---

### Task 5: Fix `replace` op to use literal string replacement, not regex

**Context:** Backend `ReplaceStep` handling calls `.str.replace(step.find, step.repl)` — in current pandas, `Series.str.replace` treats the first argument as a regex pattern unless `regex=False` is passed explicitly (this default has been the source of real bugs across pandas versions). If a user's `find` value contains regex metacharacters (e.g. `.`, `*`, `$`, `(`), the replacement silently does something other than what the user intended, and it's also a latent ReDoS-shaped correctness bug. The frontend's local `apply` implementation uses literal `split/join`, which is the correct/expected behavior — align the backend with it.

**Files:**
- Modify: `backend/modules/ingestion/transforms.py` (`ReplaceStep` branch)
- Modify: `backend/tests/test_transforms.py` (add replace tests)

**Interfaces:**
- Consumes: nothing new
- Produces: `replace` op now performs literal substring replacement regardless of regex metacharacters in `find`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_transforms.py
def test_replace_is_literal_not_regex():
    import pandas as pd
    from modules.ingestion.transforms import apply_transforms

    df = pd.DataFrame({"a": ["a.b.c", "x.y.z"]})
    result = apply_transforms(
        df, [{"type": "replace", "column": "a", "find": ".", "repl": "-"}]
    )
    # literal "." should only replace literal dots, not "any character" (regex semantics)
    assert result["a"].tolist() == ["a-b-c", "x-y-z"]


def test_replace_with_no_match_leaves_value_unchanged():
    import pandas as pd
    from modules.ingestion.transforms import apply_transforms

    df = pd.DataFrame({"a": ["hello"]})
    result = apply_transforms(
        df, [{"type": "replace", "column": "a", "find": "xyz", "repl": "-"}]
    )
    assert result["a"].tolist() == ["hello"]
```

Note: the literal `.` test above happens to produce the same output whether treated as regex-`.`-matches-any-char or as a literal dot, *because* every character in `"a.b.c"` adjacent to the dots would also match `.` as "any char" and produce a different, wrong result — regex-any-char would replace `a`,`.`,`b`,`.`,`c` all with `-` giving `"-----"`. Assert against that too:

```python
def test_replace_regex_metachar_does_not_match_any_character():
    import pandas as pd
    from modules.ingestion.transforms import apply_transforms

    df = pd.DataFrame({"a": ["a.b.c"]})
    result = apply_transforms(
        df, [{"type": "replace", "column": "a", "find": ".", "repl": "-"}]
    )
    assert result["a"].tolist() != ["-----"]
```

- [ ] **Step 2: Run to verify it fails (if pandas' current default is regex=True)**

Run: `cd backend && pytest tests/test_transforms.py -v -k replace`
Expected: FAIL on `test_replace_regex_metachar_does_not_match_any_character` if the installed pandas version defaults to regex interpretation for single-char patterns; may already PASS if pandas' literal-vs-regex heuristic happens to treat a bare `.` as literal — run it first to confirm actual current behavior before assuming.

- [ ] **Step 3: Fix the replace branch to force literal replacement**

```python
            elif isinstance(step, ReplaceStep):
                out[step.column] = out[step.column].str.replace(
                    step.find, step.repl, regex=False
                )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_transforms.py -v -k replace`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/modules/ingestion/transforms.py backend/tests/test_transforms.py
git commit -m "fix(ingestion): replace op uses literal string matching, not regex"
```

---

### Task 6: Reconcile `split` semantics between backend and frontend

**Context:** Backend `SplitStep` keeps the original column and adds `{column}.1`/`{column}.2`. Frontend's local `split.apply` removes the original column and inserts the two new ones in its place. Since the frontend currently does 100% client-side execution (Task 8 changes this to prefer backend-authoritative preview), these must agree or the user will see different results depending on which path renders. Decide backend behavior is canonical (matches the "keep original, add derived columns" pattern of every other derived-column op like `merge`/`duplicate`), and change the frontend's `apply` to match.

**Files:**
- Modify: `frontend/src/lib/transforms/transforms.ts` (`split.apply`)
- Test: manual verification via existing frontend build (no frontend test harness exists in this repo per `backend/README.md` notes — confirm no `frontend/src/**/*.test.ts` exists before skipping automated tests)

**Interfaces:**
- Consumes: nothing new
- Produces: `OPS.split.apply(table, params)` now keeps the original column and appends `{column}.1`/`{column}.2`, matching backend `SplitStep`.

- [ ] **Step 1: Check for an existing frontend test harness**

Run: `find frontend/src -iname '*.test.ts' -o -iname '*.test.tsx' -o -iname '*.spec.ts'`
Expected: no output (confirms no test harness exists yet — if one is found, add a unit test for this fix following that harness's conventions instead of skipping to Step 2).

- [ ] **Step 2: Read the current `split.apply` implementation**

Read `frontend/src/lib/transforms/transforms.ts`, locate the `split` entry in `OPS`, and inspect its current `apply` function to see exactly how it removes/replaces the original column.

- [ ] **Step 3: Rewrite `split.apply` to keep the original column**

Replace the body so that instead of splicing out the original column index, it appends the two derived columns at the end, e.g. (adapt exact variable names to match the file's existing helper usage such as `ci`/`need`):

```typescript
  split: {
    cat: "Text",
    label: "Split Column",
    desc: "Split a column into two by a delimiter",
    fields: [
      { key: "column", label: "Column", kind: "column" },
      { key: "sep", label: "Delimiter", kind: "text", placeholder: "," },
    ],
    lbl: (p) => `Split ${p.column} by "${p.sep ?? ","}"`,
    code: (p) => `df[["${p.column}.1", "${p.column}.2"]] = df["${p.column}"].str.split("${p.sep ?? ","}", n=1, expand=True)`,
    apply: (t, p) => {
      const i = need(t, String(p.column));
      const sep = String(p.sep ?? ",");
      const col1 = `${p.column}.1`;
      const col2 = `${p.column}.2`;
      const rows = t.rows.map((r) => {
        const raw = r[i];
        const [a, b] = typeof raw === "string" ? raw.split(sep) : [raw, undefined];
        return [...r, a ?? null, b ?? null];
      });
      return {
        columns: [...t.columns, { name: col1, type: "string" }, { name: col2, type: "string" }],
        rows,
      };
    },
  },
```

(Keep whatever the file's existing `need`/`ci` helper signatures actually are — read them first per Step 2 and match exactly; do not invent new helper signatures.)

- [ ] **Step 4: Run TypeScript compilation to verify no type errors**

Run: `npm --prefix frontend run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/transforms/transforms.ts
git commit -m "fix(frontend): split op keeps original column, matching backend SplitStep"
```

---

### Task 7: Add backend test coverage for the 18 untested transform ops

**Context:** `test_transforms.py` only covers the original 5 ops (drop/rename/cast/filter/fillna). The 18 new ops (duplicate, merge, dropnulls, dedupe, keeptop, upper, lower, capitalize, trim, replace*, split*, extract, length, round, abs, math*, zscore, datepart) — *replace, split, math already partially covered by Tasks 4-6's tests — have zero coverage otherwise. Add tests for parsing/validation and `apply_transforms` behavior for each.

**Files:**
- Modify: `backend/tests/test_transforms.py`

**Interfaces:**
- Consumes: `apply_transforms`, `parse_steps`, and the 18 step model classes from `backend/modules/ingestion/transforms.py` (all already defined, no signature changes needed)
- Produces: nothing new — test-only task

- [ ] **Step 1: Add parsing/validation tests**

```python
# append to backend/tests/test_transforms.py
import pandas as pd
import pytest
from pydantic import ValidationError

from modules.ingestion.transforms import apply_transforms, parse_steps


def test_parse_duplicate_step():
    steps = parse_steps([{"type": "duplicate", "column": "a"}])
    assert steps[0].type == "duplicate"
    assert steps[0].column == "a"


def test_parse_merge_step_defaults():
    steps = parse_steps([{"type": "merge", "column": "a", "column2": "b"}])
    assert steps[0].sep == ""
    assert steps[0].to == "merged"


def test_parse_keeptop_step_rejects_negative_n():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "keeptop", "n": -1}])


def test_parse_math_step_rejects_bad_op():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "math", "column": "a", "op": "modulo", "operand": 2}])


def test_parse_datepart_step_rejects_bad_part():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "datepart", "column": "a", "part": "hour"}])
```

- [ ] **Step 2: Run to verify tests pass (parsing already implemented, these should pass immediately)**

Run: `cd backend && pytest tests/test_transforms.py -v -k "duplicate or merge or keeptop_step_rejects or math_step_rejects or datepart_step_rejects"`
Expected: PASS (5 passed) — confirms existing validators work; if any fail, fix the corresponding Pydantic validator in `transforms.py` to match the spec (this is the one place a fix might be needed if validation was never actually wired for `keeptop`/`math`/`datepart`).

- [ ] **Step 3: Add `apply_transforms` behavior tests for every remaining untested op**

```python
def test_apply_duplicate_creates_copy_column():
    df = pd.DataFrame({"a": [1, 2]})
    result = apply_transforms(df, [{"type": "duplicate", "column": "a"}])
    assert "a_copy" in result.columns or f"a.copy" in result.columns  # confirm exact naming from transforms.py
    # NOTE: verify the actual generated column name in transforms.py's DuplicateStep branch and assert precisely


def test_apply_merge_concatenates_two_columns():
    df = pd.DataFrame({"first": ["a", "b"], "last": ["x", "y"]})
    result = apply_transforms(
        df, [{"type": "merge", "column": "first", "column2": "last", "sep": " ", "to": "full"}]
    )
    assert result["full"].tolist() == ["a x", "b y"]


def test_apply_dropnulls_removes_rows_with_null_in_column():
    df = pd.DataFrame({"a": [1, None, 3]})
    result = apply_transforms(df, [{"type": "dropnulls", "column": "a"}])
    assert result["a"].tolist() == [1, 3]


def test_apply_dedupe_removes_duplicate_rows():
    df = pd.DataFrame({"a": [1, 1, 2]})
    result = apply_transforms(df, [{"type": "dedupe"}])
    assert len(result) == 2


def test_apply_keeptop_limits_row_count():
    df = pd.DataFrame({"a": range(10)})
    result = apply_transforms(df, [{"type": "keeptop", "n": 3}])
    assert len(result) == 3


def test_apply_upper_lower_capitalize_trim():
    df = pd.DataFrame({"a": ["  Hi There  "]})
    assert apply_transforms(df, [{"type": "trim", "column": "a"}])["a"].tolist() == ["Hi There"]
    assert apply_transforms(df, [{"type": "upper", "column": "a"}])["a"].tolist() == ["  HI THERE  "]
    assert apply_transforms(df, [{"type": "lower", "column": "a"}])["a"].tolist() == ["  hi there  "]
    df2 = pd.DataFrame({"a": ["hello world"]})
    assert apply_transforms(df2, [{"type": "capitalize", "column": "a"}])["a"].tolist() == ["Hello world"]


def test_apply_extract_returns_substring():
    df = pd.DataFrame({"a": ["hello"]})
    result = apply_transforms(df, [{"type": "extract", "column": "a", "start": 1, "len": 3}])
    assert result["a"].tolist() == ["ell"]


def test_apply_length_returns_string_length():
    df = pd.DataFrame({"a": ["hi", "world"]})
    result = apply_transforms(df, [{"type": "length", "column": "a"}])
    assert result["a"].tolist() == [2, 5]


def test_apply_round_and_abs():
    df = pd.DataFrame({"a": [-1.567, 2.345]})
    rounded = apply_transforms(df, [{"type": "round", "column": "a", "n": 1}])
    assert rounded["a"].tolist() == [-1.6, 2.3]
    absolute = apply_transforms(df, [{"type": "abs", "column": "a"}])
    assert absolute["a"].tolist() == [1.567, 2.345]


def test_apply_zscore_normalizes_column():
    df = pd.DataFrame({"a": [1.0, 2.0, 3.0]})
    result = apply_transforms(df, [{"type": "zscore", "column": "a"}])
    assert abs(result["a"].mean()) < 1e-9


def test_apply_zscore_zero_std_returns_original_column():
    df = pd.DataFrame({"a": [5.0, 5.0, 5.0]})
    result = apply_transforms(df, [{"type": "zscore", "column": "a"}])
    assert result["a"].tolist() == [5.0, 5.0, 5.0]


def test_apply_datepart_extracts_year_month_day():
    df = pd.DataFrame({"a": ["2024-03-15"]})
    result = apply_transforms(df, [{"type": "datepart", "column": "a", "part": "year"}])
    assert "a_year" in result.columns
    assert result["a_year"].tolist() == [2024]


def test_apply_datepart_invalid_date_becomes_null():
    df = pd.DataFrame({"a": ["not-a-date"]})
    result = apply_transforms(df, [{"type": "datepart", "column": "a", "part": "month"}])
    assert result["a_month"].isna().all()
```

Before finalizing `test_apply_duplicate_creates_copy_column`, read the actual `DuplicateStep` branch in `transforms.py` to get the exact generated column name and replace the loose assertion with a precise one (this is flagged inline above — resolve before committing).

- [ ] **Step 4: Run the full new test set**

Run: `cd backend && pytest tests/test_transforms.py -v`
Expected: all PASS. Fix any assertion whose exact expected value doesn't match actual op behavior discovered while running (e.g., exact `duplicate` column-naming convention, exact `extract` slicing semantics) — read the corresponding branch in `transforms.py` to confirm intended behavior rather than guessing twice.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_transforms.py
git commit -m "test(ingestion): add coverage for 18 previously untested transform ops"
```

---

### Task 8: Add API tests for `/transforms/ops` and expand `/transforms/preview` coverage

**Files:**
- Modify: `backend/tests/test_transform_preview_endpoint.py` (from Task 3)

**Interfaces:**
- Consumes: `OPS_CATALOG` from `backend/modules/ingestion/transforms.py`, `list_ops`/`transform_preview` from `backend/modules/ingestion/router.py`
- Produces: nothing new — test-only task

- [ ] **Step 1: Write tests**

```python
# append to backend/tests/test_transform_preview_endpoint.py
from modules.ingestion.router import list_ops
from modules.ingestion.transforms import OPS_CATALOG


def test_list_ops_returns_all_23_catalog_entries():
    result = list_ops()
    assert len(result) == 23
    assert set(result.keys()) == set(OPS_CATALOG.keys())


def test_every_catalog_entry_has_required_fields():
    for key, entry in OPS_CATALOG.items():
        assert "cat" in entry, key
        assert "label" in entry, key
        assert "desc" in entry, key
        assert "fields" in entry, key
        assert "lbl_template" in entry, key
        for field in entry["fields"]:
            assert field["kind"] in ("column", "select", "text", "number"), (key, field)


def test_preview_endpoint_empty_steps_returns_input_unchanged():
    payload = TransformPreviewRequest(columns=["a"], rows=[[1], [2]], steps=[])
    response = anyio.run(transform_preview, payload)
    assert response.columns == ["a"]
    assert response.rows == [[1], [2]]
    assert response.errors == {}


def test_preview_endpoint_nan_becomes_null():
    payload = TransformPreviewRequest(
        columns=["a"],
        rows=[[1], [None]],
        steps=[{"type": "cast", "column": "a", "to_type": "decimal"}],
    )
    response = anyio.run(transform_preview, payload)
    assert response.rows[1] == [None]
```

(`TransformPreviewRequest`, `anyio` already imported at top of this test file from Task 3 — reuse those imports.)

- [ ] **Step 2: Run to verify pass**

Run: `cd backend && pytest tests/test_transform_preview_endpoint.py -v`
Expected: all PASS (8 total across Task 3 + Task 8 additions)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_transform_preview_endpoint.py
git commit -m "test(ingestion): cover /transforms/ops catalog shape and preview edge cases"
```

---

### Task 9: Frontend — fetch the op catalog from the backend on page load

**Context:** `DataTransformPage.tsx` currently imports `OPS, CATS, OP_KEYS` directly from the local `transforms.ts` module and never calls `GET /transforms/ops`. Per the spec, the backend catalog should become the source of truth for menu rendering; the local `OPS` module should be kept only for its `apply` functions (client-side preview acceleration), not as the source of menu metadata.

**Files:**
- Modify: `frontend/src/features/data-transform/DataTransformPage.tsx`
- Modify: `frontend/src/lib/transforms/transforms.ts` (export a type for the backend catalog shape and a helper to merge it with local `apply` functions)

**Interfaces:**
- Consumes: `GET /data-ingest/transforms/ops` → `Record<string, {cat, label, desc, fields: FieldDef[], lbl_template: string}>` (already implemented backend-side per Task 3's context, unchanged by this plan)
- Produces: `formatLabel(template: string, params: TransformParams): string` (new export in `transforms.ts`, used by Task 10); `PipelineStudio` component gains `remoteOps: Record<string, RemoteOpMeta> | null` state, fetched once on mount.

- [ ] **Step 1: Add `RemoteOpMeta` type and `formatLabel` helper to `transforms.ts`**

```typescript
// frontend/src/lib/transforms/transforms.ts — add near the other exported types
export interface RemoteOpMeta {
  cat: string;
  label: string;
  desc: string;
  fields: FieldDef[];
  lbl_template: string;
}

export function formatLabel(template: string, params: TransformParams): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}
```

- [ ] **Step 2: Fetch the catalog in `PipelineStudio`**

Locate the existing `useEffect` blocks in `DataTransformPage.tsx` (currently at lines ~130-175 handling dataset selection and preview/staged loading). Add a new one that runs once on mount:

```typescript
  const [remoteOps, setRemoteOps] = useState<Record<string, RemoteOpMeta> | null>(null);
  const [remoteOpsError, setRemoteOpsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/data-ingest/transforms/ops`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load transform catalog (${res.status})`);
        return res.json();
      })
      .then((data: Record<string, RemoteOpMeta>) => {
        if (!cancelled) setRemoteOps(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setRemoteOpsError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

(Match whatever base-URL constant the file already uses for other fetches, e.g. `import.meta.env.VITE_API_BASE_URL` or a shared `apiFetch` helper — read the existing `fetch` calls in this file, at the staged-preview and commit-job call sites, to find the exact constant/helper name and reuse it instead of inventing `API_BASE`.)

- [ ] **Step 3: Derive `opGroups`/menu rendering from `remoteOps` with a fallback to local `OPS`**

Find the existing `opGroups` derivation (built from `CATS`/`OP_KEYS`/`OPS` per the earlier investigation). Change it to prefer `remoteOps` when loaded, falling back to local `OPS` while the fetch is in flight or if it failed (so the UI isn't blank on a slow/broken network):

```typescript
  const opsSource: Record<string, RemoteOpMeta> = remoteOps ?? OPS;
  const opGroups = useMemo(() => {
    const groups: Record<string, Array<{ key: string; meta: RemoteOpMeta }>> = {};
    for (const [key, meta] of Object.entries(opsSource)) {
      (groups[meta.cat] ??= []).push({ key, meta });
    }
    return groups;
  }, [opsSource]);
```

Update every render site that previously indexed `OPS[key].cat/label/desc/fields` for menu display to instead read from `opsSource[key]` (same field names — `cat`, `label`, `desc`, `fields` — only `lbl_template` differs from local `OPS`, handled in Task 10). Import `useMemo` if not already imported.

- [ ] **Step 4: Run TypeScript compilation**

Run: `npm --prefix frontend run build`
Expected: succeeds. Fix any remaining direct `OPS[...]` menu-metadata references flagged by the compiler as unused/mismatched.

- [ ] **Step 5: Manual verification**

Run: `make frontend` (or `npm --prefix frontend run dev` if `make frontend` expects Docker deps not relevant here), open the Data Transform page in a browser, open the browser devtools Network tab, confirm a `GET /data-ingest/transforms/ops` request fires on page load and the menu categories/labels render identically to before.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/data-transform/DataTransformPage.tsx frontend/src/lib/transforms/transforms.ts
git commit -m "feat(frontend): fetch transform op catalog from backend, fall back to local OPS"
```

---

### Task 10: Frontend — replace `.lbl(...)` calls with `formatLabel(lbl_template, params)`

**Context:** Once menu metadata comes from `remoteOps` (Task 9), `opsSource[key]` is a `RemoteOpMeta` with `lbl_template: string`, not the local `OPS[key].lbl: (params) => string` function. Every call site that currently does `OPS[step.op].lbl(step.params)` (including the exported `stepLabel` helper in `transforms.ts` and any inline fx-bar rendering in `DataTransformPage.tsx`) must switch to `formatLabel(opsSource[step.op].lbl_template, step.params)`.

**Files:**
- Modify: `frontend/src/lib/transforms/transforms.ts` (`stepLabel`)
- Modify: `frontend/src/features/data-transform/DataTransformPage.tsx` (fx-bar / step-list label rendering)

**Interfaces:**
- Consumes: `formatLabel` from Task 9, `RemoteOpMeta.lbl_template`
- Produces: `stepLabel` now requires the active ops source as a parameter (signature change — call sites updated accordingly)

- [ ] **Step 1: Update `stepLabel` signature**

```typescript
// frontend/src/lib/transforms/transforms.ts
export function stepLabel(
  s: { type: string; [key: string]: unknown },
  opsSource: Record<string, RemoteOpMeta> = OPS
): string {
  const meta = opsSource[s.type];
  if (!meta) return s.type;
  const template = "lbl_template" in meta ? meta.lbl_template : undefined;
  if (template) return formatLabel(template, s as unknown as TransformParams);
  // local OPS entries still expose a .lbl function — support both during transition
  const localMeta = OPS[s.type];
  return localMeta ? localMeta.lbl(s as unknown as TransformParams) : s.type;
}
```

- [ ] **Step 2: Grep for every `.lbl(` call site in `DataTransformPage.tsx`**

Run: `grep -n '\.lbl(' frontend/src/features/data-transform/DataTransformPage.tsx`

- [ ] **Step 3: Replace each call site**

For each match found in Step 2, replace `OPS[x.op].lbl(x.params)` (or equivalent) with `stepLabel({ type: x.op, ...x.params }, opsSource)`, passing the `opsSource` variable established in Task 9 Step 3. Also replace the fx-bar's `OPS[activeStep.op].code(activeStep.params)` call — leave this one as-is, calling local `OPS[...].code(...)` directly, since the backend catalog has no `code` field (the fx-bar's pandas-snippet display is a client-only nicety, not part of the backend contract) — confirm this is intentional and note it stays on `OPS`, not `opsSource`, since `remoteOps` entries don't have a `code` field.

- [ ] **Step 4: Run TypeScript compilation**

Run: `npm --prefix frontend run build`
Expected: succeeds with no errors, no remaining bare `.lbl(` calls outside `transforms.ts` itself.

- [ ] **Step 5: Manual verification**

In the browser, add several transform steps via the menu and confirm the step list and fx-bar show correctly formatted labels (e.g. "Drop b", "Cast a → integer").

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/transforms/transforms.ts frontend/src/features/data-transform/DataTransformPage.tsx
git commit -m "refactor(frontend): render step labels from backend lbl_template via formatLabel"
```

---

### Task 11: Frontend — replace live recompute with explicit "Apply Preview" flow

**Context:** `computeTable(src, steps)` currently runs synchronously in the component body on every render (line ~193: `const full = src ? computeTable(src, steps) : ...`), meaning every keystroke/step edit recomputes the entire pipeline immediately using client-side `OPS[...].apply`. Per the spec, this should change to: edits mark the preview as stale; the displayed table stays at the last-applied result (or the raw source if nothing has been applied yet); clicking "Apply Preview" calls the backend's `/transforms/preview` (server-authoritative) and updates the displayed table. Local `apply` functions may still be used as an optimization but are no longer required for correctness.

**Files:**
- Modify: `frontend/src/features/data-transform/DataTransformPage.tsx`

**Interfaces:**
- Consumes: `POST /data-ingest/transforms/preview` (existing backend endpoint, response now includes `schema` per Task 3): request body `{columns: string[], rows: unknown[][], steps: Array<{type: string, [param: string]: unknown}>}`, response `{columns: string[], rows: unknown[][], schema: Record<string,string>, errors: Record<number,string>}`
- Produces: new state `appliedTable: Table | null`, `appliedSchema: Record<string,string> | null`, `previewErrors: Record<number,string>`, `previewLoading: boolean`, `previewDirty: boolean`; removes the always-on `computeTable(src, steps)` call from the render body.

- [ ] **Step 1: Add new state and remove the always-on `computeTable` call**

Replace the line `const full = src ? computeTable(src, steps) : {table: emptyTable, errors: {}};` with:

```typescript
  const [appliedTable, setAppliedTable] = useState<Table | null>(null);
  const [appliedSchema, setAppliedSchema] = useState<Record<string, string> | null>(null);
  const [previewErrors, setPreviewErrors] = useState<Record<number, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDirty, setPreviewDirty] = useState(false);

  const displayedTable = appliedTable ?? src ?? emptyTable;
```

- [ ] **Step 2: Mark preview stale whenever steps change**

Find `mutateSteps` (the shared setter used by `instantStep`, `commitBuilder`, `editStep`, `removeStep`, undo/redo) and add `setPreviewDirty(true);` inside it, right after it updates `steps`/`past`/`future`. This must cover: adding a step, editing a step, removing a step, undo, and redo — confirm all these code paths funnel through `mutateSteps` (per the earlier investigation they do, via the shared `past`/`future` snapshot mechanism); if any of them bypass it, add `setPreviewDirty(true)` there too.

- [ ] **Step 3: Implement `applyPreview()`**

```typescript
  async function applyPreview() {
    if (!src) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(`${API_BASE}/data-ingest/transforms/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: src.columns.map((c) => c.name),
          rows: src.rows,
          steps: steps.map((s) => ({ type: s.op, ...s.params })),
        }),
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      const data: { columns: string[]; rows: unknown[][]; schema: Record<string, string>; errors: Record<number, string> } =
        await res.json();
      setAppliedTable({
        columns: data.columns.map((name) => ({ name, type: data.schema[name] ?? "string" })),
        rows: data.rows,
      });
      setAppliedSchema(data.schema);
      setPreviewErrors(data.errors);
      setPreviewDirty(false);
    } catch (err) {
      setPreviewErrors({ [-1]: err instanceof Error ? err.message : "Preview failed" });
    } finally {
      setPreviewLoading(false);
    }
  }
```

(Use whatever base-URL constant/helper Task 9 established for `API_BASE`.)

- [ ] **Step 4: Add the "Apply Preview" button and stale indicator**

In the render section (near where the existing "Save & Apply" button lives per the step-builder panel), add:

```tsx
        <div className="flex items-center gap-2">
          <button
            className="btn"
            onClick={applyPreview}
            disabled={previewLoading || steps.length === 0}
          >
            {previewLoading ? "Applying…" : "Apply Preview"}
          </button>
          {previewDirty && steps.length > 0 && (
            <span className="text-xs text-amber-600">Preview out of date</span>
          )}
        </div>
```

Place this in both render paths that currently show step controls — for import mode, it sits alongside "Save & Apply" (which stays a separate, always-visible action per spec item 16); for normal preview mode, only "Apply Preview" is shown (no "Save & Apply" — confirm by reading the existing conditional around `tab === "import"` that already gates the "Save & Apply" button, and add "Apply Preview" outside that conditional so it always shows).

- [ ] **Step 5: Wire all downstream renders (grid, stats, fx bar) to `displayedTable`/`appliedSchema`/`previewErrors` instead of the old `full.table`/`full.errors`**

Grep for every remaining reference to the removed `full` variable:

Run: `grep -n '\bfull\.' frontend/src/features/data-transform/DataTransformPage.tsx`

Replace `full.table` → `displayedTable`, `full.errors` → `previewErrors`. For column type badges that previously came from client-computed types, prefer `appliedSchema` when present, falling back to the original `src` column types otherwise.

- [ ] **Step 6: Simplify or remove "viewing past step" intermediate computation**

Per spec item 18, recommendation is to simplify. The existing `viewingPast`/`activeStepIndex` banner reads intermediate pipeline state at an earlier step. Since preview is no longer always-live, remove any code path that called `computeTable(src, steps, activeStepIndex)` to show an intermediate table, and instead have "viewing past step" only affect which step is highlighted/selected in the step list (for edit purposes), not what table is displayed. Update the banner text if needed to reflect this simplification, e.g. keep it only as "Editing step {n} of {total}" without implying a different table is shown.

- [ ] **Step 7: Run TypeScript compilation**

Run: `npm --prefix frontend run build`
Expected: succeeds, no references to the removed `full` variable or `computeTable` remain in the render path (function itself can stay exported from the file if still used elsewhere, e.g. as the "optimization" path in Task 12 — otherwise remove it if fully dead per YAGNI).

- [ ] **Step 8: Manual verification**

Run: `npm --prefix frontend run dev`, open the Data Transform page:
- Add a step → confirm the grid does NOT change immediately, and "Preview out of date" appears.
- Click "Apply Preview" → confirm the grid updates to the transformed result and the stale note disappears.
- In import mode, confirm both "Apply Preview" and "Save & Apply" buttons are visible and behave independently (Apply Preview does not call `/commit`; Save & Apply still works as before).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/data-transform/DataTransformPage.tsx
git commit -m "feat(frontend): replace live pipeline recompute with explicit Apply Preview action"
```

---

### Task 12: Keep local `apply` as an optional fast-path optimization (optional, do last)

**Context:** Spec item 10/14 allows local op implementations as a preview-acceleration optimization, not as the source of truth. This task is explicitly optional — implement only if Task 11 is verified working and there's appetite for reduced latency; otherwise stop after Task 11 (server-only-on-click already satisfies the spec's "lower clunkiness and fewer requests" goal per item 14's own note).

**Files:**
- Modify: `frontend/src/features/data-transform/DataTransformPage.tsx` (`applyPreview`)

**Interfaces:**
- Consumes: local `OPS[key].apply` (existing, from `transforms.ts`)
- Produces: `applyPreview()` tries local computation first; falls back to the server call only if any step's op key is missing from local `OPS` or a local `apply` throws.

- [ ] **Step 1: Add a local-first attempt inside `applyPreview`**

```typescript
  async function applyPreview() {
    if (!src) return;
    setPreviewLoading(true);
    const canComputeLocally = steps.every((s) => s.op in OPS);
    if (canComputeLocally) {
      try {
        const { table, errors } = computeTable(src, steps);
        if (Object.keys(errors).length === 0) {
          setAppliedTable(table);
          setAppliedSchema(null); // local compute doesn't infer types; fall back to src types in render
          setPreviewErrors({});
          setPreviewDirty(false);
          setPreviewLoading(false);
          return;
        }
      } catch {
        // fall through to server preview
      }
    }
    // ...(existing fetch-based implementation from Task 11 Step 3, unchanged)
  }
```

- [ ] **Step 2: Run TypeScript compilation**

Run: `npm --prefix frontend run build`
Expected: succeeds.

- [ ] **Step 3: Manual verification**

Confirm "Apply Preview" still works and feels at least as fast for common ops (drop/rename/cast), and correctly falls back to the server for any op not in local `OPS` (there shouldn't be any, since local `OPS` mirrors all 23 backend ops — this fallback exists for safety/future drift, not because a gap exists today).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/data-transform/DataTransformPage.tsx
git commit -m "perf(frontend): try local transform compute before falling back to server preview"
```

---

### Task 13: Update `backend/README.md`

**Files:**
- Modify: `backend/README.md`

- [ ] **Step 1: Update § "2. Data Ingestion Pipeline"**

Add `staging_metadata` to the job/database-tables description (fields: `file_size`, `row_count` (nullable), `column_count`, `source_format`), and add a short note on the engine-selection layer (`modules/ingestion/engine/`) — currently pandas-only, selection based on `staging_metadata`, ready for future DuckDB/Polars backends.

- [ ] **Step 2: Update § "3. Data Transform"**

Document the 23-op transform catalog (list categories: Columns, Rows, Text, Numeric, Date & Time), and the two endpoints:
- `GET /data-ingest/transforms/ops` → returns `OPS_CATALOG`, the canonical op metadata used to render the frontend's transform menus.
- `POST /data-ingest/transforms/preview` → stateless preview execution over a sampled table; request `{columns, rows, steps}`, response `{columns, rows, schema, errors}` (errors keyed by the failing step's index).

- [ ] **Step 3: Append Changelog entry**

```markdown
### 2026-07-05 — Unified transform catalog and engine abstraction

- Backend `OPS_CATALOG` (23 ops across Columns/Rows/Text/Numeric/Date & Time) is now the source of truth for the frontend's transform menus, served via `GET /data-ingest/transforms/ops`.
- `POST /data-ingest/transforms/preview` now attributes errors to the failing step index and returns inferred column types (`schema` field).
- Fixed `engine/__init__.py` importing a nonexistent `PandasEngine` class; engine function-dict keys now match the `TransformEngine` protocol method names (`load_source`, `apply_transforms`, `infer_schema`, `write_parquet`, `row_count`, `column_count`).
- Fixed `replace` op to use literal string matching instead of regex, and `math` divide-by-zero to yield a NaN-typed column instead of an object-dtype `None` column.
- Added `staging_metadata` (file_size, row_count, column_count, source_format) to `IngestionJob`, populated at job creation for both file-upload and DB-source jobs.
```

- [ ] **Step 4: Commit**

```bash
git add backend/README.md
git commit -m "docs(backend): document unified transform catalog, preview contract, and engine abstraction"
```

---

### Task 14: Update `frontend/README.md`

**Files:**
- Modify: `frontend/README.md`

- [ ] **Step 1: Update § "Pages & Routes" or § "API Integration"**

Add a note under the Data Transform page entry: transform menu metadata is now fetched from the backend (`GET /data-ingest/transforms/ops`) rather than hardcoded; local `OPS` catalog in `src/lib/transforms/transforms.ts` is retained only as a client-side preview optimization. Preview is no longer recomputed on every edit — the user must click "Apply Preview" (calls `POST /data-ingest/transforms/preview`), and edits mark the preview as stale until re-applied.

- [ ] **Step 2: Append Changelog entry**

```markdown
### 2026-07-05 — Backend-driven transform catalog, explicit Apply Preview

- DataTransformPage now fetches its transform-op menu metadata from `GET /data-ingest/transforms/ops` instead of a hardcoded catalog; local `transforms.ts` `OPS` is kept only as a fast-path preview optimization.
- Preview no longer recomputes live on every step edit — edits mark the preview as stale ("Preview out of date"); users click "Apply Preview" to recompute via the backend, keeping Save & Apply (commit) a separate, authoritative action.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/README.md
git commit -m "docs(frontend): document backend-driven op catalog and explicit Apply Preview flow"
```

---

### Task 15: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && pytest tests/ -v`
Expected: all tests pass, including all new tests from Tasks 1, 3, 4, 5, 7, 8 and repaired tests from Task 2.

- [ ] **Step 2: Run frontend build**

Run: `npm --prefix frontend run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Manual end-to-end walkthrough**

Start the stack (`make run` or `make backend` + `make frontend` + Celery worker per `backend/README.md`), then:
1. Upload a CSV via the Data Import flow.
2. Confirm the staged preview loads.
3. Add 2-3 transform steps in DataTransformPage without the grid changing.
4. Click "Apply Preview" — confirm the grid updates and matches the steps applied.
5. Click "Save & Apply" — confirm the job reaches SUCCESS and the committed dataset version reflects the same transforms as the last-applied preview.

- [ ] **Step 4: Report any discrepancies found during manual walkthrough**

If step 3's manual walkthrough surfaces any behavior mismatch between preview and commit (e.g. an op behaves differently in `apply_transforms` used by both endpoints, which it shouldn't since both share the same function — but confirm empirically), file it as a follow-up rather than silently patching without a task/test, since this plan's scope ends at verification.
