import asyncio
import datetime
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
from fastapi import HTTPException

from modules.ingestion import router as router_mod
from modules.ingestion import tasks as tasks_mod
from modules.ingestion import repository as repo
from modules.ingestion.enums import JobStatus, SourceType
from modules.ingestion.schemas import CommitJobRequest


# ── commit endpoint ───────────────────────────────────────────────────────────


def _commit_job(status=JobStatus.PENDING):
    now = datetime.datetime.now(datetime.timezone.utc)
    return SimpleNamespace(
        id=uuid.uuid4(), dataset_id=uuid.uuid4(), status=status,
        source_type=SourceType.CSV, error_message=None, created_at=now, updated_at=now,
        staging_metadata=None,
    )


def _run_commit(job_id, payload):
    return asyncio.run(
        router_mod.commit_job(job_id, payload, db=None, user={"sub": "u1"})
    )


def test_commit_persists_plan_and_dispatches(monkeypatch):
    job = _commit_job()
    monkeypatch.setattr(repo, "get_job", lambda db, jid: job)
    monkeypatch.setattr(router_mod, "assert_job_owned", lambda db, jid, owner_id: job)
    recorded = {}
    monkeypatch.setattr(repo, "set_transform_plan", lambda db, jid, plan: recorded.update(plan=plan))
    monkeypatch.setattr(router_mod, "run_ingestion_pipeline",
                        SimpleNamespace(delay=lambda jid: recorded.update(dispatched=jid)))

    payload = CommitJobRequest(transforms=[{"type": "drop", "column": "a"}])
    resp = _run_commit(job.id, payload)

    assert recorded["plan"] == [{"type": "drop", "column": "a"}]
    assert recorded["dispatched"] == str(job.id)
    assert resp.status == "PENDING"


def test_commit_404_when_missing(monkeypatch):
    monkeypatch.setattr(repo, "get_job", lambda db, jid: None)
    with pytest.raises(HTTPException) as exc:
        _run_commit(uuid.uuid4(), CommitJobRequest(transforms=[]))
    assert exc.value.status_code == 404


def test_commit_400_when_not_pending(monkeypatch):
    job = _commit_job(status=JobStatus.SUCCESS)
    monkeypatch.setattr(repo, "get_job", lambda db, jid: job)
    monkeypatch.setattr(router_mod, "assert_job_owned", lambda db, jid, owner_id: job)
    with pytest.raises(HTTPException) as exc:
        _run_commit(job.id, CommitJobRequest(transforms=[]))
    assert exc.value.status_code == 400


# ── pipeline applies the transform plan ───────────────────────────────────────


def _fake_select_engine(fake_load_source, fake_upload, captured):
    def fake_apply_transforms(df, steps):
        result = df
        for step in steps:
            if step.get("type") == "drop":
                result = result.drop(columns=[step["column"]])
        return result

    def fake_write_parquet(df, path):
        captured.update(uploaded=df, path=path)
        return fake_upload(df, path)

    def fake_infer_schema(df):
        return {col: str(dtype) for col, dtype in df.dtypes.items()}

    return lambda staging_metadata: {
        "load_source": fake_load_source,
        "apply_transforms": fake_apply_transforms,
        "infer_schema": fake_infer_schema,
        "write_parquet": fake_write_parquet,
        "row_count": len,
        "column_count": lambda df: len(df.columns),
    }


def test_pipeline_applies_transform_plan(monkeypatch):
    did, wid, jid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    job = SimpleNamespace(
        id=jid, dataset_id=did, staging_path="ws/ds/staging/job/f.csv",
        source_config={"_transforms": [{"type": "drop", "column": "b"}]},
        status=JobStatus.PENDING, staging_metadata=None,
    )
    dataset = SimpleNamespace(id=did, workspace_id=wid)
    captured = {}

    monkeypatch.setattr(tasks_mod, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(repo, "get_job", lambda db, j: job)
    monkeypatch.setattr(repo, "get_dataset", lambda db, d: dataset)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, d: None)
    monkeypatch.setattr(repo, "update_job_status", lambda *a, **k: None)
    monkeypatch.setattr(
        tasks_mod,
        "select_engine",
        _fake_select_engine(
            fake_load_source=lambda j: pd.DataFrame({"a": [1, 2], "b": [3, 4]}),
            fake_upload=lambda d, path: 123,
            captured=captured,
        ),
    )
    monkeypatch.setattr(repo, "create_dataset_version", lambda db, payload: captured.update(version=payload))
    monkeypatch.setattr("modules.ingestion.storage.minio_client.delete_object", lambda p: None)

    result = tasks_mod.run_ingestion_pipeline(str(jid))

    assert result["status"] == "SUCCESS"
    assert result["version"] == 1
    assert list(captured["uploaded"].columns) == ["a"]           # 'b' dropped by the plan
    assert captured["version"]["column_count"] == 1
    assert set(captured["version"]["schema"]) == {"a"}
    assert captured["path"].endswith("/raw/v1/data.parquet")


def test_pipeline_no_transforms_versions_as_is(monkeypatch):
    did, wid, jid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    job = SimpleNamespace(id=jid, dataset_id=did, staging_path=None, source_config=None,
                          status=JobStatus.PENDING, staging_metadata=None)
    dataset = SimpleNamespace(id=did, workspace_id=wid)
    captured = {}

    monkeypatch.setattr(tasks_mod, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(repo, "get_job", lambda db, j: job)
    monkeypatch.setattr(repo, "get_dataset", lambda db, d: dataset)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, d: None)
    monkeypatch.setattr(repo, "update_job_status", lambda *a, **k: None)
    monkeypatch.setattr(
        tasks_mod,
        "select_engine",
        _fake_select_engine(
            fake_load_source=lambda j: pd.DataFrame({"a": [1], "b": [2]}),
            fake_upload=lambda d, path: 1,
            captured=captured,
        ),
    )
    monkeypatch.setattr(repo, "create_dataset_version", lambda db, payload: captured.update(version=payload))

    result = tasks_mod.run_ingestion_pipeline(str(jid))

    assert result["status"] == "SUCCESS"
    assert captured["version"]["column_count"] == 2  # untouched
