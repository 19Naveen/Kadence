# Knowledge Representation Platform

An AI-powered lakehouse data platform that enables users to ingest, transform, query, and model data at scale — without managing infrastructure or risking data integrity.

> Detailed documentation: [Backend](./backend/README.md) | [Frontend](./frontend/README.md) | [Knowledge Base / Wiki](./docs/wiki/00-INDEX.md)

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [System Architecture](#system-architecture)
3. [Tech Stack](#tech-stack)
4. [Infrastructure Services](#infrastructure-services)
5. [Getting Started](#getting-started)
6. [Design Rules](#design-rules)
7. [Changelog](#changelog)

---

## Core Philosophy

> **Separate Storage, Compute, and Control Planes**

1. **Object Storage is the source of truth** — all datasets stored as Parquet in MinIO
2. **Compute is stateless** — DuckDB / Spark / Pandas with no side effects
3. **PostgreSQL stores only metadata** — never actual dataset rows

---

## System Architecture

```
                    ┌────────────────────┐
                    │     Frontend       │
                    │  React + Vite      │
                    └─────────┬──────────┘
                              │ HTTP / REST
                    ┌─────────▼──────────┐
                    │      FastAPI       │
                    │   Control Plane    │
                    │   /api/v1/*        │
                    └──────┬──────┬──────┘
                           │      │
              ┌────────────▼─┐  ┌─▼────────────┐
              │  PostgreSQL  │  │   RabbitMQ   │
              │  (Metadata)  │  │  (Job Queue) │
              └──────────────┘  └──────┬───────┘
                                       │
                              ┌────────▼────────┐
                              │  Celery Workers │
                              │ (Async Pipeline)│
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │     MinIO       │
                              │ (Parquet Store) │
                              └─────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, react-router-dom |
| Backend API | FastAPI (Python 3.14), Uvicorn |
| Task Queue | Celery 5 + RabbitMQ |
| Metadata DB | PostgreSQL 16 (SQLAlchemy 2.0, Alembic) |
| Object Storage | MinIO (S3-compatible) |
| Columnar Compute | DuckDB, PyArrow, Pandas |
| ML | scikit-learn, XGBoost |
| Auth | JWT (python-jose + bcrypt) |
| Package Managers | uv (backend), npm (frontend) |

---

## Infrastructure Services

All services run via Docker Compose (`backend/docker-compose.yml`).

| Service | Port(s) | Purpose |
|---|---|---|
| PostgreSQL 16 | 5432 | Metadata storage |
| MinIO | 9000 (API), 9001 (Console) | Parquet file storage |
| RabbitMQ 3.13 | 5672 (AMQP), 15672 (Management) | Celery task broker |

---

## Getting Started

### Prerequisites

- Python 3.14+, Node.js 18+, Docker + Docker Compose, `uv`

### Run everything

```bash
make run
```

Starts Docker services, FastAPI backend, and React frontend. Ctrl+C stops all.

### Individual commands

```bash
make docker-up      # Start Docker services only
make backend        # Start backend (also starts Docker)
make frontend       # Start frontend dev server
make docker-down    # Stop Docker services
```

### Celery worker (separate terminal)

```bash
cd backend
celery -A celery_app worker --loglevel=info
```

For full setup details see [backend/README.md](./backend/README.md) and [frontend/README.md](./frontend/README.md).

---

## Design Rules

### Must follow

- Raw data is **never stored in a database**
- All datasets stored as **Parquet in MinIO**
- DB connections are **read-only**
- Transformations are **immutable + versioned**
- PostgreSQL holds **metadata only**

### Never do

- Load large datasets into PostgreSQL
- Query user production DB directly
- Overwrite raw Parquet files
- Use Pandas for datasets > 1 GB

---

## Changelog

### 2026-07-10 — Backend knowledge base wiki added

- Added `docs/wiki/` — a plain-language, code-free knowledge base explaining backend architecture,
  concepts, modules, data model, API surface, developer patterns, the ingestion journey, and how the
  system is designed to grow. Complements `backend/README.md` (setup/quick-reference) rather than
  replacing it.

### 2026-06-17 — Live query/compute layer over latest version

- DuckDB query layer (`/api/v1/query`) now reads dataset Parquet directly from MinIO via `httpfs`,
  always resolving the **latest version** — realising the stateless-compute principle for EDA
  Dashboards, Query Studio, and Data Transform preview.
- Ingestion can now version a changed schema as-is ("accept new schema"), and all downstream
  features read the latest version, so a new schema propagates everywhere automatically.

### 2026-06-06 — Three-file README split

- Root README reduced to platform overview and getting started
- `backend/README.md` created with full backend module, API, and pipeline detail
- `frontend/README.md` created with full frontend structure, routing, and state management detail

### 2026-06-06 — Data Ingestion Pipeline Architecture

- Defined full 11-step ingestion pipeline with Celery async execution
- Schema inference, diff detection, mapping rule persistence, and versioned MinIO storage

### 2026-06-06 — Backend Bootstrap

- FastAPI + JWT auth, PostgreSQL via SQLAlchemy 2.0, MinIO + RabbitMQ services
- Switched to `uv` + `pyproject.toml`, Makefile for unified dev workflow

---

Developed by **Bit Bandits**.
