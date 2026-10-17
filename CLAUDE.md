# CLAUDE.md — Project Instructions

## README Maintenance (mandatory)

The project uses **three README files**. Update the correct one(s) in the same response as the change — do not defer to a follow-up.

### Which file to update

| Change type | Update |
|---|---|
| Architecture diagram, tech stack, core philosophy, design rules, getting started | `README.md` (root) |
| Backend module, API endpoint, DB model/table, env var, MinIO storage layout, Celery config, code pattern | `backend/README.md` |
| Frontend page, route, context, API integration, design system, env var | `frontend/README.md` |

If a change is platform-wide (e.g. new service added to docker-compose, new infrastructure), update both root and the relevant sub-README.

### What to update

- The **relevant section** in the appropriate README (endpoints table, module reference, tables list, etc.)
- The **Changelog section** at the bottom of that file — append a dated entry

### Changelog entry format

```
### YYYY-MM-DD — Short descriptive title

- Bullet describing what changed and why (if non-obvious)
```

Do not rewrite entire READMEs for small changes — update only the affected sections and append to the Changelog.

---

## Code Patterns

### Backend

- **Models:** SQLAlchemy 2.0 `Mapped` / `mapped_column` style (see `modules/auth/models.py`)
- **Schemas:** Pydantic v2 `BaseModel` with `model_config = {"from_attributes": True}` for ORM responses
- **Repository:** Plain functions taking `db: Session`, converting ORM → Pydantic (see `modules/auth/repository.py`)
- **Service:** Business logic only, calls repository functions, raises `HTTPException`
- **Router:** `APIRouter` with `Depends(get_db)` and `Depends(get_current_user)` for protected routes
- **Enums:** `enum.Enum` subclasses in `enums.py`, mapped with `SAEnum` in SQLAlchemy columns

### Auth dependency (all protected endpoints)

```python
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.security import decode_access_token

_bearer = HTTPBearer(auto_error=True)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    return decode_access_token(credentials.credentials)
```

### Frontend

- State management via React Context only (no Redux / Zustand)
- API calls via native `fetch` — no axios
- All env vars prefixed with `VITE_`
- Styling via TailwindCSS utility classes + component classes (`.card`, `.btn`, `.input`, `.badge`)
- One folder per feature under `src/features/`, one context per concern under `src/lib/context/`

---

## Running the Project

```bash
make run          # Docker + backend + frontend (Ctrl+C stops all)
make backend      # Docker + backend only
make frontend     # Frontend only
make docker-up    # Docker only
make docker-down  # Stop Docker

# Celery worker (separate terminal, from backend/)
celery -A celery_app worker --loglevel=info
```

## Package Management

- Backend: `uv` — add packages with `uv add <package>` from `backend/`
- Frontend: `npm` — add packages with `npm install <package>` from `frontend/`

## Environment

- Python 3.14, FastAPI, SQLAlchemy 2.0, Pydantic v2, Celery 5
- All backend env vars in `backend/.env` — see `backend/README.md` for the full list
- All frontend env vars in `frontend/.env.local` — see `frontend/README.md` for the full list


## Things that needs to be followed:

 - Don't commit code with co-authored by claude