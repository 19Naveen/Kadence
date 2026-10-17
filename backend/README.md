# Backend — Knowledge Representation Platform

FastAPI backend serving the control plane, async ingestion pipeline, and metadata management.

> Part of the monorepo. See [root README](../README.md) for platform overview and [frontend README](../frontend/README.md) for frontend detail.

---

## Table of Contents

1. [Structure](#structure)
2. [Environment Variables](#environment-variables)
3. [Running the Backend](#running-the-backend)
4. [Code Patterns](#code-patterns)
5. [Module Reference](#module-reference)
   - [Authentication](#1-authentication)
   - [Data Ingestion Pipeline](#2-data-ingestion-pipeline)
   - [Data Transform](#3-data-transform)
   - [Query Studio](#4-query-studio)
   - [Dashboard & EDA](#5-dashboard--eda)
   - [Machine Learning](#6-machine-learning)
   - [Workspaces](#7-workspaces)
6. [API Reference](#api-reference)
7. [Storage Design](#storage-design)
8. [Database Tables](#database-tables)
9. [Celery Worker](#celery-worker)
10. [Changelog](#changelog)

---

## Structure

```
backend/
├── main.py                        # FastAPI app, CORS, router mount, create_all
├── celery_app.py                  # Celery app factory (RabbitMQ broker, rpc:// backend)
├── pyproject.toml                 # Dependencies managed by uv
├── docker-compose.yml             # PostgreSQL, MinIO, RabbitMQ
├── .env                           # Environment variables (not committed)
│
├── api/
│   └── router.py                  # Aggregates all module routers → /api/v1
│
├── core/
│   ├── config.py                  # Pydantic Settings (reads .env)
│   ├── database.py                # SQLAlchemy engine, SessionLocal, get_db()
│   ├── security.py                # JWT encode/decode, bcrypt hashing
│   └── dependencies.py            # Shared FastAPI Depends()
│
├── infrastructure/
│   ├── blob/
│   │   ├── minio_client.py        # MinIO helpers (upload, download, delete, Parquet)
│   │   └── parquet_writer.py      # Chunked parquet write
│   ├── cache/                     # (placeholder) caching abstraction
│   ├── monitoring/                # (placeholder) observability
│   └── queue/                     # (placeholder) messaging abstraction
│
└── modules/
    ├── auth/                      # JWT authentication
    ├── ingestion/                 # Data ingestion pipeline
    │   ├── models.py
    │   ├── schemas.py
    │   ├── repository.py
    │   ├── service.py
    │   ├── router.py
    │   ├── enums.py
    │   ├── tasks.py               # Celery task: run_ingestion_pipeline
    │   ├── schema_inference.py    # pandas dtype → canonical type
    │   ├── schema_diff.py         # compute_diff, apply_rules
    │   ├── connectors/
    │   │   ├── postgres_connector.py
    │   │   ├── csv.py
    │   │   ├── parquet.py
    │   │   ├── snowflake_connector.py  # stub
    │   │   ├── mysql_connector.py      # stub
    │   │   └── mssql_connector.py      # stub
    │   └── sync/
    │       ├── watermark.py
    │       └── incremental.py
    ├── transformation/            # Data transform engine
    ├── query/                     # Query Studio (DuckDB)
    ├── dashboard/                 # EDA & dashboards
    ├── ml/                        # ML training & predictions
    └── workspace/                 # Workspace & member management
```

---

## Environment Variables

Store in `backend/.env` (never commit this file).

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/knowrep` | PostgreSQL connection |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO API endpoint |
| `MINIO_ACCESS_KEY` | `admin` | MinIO access key |
| `MINIO_SECRET_KEY` | `password123` | MinIO secret key |
| `RABBITMQ_URL` | `amqp://admin:password123@localhost:5672/` | Celery broker URL |
| `JWT_SECRET` | `<hex string>` | JWT signing secret |
| `CREDENTIALS_ENCRYPTION_KEY` | `<Fernet key>` | Fernet key used to encrypt DB source passwords at rest. Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | JWT expiry in minutes |
| `LOG_LEVEL` | `info` | Uvicorn log level |
| `TRANSFORM_ENGINE_THRESHOLD_BYTES` | `524288000` | Staging file size (bytes) above which transform runs use the streaming DuckDB engine instead of pandas. Default 500 MiB. |

---

## Running the Backend

```bash
# Start Docker services + backend
make backend

# Or start everything (Docker + backend + frontend)
make run

# Start Celery worker (separate terminal, from backend/)
celery -A celery_app worker --loglevel=info
```

Backend API is available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

---

## Code Patterns

Every module follows the same layered pattern. Use existing modules as reference.

### Models (`models.py`)

SQLAlchemy 2.0 declarative style:

```python
class MyModel(Base):
    __tablename__ = "my_table"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

### Schemas (`schemas.py`)

Pydantic v2. Use `model_config = {"from_attributes": True}` for ORM response models.

### Repository (`repository.py`)

Plain functions, not classes. Accept `db: Session`, convert ORM → Pydantic.

```python
def get_thing(db: Session, thing_id: uuid.UUID) -> ThingSchema | None:
    row = db.query(ThingModel).filter(ThingModel.id == thing_id).first()
    return ThingSchema.model_validate(row) if row else None
```

### Service (`service.py`)

Business logic only. Calls repository functions. Raises `HTTPException` on errors.

### Router (`router.py`)

```python
router = APIRouter(prefix="/my-module", tags=["my-module"])

@router.get("/{id}", response_model=MyResponse)
async def get_thing(id: uuid.UUID, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ...
```

### Auth dependency (all protected endpoints)

```python
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.security import decode_access_token

_bearer = HTTPBearer(auto_error=True)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    return decode_access_token(credentials.credentials)
```

---

## Module Reference

### 1. Authentication

**Prefix:** `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/signup` | No | Register new user |
| POST | `/login` | No | Login, returns JWT |
| GET | `/me` | Yes | Current user profile |
| GET | `/oauth/providers` | No | OAuth providers (stubs) |

**Tables:** `users`

---

### 2. Data Ingestion Pipeline

**Prefix:** `/api/v1/data-ingest`

Full async pipeline: file upload or DB connection → validate → infer schema → diff → resolve → Parquet → MinIO → version metadata.

#### Pipeline Flow

```
Upload File / Connect DB
        ↓
Validate target workspace exists and is owned by the current user (404 otherwise)
        ↓
Create Dataset (if new) → Create IngestionJob (PENDING) in PostgreSQL
        ↓
[File sources] Stream raw file to MinIO staging path in 8MB chunks (never buffered in RAM)
        ↓
User builds a transform plan in Pipeline Studio against a staged preview, then commits
        ↓
Dispatch run_ingestion_pipeline.delay(job_id) via RabbitMQ
        ↓
Celery Worker:
  Mark RUNNING
  select_engine(staging_metadata) → pandas (≤ threshold) or DuckDB (> threshold)
  [pandas]  Load source → pd.DataFrame → apply_transforms (steps, incl. join) → Parquet (PyArrow) → MinIO
  [DuckDB]  Single fused SQL run: read staged source → compiled step SQL (incl. JOIN) →
            COPY ... TO 's3://.../raw/v{n}/data.parquet' directly against MinIO, streaming —
            never materializes the full dataset in memory
  get_latest_version → compare schemas (skipped on the DuckDB fused path's first run of a plan)
  If diff & no rules → store pending schema, mark PENDING (await /resolve)
  If rules exist    → apply_rules(df, rules) → re-infer schema
  create_dataset_version in PostgreSQL
  Mark SUCCESS
  Delete staging file from MinIO
On exception → mark FAILED with error_message (DuckDB SQL errors are mapped back to the
  failing step index via TransformStepError)
```

#### Transform Engine Selection

`modules/ingestion/engine/select.py` picks the execution engine per job from
`staging_metadata.file_size`:

| Staged file size | Engine | Notes |
|---|---|---|
| ≤ `TRANSFORM_ENGINE_THRESHOLD_BYTES` (default 500 MiB) | Pandas (`engine/pandas_engine.py`) | Whole dataset in memory; exact parity with the live `/transforms/preview` endpoint. |
| > threshold, or file_size unknown falls back to pandas | DuckDB (`engine/duckdb_engine.py`) | Streams `read_csv`/`read_parquet`/`read_xlsx` (via pandas for xlsx) → compiled SQL → `COPY TO 's3://...'` directly against MinIO. No dataset size limit within reason — data is never fully materialized in RAM. |

The DuckDB engine exposes the same callable-dict contract as pandas
(`load_source`, `apply_transforms`, `infer_schema`, `write_parquet`, `row_count`,
`column_count`) plus a fused `run(job, transforms, storage_path)` that `tasks.py`
prefers when present, executing load→transform→write as one SQL statement instead of
per-step calls. Every one of the 23 transform ops (plus `join`) is compiled to SQL by
`modules/ingestion/engine/sql_compiler.py`, which chains one CTE per step and mirrors
pandas' "skip step if referenced column is missing" semantics. DuckDB is the deliberate
scale ceiling for this pipeline — single-node, streaming, spills to disk for 10–100GB
runs; no Spark/cluster engine.

#### Supported Sources

| Type | Status |
|---|---|
| CSV | Implemented |
| XLSX | Implemented |
| Parquet | Implemented |
| PostgreSQL | Implemented |
| Snowflake | Stub (NotImplementedError) |
| MySQL | Stub (NotImplementedError) |
| SQL Server | Stub (NotImplementedError) |

All database connections are read-only.

#### Job Status States

```
PENDING → RUNNING → SUCCESS
                  → FAILED
PENDING (awaiting schema resolution) → user calls /resolve → RUNNING → SUCCESS
```

#### API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/jobs` | Yes | Create job from DB source (JSON). Validates the target workspace exists and is owned by the caller (404 `Workspace not found` otherwise) before creating the dataset/job. |
| POST | `/jobs/upload` | Yes | Create job from file (multipart). Same workspace-ownership validation as `/jobs`. Streams the upload straight to MinIO staging in 8MB chunks via `upload_staging_stream` (no full-file buffering); `staging_metadata.file_size` is the actual streamed byte count, computed after upload. Empty upload → 400. |
| GET | `/jobs/{job_id}` | Yes | Poll job status |
| GET | `/jobs/{job_id}/staged-preview` | Yes | Sample rows + inferred schema of the staged source, for Pipeline Studio |
| GET | `/transforms/ops` | Yes | Canonical transform op catalog (`OPS_CATALOG`), incl. the `join` op |
| POST | `/transforms/preview` | Yes | Apply a transform plan to a sampled table and return the result. Auth-gated (`db` + `get_current_user`) so `join` steps can resolve and authorize their right-hand dataset via `resolve_join_sources` — unauthorized or missing dataset → 404 `Dataset not found` (no 403, no existence leak). Right side capped at 100k rows for preview only. |
| POST | `/jobs/{job_id}/commit` | Yes | Persist the transform plan and dispatch `run_ingestion_pipeline` |
| POST | `/jobs/combine` | Yes | Ad-hoc combine of one or more already-imported datasets — no fresh import required. Builds an `IngestionJob` whose `staging_path` is the primary dataset's latest version file instead of an upload, then reuses `run_ingestion_pipeline` unmodified. Result is saved as a new dataset (`new_dataset_name`) or a new version of an existing one (`target_dataset_id`) — exactly one must be provided. |
| POST | `/jobs/{job_id}/resolve` | Yes | Resolve a schema diff: submit mapping rules **or** `accept_new_schema`, then re-dispatch |
| GET | `/datasets` | Yes | List datasets in a workspace (with version count + latest stats) |
| DELETE | `/datasets/{dataset_id}` | Yes | Delete dataset + versions + MinIO objects |
| GET | `/datasets/{dataset_id}/versions` | Yes | List all versions |
| GET | `/datasets/{dataset_id}/schema` | Yes | Get latest schema and diff |
| GET | `/datasets/{dataset_id}/lineage` | Yes | Where this dataset originally came from (`source_type` + `origin_detail`, e.g. a DB table name from `repo.get_first_success_job`) plus single-hop join sources feeding its latest version (from `repo.get_latest_success_job`'s transform plan). No recursion server-side — the frontend calls this again per source `dataset_id` to walk further back and render a multi-hop lineage graph. Never exposes DB credentials, only the table name. |

#### Schema Inference

Canonical types mapped from pandas dtypes:

| Pandas dtype | Canonical type |
|---|---|
| int32, int64 | integer |
| float32, float64 | decimal |
| object, string | string |
| bool | boolean |
| datetime64 | timestamp |

#### Schema Diff & Resolution

When the inferred schema differs from the latest version, a diff is returned:

```json
{
  "added": ["region"],
  "missing": ["date"],
  "type_changes": [{"column": "amount", "expected": "decimal", "received": "string"}],
  "suggested_mappings": [{"source": "transaction_date", "target": "date"}]
}
```

User resolves by posting mapping rules (`map` / `drop` / `cast`). Rules are saved per dataset and **auto-applied on all future ingestions** for that dataset.

Alternatively the user can **accept the incoming schema as-is**: posting `accept_new_schema: true`
with no rules flags the job (`source_config._accept_new_schema`) so the pipeline bypasses the diff
gate and writes the new schema as the next version. Because no transforms are saved, this also
clears any prior mapping rules for the dataset (they no longer apply to the new shape). Downstream
features always read the latest version, so the new schema takes effect everywhere immediately.

#### Database Tables

| Table | Key Columns |
|---|---|
| `datasets` | id, workspace_id, name, source_type, created_at |
| `ingestion_jobs` | id, dataset_id, status, source_type, source_config (JSONB), staging_path, error_message |
| `dataset_versions` | id, dataset_id, version, storage_path, row_count, column_count, schema (JSONB), file_size |
| `mapping_rules` | id, dataset_id, source_column, target_column, transform_type, cast_to_type |

#### MinIO Storage Layout

```
bucket: datasets
├── staging/{job_id}/{filename}          ← deleted after SUCCESS
└── {workspace_id}/{dataset_id}/raw/
    ├── v1/data.parquet
    ├── v2/data.parquet
    └── vN/data.parquet                  ← immutable, never overwritten
```

---

### 3. Data Transform (Pipeline Studio)

**Prefix:** `/api/v1/data-ingest` (`/transforms/*`, `/jobs/{job_id}/commit`) — not a separate
router; lives alongside Data Ingestion Pipeline above.

An ordered list of typed steps (`modules/ingestion/transforms.py`) built in the frontend's
Pipeline Studio against a staged preview, then applied to the **entire** staged dataset on
commit. Output is a new immutable `DatasetVersion`. Engine choice is transparent to the
caller — see Transform Engine Selection above; this section covers the step catalog and joins.

23 ops across categories Columns / Rows / Text / Numeric / Date & Time, plus:

**`join` (category Combine)** — combine the in-progress dataset with another dataset owned by
the caller:

```json
{"type": "join", "dataset_id": "<uuid>", "left_on": "col_a", "right_on": "col_b", "how": "inner|left|right|full"}
```

- Right side always resolves to the referenced dataset's **latest version** parquet
  (`service.resolve_join_sources`).
- **Ownership enforced** wherever a plan is accepted: `/transforms/preview` (via `db` +
  `get_current_user` deps) and at commit/run time. An unowned or missing `dataset_id` raises
  404 `Dataset not found` — never 403, so the caller can't distinguish "not yours" from
  "doesn't exist".
- Pandas engine: right side read via DuckDB into a DataFrame (preview capped at 100k rows;
  full runs uncapped), then `pd.merge(..., suffixes=("", "_right"))`. `how="full"` maps to
  pandas' `outer`.
- DuckDB engine: compiled to a native SQL `JOIN` against `read_parquet('s3://...')`, with
  explicit right-column aliasing to match the pandas `_right` suffix rule.
- If the left key column is missing, the join step is skipped (same "skip if column missing"
  semantics as every other op); if the *right* dataset lacks `right_on`, the step raises
  `TransformStepError`.

**Ad-hoc combine of existing datasets** (`POST /jobs/combine`) — join steps normally only run
as part of a fresh import's transform plan. `/jobs/combine` lets a user pick an
already-imported "primary" dataset directly (no import needed), add `join` steps against other
owned datasets, and save the result as a new dataset or a new version of an existing one. It
works by pointing a synthetic `IngestionJob.staging_path` at the primary dataset's latest
version file instead of an upload — `run_ingestion_pipeline` needs no changes, since a
dataset's parquet and a staging upload are both just object keys in the same MinIO bucket. The
one hazard this exposes: the pipeline normally deletes `staging_path` after a successful run
(cleanup for ephemeral uploads); the delete is now guarded to only fire for paths under
`.../staging/...`, never for a combine job's permanent `.../raw/v{n}/...` source file.

---

### 4. Query Studio

**Prefix:** `/api/v1/query` — Implemented

DuckDB compute over the **latest version** of a dataset, read directly from MinIO via DuckDB's
`httpfs` (S3) extension — no data is copied into Postgres or staged on disk. `modules/query/duckdb_executor.py`
is the single place where "always use the latest version" is enforced (`repo.get_latest_version`).
It reuses the existing `MINIO_*` settings (path-style S3, `s3_use_ssl=false`).

This module also powers the EDA Dashboards and Data Transform preview on the frontend.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/query/execute` | Yes | Run a read-only single `SELECT` against the latest version, exposed as the view `dataset`. Returns `{columns, rows}` (capped, default 1000 rows). |
| POST | `/query/aggregate` | Yes | `GROUP BY` a dimension and apply `sum/avg/count/min/max` to a measure → `{data: [{label, value}]}` (for charts). |
| GET | `/query/datasets/{dataset_id}/preview?limit=N` | Yes | First N rows + schema of the latest version. |

**Safety:** `/query/execute` rejects multiple statements, anything that is not `SELECT`/`WITH`, and a
denylist of mutating keywords; the query is also wrapped as a subquery before running. Aggregate
column names are validated against the version schema and quoted.

---

### 5. Dashboard & EDA

**Prefix:** `/api/v1/dashboard` — Stub

EDA dashboards and widget-based analytics. DuckDB direct queries on Parquet.

---

### 6. Machine Learning

**Prefix:** `/api/v1/ml` — Stub

AutoML and manual training (XGBoost, scikit-learn). Consumes processed Parquet datasets.

---

### 7. Workspaces

**Prefix:** `/api/v1/workspaces` — Stub

| Role | Capabilities |
|---|---|
| Admin | Full control — settings, members, billing, API keys |
| Editor | Edit datasets, run transforms, launch training |
| Viewer | Read-only — datasets, dashboards, query results |

**Tables:** `workspaces`, `workspace_members`

---

## API Reference

All endpoints prefixed with `/api/v1`.

| Module | Prefix | Status |
|---|---|---|
| Auth | `/auth` | Implemented |
| Ingestion | `/data-ingest` | Implemented |
| Transform | `/transform` | Stub |
| Query | `/query` | Implemented (DuckDB over latest version) |
| Dashboard | `/dashboard` | Stub |
| ML | `/ml` | Stub |
| Workspace | `/workspaces` | Stub |

Health check: `GET /health` → `{"status": "healthy"}`

---

## Storage Design

```
MinIO bucket: datasets

{workspace_id}/
└── {dataset_id}/
    ├── raw/              ← immutable ingested data
    │   ├── v1/data.parquet
    │   └── v2/data.parquet
    ├── processed/        ← transform outputs (versioned)
    └── features/         ← ML-ready datasets
```

---

## Database Tables

| Table | Module | Purpose |
|---|---|---|
| `users` | Auth | User accounts |
| `datasets` | Ingestion | Dataset registry |
| `ingestion_jobs` | Ingestion | Async job tracking |
| `dataset_versions` | Ingestion | Versioned metadata per ingestion |
| `mapping_rules` | Ingestion | Persisted schema resolution rules |
| `workspaces` | Workspace | Workspace registry |
| `workspace_members` | Workspace | User ↔ workspace membership and roles |

## Database Migrations

Schema changes are managed with **Alembic**, not `Base.metadata.create_all()` (removed from
`main.py` — it only creates missing tables and silently ignores column changes on existing ones,
which caused a production 500 when a model gained a column the live DB didn't have).

```bash
# After editing a model in modules/*/models.py:
alembic revision --autogenerate -m "add staging_metadata to ingestion_jobs"
# Review the generated file in alembic/versions/, then:
alembic upgrade head
```

- `alembic/env.py` imports `core.database.Base` plus every module's `models.py` and reads the DB
  URL from `core.config.settings` (not `alembic.ini`), so it always targets the same database as
  the app.
- Any new `modules/<name>/models.py` file must be imported in `alembic/env.py` or its tables won't
  be picked up by `--autogenerate`.
- Baseline migration `6455dd9affdd` was stamped (not applied) against the existing DB, since the
  tables already existed from the old `create_all()` bootstrap.

---

## Celery Worker

**App:** `backend/celery_app.py`
**Broker:** RabbitMQ (`RABBITMQ_URL`)
**Result backend:** `rpc://` (no Redis required)
**Tasks:** `modules.ingestion.tasks.run_ingestion_pipeline`

```bash
# From backend/ directory
celery -A celery_app worker --loglevel=info

# Add to Makefile or run in a separate terminal alongside make backend
```

---

## Changelog

### 2026-07-19 — Data lineage endpoint + fix: join step's right-side key defaulted to empty

- New `GET /datasets/{dataset_id}/lineage`: returns where a dataset originally came from
  (`source_type`, and `origin_detail` — the DB table name for DB-sourced datasets, from
  `get_first_success_job`; never credentials) plus the immediate join sources (dataset, join
  type, keys) behind its latest version, read from `get_latest_success_job`'s transform plan.
  Single-hop only by design — the frontend recurses per source to build a multi-hop lineage
  graph, so no backend changes are needed if the UI wants to go deeper later.
- Unrelated frontend bug also fixed this session: the join builder's `right_on` field (kind
  `column_right`) never got a default once the right dataset's columns loaded, so a join step
  could be committed with `right_on: ""`, producing a `"right dataset has no column ''"` error
  at run time. See `frontend/README.md`.

### 2026-07-19 — Ad-hoc combine of existing datasets (`POST /jobs/combine`)

- New endpoint lets a user join already-imported datasets together and save the result as a
  new (or existing) dataset, without running a fresh import first. `service.create_combine_job`
  builds an `IngestionJob` whose `staging_path` is the primary dataset's latest version's
  `storage_path` — `run_ingestion_pipeline`, `resolve_join_sources`, engine selection, and the
  TOCTOU join re-auth all run completely unmodified.
- `tasks.run_ingestion_pipeline`'s post-success staging-file delete is now guarded to only fire
  for paths under `.../staging/...`, so a combine job never deletes its (permanent) source
  dataset file.
- See `frontend/README.md` for the matching Preview-tab "Save as dataset" UI.

### 2026-07-16 — Pipeline Studio: DuckDB engine for 10-100GB scale + cross-dataset joins

- **Streaming upload:** `create_job_from_file` no longer buffers the whole upload in memory.
  `infrastructure/blob/minio_client.upload_staging_stream` streams `UploadFile.file` straight to
  MinIO staging in 8MB parts (`put_object(..., length=-1, part_size=8MB)`); `file_size` is the
  actual streamed byte count. Empty upload still → 400.
- **DuckDB transform engine for large runs:** `modules/ingestion/engine/select.py` now picks
  pandas (in-memory, exact preview parity) for staged files `<= TRANSFORM_ENGINE_THRESHOLD_BYTES`
  (new setting, default 500 MiB) and a new streaming `duckdb_engine.py` above it. The DuckDB
  engine compiles the saved transform-step plan to chained-CTE SQL
  (`modules/ingestion/engine/sql_compiler.py`, all 23 ops) and runs
  `read_csv/parquet/xlsx(s3://staging) → steps → COPY TO 's3://.../raw/v{n}/data.parquet'` as one
  fused execution against MinIO — no dataset-size limit within reason, since it streams and spills
  rather than materializing in RAM. `tasks.py` calls the fused `engine["run"]` when the selected
  engine exposes one. SQL failures are mapped back to the failing step index as
  `TransformStepError`, same as pandas.
- **Join / combine-datasets transform step:** new `join` op (category **Combine**) —
  `{"type": "join", "dataset_id", "left_on", "right_on", "how": inner|left|right|full}`. Right
  side always resolves to the referenced dataset's latest version. Ownership enforced via
  `service.resolve_join_sources` everywhere a plan is accepted (`/transforms/preview`, now
  auth-gated, and commit/run) — unowned or missing dataset → 404 `Dataset not found`, never 403.
  Implemented in both engines: pandas via `pd.merge` (right side loaded through DuckDB, capped at
  100k rows for preview only), DuckDB via a native `JOIN`; both alias colliding right-side columns
  with a `_right` suffix.
- See `frontend/README.md` for the matching Pipeline Studio join-builder UI and page rename.

### 2026-07-16 — Alembic migrations added; `create_all()` removed

- Replaced `Base.metadata.create_all()` in `main.py` with Alembic-managed migrations, after it
  masked a missing `ingestion_jobs.staging_metadata` column (added to the model, never applied to
  the live DB) and caused a 500 on job creation.
- Initialized `alembic/` with `env.py` wired to `core.database.Base` and `core.config.settings`.
- Stamped a `baseline` migration (`6455dd9affdd`) against the existing DB — no DDL applied, since
  the schema was already up to date.
- See **Database Migrations** section above for the new workflow.

### 2026-07-13 — Refactor: extract MinIO client to infrastructure/

- Moved `modules/ingestion/storage/minio_client.py` and `parquet_writer.py` to
  `infrastructure/blob/` so they are shared across modules (already consumed by
  `modules/query/duckdb_executor.py`). Updated all 7 import sites in the codebase.
- Removed the `modules/ingestion/storage/` directory.

### 2026-07-11 — Security hardening: authorization, credential encryption, query/connector safety

- **Authorization (IDOR fix):** Added `modules/ingestion/authz.py` with reusable guards
  `assert_dataset_owned`, `assert_job_owned`, `assert_workspace_owned` (chain:
  `IngestionJob → Dataset → Workspace.owner_id == user["sub"]`; all raise `404` on miss/foreign
  ownership so existence of other users' resources isn't leaked). Applied to every ingestion
  endpoint taking a `job_id`/`dataset_id`/`workspace_id` (`get_job`, `staged_preview`, `commit_job`,
  `resolve`, `list_versions`, `schema`, `delete_dataset`, `list_datasets`) and to all query
  endpoints (`/query/execute`, `/query/aggregate`, `/query/datasets/{id}/preview`) via
  `modules/query/service` (`owner_id` threaded from routers).
- **Credential encryption at rest:** DB source passwords in `IngestionJob.source_config` are now
  encrypted with Fernet before persistence (`core/crypto.py`: `encrypt_secret`/`decrypt_secret`;
  keyed by new `CREDENTIALS_ENCRYPTION_KEY`). `service.create_ingestion_job` encrypts on write;
  `source_loader._decrypted_config` decrypts just-in-time for connectors (tolerant of the plaintext
  dry-run used for row-count estimation). Bookkeeping keys (`_pending_schema`, `_transforms`,
  `_accept_new_schema`) are left untouched. Requires the `cryptography` dependency.
- **SQL injection (Postgres connector):** `postgres_connector.py` composes `SELECT * FROM {table}`
  via `psycopg2.sql.Identifier` (schema-qualified names quoted per-part) instead of f-string
  interpolation, and forces `set_session(readonly=True)` so a user-supplied passthrough `query`
  cannot mutate the source. MySQL/MSSQL/Snowflake connectors remain unimplemented stubs (no surface).
- **Query safety:** `modules/query/service._validate_select` replaced the substring blocklist with a
  word-boundary regex (`\b(keyword)\b`) so identifiers like `created_at` are no longer over-blocked,
  keeping the single-statement + must-start-with-SELECT/WITH checks. `duckdb_executor._connect` now
  ends setup with `SET lock_configuration=true;` so queries can't re-enable dangerous engine settings.
- **Path traversal (upload):** `POST /jobs/upload` no longer uses the client filename in the storage
  path. The object name is fully server-controlled: `{workspace_id}/{dataset_id}/staging/{job.id}/source{ext}`
  where `ext` is derived solely from the validated `source_type`.

### 2026-07-10 — Enforce workspace ownership before dataset/job creation

- `modules/ingestion/service.create_ingestion_job` now requires `owner_id` and calls
  `modules/workspace/repository.get_workspace(db, workspace_id, owner_id)` before creating a
  dataset or job. Raises `404 Workspace not found` if the workspace doesn't exist or isn't owned
  by the current user. `POST /jobs` passes `owner_id=user["sub"]`.
- `POST /jobs/upload` (router-level dataset creation, previously duplicated the same logic
  inline) gained the identical workspace-ownership check before its `get_dataset`/`create_dataset`
  block.
- Ordering is now strictly: validate workspace → create dataset (if new) → create job.

### 2026-06-17 — Query module (DuckDB) + accept-new-schema resolution

- Implemented `modules/query`: `duckdb_executor.py` (httpfs/S3 over MinIO, always reads the dataset's
  latest version), `service.py` (read-only SELECT validation, aggregate, preview), `schemas.py`,
  `router.py`. Registered `query_router` in `api/router.py`.
- New endpoints: `POST /query/execute`, `POST /query/aggregate`, `GET /query/datasets/{id}/preview`.
  These back the frontend EDA Dashboards, Query Studio, and Data Transform preview (real data).
- Added `duckdb` dependency (`uv add duckdb`). Reuses existing `MINIO_*` env vars — no new config.
- Ingestion: `ResolveSchemaMappingRequest` gained `accept_new_schema`; `service.resolve_schema_mapping`
  and `tasks.run_ingestion_pipeline` now support accepting an incoming schema as a new version
  (bypassing the diff gate via `source_config._accept_new_schema`). Added `repo.set_accept_new_schema`.
- Documented previously-undocumented ingestion endpoints `GET /datasets` and `DELETE /datasets/{id}`.

### 2026-06-06 — Data Ingestion Pipeline implemented

- Implemented all ingestion module files: `models.py`, `schemas.py`, `repository.py`, `service.py`, `router.py`, `tasks.py`, `schema_inference.py`, `schema_diff.py`
- Added `celery_app.py` at backend root (RabbitMQ broker, `rpc://` result backend)
- Implemented `CsvConnector`, `XlsxConnector`, `ParquetConnector` with MinIO staging download
- Extended `PostgresConnector` with `read_all()` method
- Added stub connectors: `SnowflakeConnector`, `MySQLConnector`, `MSSQLConnector`
- Extended `minio_client.py` with `upload_staging_file`, `upload_dataframe_as_parquet`, `download_staging_file`, `delete_object`
- All 6 ingestion API endpoints live and registered: `/jobs`, `/jobs/upload`, `/jobs/{id}`, `/jobs/{id}/resolve`, `/datasets/{id}/versions`, `/datasets/{id}/schema`
- Added `openpyxl` dependency for XLSX support

### 2026-06-06 — backend/README.md created

- Moved all backend detail from root README into this file
- Added full ingestion pipeline specification
- Documented all code patterns, env vars, DB tables, storage layout

### 2026-06-06 — Data Ingestion Pipeline Architecture

- Defined 11-step async ingestion pipeline (Celery + RabbitMQ)
- Added `IngestionJob`, `DatasetVersion`, `MappingRule` models
- Schema inference, diff, mapping rule persistence and auto-reuse
- MinIO versioned immutable storage (`{workspace_id}/{dataset_id}/raw/vN/data.parquet`)
- Stubs for Snowflake, MySQL, SQL Server connectors

### 2026-06-06 — Backend Bootstrap

- FastAPI app, JWT auth (signup / login / me)
- PostgreSQL via SQLAlchemy 2.0 (`Mapped`/`mapped_column`)
- MinIO client, RabbitMQ service in docker-compose
- Switched from pip/requirements.txt to `uv` + `pyproject.toml`
- Makefile: `make run`, `make backend`, `make frontend`, `make docker-up/down`
