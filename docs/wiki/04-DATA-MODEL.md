# Data Model

This page explains what information the system keeps track of and how those pieces relate — without diving into database column types or SQL. If you understand [Core Concepts](02-CORE-CONCEPTS.md), this page just connects those concepts to each other.

## The relationships, in plain terms

- A **User** owns many **Workspaces**.
- A **Workspace** contains many **Datasets**.
- A **Dataset** has many **Versions** (its history) and many **Ingestion Jobs** (its import attempts).
- A **Version** belongs to exactly one dataset, and knows its own row count, column count, schema, and where its data file lives in storage.
- An **Ingestion Job** belongs to exactly one dataset and tracks one import attempt from start to finish (or failure).
- A **Mapping Rule** belongs to a dataset and records a saved decision about how to reconcile a schema change (e.g., "always rename column `qty` to `quantity`").

Visually:

```
User
 └─ Workspace (many)
     └─ Dataset (many)
         ├─ Version (many)         — the actual data, snapshotted over time
         ├─ Ingestion Job (many)   — the history of import attempts
         └─ Mapping Rule (many)    — saved schema-reconciliation decisions
```

## What each record actually holds

**User** — username, email, password (hashed), which login provider they used (local password vs. an external provider), account status.

**Workspace** — a name, an optional description, a URL-friendly slug, and which user owns it.

**Dataset** — a name, an optional description, what kind of source it originally came from (CSV, Postgres, etc.), and which workspace it belongs to. The dataset record itself is lightweight — the real data lives in its versions.

**Ingestion Job** — which dataset it's importing into, its current status (pending / running / succeeded / failed), what kind of source it's reading from, the connection details for database sources, a temporary staging location for file sources, and an error message if it failed. A job also temporarily holds the schema of newly-staged data while it's awaiting the user's review, and the transform plan the user built for it once one exists.

**Dataset Version** — which version number it is, where its Parquet data file lives in object storage, its row count, column count, inferred schema, and file size.

**Mapping Rule** — a remembered decision for handling a specific schema difference: which source column, what to do with it (map to a new name, drop it, or cast its type), and the target column/type if applicable. These accumulate over time so recurring schema quirks (e.g., a source that always renames a column slightly differently) don't need to be re-solved by hand on every import.

## Why metadata and data are stored separately

Notice that nowhere in this model is the *actual dataset content* — the rows and cells a user uploaded. That lives in object storage as Parquet files, referenced by a version's storage path. The operational database only stores the bookkeeping: who owns what, what happened, and where to find the real data.

This split is deliberate — see [Architecture](01-ARCHITECTURE.md#why-its-built-this-way) for the reasoning. In short: it keeps the operational database small regardless of how much data users bring in, and it lets the query engine read data straight from storage without a database round-trip.
