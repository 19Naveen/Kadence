import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from core.database import get_db
from core.dependencies import get_current_user
from main import app
from modules.workspace import router as ws_router


def test_delete_workspace_cascades_datasets_and_storage(monkeypatch):
    ws_id = uuid.uuid4()
    datasets = [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4())]
    calls = {"datasets": [], "prefix": None, "workspace": False}

    monkeypatch.setattr(ws_router.repo, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(ws_router.repo, "delete_workspace",
                        lambda db, wid, owner_id: calls.update(workspace=True) or True)
    monkeypatch.setattr(ws_router.ingest_repo, "list_datasets", lambda db, wid: datasets)
    monkeypatch.setattr(ws_router.ingest_repo, "delete_dataset",
                        lambda db, did, wid: calls["datasets"].append(did) or [])
    monkeypatch.setattr(ws_router, "delete_prefix", lambda p: calls.update(prefix=p))
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}
    try:
        resp = TestClient(app).delete(f"/api/v1/workspaces/{ws_id}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 204
    assert calls["datasets"] == [d.id for d in datasets]
    assert calls["workspace"] is True
    assert calls["prefix"] == f"{ws_id}/"
