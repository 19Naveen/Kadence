# Backend Knowledge Base

A plain-language guide to how the Knowledge Representation backend works — what it does, how the pieces fit together, and why they're built the way they are. This is a conceptual companion to `backend/README.md` (which covers setup and quick reference); this wiki explains the *why* and *how* behind each feature.

No code-reading required. If you want implementation details, see the module source under `backend/modules/`.

## Contents

1. **[Architecture](01-ARCHITECTURE.md)** — The big picture: what the system does end-to-end, and the design philosophy behind it.
2. **[Core Concepts](02-CORE-CONCEPTS.md)** — The vocabulary: Workspaces, Datasets, Versions, Jobs, Transforms, Schemas.
3. **[Modules](03-MODULES.md)** — What each part of the backend is responsible for: Auth, Workspace, Ingestion, Transformation, Query.
4. **[Data Model](04-DATA-MODEL.md)** — What data the system stores and how it relates, explained without table/column jargon.
5. **[API Reference](05-API-REFERENCE.md)** — Every endpoint, what it's for, and when to call it.
6. **[How the System Is Built](06-DEVELOPER-PATTERNS.md)** — The recurring shape every feature follows, so the codebase feels consistent no matter which module you're in.
7. **[The Data Ingestion Journey](07-DATA-INGESTION-PIPELINE.md)** — A step-by-step walkthrough of what happens from "user uploads a CSV" to "queryable dataset."
8. **[Growing the System](08-EXTENDING-THE-SYSTEM.md)** — How new capabilities (data sources, transforms, compute engines, whole modules) get added without disrupting what already works.

## Who this is for

- **New team members** — read in order, 1 → 8, to build a mental model of the whole system.
- **Existing contributors** — jump to the module or feature you're touching for a refresher.
- **Anyone curious how a feature works** — each page stands alone; you don't need code access to follow along.
