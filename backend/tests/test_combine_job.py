import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from modules.ingestion import auth as auth_mod
from modules.ingestion import repository as repo
from modules.ingestion import service as service_mod
from modules.ingestion import tasks as tasks_mod
from modules.ingestion.enums import JobStatus, SourceType
from modules.ingestion.schemas import CombineDatasetsRequest


def _payload(primary_id, target_dataset_id=None, new_dataset_name="combined", join_dataset_id=None):
    return CombineDatasetsRequest(
        workspace_id=uuid.uuid4(),
        primary_dataset_id=primary_id,
        transforms=(
            [{
                "type": "join", "dataset_id": str(join_dataset_id),
                "left_on": "id", "right_on": "id", "how": "inner",
            }]
            if join_dataset_id
            else []
        ),
        new_dataset_name=None if target_dataset_id else new_dataset_name,
        target_dataset_id=target_dataset_id,
    )


def test_combine_job_creates_new_dataset_and_pending_job(monkeypatch):
    primary_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    primary = SimpleNamespace(id=primary_id, workspace_id=workspace_id)
    latest = SimpleNamespace(
        storage_path="ws/ds/raw/v1/data.parquet", file_size=1024, row_count=10, column_count=3,
    )

    monkeypatch.setattr(service_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: primary)
    monkeypatch.setattr(auth_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: latest)

    created = {}
    monkeypatch.setattr(
        repo, "create_dataset",
        lambda db, payload: created.update(dataset=payload) or SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        repo, "create_job",
        lambda db, payload: created.update(job=payload) or SimpleNamespace(id=uuid.uuid4(), **payload),
    )

    job = service_mod.create_combine_job(db=None, payload=_payload(primary_id), owner_id="u1")

    assert created["dataset"]["name"] == "combined"
    assert created["job"]["staging_path"] == "ws/ds/raw/v1/data.parquet"
    assert created["job"]["source_type"] == SourceType.PARQUET
    assert created["job"]["status"] == JobStatus.PENDING


def test_combine_job_rejects_unauthorized_primary_dataset(monkeypatch):
    primary_id = uuid.uuid4()
    monkeypatch.setattr(service_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: SimpleNamespace(id=did, workspace_id=uuid.uuid4()))
    monkeypatch.setattr(auth_mod, "get_workspace", lambda db, wid, owner_id: None)

    with pytest.raises(HTTPException) as exc:
        service_mod.create_combine_job(db=None, payload=_payload(primary_id), owner_id="u1")
    assert exc.value.status_code == 404


def test_combine_job_rejects_unauthorized_join_dataset(monkeypatch):
    primary_id = uuid.uuid4()
    join_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    primary = SimpleNamespace(id=primary_id, workspace_id=workspace_id)
    latest = SimpleNamespace(storage_path="ws/ds/raw/v1/data.parquet", file_size=1, row_count=1, column_count=1)

    monkeypatch.setattr(service_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))

    def fake_get_dataset(db, did):
        if did == primary_id:
            return primary
        return SimpleNamespace(id=did, workspace_id=uuid.uuid4())  # join dataset, unowned

    monkeypatch.setattr(repo, "get_dataset", fake_get_dataset)

    def fake_get_workspace(db, wid, owner_id):
        return SimpleNamespace(id=wid) if wid == workspace_id else None

    monkeypatch.setattr(auth_mod, "get_workspace", fake_get_workspace)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: latest)

    created = {}
    monkeypatch.setattr(repo, "create_dataset", lambda db, payload: created.update(dataset=payload))
    monkeypatch.setattr(repo, "create_job", lambda db, payload: created.update(job=payload))

    with pytest.raises(HTTPException) as exc:
        service_mod.create_combine_job(
            db=None, payload=_payload(primary_id, join_dataset_id=join_id), owner_id="u1"
        )
    assert exc.value.status_code == 404
    # No orphan dataset/job left behind when join auth fails before creation.
    assert created == {}


