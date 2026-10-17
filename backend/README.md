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
    │   ├── storage/
    │   │   ├── minio_client.py    # MinIO helpers (upload, download, staging)
    │   │   └── parquet_writer.py  # Chunked parquet write
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
[File sources] Upload raw file to MinIO staging path
        ↓
Dispatch run_ingestion_pipeline.delay(job_id) via RabbitMQ
        ↓
Celery Worker:
  Mark RUNNING
  Load source → pd.DataFrame (via connector)
  infer_schema(df) → {"col": "type"}
  get_latest_version → compare schemas
  If diff & no rules → store pending schema, mark PENDING (await /resolve)
  If rules exist    → apply_rules(df, rules) → re-infer schema
  Write DataFrame → Parquet (PyArrow)
  upload_dataframe_as_parquet → MinIO (immutable, versioned path)
  create_dataset_version in PostgreSQL
  Mark SUCCESS
  Delete staging file from MinIO
On exception → mark FAILED with error_message
```

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
| POST | `/jobs/upload` | Yes | Create job from file (multipart). Same workspace-ownership validation as `/jobs`. |
| GET | `/jobs/{job_id}` | Yes | Poll job status |
| POST | `/jobs/{job_id}/resolve` | Yes | Resolve a schema diff: submit mapping rules **or** `accept_new_schema`, then re-dispatch |
| GET | `/datasets` | Yes | List datasets in a workspace (with version count + latest stats) |
| DELETE | `/datasets/{dataset_id}` | Yes | Delete dataset + versions + MinIO objects |
| GET | `/datasets/{dataset_id}/versions` | Yes | List all versions |
| GET | `/datasets/{dataset_id}/schema` | Yes | Get latest schema and diff |

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

### 3. Data Transform

**Prefix:** `/api/v1/transform` — Stub

Applies transformation steps to versioned datasets. Output is a new immutable version.

| Data Size | Engine |
|---|---|
| < 1 GB | Pandas |
| 1–10 GB | DuckDB |
| 10 GB+ | Spark |

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
