import asyncio
import uuid
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import HTTPException

from modules.ingestion import router as router_mod
from modules.ingestion import repository as repo
from modules.ingestion.enums import SourceType

from tests.conftest import make_version


def _job():
    return SimpleNamespace(
        id=uuid.uuid4(),
        dataset_id=uuid.uuid4(),
        source_type=SourceType.CSV,
        staging_path="ws/ds/staging/job/file.csv",
        source_config=None,
    )


def _call(job_id, limit=50):
    return asyncio.run(
        router_mod.staged_preview(job_id, limit=limit, db=None, user={"sub": "u1"})
    )


def test_404_when_job_missing(monkeypatch):
    # Ownership guard resolves the job first: a missing job → 404 (never reveals
    # whether it exists but belongs to someone else).
    monkeypatch.setattr(repo, "get_job", lambda db, jid: None)
    with pytest.raises(HTTPException) as exc:
        _call(uuid.uuid4())
    assert exc.value.status_code == 404


def test_preview_first_import_no_diff(monkeypatch):
    job = _job()
    monkeypatch.setattr(repo, "get_job", lambda db, jid: job)
    monkeypatch.setattr(router_mod, "assert_job_owned", lambda db, jid, owner_id: job)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: None)
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    monkeypatch.setattr(router_mod, "load_source", lambda j, nrows=None: df.head(nrows) if nrows else df)

    resp = _call(job.id, limit=2)

    assert resp.columns == ["a", "b"]
    assert set(resp.dataset_schema) == {"a", "b"}
    assert resp.sample_rows == [[1, "x"], [2, "y"]]  # limited to 2
    assert resp.previous_schema is None
    assert resp.diff is None


def test_preview_with_previous_version_diff(monkeypatch):
    job = _job()
    monkeypatch.setattr(repo, "get_job", lambda db, jid: job)
    monkeypatch.setattr(router_mod, "assert_job_owned", lambda db, jid, owner_id: job)
    # latest version has columns {a, old}; incoming has {a, new} → diff
    latest = make_version(1, {"a": "integer", "old": "string"})
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: latest)
    df = pd.DataFrame({"a": [1], "new": ["z"]})
    monkeypatch.setattr(router_mod, "load_source", lambda j, nrows=None: df)

    resp = _call(job.id)

    assert resp.previous_schema == {"a": "integer", "old": "string"}
    assert resp.diff is not None
    assert resp.diff.has_diff is True
    assert "new" in resp.diff.added_columns
    assert "old" in resp.diff.missing_columns


def test_preview_nan_becomes_null(monkeypatch):
    job = _job()
    monkeypatch.setattr(repo, "get_job", lambda db, jid: job)
    monkeypatch.setattr(router_mod, "assert_job_owned", lambda db, jid, owner_id: job)
    monkeypatch.setattr(repo, "get_latest_version", lambda db, did: None)
    df = pd.DataFrame({"a": [1.0, None]})
    monkeypatch.setattr(router_mod, "load_source", lambda j, nrows=None: df)

    resp = _call(job.id)

    assert resp.sample_rows == [[1.0], [None]]