def test_combine_job_target_existing_dataset_reuses_dataset_row(monkeypatch):
    primary_id = uuid.uuid4()
    target_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    primary = SimpleNamespace(id=primary_id, workspace_id=workspace_id)
    latest = SimpleNamespace(storage_path="ws/ds/raw/v1/data.parquet", file_size=1, row_count=1, column_count=1)

    target = SimpleNamespace(id=target_id, workspace_id=workspace_id)

    monkeypatch.setattr(service_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: primary if did == primary_id else target)
    monkeypatch.setattr(auth_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: latest)

    dataset_created = {"called": False}
    monkeypatch.setattr(
        repo, "create_dataset",
        lambda db, payload: dataset_created.update(called=True),
    )
    created = {}
    monkeypatch.setattr(repo, "create_job", lambda db, payload: created.update(job=payload) or SimpleNamespace(id=uuid.uuid4(), **payload))

    job = service_mod.create_combine_job(
        db=None, payload=_payload(primary_id, target_dataset_id=target_id), owner_id="u1"
    )

    assert dataset_created["called"] is False
    assert created["job"]["dataset_id"] == target_id


def test_combine_job_persists_join_step_as_json_serializable(monkeypatch):
    """Same JSONB-serialization regression as test_commit_pipeline's guard, but for
    the combine path's source_config write."""
    import json

    primary_id = uuid.uuid4()
    join_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    primary = SimpleNamespace(id=primary_id, workspace_id=workspace_id)
    latest = SimpleNamespace(storage_path="ws/ds/raw/v1/data.parquet", file_size=1, row_count=1, column_count=1)

    monkeypatch.setattr(service_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: primary if did == primary_id else SimpleNamespace(id=did, workspace_id=workspace_id))
    monkeypatch.setattr(auth_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: latest)

    created = {}
    monkeypatch.setattr(repo, "create_dataset", lambda db, payload: SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(repo, "create_job", lambda db, payload: created.update(job=payload) or SimpleNamespace(id=uuid.uuid4(), **payload))

    service_mod.create_combine_job(
        db=None, payload=_payload(primary_id, join_dataset_id=join_id), owner_id="u1"
    )

    json.dumps(created["job"]["source_config"])  # raises TypeError if dataset_id is still a UUID object
    assert created["job"]["source_config"]["_transforms"][0]["dataset_id"] == str(join_id)


def test_run_ingestion_pipeline_does_not_delete_source_on_combine_job(monkeypatch):
    """Regression guard: a combine job's staging_path is a permanent dataset
    version file, not an ephemeral upload — it must never be deleted."""
    from unittest.mock import MagicMock
    import pandas as pd

    did, wid, jid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    job = SimpleNamespace(
        id=jid, dataset_id=did,
        staging_path="ws/other-ds/raw/v3/data.parquet",  # not under .../staging/...
        source_config={"_transforms": []},
        status=JobStatus.PENDING, staging_metadata=None,
    )
    dataset = SimpleNamespace(id=did, workspace_id=wid)

    monkeypatch.setattr(tasks_mod, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(repo, "get_job", lambda db, j: job)
    monkeypatch.setattr(repo, "get_dataset", lambda db, d: dataset)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, d: None)
    monkeypatch.setattr(repo, "update_job_status", lambda *a, **k: None)
    monkeypatch.setattr(repo, "create_dataset_version", lambda db, payload: None)
    monkeypatch.setattr(
        tasks_mod, "select_engine",
        lambda staging_metadata: {
            "load_source": lambda j: pd.DataFrame({"a": [1]}),
            "apply_transforms": lambda df, steps: df,
            "infer_schema": lambda df: {"a": "int"},
            "write_parquet": lambda df, path: 1,
            "row_count": len,
            "column_count": lambda df: len(df.columns),
        },
    )

    delete_calls = []
    monkeypatch.setattr("infrastructure.blob.minio_client.delete_object", lambda p: delete_calls.append(p))

    result = tasks_mod.run_ingestion_pipeline(str(jid))

    assert result["status"] == "SUCCESS"
    assert delete_calls == []
