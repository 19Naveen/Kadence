# Modules

The backend is organized into feature modules, each owning one area of responsibility. This page explains what each module does and why it exists — not how it's coded.

Every module follows the same internal shape (models → business rules → API endpoints); that consistency is covered in [How the System Is Built](06-DEVELOPER-PATTERNS.md). This page is about *what* each module is for.

---

## Auth

**Responsibility:** Who is this user, and are they who they say they are?

Auth handles account creation (signup), login, and issuing access tokens. Every other protected endpoint in the system relies on Auth to confirm "this request belongs to user X" before doing anything.

Passwords are never stored in plain text — they're hashed. Access tokens are short-lived and carry the user's identity so the rest of the system doesn't need to re-check the database on every request.

The system is also designed to support logging in via external providers (Google, GitHub, Microsoft) — that groundwork exists today even though those providers aren't fully wired up yet.

---

## Workspace

**Responsibility:** Organizing a user's datasets into separate projects.

A workspace is the top-level container everything else lives under. Users can create workspaces, list the ones they own, and delete them. Every dataset belongs to exactly one workspace, so workspaces are the natural boundary for "everything related to this project."

---

## Ingestion

**Responsibility:** Getting data into the system, safely and reviewably.

This is the largest and most involved module. It's responsible for:

- **Connecting to sources** — file uploads (CSV, Excel, Parquet) or live database connections (Postgres, MySQL, SQL Server, Snowflake). Before anything is created, ingestion confirms the target workspace exists and is owned by the requesting user — datasets and jobs can only ever be created inside a workspace the user actually owns.
- **Staging** — taking a first look at the data, sampling it, and inferring its shape, without committing anything permanent.
- **Detecting schema changes** — when a dataset already has a version and new incoming data doesn't match, ingestion computes exactly what changed (new columns, missing columns, type changes) and offers smart suggestions for reconciling it (e.g., "this looks like a renamed column").
- **Running transform plans** — applying the user's cleanup steps to the data.
- **Committing versions** — writing the final, transformed data to storage and recording a new dataset version.

See [The Data Ingestion Journey](07-DATA-INGESTION-PIPELINE.md) for the full step-by-step walkthrough.

---

## Transformation

**Responsibility:** Defining and previewing the "cleanup steps" a user can apply to data.

This module owns the catalog of available transform operations — things like renaming a column, casting a type, filtering rows, trimming whitespace, doing basic math on a numeric column. It also powers the *live preview*: as a user builds a transform plan in DataForge, this module lets them see the effect of each step on a small sample immediately, before anything is committed.

Longer-term, this module is where compiled/optimized execution of transform plans lives — for now, transforms run directly against the sampled data for preview and against the full data at commit time via the Ingestion module.

---

## Query

**Responsibility:** Letting users explore committed data.

Once a dataset has a version, this module offers three ways to look at it:

- **Raw SQL** — a read-only `SELECT` query the user writes themselves, useful for ad-hoc exploration.
- **Aggregation** — a simplified "group by X, summarize Y" request, designed to power charts without needing a user to write SQL.
- **Preview** — the first N rows plus the schema, a quick sanity check of what a dataset currently looks like.

Every query always targets the dataset's *latest* version and reads straight from object storage — there's no separate step where data gets "loaded" into a queryable database first. This keeps exploration fast and avoids duplicating data.

For safety, only read-only queries are allowed: anything that would modify data or the database (`INSERT`, `DELETE`, `DROP`, etc.) is rejected before it ever runs.
