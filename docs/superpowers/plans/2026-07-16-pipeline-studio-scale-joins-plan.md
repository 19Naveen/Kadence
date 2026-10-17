# Pipeline Studio: Scale + Joins — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-16-pipeline-studio-scale-joins-design.md`
**Branch:** `enchancement/backend`

Tasks are ordered; each is independently committable. Agent column = delegation target.

---

## Task 1 — Streaming upload (Sonnet)

**Files:** `backend/modules/ingestion/router.py`, `backend/infrastructure/blob/minio_client.py`

- Replace `await file.read()` in `create_job_from_file` with chunked streaming to MinIO:
  add `upload_staging_stream(fileobj, staging_path, length=-1, part_size=8MB)` to
  `minio_client.py` using `put_object` with `part_size` (MinIO SDK supports unknown
  length with `length=-1, part_size`). FastAPI's `UploadFile.file` is a SpooledTemporaryFile —
  pass it directly.
- Compute `file_size` after upload via `stat_object` (or count while streaming with a
  wrapper). Empty file → 400 (keep existing check, now via size==0 after stream or a
  first-chunk peek).
- Keep path-traversal protections as-is.
- Test: `backend/tests/test_upload_streaming.py` — multi-part-sized in-memory file
  uploads via TestClient, asserts staging object exists with right size and no full
  read into memory (monkeypatch `upload_staging_file` absent / assert stream fn called).

**Verify:** upload a CSV via TestClient; job created with correct `staging_metadata.file_size`.

## Task 2 — DuckDB engine + step→SQL compiler + parity suite (Opus)

**Files:** `backend/modules/ingestion/engine/duckdb_engine.py` (new),
`backend/modules/ingestion/engine/sql_compiler.py` (new),
`backend/modules/ingestion/engine/select.py`, `backend/modules/ingestion/tasks.py`,
`backend/core/config.py`

- `sql_compiler.py`: `compile_plan(steps: list[TransformStep], source_rel: str) -> str`
  — builds a chained-CTE SELECT applying each of the 23 ops in order. Each op gets a
  `_compile_<type>(step, cols)` producing the next CTE; tracks live column list to mirror
  pandas "skip if column missing" semantics. Identifier quoting via existing DB quoting
  helper or `duckdb` `"` escaping. Values parameterized/escaped (no injection from step
  values).
- `duckdb_engine.py`: implements the engine dict keys plus fused
  `run(job, transforms, storage_path) -> {row_count, column_count, schema, file_size}`:
  opens the shared `_connect()`-style httpfs connection (reuse/extract from
  `modules/query/duckdb_executor.py` into `infrastructure/` or import it), reads staging
  (csv/xlsx→via pandas fallback for xlsx sheets? — xlsx: load via pandas then register;
  csv/parquet: native readers), applies compiled SQL, `COPY (…) TO 's3://…' (FORMAT PARQUET)`,
  then `stat_object` for file_size and `DESCRIBE`/`count(*)` for stats.
- `select.py`: threshold from `settings.TRANSFORM_ENGINE_THRESHOLD_BYTES` (default
  524288000); metadata missing → pandas.
- `tasks.py`: if engine provides `run`, call it; else existing per-key flow.
- Map SQL failures → `TransformStepError(step_index, …)` by compiling/executing
  incrementally on error to locate the failing step (only on failure path — happy path
  stays single-shot).
- Parity suite `backend/tests/test_engine_parity.py`: fixture DataFrame covering nulls,
  strings, numerics, timestamps; every op through pandas `apply_transforms` and through
  compiler+DuckDB; assert equal (documented dtype tolerances).

**Verify:** parity suite green; a >threshold synthetic parquet commits through the DuckDB
path end-to-end against local MinIO.

## Task 3 — Join step, both engines + ownership (Opus)

**Files:** `backend/modules/ingestion/transforms.py`, both engines,
`backend/modules/ingestion/router.py` (preview endpoint), `backend/modules/ingestion/service.py`

- `JoinStep {type:"join", dataset_id: UUID, left_on: str, right_on: str, how: Literal[inner,left,right,full]}`
  added to union + `OPS_CATALOG` (cat "Combine", field kinds: `dataset`, `column`,
  `column_right`, `select`).
- Resolution helper `resolve_join_source(db, dataset_id, owner_id) -> storage_path`:
  latest version + ownership chain (reuse existing workspace-ownership guard). Called
  at preview and at commit-time validation; Celery task re-resolves at run time.
- Pandas path: right side read via DuckDB `read_parquet` → df (preview cap 100k rows,
  full run uncapped), `pd.merge(left, right, left_on, right_on, how, suffixes=("","_right"))`.
- DuckDB path: compiler emits JOIN CTE with explicit right-column aliasing matching the
  pandas suffix rule; `how=full` ↔ pandas `outer`.
- `/transforms/preview` gains `db: Session` + `get_current_user` deps; join steps in the
  plan resolve+authorize right datasets; unauthorized → 404 (not 403, don't leak).
- `apply_transforms` (pandas) signature: join needs a resolver — pass optional
  `join_loader: Callable[[JoinStep], pd.DataFrame]`; steps without joins keep working
  with no loader (loader=None → join step raises TransformStepError). Tasks/preview wire
  the real loader.
- Parity tests extended: join inner/left/right/full, key collision suffixing, missing
  right dataset → clean error.

**Verify:** end-to-end: two small datasets, plan with join + filter commits and the new
version contains joined columns; AI Query preview on result works.

## Task 4 — Frontend: Join UI + Pipeline Studio naming (Sonnet)

**Files:** `frontend/src/features/data-transform/DataTransformPage.tsx`,
`frontend/src/lib/transforms/transforms.ts`, nav/labels where "Data Transform" appears

- Builder consumes `OPS_CATALOG` join entry: dataset picker (fetch workspace datasets —
  reuse the existing datasets fetch from useDatasets/data-import), left column select
  (current preview columns), right column select (fetched from chosen dataset's latest
  schema via existing versions/schema endpoint), join-type select.
- Client-side live preview for join: call `/transforms/preview` (server-side) for plans
  containing a join instead of pure client-side execution — simplest correct behavior;
  non-join plans keep instant client-side path.
- Page title/labels → "Pipeline Studio"; import-mode subtitle mentions background
  full-data processing on save.
- Verify DB-source imports land in import mode with staged preview identical to files.

**Verify:** `npx tsc` clean (ignoring pre-existing DataTransformPage errors — fix those
if touched); manual flow: import CSV → join another dataset → Save & Apply → version
created.

## Task 5 — Docs + changelogs (Sonnet)

- `backend/README.md`: engine selection + threshold env var, join step, streaming
  upload, new/changed endpoints; changelog entry.
- `frontend/README.md`: Pipeline Studio naming, join UI; changelog entry.
- Root `README.md`: architecture note (DuckDB transform engine); changelog entry.

---

## Execution notes

- Task 1 ∥ Task 2 can run in parallel (different files). Task 3 depends on 2.
  Task 4 depends on 3 (catalog shape). Task 5 last.
- Each task: subagent implements + tests, then a review pass before the next dependent
  task starts.
- Python 3.14 / uv; run backend tests with `uv run pytest` from `backend/`.
