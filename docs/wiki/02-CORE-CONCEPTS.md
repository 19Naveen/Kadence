# Core Concepts

These are the building-block terms used throughout the system. Understanding them makes every other page in this wiki easier to follow.

## Workspace

A **Workspace** is a container for a user's work — think of it like a project or folder. Every dataset belongs to exactly one workspace, and every workspace belongs to exactly one owner (the user who created it). Workspaces keep different projects or teams' data separate from each other.

## Dataset

A **Dataset** is a named "thing" a user is tracking — for example, "Q3 Sales" or "Customer List." A dataset on its own doesn't hold any data; it's a label and a home for a series of **versions**. When people talk about "the dataset," they usually mean its *latest version*.

## Ingestion Job

An **Ingestion Job** represents one attempt to bring data into a dataset — connecting a source, staging it, and (eventually) committing it as a new version. A job tracks its own status (pending, running, succeeded, failed) independently of the dataset, so you can see the history of import attempts, including ones that failed.

Every commit — whether it's the dataset's first version or its tenth — goes through a job.

## Version

A **Version** is an immutable, point-in-time snapshot of a dataset's data. Each time a job successfully commits, a new version is created — version 1, then version 2, and so on. Old versions are never overwritten or deleted automatically; they simply stop being "the latest." This gives datasets a built-in history: you can always trace back to what the data looked like before a change.

Versions store:
- Where the actual data file lives (in object storage)
- How many rows and columns it has
- Its schema (column names and types)
- Its file size

## Schema

A dataset version's **schema** is the list of its column names and their types (string, integer, decimal, boolean, timestamp). Schemas are *inferred automatically* from the data — nobody manually declares "column X is an integer"; the system looks at the actual values and figures it out.

Because schemas are inferred fresh on every commit, a new version can have a different schema than the one before it (a new column shows up, a type changes). The system detects this as a **schema diff** and asks the user how to reconcile it — that's covered in [The Data Ingestion Journey](07-DATA-INGESTION-PIPELINE.md).

## Transform / Transform Plan

A **Transform** is a single, well-defined operation applied to the data — for example, "drop this column," "rename that column," "convert this text to uppercase," "filter out rows where price is null." A **Transform Plan** is an ordered list of these steps, built visually by the user in the import wizard (nicknamed *DataForge*) before a dataset is committed.

Transform plans are applied once, at commit time, to produce a version — they aren't a live, ongoing pipeline. If a user wants to change the transformation logic later, they build (or edit) a new plan and commit a new version.

## Staging

**Staging** is the temporary holding area for data that has been uploaded or connected but not yet committed. A staged file lives in object storage under a temporary path; a staged database connection is just a stored set of connection details. Staging exists so the user can preview and shape data (see the schema, try transforms) before anything becomes a permanent version. Once a job commits successfully, staged files are cleaned up — the data lives on only as the new version.

## Query

Once a dataset has at least one version, it can be **queried** — either with a hand-written SQL `SELECT` statement, a simpler "group by and aggregate" request (for charts), or a plain row preview. Queries always run against the *latest* version of a dataset and read data directly from object storage — they never touch the operational database.
