# Growing the System

The backend was deliberately built with several places designed to grow — so new capabilities can be added without reworking what already exists. This page explains what those growth points are and how they're meant to be used, conceptually.

## Adding a new data source

Today the system can ingest from files (CSV, Excel, Parquet) and several databases (Postgres, MySQL, SQL Server, Snowflake). Each source type is handled by its own **connector** — a self-contained piece of code responsible only for "read this kind of source into a table." The rest of the ingestion pipeline (staging, schema diffing, transforming, committing, versioning) doesn't know or care which connector produced the data.

This means adding support for a new source (say, a new database vendor, or an API-based source) is additive: build a new connector that can produce the same kind of table-shaped output, register it as a new source type, and the rest of the pipeline works with it automatically. Nothing about staging, transforms, or versioning needs to change.

## Adding a new transform operation

The catalog of available transform steps (rename, drop, cast, filter, trim, uppercase, round, and more) is deliberately structured as a growing list of independent, well-defined operations rather than one big piece of transformation logic. Each operation is self-describing — it knows its own name, what inputs it needs, and how to apply itself.

This is why the transform-builder UI (DataForge) can offer new operations without backend changes to the pipeline itself: adding an operation means describing a new entry in the catalog, and it becomes available everywhere transforms are used — preview, commit, and any future use of transform plans.

## Adding a new compute engine

Right now, all data processing (loading, transforming, writing) runs through a single engine built on pandas. But the system anticipates needing faster or more scalable engines as datasets grow larger — for example, a DuckDB-based engine for bigger-than-memory processing, or a distributed engine for very large datasets.

The pipeline doesn't call pandas directly — it calls a generic "engine" that exposes a standard set of capabilities (load data, apply transforms, infer schema, write the result, count rows/columns). Because every engine is expected to expose the same capabilities, the pipeline can be pointed at a different engine — potentially chosen automatically based on how big the incoming data is — without changing how ingestion, transformation, or versioning work. Today only the pandas engine exists in full, but the seams for adding faster engines are already in place.

## Adding a whole new module

Auth, Workspace, Ingestion, Transformation, and Query are all built the same way (see [How the System Is Built](06-DEVELOPER-PATTERNS.md)): a consistent shape of data definitions, business rules, and API endpoints. A future module — say, Sharing, Notifications, or Machine-Learning Insights — is expected to follow that same shape:

1. Define what it needs to remember permanently.
2. Define what valid requests and responses look like.
3. Write the rules for what's allowed and what isn't.
4. Expose it through a set of API endpoints.
5. Wire it into the same authentication system everything else uses.

Because every existing module follows this pattern, a new module slots in alongside them without requiring changes to how existing modules work — they're independent of each other, connected only through shared concepts like Workspace and Dataset.

## Design principles that make this possible

- **Small, replaceable pieces.** Connectors, transform operations, and compute engines are each self-contained, so replacing or adding one doesn't ripple into the rest of the system.
- **A stable "shape of a version" contract.** Every version — regardless of source or engine — ends up with the same basic properties (schema, row count, storage location). Anything downstream (querying, previewing) only needs to understand that shape, not how the version was produced.
- **Background work stays background work.** As new, heavier capabilities get added (bigger engines, more complex transforms), they can continue to run asynchronously without changing how users interact with the system — start a job, get notified when it's ready.
- **Review-before-commit stays the default.** Any new way of bringing in or reshaping data is expected to follow the same "stage it, preview it, then commit it" pattern that ingestion uses today — it's the safety net that keeps bad imports from silently becoming permanent.
