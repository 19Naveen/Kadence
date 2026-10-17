import uuid
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import HTTPException

from modules.ingestion.transforms import apply_transforms, TransformStepError


def test_apply_transforms_skips_step_on_already_dropped_column():
    # apply_transforms' documented contract (see transforms.py module docstring
    # and the sql_compiler parity notes) is "skip if column missing", not raise —
    # a second drop of an already-dropped column is a silent no-op, matching the
    # DuckDB compiler's `missing()` skip semantics.
    df = pd.DataFrame({"a": [1, 2]})
    steps = [
        {"type": "drop", "column": "a"},
        {"type": "drop", "column": "a"},  # already dropped -> skipped, not an error
    ]
    result = apply_transforms(df, steps)
    assert list(result.columns) == []


def test_apply_transforms_succeeds_without_raising_error_wrapper():
    df = pd.DataFrame({"a": [1, 2]})
    steps = [{"type": "drop", "column": "a"}]
    result = apply_transforms(df, steps)
    assert list(result.columns) == []


import anyio

from modules.ingestion.router import transform_preview
from modules.ingestion.schemas import TransformPreviewRequest


def _run_preview(payload):
    # transform_preview now depends on db + get_current_user (join-step auth); a
    # plan with no join steps never touches the db, so a dummy db is fine here.
    return anyio.run(transform_preview, payload, None, {"sub": "u1"})


def test_preview_endpoint_returns_transformed_rows():
    payload = TransformPreviewRequest(
        columns=["a", "b"],
        rows=[[1, "x"], [2, "y"]],
        steps=[{"type": "drop", "column": "b"}],
    )
    response = _run_preview(payload)
    assert response.columns == ["a"]
    assert response.rows == [[1], [2]]
    assert response.errors == {}


def test_preview_endpoint_no_error_on_already_dropped_column():
    # Matches apply_transforms' skip-if-missing contract: the second drop is a
    # no-op, not a reported error.
    payload = TransformPreviewRequest(
        columns=["a"],
        rows=[[1], [2]],
        steps=[
            {"type": "drop", "column": "a"},
            {"type": "drop", "column": "a"},
        ],
    )
    response = _run_preview(payload)
    assert response.columns == []
    assert response.errors == {}


# ── join auth ────────────────────────────────────────────────────────────────
# resolve_join_sources is exercised through the router (as it runs in
# production) with repo/get_workspace monkeypatched — no real DB needed.

from modules.ingestion import auth as auth_mod
from modules.ingestion import repository as repo
from modules.ingestion import service as service_mod
from modules.ingestion.schemas import TransformPreviewRequest as _TPR


def _join_payload(dataset_id):
    return _TPR(
        columns=["id"],
        rows=[[1], [2]],
        steps=[{
            "type": "join", "dataset_id": str(dataset_id),
            "left_on": "id", "right_on": "id", "how": "inner",
        }],
    )


def test_preview_join_unauthorized_dataset_returns_404(monkeypatch):
    dataset_id = uuid.uuid4()
    dataset = SimpleNamespace(id=dataset_id, workspace_id=uuid.uuid4())
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: dataset)
    # Caller does not own the dataset's workspace -> get_workspace returns None.
    monkeypatch.setattr(auth_mod, "get_workspace", lambda db, wid, owner_id: None)

    with pytest.raises(HTTPException) as exc:
        anyio.run(transform_preview, _join_payload(dataset_id), None, {"sub": "u1"})
    assert exc.value.status_code == 404


def test_preview_join_missing_dataset_returns_404(monkeypatch):
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: None)

    with pytest.raises(HTTPException) as exc:
        anyio.run(transform_preview, _join_payload(uuid.uuid4()), None, {"sub": "u1"})
    assert exc.value.status_code == 404


def test_preview_join_happy_path_returns_joined_columns(monkeypatch):
    dataset_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    dataset = SimpleNamespace(id=dataset_id, workspace_id=workspace_id)
    version = SimpleNamespace(storage_path="ws/ds/raw/v1/data.parquet")

    monkeypatch.setattr(repo, "get_dataset", lambda db, did: dataset)
    monkeypatch.setattr(
        auth_mod, "get_workspace",
        lambda db, wid, owner_id: SimpleNamespace(id=wid, owner_id=owner_id),
    )
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: version)

    right = pd.DataFrame({"id": [1, 2], "extra": ["p", "q"]})

    # The router's join_loader reads via DuckDB/MinIO; monkeypatch apply_transforms
    # at the router import site so the test stays storage-free while still proving
    # the router wired a working loader through to apply_transforms.
    import modules.ingestion.router as router_mod

    def fake_apply_transforms(df, steps, join_loader=None):
        assert join_loader is not None
        return apply_transforms(df, steps, join_loader=lambda step: right)

    monkeypatch.setattr(router_mod, "apply_transforms", fake_apply_transforms)

    response = anyio.run(
        transform_preview, _join_payload(dataset_id), None, {"sub": "u1"}
    )
    assert response.errors == {}
    assert response.columns == ["id", "extra"]


