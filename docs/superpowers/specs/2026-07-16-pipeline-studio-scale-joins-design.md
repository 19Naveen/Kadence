# Pipeline Studio: Scale + Joins — Design

**Date:** 2026-07-16
**Status:** Approved (user granted full freedom)

## Goal

Every source import routes through Pipeline Studio (the Data Transform page in import
mode), where the user builds a transform plan on a live preview, saves, and the plan is
applied to the **entire** dataset in the background; the result becomes the latest
version consumed by AI Query. This flow must work from MB up to 10–100 GB, and the
transform plan must support **joining other datasets**.

## Current state (what already exists)

- File and DB imports stage data in MinIO, then the frontend navigates to
  `/app/data-transform` in import mode with the job id.
- `GET /data-ingest/jobs/{id}/staged-preview` serves a 200-row sample; transform steps
  run live client-side and via `POST /data-ingest/transforms/preview` (pandas).
- `POST /data-ingest/jobs/{id}/commit` dispatches Celery task
  `ingestion.run_pipeline`, which loads the staged source, applies the saved transform
  plan (`source_config._transforms`), writes `raw/v{n}/data.parquet` to MinIO, and
  creates a `DatasetVersion`.
- AI Query (modules/query) always reads the **latest** `DatasetVersion` parquet from
  MinIO via DuckDB httpfs.

## Gaps this design closes

### 1. Scale

| Problem | Fix |
|---|---|
| `create_job_from_file` does `await file.read()` — whole upload buffered in RAM | Stream the upload to MinIO staging in chunks (8 MB); never hold the file in memory. `staging_metadata.file_size` computed from the stream. |
| Full-run engine is pandas-only (whole dataset in RAM) | New **DuckDB engine**: compile the transform-step list to SQL, execute `read_parquet/read_csv(s3://…staging…) → steps → COPY TO 's3://…/raw/v{n}/data.parquet'` fully inside DuckDB (streaming execution, disk spill). |
| `select_engine()` stub always returns pandas | Threshold selection: `staging_metadata.file_size <= ENGINE_THRESHOLD_BYTES` (default 500 MB, env-overridable `TRANSFORM_ENGINE_THRESHOLD_BYTES`) → pandas (exact parity with preview); above → DuckDB. |

DuckDB single-node is the deliberate ceiling: it streams and spills for 100 GB
workloads; no Spark/cluster (`ponytail:` ceiling — revisit if >1 TB or concurrency
demands appear).

### 2. Joins / combining datasets

New transform step:

```json
{"type": "join", "dataset_id": "<uuid>", "left_on": "col_a", "right_on": "col_b", "how": "inner|left|right|full"}
```

- Right side always resolves the referenced dataset's **latest version** parquet.
- **Ownership**: the referenced dataset must belong to a workspace owned by the caller
  — enforced everywhere the plan is accepted/executed (preview endpoint, commit).
- **Pandas engine**: right side loaded via DuckDB → DataFrame, `pd.merge`.
- **DuckDB engine**: native SQL `JOIN read_parquet('s3://…right…')`.
- **Preview** (`/transforms/preview` and client-side): sample left × full right,
  right side capped at 100k rows for preview only (full run is uncapped).
  Preview endpoint gains `db` + auth dependencies to resolve/authorize the right
  dataset.
- Column-name collisions: right-side columns that clash get suffix `_right`
  (matching pandas `suffixes=("", "_right")`; DuckDB compiler emits explicit aliases
  to match).
- **Frontend**: new "Join Dataset" op (category **Combine**) in the builder —
  dataset picker (workspace datasets), left/right key column selects, join-type
  select. Join is a first-class step in the pipeline list like any other.

### 3. Cohesion / naming

- The Data Transform page is titled **Pipeline Studio** everywhere (route stays
  `/app/data-transform`).
- DB-source imports get identical staged-preview + transform treatment as files
  (verify; fix anything that diverges).
- READMEs updated (backend endpoints/engine section, frontend page section, root if
  platform-wide) + changelogs.

## Engine contract

`select_engine(staging_metadata) -> dict` keeps its callable-dict shape with keys
`load_source, apply_transforms, infer_schema, write_parquet, row_count, column_count`.
The DuckDB engine implements the same keys; internally it may fuse
load→transform→write into one SQL execution for efficiency (the dict contract is
per-key, but the Celery task is refactored to call a single
`engine["run"](job, transforms, storage_path) -> VersionStats` when available,
falling back to the step-by-step keys for pandas). Keep the seam minimal — no
premature abstraction beyond what the two engines need.

## Preview/full-run parity

The 23 existing ops + join must behave the same in pandas (preview + small runs) and
DuckDB SQL (large runs). Parity is enforced by a pytest suite that runs every op on a
fixture frame through both engines and asserts frame equality (modulo dtype widening
documented per-op). Known deliberate divergences (e.g. `zscore` ddof, string casts of
nulls) are documented in the test file.

## Error handling

- Per-step errors already raise `TransformStepError(step_index, message)` — the DuckDB
  compiler wraps SQL errors and maps them back to the failing step index.
- Job status flow unchanged: RUNNING → SUCCESS/FAILED with `error_message`.
- Upload streaming failures abort the request; staging object cleaned up best-effort.

## Testing

- Unit: step→SQL compiler (each op), join ownership guard, engine selection threshold.
- Parity: both engines, all ops, fixture data.
- Integration: commit flow with a join plan end-to-end against local MinIO/Postgres
  (small data); streaming upload endpoint with a multi-chunk file.

## Delegation

- **Opus**: DuckDB engine + step→SQL compiler + parity suite; join step backend
  (both engines) + ownership enforcement.
- **Sonnet**: streaming upload; preview-endpoint join support; frontend Join UI +
  Pipeline Studio naming; docs/READMEs.

## Out of scope

Spark/clusters, DAG pipelines across datasets, scheduled syncs, join-key suggestion,
multi-join optimization, preview of >2-way joins beyond sequential steps (sequential
join steps already compose).
