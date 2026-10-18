"""Models screen backend: lineage base source, workspace lineage graph, rebuild.

Runs through the real FastAPI app with repo / get_workspace monkeypatched — no DB.
"""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.dependencies import get_current_user
from main import app
from modules.ingestion import auth as auth_mod
from modules.ingestion import repository as repo
from modules.ingestion import router as router_mod
from modules.ingestion import service as service_mod

NOW = datetime(2026, 10, 18, tzinfo=timezone.utc)
WS = uuid.uuid4()


def _ds(name, workspace_id=WS):
    return SimpleNamespace(
        id=uuid.uuid4(), workspace_id=workspace_id, name=name, source_type="parquet",
        description=None, created_at=NOW,
    )


def _version(ds, version=1):
    return SimpleNamespace(
        dataset_id=ds.id, version=version, row_count=10, column_count=3, created_at=NOW,
        storage_path=f"{ds.workspace_id}/{ds.id}/raw/v{version}/data.parquet", file_size=1,
    )


def _job(ds, source_config):
    return SimpleNamespace(
        id=uuid.uuid4(), dataset_id=ds.id, source_config=source_config,
        created_at=NOW, updated_at=NOW,
    )


@pytest.fixture
def client(monkeypatch):
    """Owner u1 owns WS only. Each test sets `world` = datasets / versions / jobs."""
    world = {"datasets": [], "versions": {}, "jobs": []}
    owned = lambda db, wid, owner_id: SimpleNamespace(id=wid) if wid == WS else None
    monkeypatch.setattr(auth_mod, "get_workspace", owned)
    monkeypatch.setattr(service_mod, "get_workspace", owned)
    by_id = lambda did: next((d for d in world["datasets"] if d.id == did), None)
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: by_id(did))
    monkeypatch.setattr(repo, "list_datasets", lambda db, wid: [d for d in world["datasets"] if d.workspace_id == wid])
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: world["versions"].get(did))
    monkeypatch.setattr(repo, "get_latest_versions", lambda db, ids: {i: world["versions"][i] for i in ids if i in world["versions"]})
    monkeypatch.setattr(repo, "list_success_jobs", lambda db, ids: [j for j in world["jobs"] if j.dataset_id in ids])
    latest = lambda did: next((j for j in reversed(world["jobs"]) if j.dataset_id == did), None)
    monkeypatch.setattr(repo, "get_latest_success_job", lambda db, did: latest(did))
    monkeypatch.setattr(repo, "get_first_success_job", lambda db, did: next((j for j in world["jobs"] if j.dataset_id == did), None))

    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}
    try:
        yield TestClient(app), world
    finally:
        app.dependency_overrides.clear()


def _add(world, ds, source_config=None, versioned=True):
    world["datasets"].append(ds)
    if versioned:
        world["versions"][ds.id] = _version(ds)
        world["jobs"].append(_job(ds, source_config))
    return ds


# ── single-dataset lineage ────────────────────────────────────────────────────

def test_lineage_includes_base_source_first(client):
    c, world = client
    orders = _add(world, _ds("orders"))
    segments = _add(world, _ds("segments"))
    model = _add(world, _ds("orders_with_segment"), {
        "_primary_dataset_id": str(orders.id),
        "_transforms": [{"type": "join", "dataset_id": str(segments.id), "left_on": "cid", "right_on": "id", "how": "left"}],
    })
    resp = c.get(f"/api/v1/data-ingest/datasets/{model.id}/lineage")
    assert resp.status_code == 200
    sources = resp.json()["sources"]
    assert [(s["dataset_id"], s["how"], s["left_on"], s["right_on"]) for s in sources] == [
        (str(orders.id), "base", "", ""),
        (str(segments.id), "left", "cid", "id"),
    ]


def test_lineage_omits_base_equal_to_self(client):
    c, world = client
    ds = _ds("self_saved")
    _add(world, ds, {"_primary_dataset_id": str(ds.id), "_transforms": []})
    resp = c.get(f"/api/v1/data-ingest/datasets/{ds.id}/lineage")
    assert resp.status_code == 200
    assert resp.json()["sources"] == []


# ── lineage graph ─────────────────────────────────────────────────────────────