def test_resolve_join_sources_ownership_guard(monkeypatch):
    """Dataset in another user's workspace -> 404 (not 403 -- no info leak)."""
    dataset_id = uuid.uuid4()
    dataset = SimpleNamespace(id=dataset_id, workspace_id=uuid.uuid4())
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: dataset)
    monkeypatch.setattr(auth_mod, "get_workspace", lambda db, wid, owner_id: None)

    steps = [{
        "type": "join", "dataset_id": str(dataset_id),
        "left_on": "id", "right_on": "id", "how": "inner",
    }]
    with pytest.raises(HTTPException) as exc:
        service_mod.resolve_join_sources(db=None, steps=steps, owner_id="someone-else")
    assert exc.value.status_code == 404


# ── lineage ──────────────────────────────────────────────────────────────────

import modules.ingestion.router as router_mod


def test_lineage_returns_join_sources_from_latest_success_job(monkeypatch):
    dataset_id = uuid.uuid4()
    join_dataset_id = uuid.uuid4()
    dataset = SimpleNamespace(id=dataset_id, workspace_id=uuid.uuid4(), name="combined", source_type="parquet")
    join_dataset = SimpleNamespace(id=join_dataset_id, workspace_id=uuid.uuid4(), name="orders")
    job = SimpleNamespace(source_config={"_transforms": [
        {"type": "join", "dataset_id": str(join_dataset_id), "left_on": "id", "right_on": "order_id", "how": "left"},
    ]})
    version = SimpleNamespace(version=3)

    monkeypatch.setattr(router_mod, "assert_dataset_owned", lambda db, did, owner_id: dataset)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: version)
    monkeypatch.setattr(repo, "get_latest_success_job", lambda db, did: job)
    monkeypatch.setattr(repo, "get_first_success_job", lambda db, did: job)
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: join_dataset if did == join_dataset_id else None)

    resp = anyio.run(router_mod.get_dataset_lineage, dataset_id, None, {"sub": "u1"})

    assert resp.dataset_name == "combined"
    assert resp.source_type == "parquet"
    assert resp.version == 3
    assert len(resp.sources) == 1
    assert resp.sources[0].dataset_name == "orders"
    assert resp.sources[0].how == "left"


def test_lineage_no_joins_returns_empty_sources(monkeypatch):
    dataset_id = uuid.uuid4()
    dataset = SimpleNamespace(id=dataset_id, workspace_id=uuid.uuid4(), name="plain", source_type="csv")

    monkeypatch.setattr(router_mod, "assert_dataset_owned", lambda db, did, owner_id: dataset)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: None)
    monkeypatch.setattr(repo, "get_latest_success_job", lambda db, did: None)
    monkeypatch.setattr(repo, "get_first_success_job", lambda db, did: None)

    resp = anyio.run(router_mod.get_dataset_lineage, dataset_id, None, {"sub": "u1"})

    assert resp.sources == []
    assert resp.version is None
    assert resp.origin_detail is None


def test_lineage_db_import_exposes_table_name_not_credentials(monkeypatch):
    dataset_id = uuid.uuid4()
    dataset = SimpleNamespace(id=dataset_id, workspace_id=uuid.uuid4(), name="orders", source_type="postgres")
    first_job = SimpleNamespace(source_config={
        "host": "db.internal", "table": "public.orders", "password": "encrypted:xyz",
    })

    monkeypatch.setattr(router_mod, "assert_dataset_owned", lambda db, did, owner_id: dataset)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: None)
    monkeypatch.setattr(repo, "get_latest_success_job", lambda db, did: None)
    monkeypatch.setattr(repo, "get_first_success_job", lambda db, did: first_job)

    resp = anyio.run(router_mod.get_dataset_lineage, dataset_id, None, {"sub": "u1"})

    assert resp.origin_detail == "public.orders"
    assert "password" not in resp.model_dump_json()
