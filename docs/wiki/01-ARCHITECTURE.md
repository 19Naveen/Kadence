# Architecture

## What the backend does

The Knowledge Representation backend is a data platform: it lets a user bring in data from many kinds of sources (spreadsheets, databases, files), clean and reshape that data, and then explore it — through SQL queries, charts, or direct preview — without ever needing their own database or data engineering team.

At a high level, it does four things:

1. **Authenticates users** and organizes their work into **Workspaces**.
2. **Ingests data** from files (CSV, Excel, Parquet) or databases (Postgres, MySQL, SQL Server, Snowflake).
3. **Transforms** that data — renaming columns, fixing types, filtering rows, cleaning text — through a visual, no-code pipeline builder called *DataForge*.
4. **Serves** the cleaned data back for querying, aggregation, and preview using fast, on-demand SQL compute.

## The three-stage journey of a dataset

Every dataset moves through the same three stages, no matter where it came from:

**Stage 1 — Staging.** When a user connects a source, the backend takes a first look: it samples the data, figures out the column names and types, and shows the user a preview. Nothing is permanently saved yet — this is a "let's see what we're working with" step.

**Stage 2 — Transformation.** The user reviews the sample and builds a plan: drop a column, rename another, cast a price field to a number, filter out blank rows. This plan is just a list of instructions — it isn't run yet. The user can preview the effect of each step live, on the sample, before committing to anything.

**Stage 3 — Commit & Version.** Once satisfied, the user commits. The backend then runs the full pipeline: loads the *entire* source (not just the sample), applies the transformation plan, and writes the result as a new **version** of the dataset. Every commit creates a new version rather than overwriting the old one — so data is never silently lost, and past states remain queryable.

After a version exists, it's immediately queryable — through raw SQL, pre-built aggregations for charts, or a simple row preview.

## Why it's built this way

**Review before you commit.** Early versions of this pipeline ran automatically the moment a source was connected. That meant garbage data (wrong types, misnamed columns) could get versioned before anyone looked at it. The system now deliberately pauses after staging so a human reviews and shapes the data before anything is permanently written. This is why ingestion is a two-step process (create job → commit job) rather than one.

**Versions are immutable.** Instead of updating a dataset in place, each commit produces a new version alongside the old ones. This means:
- Nothing is destroyed by a bad transform — you can always look at (or query) an earlier version.
- Downstream consumers (queries, dashboards) always know exactly which version they're reading.
- The "current" state of a dataset is simply "whichever version is newest."

**Compute happens where the data lives, not in the app database.** Once data is versioned, it's stored as compressed columnar files (Parquet) in object storage (MinIO), not copied into the application's Postgres database. Querying reads those files directly using an embedded analytics engine (DuckDB), on demand. This keeps the operational database small and fast, and means dataset size isn't limited by database capacity.

**Long-running work happens off the request path.** Loading and transforming a full dataset can take a while — especially for large files or slow database sources. Rather than making a user's browser wait on an HTTP request, this work is handed off to a background task queue (Celery). The user gets an immediate acknowledgment ("job accepted") and the result becomes available once the background job finishes.

**Security is enforced at every layer.** Being logged in is never enough on its own: every request for a specific dataset, job, or query result is also checked against who owns it, so one user can never reach another user's data by guessing an identifier. Credentials for database sources (the password used to connect to an external Postgres, MySQL, and so on) are encrypted before they are stored, so they are never sitting in the database as readable text — they're only unlocked momentarily when a connection actually needs to be made. And every query a user runs against their data is forced to be read-only: the system both rejects anything that isn't a plain read, and connects to the underlying source in a mode that physically cannot modify or delete data.

**Sources and compute are pluggable, not hardcoded.** The system supports many source types (CSV, Postgres, Snowflake, etc.) and is designed to support more compute engines in the future (today: pandas; planned: DuckDB/Polars for larger datasets). Both are built behind a consistent internal interface, so adding a new source or a faster engine doesn't require rewriting the pipeline — see [Growing the System](08-EXTENDING-THE-SYSTEM.md).

## The moving pieces

| Piece | Role |
|---|---|
| **API** (FastAPI) | Handles requests: auth, workspace management, starting ingestion jobs, running queries. |
| **Operational database** (Postgres) | Stores users, workspaces, dataset metadata, version records, job status — the "bookkeeping," not the data itself. |
| **Object storage** (MinIO, S3-compatible) | Stores the actual dataset files, as Parquet, one per version. |
| **Task queue** (Celery + RabbitMQ) | Runs the full ingestion pipeline in the background so the API stays responsive. |
| **Query engine** (DuckDB) | Reads Parquet files directly from object storage and executes SQL against them on demand — no data duplication into Postgres. |

## A request's-eye view

A typical flow — uploading a CSV and querying it — touches the system like this:

1. User uploads a file → API stages it in object storage and returns a sampled preview.
2. User builds a transform plan in DataForge, previewing each step against the sample.
3. User commits → API stores the plan and hands off a background job.
4. Background worker loads the *full* file, applies the plan, infers the final schema, writes it as Parquet, and records a new dataset version.
5. User queries the dataset → the query engine reads that Parquet file directly from storage and returns results — no separate "load into database" step required.

This separation — light, synchronous work in the API; heavy, asynchronous work in the background; storage-native compute for queries — is the backbone of the whole system.