def test_lineage_graph_nodes_and_edges(client):
    c, world = client
    orders = _add(world, _ds("orders"), {"table": "public.orders", "password": "secret"})
    segments = _add(world, _ds("segments"))
    more = _add(world, _ds("more_orders"))
    _add(world, _ds("staged_only"), versioned=False)
    foreign = _add(world, _ds("foreign", workspace_id=uuid.uuid4()))
    deleted_id = uuid.uuid4()
    steps = [
        {"type": "join", "dataset_id": str(segments.id), "left_on": "cid", "right_on": "id", "how": "left"},
        {"type": "append", "dataset_id": str(more.id)},
        {"type": "join", "dataset_id": str(foreign.id), "left_on": "a", "right_on": "a", "how": "inner"},
        {"type": "append", "dataset_id": str(deleted_id)},
        {"type": "drop", "column": "x"},
    ]
    model = _add(world, _ds("orders_with_segment"), {"_primary_dataset_id": str(orders.id), "_transforms": steps})
    legacy = _add(world, _ds("legacy_combined"), {"_transforms": [steps[0]]})
    self_saved = _ds("self_saved")
    _add(world, self_saved, {"_primary_dataset_id": str(self_saved.id), "_transforms": []})

    resp = c.get(f"/api/v1/data-ingest/lineage-graph?workspace_id={WS}")
    assert resp.status_code == 200
    body = resp.json()
    nodes = {n["name"]: n for n in body["nodes"]}

    assert set(nodes) == {"orders", "segments", "more_orders", "orders_with_segment", "legacy_combined", "self_saved"}
    assert nodes["orders"]["kind"] == "source" and nodes["orders"]["model"] is None
    assert nodes["orders"]["origin_detail"] == "public.orders"
    assert "secret" not in resp.text
    m = nodes["orders_with_segment"]
    assert m["kind"] == "model"
    assert m["model"]["base_dataset_id"] == str(orders.id)
    assert m["model"]["steps"] == steps
    assert (m["row_count"], m["column_count"], m["version"]) == (10, 3, 1)
    assert nodes["legacy_combined"]["kind"] == "model"
    assert nodes["legacy_combined"]["model"]["base_dataset_id"] is None
    assert nodes["self_saved"]["kind"] == "model"

    edges = {(e["source"], e["target"], e["role"], e["how"], e["left_on"], e["right_on"]) for e in body["edges"]}
    assert edges == {
        (str(orders.id), str(model.id), "base", None, None, None),
        (str(segments.id), str(model.id), "join", "left", "cid", "id"),
        (str(more.id), str(model.id), "append", None, None, None),
        (str(segments.id), str(legacy.id), "join", "left", "cid", "id"),
    }


def test_lineage_graph_requires_workspace_ownership(client):
    c, _ = client
    resp = c.get(f"/api/v1/data-ingest/lineage-graph?workspace_id={uuid.uuid4()}")
    assert resp.status_code == 404


# ── rebuild ───────────────────────────────────────────────────────────────────

@pytest.fixture
def dispatched(monkeypatch):
    calls = []
    monkeypatch.setattr(router_mod.run_ingestion_pipeline, "delay", lambda jid: calls.append(jid))
    return calls


def test_rebuild_reuses_combine_path_with_recorded_base(client, monkeypatch, dispatched):
    c, world = client
    orders = _add(world, _ds("orders"))
    segments = _add(world, _ds("segments"))
    steps = [{"type": "join", "dataset_id": str(segments.id), "left_on": "cid", "right_on": "id", "how": "left"}]
    model = _add(world, _ds("orders_with_segment"), {"_primary_dataset_id": str(orders.id), "_transforms": steps})

    seen = {}
    real_combine = service_mod.create_combine_job
    monkeypatch.setattr(service_mod, "create_combine_job",
                        lambda db, payload, owner_id: seen.update(payload=payload) or real_combine(db, payload, owner_id))
    created = {}
    monkeypatch.setattr(repo, "create_dataset", lambda db, p: pytest.fail("rebuild must not create a dataset"))
    monkeypatch.setattr(repo, "create_job", lambda db, p: created.update(p) or SimpleNamespace(
        id=uuid.uuid4(), error_message=None, created_at=NOW, updated_at=NOW, **p))

    resp = c.post(f"/api/v1/data-ingest/datasets/{model.id}/rebuild?workspace_id={WS}")

    assert resp.status_code == 202, resp.text
    assert seen["payload"].primary_dataset_id == orders.id
    assert seen["payload"].target_dataset_id == model.id
    assert created["dataset_id"] == model.id
    assert created["staging_path"] == world["versions"][orders.id].storage_path
    assert created["source_config"] == {"_transforms": steps, "_primary_dataset_id": str(orders.id)}
    assert dispatched == [resp.json()["id"]]


@pytest.mark.parametrize("config, message", [
    ({"table": "public.orders"}, "not a model"),
    ({"_transforms": [{"type": "append", "dataset_id": "SELF"}]}, "before its base was recorded"),
    ({"_primary_dataset_id": str(uuid.uuid4()), "_transforms": []}, "no longer exists"),
])
def test_rebuild_rejects_unrebuildable(client, dispatched, config, message):
    c, world = client
    other = _add(world, _ds("other"))
    if "_transforms" in config:
        config["_transforms"] = [dict(s, dataset_id=str(other.id)) for s in config["_transforms"]]
    ds = _add(world, _ds("target"), config)
    resp = c.post(f"/api/v1/data-ingest/datasets/{ds.id}/rebuild?workspace_id={WS}")
    assert resp.status_code == 400
    assert message in resp.json()["detail"]
    assert dispatched == []
