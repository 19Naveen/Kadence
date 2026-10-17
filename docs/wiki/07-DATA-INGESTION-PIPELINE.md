# The Data Ingestion Journey

This page walks through, step by step, everything that happens between "a user wants to bring in some data" and "that data is queryable." It ties together concepts from [Core Concepts](02-CORE-CONCEPTS.md) into one continuous story.

## Step 1 — Connecting a source

The user tells the system where their data is: either by uploading a file (CSV, Excel, Parquet) or by supplying connection details for a database (Postgres, MySQL, SQL Server, Snowflake), along with the workspace it belongs to.

Before anything else happens, the system checks that the target **workspace** actually exists and is owned by the user making the request. If it doesn't exist, or belongs to someone else, the request is rejected — nothing is created. This check runs first, ahead of both dataset and job creation, so a dataset can never end up attached to a workspace the requester doesn't own.

- **File uploads** are stored immediately in a temporary staging location in object storage.
- **Database connections** aren't copied anywhere yet — the system just remembers the connection details and takes a quick peek to estimate size and shape.

Only once the workspace is confirmed does the system proceed: creating a new **dataset** record (if this is the dataset's first-ever import), and then an **ingestion job** with status "pending," in that order — workspace, then dataset, then job.

Nothing has been permanently versioned yet. This is intentionally a "just looking" step.

## Step 2 — Reviewing a sample

The user (or the UI on their behalf) requests a **staged preview**: a sample of rows from the source, along with the schema the system inferred from that sample (column names and types, detected automatically — not manually declared).

If the dataset already has a previous version, the system also compares the new schema against the old one and flags any differences: new columns, columns that disappeared, or columns whose type looks like it changed. This is the **schema diff** — it exists so users notice when an upstream source changes shape, instead of silently overwriting a dataset with structurally different data.

## Step 3 — Reconciling schema changes (if any)

If the schema diff shows meaningful changes, the user has two choices:

- **Accept the new schema as-is** — proceed with whatever the incoming data actually looks like.
- **Supply mapping rules** — explicit instructions for how to reconcile the difference, e.g., "the old `qty` column is now called `quantity`, treat them as the same," or "drop the new `internal_notes` column," or "cast `price` to a decimal." The system even suggests likely renames automatically, by comparing old and new column names for close matches.

This step only happens when a diff exists and needs resolving. A dataset's very first import has nothing to reconcile against, so it skips straight through.

## Step 4 — Building a transform plan

Independently of schema reconciliation, the user can build a **transform plan**: an ordered list of cleanup steps to apply to the data before it becomes a version. This is done visually, in the import wizard (DataForge) — drag in a step like "trim whitespace," "filter out nulls," "convert to uppercase," "round to 2 decimals," and see the result immediately, applied live to the sample.

This plan isn't run against the real data yet — it's just being assembled and checked against the sample for correctness.

## Step 5 — Committing

When the user is satisfied, they commit. This does two things:

1. Saves the transform plan (and any schema mapping rules) permanently against the job.
2. Hands the job off to a **background worker** — the request returns immediately with the job marked "running," rather than making the user wait.

## Step 6 — Processing (in the background)

The background worker does the heavy lifting, away from the user's browser:

1. Loads the **entire** source — not just the sample used for preview.
2. Applies the transform plan, in order, to the full dataset.
3. Infers the final schema from the transformed result.
4. Writes the result as a compressed columnar file (Parquet) to object storage.
5. Records a new **dataset version** — incrementing the version number, and storing the row count, column count, schema, and file size.
6. Marks the job "succeeded" (or "failed," with an error message, if something went wrong along the way).
7. Cleans up the temporary staging file, since its data now lives permanently in the new version.

## Step 7 — Ready to query

As soon as the version exists, it's the dataset's new "latest" — and every query, aggregation, and preview automatically targets it. There's no separate activation step; committing *is* what makes data available.

## What happens on a re-import

If a user re-imports into a dataset that already has data (e.g., a refreshed weekly export), the whole journey repeats: stage the new data, compare its schema to the current latest version, resolve any differences, optionally transform, and commit — producing the *next* version, not overwriting the last one. The old version keeps existing, so nothing is lost even if the new import turns out to be wrong.
