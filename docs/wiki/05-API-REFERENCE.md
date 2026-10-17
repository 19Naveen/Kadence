# API Reference

A plain-language index of every endpoint the backend exposes. All routes are prefixed with `/api/v1`. All endpoints except signup, login, and OAuth provider listing require a valid access token.

Beyond simply being logged in, every job, dataset, and query endpoint now also checks that the resource you're asking about actually belongs to you. A user can only ever read, preview, commit, query, or delete their own datasets and jobs (ownership is traced from the job or dataset back to the workspace that owns it). If you reference something that either doesn't exist or belongs to someone else, the response is an identical not-found — the system never reveals that another user's resource exists.

## Auth — `/auth`

| Endpoint | Purpose |
|---|---|
| `POST /auth/signup` | Create a new account and immediately return an access token. |
| `POST /auth/login` | Exchange email + password for an access token. |
| `GET /auth/me` | Return the currently logged-in user's profile. |
| `GET /auth/oauth/providers` | List which external login providers (Google, GitHub, Microsoft) are available — currently all reported as not-yet-enabled. |

## Workspace — `/workspaces`

| Endpoint | Purpose |
|---|---|
| `POST /workspaces` | Create a new workspace for the logged-in user. |
| `GET /workspaces` | List all workspaces the logged-in user owns. |
| `DELETE /workspaces/{workspace_id}` | Delete a workspace the user owns. |

## Data Ingestion — `/data-ingest`

| Endpoint | Purpose |
|---|---|
| `POST /data-ingest/jobs` | Start an import from a database source (Postgres, MySQL, SQL Server, Snowflake). Validates that the target workspace exists and is owned by the caller (returns not-found otherwise), then creates the dataset if it doesn't exist yet. Does **not** run the import — it stages it for review. |
| `POST /data-ingest/jobs/upload` | Start an import by uploading a file (CSV, Excel, Parquet). Same workspace-ownership validation and review-first behavior as above. |
| `GET /data-ingest/jobs/{job_id}` | Check the status of an import job. |
| `GET /data-ingest/jobs/{job_id}/staged-preview` | Preview a sample of the staged (not-yet-committed) data, its inferred schema, and — if this dataset already has a version — how the schema differs from what's already there. Powers the import review screen. |
| `GET /data-ingest/transforms/ops` | List every available transform operation (rename, cast, filter, trim, etc.) so the UI can render the transform-builder palette. |
| `POST /data-ingest/transforms/preview` | Apply a proposed set of transform steps to a small sample and return the result, so users see the effect before committing. |
| `POST /data-ingest/jobs/{job_id}/commit` | Finalize an import: save the transform plan and kick off the background job that processes the full dataset and writes a new version. |
| `POST /data-ingest/jobs/{job_id}/resolve` | Resolve a detected schema change — either accept the new schema as-is, or supply mapping rules (rename/drop/cast) to reconcile it with the previous version. |
| `GET /data-ingest/datasets` | List all datasets in a workspace, including each one's version count and latest size. |
| `DELETE /data-ingest/datasets/{dataset_id}` | Delete a dataset and everything tied to it (versions, jobs, mapping rules, and its stored files). |
| `GET /data-ingest/datasets/{dataset_id}/versions` | List every version ever committed for a dataset, most recent last. |
| `GET /data-ingest/datasets/{dataset_id}/schema` | Get the schema difference between a dataset's two most recent versions (or against a pending, not-yet-resolved import). |

## Query — `/query`

| Endpoint | Purpose |
|---|---|
| `POST /query/execute` | Run a read-only SQL `SELECT` against a dataset's latest version. Only `SELECT`/`WITH` statements are allowed — anything that could modify data is rejected. |
| `POST /query/aggregate` | Group a dataset's latest version by a column and summarize a measure (sum, average, count, min, max) — built for powering charts without hand-written SQL. |
| `GET /query/datasets/{dataset_id}/preview` | Return the first N rows and schema of a dataset's latest version — a quick look without writing any SQL. |

## A note on how imports work

Notice that creating an ingestion job (`POST /data-ingest/jobs` or `/jobs/upload`) never immediately produces a queryable version. It only stages data for review. A version only gets created after `POST /data-ingest/jobs/{job_id}/commit` runs — and even then, the actual processing happens in the background, so the commit response reflects the job moving to "running," not "done." Poll `GET /data-ingest/jobs/{job_id}` (or check `GET /data-ingest/datasets/{dataset_id}/versions`) to know when it's finished. See [The Data Ingestion Journey](07-DATA-INGESTION-PIPELINE.md) for the full picture.
