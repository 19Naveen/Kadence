# Frontend — Knowledge Representation Platform

React 18 + TypeScript + Vite frontend for the KnowRep platform.

> Part of the monorepo. See [root README](../README.md) for platform overview and [backend README](../backend/README.md) for API detail.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Structure](#structure)
3. [Pages & Routes](#pages--routes)
4. [State Management](#state-management)
5. [API Integration](#api-integration)
6. [Design System](#design-system)
7. [Environment Variables](#environment-variables)
8. [Running the Frontend](#running-the-frontend)
9. [Changelog](#changelog)

---

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| React | 18.3.1 | UI framework |
| TypeScript | 5.6.3 | Type safety |
| Vite | 5.4.10 | Build tool and dev server |
| react-router-dom | 6.30.1 | Client-side routing |
| TailwindCSS | 3.4.14 | Utility-first CSS |
| lucide-react | 0.468.0 | Icon library |

No Redux or Zustand — state is managed via React Context API.

---

## Structure

```
frontend/
├── index.html                     # Root HTML, mounts #root
├── vite.config.ts                 # Vite config (React plugin)
├── tailwind.config.ts             # Tailwind + design tokens
├── tsconfig.json                  # TypeScript config (strict mode)
│
└── src/
    ├── main.tsx                   # Entry point: context providers + BrowserRouter
    ├── App.tsx                    # Route definitions + layout
    │
    ├── components/
    │   ├── auth/
    │   │   ├── ProtectedRoute.tsx # Redirects to /auth if not authenticated
    │   │   └── PublicOnlyRoute.tsx# Redirects to / if already authenticated
    │   └── shared/
    │       ├── AppShell.tsx       # Main layout: sidebar + header + outlet
    │       ├── BrandMark.tsx      # "K" tile + "KnowRep" wordmark (size/inverted props)
    │       ├── AuthCardLayout.tsx # Centered gradient card shell for auth pages
    │       ├── PageHeader.tsx     # Page title + subtitle component
    │       ├── EmptyState.tsx     # Empty state placeholder
    │       ├── MetricTile.tsx     # Single metric display tile
    │       ├── StatCard.tsx       # Stat card with label and value
    │       └── StatusPill.tsx     # Status badge (active, pending, error)
    │
    ├── features/                  # One folder per platform feature
    │   ├── home/
    │   │   └── HomePage.tsx
    │   ├── landing/
    │   │   ├── LandingPage.tsx    # Composition root
    │   │   ├── landingContent.ts  # Typed feature + step arrays
    │   │   └── components/        # LandingNavbar, HeroSection, FeaturesSection, HowItWorksSection, CtaBanner, LandingFooter
    │   ├── auth/
    │   │   ├── AuthPage.tsx       # Legacy combined page (kept for reference)
    │   │   ├── SigninPage.tsx     # Email + password sign in → /app
    │   │   └── SignupPage.tsx     # Registration → /onboarding
    │   ├── onboarding/
    │   │   └── OnboardingPage.tsx # Workspace creation; no AppShell
    │   ├── data-import/
    │   │   └── DataImportPage.tsx
    │   ├── data-transform/
    │   │   └── DataTransformPage.tsx
    │   ├── query-studio/
    │   │   └── QueryStudioPage.tsx
    │   ├── eda-dashboards/
    │   │   └── EDADashboardsPage.tsx
    │   ├── ml-training/
    │   │   └── MLTrainingPage.tsx
    │   ├── ml-prediction/
    │   │   └── MLPredictionPage.tsx
    │   ├── automl-lab/
    │   │   └── AutoMLLabPage.tsx
    │   ├── deploy-sim/
    │   │   └── DeploySimPage.tsx
    │   ├── workspace/
    │   │   └── WorkspaceSettingsPage.tsx
    │   └── about/
    │       └── AboutPage.tsx
    │
    ├── lib/
    │   ├── auth/
    │   │   ├── types.ts           # Auth type definitions (User, Session, etc.)
    │   │   └── storage.ts         # localStorage read/write for session
    │   ├── context/
    │   │   ├── AuthContext.tsx    # Auth state + backend API calls
    │   │   ├── AppContext.tsx     # Datasets and dashboards state
    │   │   └── WorkspaceContext.tsx # Workspace and member state
    │   ├── hooks/
    │   │   └── useDatasets.ts     # useDatasets() (real datasets) + useQueryApi() (DuckDB endpoints)
    │   ├── mocks/
    │   │   ├── data.ts            # Mock data for not-yet-wired features (ML pages)
    │   │   └── types.ts           # Types for mock data
    │   └── cn.ts                  # Classname utility (clsx/twMerge pattern)
    │
    └── styles/
        ├── globals.css            # Tailwind directives + base styles
        └── tokens.css             # CSS custom properties (colors, spacing)
```

---

## Pages & Routes

Public routes are open to all. `/signin` and `/signup` are wrapped in `<PublicOnlyRoute>` (redirect to `/app` if logged in). `/onboarding` is `<ProtectedRoute>` without AppShell. All `/app/*` routes require authentication via `<ProtectedRoute>` and render inside `<AppShell>`.

| Path | Component | Auth Required | Description |
|---|---|---|---|
| `/` | `LandingPage` | No | Marketing landing page |
| `/signin` | `SigninPage` | No (public only) | Email + password sign in |
| `/signup` | `SignupPage` | No (public only) | Username + email + password registration |
| `/auth` | Redirect → `/signin` | — | Legacy redirect |
| `/onboarding` | `OnboardingPage` | Yes | Create first workspace (no AppShell) |
| `/app` | `HomePage` | Yes | Platform dashboard / overview |
| `/app/data-import` | `DataImportPage` | Yes | Ingest files or connect databases. Dataset detail panel always shows a Data Origin & Lineage section — where the dataset originally came from (file/DB table), plus any join sources if it was combined in Pipeline Studio |
| `/app/data-transform` | `DataTransformPage` (**Pipeline Studio**) | Yes | Apply transformation steps to datasets, including cross-dataset joins. The Preview tab (no import in progress) can also combine already-imported datasets and save the result as a new/existing dataset via "Save as dataset" |
| `/app/query-studio` | `QueryStudioPage` | Yes | SQL queries on Parquet via DuckDB |
| `/app/eda-dashboards` | `EDADashboardsPage` | Yes | Exploratory data analysis dashboards |
| `/app/automl-lab` | `AutoMLLabPage` | Yes | AutoML pipeline configuration |
| `/app/ml-training` | `MLTrainingPage` | Yes | Manual ML training runs |
| `/app/ml-prediction` | `MLPredictionPage` | Yes | Run and view model predictions |
| `/app/workspace-settings` | `WorkspaceSettingsPage` | Yes | Workspace members, roles, settings |
| `/app/about` | `AboutPage` | Yes | Platform information |
| `*` | Redirect → `/` | — | Catch-all |

### Sidebar navigation groups

| Group | Pages |
|---|---|
| Overview | Home |
| Data Engine | Data Import, Data Transform, Query Studio, EDA Dashboards |
| Intelligence | AutoML Lab, ML Training, ML Prediction |
| Predictive Models | Deploy Sim |

---

## State Management

Three React Contexts with no external state library. Provider hierarchy:

```
AuthProvider
  └── WorkspaceProvider
        └── AppProvider
              └── BrowserRouter
                    └── App
```

### AuthContext (`src/lib/context/AuthContext.tsx`)

Manages authentication state and all auth API calls.

| Export | Type | Description |
|---|---|---|
| `isAuthenticated` | `boolean` | Whether a valid session exists |
| `isLoading` | `boolean` | Auth operation in progress |
| `user` | `User \| null` | Current user profile |
| `session` | `Session \| null` | Raw session with token |
| `loginWithCredentials(email, password)` | `async fn` | POST `/auth/login` |
| `signupWithCredentials(username, email, password)` | `async fn` | POST `/auth/signup` |
| `logout()` | `fn` | Clears session from state and localStorage |

Session is persisted in localStorage under key `knowrep.auth.session` and rehydrated on app load.

### AppContext (`src/lib/context/AppContext.tsx`)

Manages app-level data state (currently backed by mock data).

| Export | Type | Description |
|---|---|---|
| `datasets` | `Dataset[]` | All datasets in the active workspace |
| `activeDatasetId` | `string \| null` | Currently selected dataset |
| `activeDataset` | `Dataset \| null` | Derived from activeDatasetId |
| `dashboards` | `Dashboard[]` | Dashboard configurations |
| `addDataset(dataset)` | `fn` | Add a new dataset |
| `addDashboard(dashboard)` | `fn` | Add a new dashboard |
| `updateDashboard(id, updates)` | `fn` | Update dashboard config |

### WorkspaceContext (`src/lib/context/WorkspaceContext.tsx`)

Manages workspace switching and member management.

| Export | Type | Description |
|---|---|---|
| `workspaces` | `Workspace[]` | All workspaces the user belongs to |
| `activeWorkspace` | `Workspace \| null` | Currently selected workspace |
| `switchWorkspace(id)` | `fn` | Change active workspace |
| `createWorkspace(name, description?)` | `fn` | Create a new workspace |
| `updateWorkspace(updates)` | `fn` | Update active workspace |
| `inviteMember(email, role)` | `fn` | Invite a member to the workspace |
| `updateMemberRole(memberId, role)` | `fn` | Change a member's role |
| `removeMember(memberId)` | `fn` | Remove a member |

---

## API Integration

API calls use the native `fetch` API — no axios or custom HTTP client.

**Base URL** (configured via env var):

```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1"
```

**Auth header pattern** (for all protected requests):

```typescript
headers: {
  "Authorization": `Bearer ${session.access_token}`,
  "Content-Type": "application/json",
}
```

**Implemented API calls:**

| Call | Endpoint | Where |
|---|---|---|
| Login | `POST /auth/login` | `AuthContext` |
| Signup | `POST /auth/signup` | `AuthContext` |
| Workspaces CRUD | `/workspaces` | `WorkspaceContext` |
| Ingestion (upload, jobs, resolve, datasets, versions, schema) | `/data-ingest/*` | `DataImportPage` |
| List datasets | `GET /data-ingest/datasets?workspace_id=` | `useDatasets()` |
| Preview latest version | `GET /query/datasets/{id}/preview` | `useQueryApi().preview` |
| Run SQL | `POST /query/execute` | `useQueryApi().execute` (Query Studio) |
| Aggregate for charts | `POST /query/aggregate` | `useQueryApi().aggregate` (EDA Dashboards) |

### Real datasets & latest-version data (`src/lib/hooks/useDatasets.ts`)

`useDatasets()` fetches the real datasets in the active workspace (source of truth shared by EDA
Dashboards, Query Studio, and Data Transform). `useQueryApi()` wraps the DuckDB-backed `/query`
endpoints. The frontend **never sends a version number** — the backend always resolves the latest
version, so charts/queries/previews reflect the newest ingested schema automatically.

The **ML pages** (Training, Prediction, AutoML, Deploy Sim) still use mock data from
`src/lib/mocks/data.ts` pending the backend ML module.

---

## Design System

Built on TailwindCSS with a custom design token layer.

### Color tokens (`src/styles/tokens.css`)

HSL-based CSS custom properties — dark theme by default:

| Token | Usage |
|---|---|
| `--color-primary` | Deep indigo/near-black — backgrounds |
| `--color-accent` | Electric blue — interactive elements |
| `--color-success` | Green |
| `--color-warning` | Amber |
| `--color-danger` | Red |

### Component utility classes (`tailwind.config.ts`)

| Class | Purpose |
|---|---|
| `.card` | Surface container with border and radius |
| `.btn` | Base button |
| `.btn-primary` | Accent-coloured primary action button |
| `.btn-secondary` | Outlined secondary button |
| `.input` | Styled form input |
| `.badge` | Small status label |

### Typography

- **Body:** Inter (sans-serif)
- **Code / monospace:** JetBrains Mono

### Custom animations

`fadeIn`, `slideUp`, `scaleIn` — defined in `tailwind.config.ts`.

---

## Environment Variables

Create `frontend/.env.local` for local overrides (not committed).

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | Backend API base URL |

All Vite env vars must be prefixed with `VITE_` to be accessible in the browser via `import.meta.env`.

---

## Running the Frontend

```bash
# From repo root
make frontend

# Or directly
cd frontend && npm run dev
```

Dev server runs at `http://localhost:5173` (Vite default).

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

---

## Changelog

### 2026-07-19 — Data Lineage view in Data Import + fix: join right-key defaulted to empty

- Dataset detail panel (`DataImportPage.tsx`) now **always** shows a **Data Origin & Lineage**
  section above Version History — for every dataset, not just combined ones. It always states
  where the data originally came from (`originLabel`: "Uploaded CSV/XLSX/Parquet file", or
  `<db type> · <table>` for a DB import — table name only, never credentials), and additionally
  lists any join sources if the dataset's latest version was produced by combining others:
  each join edge shows the source dataset's name, join type/keys, and *its own* origin,
  indented recursively for multi-hop chains (a dataset joined from a dataset that was itself
  joined, etc.). Built by `fetchLineageTree`, which calls `GET /datasets/{id}/lineage`
  recursively (server only resolves one hop; depth capped at 4 with cycle guard via a
  `visited` set).
- Fixed a join-builder bug in `DataTransformPage.tsx`: the right-side key select (`right_on`,
  kind `column_right`) never got a default value once the right dataset's columns finished
  loading — unlike `left_on`, which `defaultParams` already handles. The `<select>` visually
  showed the first column but `draftParams.right_on` stayed `""`, so committing the step could
  produce a join with an empty right key, failing at preview/run time with `"right dataset has
  no column ''"`. Now auto-selected the same way `left_on` already was.

### 2026-07-19 — Fix: join step (and "Combine" category) never appeared in Pipeline Studio

- `fetchOpsFromApi` (merges the backend's op catalog — including `join`, category
  "Combine" — into the frontend's `OPS`/`CATS`) was defined in `transforms.ts` but never
  called anywhere. `DataTransformPage` silently ran on `LOCAL_CATS`
  (`["Columns","Rows","Text","Numeric","Date & Time"]`), which has no "Combine" category and
  no `join` op at all — so the join builder was invisible in both the Preview tab and Import
  Review (DataForge), and nothing prevented or supported adding one, let alone several.
- Fixed by calling `fetchOpsFromApi(authHeaders)` in a `useEffect` on mount, with a small
  `opsVersion` state bump to force a re-render once the module-level `OPS`/`CATS` bindings
  update (they aren't React state). Once loaded, "Join Dataset" appears under the "Combine"
  menu in both tabs and can be added as many times as needed — nothing in the step list caps
  join count, matching the backend (`resolve_join_sources` and `sql_compiler.compile_plan`
  already handled unlimited chained joins).

### 2026-07-19 — Pipeline Studio: ad-hoc "Save as dataset" for combining existing datasets

- The Preview tab's "Save & Apply" button is now "Save as dataset" — enabled whenever a
  dataset is selected (previously the Preview tab had no save capability at all). Clicking it
  opens an inline form to combine the selected dataset with others via `join` steps (same
  builder UI as import mode) and save the result as a new dataset (name field) or a new
  version of an existing one (dataset picker).
- New `saveCombine()` posts to `POST /data-ingest/jobs/combine` and polls the returned job to
  completion, reusing a `pollJob()` helper extracted out of the existing `saveAndApply()` (no
  behavior change to the import-commit path).
- See `backend/README.md` for the `/jobs/combine` endpoint.

### 2026-07-16 — Pipeline Studio: join step UI + server-routed preview for joins

- `DataTransformPage.tsx` renamed on-page (title + subtitle) to **Pipeline Studio**; the
  route (`/app/data-transform`) and file name are unchanged. Subtitle now mentions that
  Save & Apply processes the full dataset in the background (matches the new DuckDB
  large-run engine on the backend).
- Added a "Join Dataset" step to the transform builder (category **Combine**), backed by the
  backend's new `join` op. Two new `FieldDef` kinds in `src/lib/transforms/transforms.ts`:
  `dataset` (a `<select>` of workspace datasets from `useDatasets()`, excluding the dataset
  currently being transformed) and `column_right` (a `<select>` of the chosen right dataset's
  columns, fetched from `GET /data-ingest/datasets/{id}/versions` and cached per `dataset_id`).
  Field keys match the backend's `JoinStep`/`OPS_CATALOG["join"]` exactly: `dataset_id`,
  `left_on`, `right_on`, `how`.
- `join` has no client-side `apply()` (it needs real backend data), so any plan containing a
  join step now routes the live preview through `applyWithFallback()` (→
  `POST /transforms/preview`) instead of the synchronous `computeTable`. Plans without a join
  keep the instant client-side path unchanged. A small "Refreshing joined preview…" banner
  shows while the server round-trip is in flight.
- Fixed a pre-existing bug: `TransformOp` never had a `.lbl()` method (only `lbl_template` +
  `formatLabel`), but the page called `OPS[step.op]?.lbl(...)` in two places. Both now use the
  already-exported `stepLabel()` helper from `transforms.ts`.
- Verified DB-source imports get identical Pipeline Studio treatment to file imports — both
  `uploadFile` and `submitDbJob` in `DataImportPage.tsx` navigate to `/app/data-transform` with
  the same `{ jobId, datasetId, datasetName }` state shape, and the staged-preview fetch is
  keyed only on `jobId`. No divergence found.

### 2026-07-16 — Per-version schema in Data Import detail panel

- The dataset detail panel now shows schema for **every** version, not just the latest. Version
  History rows are clickable accordions that expand to reveal that version's column/type schema
  (`src/features/data-import/DataImportPage.tsx`). Multiple rows can be open at once to compare.
  Data was already fetched per-version — this only surfaces it.

### 2026-06-18 — Review-gated Data Import wizard (hand-off to DataForge)

- Extracted the FastAPI error helpers (`errMessage`, `readError`) into `src/lib/http.ts`; both
  Data Import and Data Transform now import them.
- **Data Import** (`DataImportPage.tsx`): uploading a file or connecting a DB now only *stages* the
  source (job created PENDING) and navigates to `/app/data-transform` with router state
  `{ jobId, datasetId, datasetName }`. Removed the in-page polling / schema-diff / success machinery.
- **Data Transform** (`DataTransformPage.tsx`): added an **import-review mode** triggered when
  `location.state.jobId` is present. It fetches `GET /data-ingest/jobs/{id}/staged-preview`, renders the
  staged rows + schema, surfaces the schema diff (added/missing/type changes) with one-click
  `suggested_mappings` rename actions, and provides a transform-plan builder (drop / rename / cast /
  filter / fillna) where each UI step maps 1:1 to a backend `TransformStep`. "Save & Apply" POSTs to
  `/commit`, polls `GET /jobs/{id}` until SUCCESS/FAILED, then returns to Data Import.
  The no-`jobId` read-only preview behavior is unchanged.

### 2026-06-17 — Real-data wiring for EDA, Query Studio, and Transform preview

- Added `src/lib/hooks/useDatasets.ts` — `useDatasets()` (real workspace datasets) and
  `useQueryApi()` (preview / execute / aggregate against the DuckDB `/query` endpoints).
- **EDA Dashboards**: dataset selector + chart columns now come from real datasets; chart series are
  computed live via `POST /query/aggregate` (replaced `generateMockData`).
- **Query Studio**: converted from a simulated NL chat to a real read-only SQL runner against the
  `dataset` view via `POST /query/execute`, rendering actual columns/rows.
- **Data Transform**: dataset selector + preview table now show the latest version via
  `GET /query/datasets/{id}/preview`; the step builder is retained (execution backend pending).
- **Data Import**: added an "Accept as New Schema & Version" option in the schema-diff step
  (`accept_new_schema`), so an incoming schema can be versioned as-is.
- ML pages remain on mock data pending the backend ML module.

### 2026-06-07 — Landing page, auth flow, and onboarding added

- Added public landing page at `/` with Navbar, Hero, Features, HowItWorks, CtaBanner, Footer sections
- Added `/signin` (SigninPage) and `/signup` (SignupPage) replacing the combined `/auth` page; `/auth` now redirects to `/signin`
- Added `/onboarding` (OnboardingPage) — full-screen workspace creation step post-signup, no AppShell
- Moved all protected app routes from `/` to `/app/*` namespace to cleanly separate public and authenticated surfaces
- Added `BrandMark` and `AuthCardLayout` shared components reused across auth/onboarding/landing

### 2026-06-06 — frontend/README.md created

- Documented full frontend structure, routing, state management, API integration, and design system
- Based on exploration of current codebase state

### Prior — Initial frontend implementation

- React 18 + Vite + TypeScript project setup
- react-router-dom v6 routing with ProtectedRoute / PublicOnlyRoute guards
- Three-context state management (Auth, App, Workspace)
- TailwindCSS with custom design token system
- AppShell layout with responsive sidebar navigation
- Auth page (login + signup) wired to backend `/auth` endpoints
- All feature pages scaffolded (Data Import, Transform, Query Studio, EDA, ML, AutoML, Deploy Sim, Workspace Settings)
- Mock data layer for non-auth features pending backend integration
