import datetime
import io
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.dependencies import get_current_user
from infrastructure.blob import minio_client
from main import app
from modules.ingestion import repository as repo
from modules.ingestion import router as router_mod
from modules.ingestion.enums import JobStatus, SourceType


@pytest.fixture
def fake_db():
    return MagicMock()


@pytest.fixture
def client(fake_db):
    app.dependency_overrides[get_db] = lambda: fake_db
    app.dependency_overrides[get_current_user] = lambda: {"sub": "u1"}
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def upload_env(monkeypatch):
    """Fake DB/repo/MinIO around create_job_from_file; records stream uploads."""
    now = datetime.datetime.now(datetime.timezone.utc)
    dataset_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    job = SimpleNamespace(
        id=uuid.uuid4(), dataset_id=dataset_id, status=JobStatus.PENDING,
        source_type=SourceType.CSV, source_config=None, staging_path=None,
        staging_metadata=None, error_message=None, created_at=now, updated_at=now,
    )
    dataset = SimpleNamespace(id=dataset_id, workspace_id=workspace_id)
    recorded = {}

    def fake_stream(fileobj, object_name):
        size = 0
        fileobj.seek(0)
        while chunk := fileobj.read(64 * 1024):  # chunked, never .read() all at once
            size += len(chunk)
        recorded.update(stream_path=object_name, stream_size=size)
        return size

    monkeypatch.setattr(router_mod, "get_workspace", lambda db, wid, owner_id: SimpleNamespace(id=wid))
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: dataset)
    monkeypatch.setattr(repo, "create_job", lambda db, payload: job)
    monkeypatch.setattr(router_mod, "upload_staging_stream", fake_stream)
    monkeypatch.setattr(router_mod, "delete_object",
                        lambda path: recorded.update(deleted=path))
    def fake_load_source(j, nrows=None):
        # The real loader reads j.staging_path; it must already point at the staged object.
        assert j.staging_path == recorded["stream_path"]
        return pd.DataFrame({"a": [1], "b": [2]})

    monkeypatch.setattr(router_mod, "load_source", fake_load_source)
    return SimpleNamespace(job=job, dataset=dataset, recorded=recorded,
                           workspace_id=workspace_id, dataset_id=dataset_id)


def _post(client, env, content: bytes):
    return client.post(
        "/api/v1/data-ingest/jobs/upload",
        data={
            "dataset_id": str(env.dataset_id),
            "dataset_name": "ds",
            "workspace_id": str(env.workspace_id),
            "source_type": "csv",
        },
        files={"file": ("evil/../name.csv", io.BytesIO(content), "text/csv")},
    )


def test_multi_mb_upload_streams_and_records_size(client, upload_env):
    content = b"a,b\n" + b"1,2\n" * (3 * 1024 * 1024 // 4)  # ~3MB
    resp = _post(client, upload_env, content)

    assert resp.status_code == 202
    meta = resp.json()["staging_metadata"]
    assert meta["file_size"] == len(content)
    assert meta["row_count"] is None
    assert meta["column_count"] == 2
    assert meta["source_format"] == "csv"
    # Stream helper was called; object name is server-controlled (job id, not filename).
    rec = upload_env.recorded
    assert rec["stream_size"] == len(content)
    assert rec["stream_path"].endswith(f"/staging/{upload_env.job.id}/source.csv")
    assert "evil" not in rec["stream_path"] and ".." not in rec["stream_path"]


def test_empty_upload_returns_400_and_cleans_up(client, upload_env):
    resp = _post(client, upload_env, b"")

    assert resp.status_code == 400
    assert "empty" in resp.json()["detail"].lower()
    assert upload_env.recorded["deleted"] == upload_env.recorded["stream_path"]


def _boom(j, nrows=None):
    raise ValueError("bad csv")


def test_unparseable_upload_deletes_job_and_staged_object(client, upload_env, fake_db, monkeypatch):
    monkeypatch.setattr(router_mod, "load_source", _boom)
    resp = _post(client, upload_env, b"not,a\ncsv")

    assert resp.status_code == 400
    assert "bad csv" in resp.json()["detail"]
    fake_db.delete.assert_called_once_with(upload_env.job)  # existing dataset is kept
    assert upload_env.recorded["deleted"] == upload_env.recorded["stream_path"]


def test_rejected_upload_also_deletes_dataset_it_created(client, upload_env, monkeypatch):
    monkeypatch.setattr(repo, "get_dataset", lambda db, did: None)
    monkeypatch.setattr(repo, "create_dataset", lambda db, payload: upload_env.dataset)
    monkeypatch.setattr(repo, "delete_dataset",
                        lambda db, did, wid: upload_env.recorded.update(dataset_deleted=did) or [])
    monkeypatch.setattr(router_mod, "load_source", _boom)
    resp = _post(client, upload_env, b"not,a\ncsv")

    assert resp.status_code == 400
    assert upload_env.recorded["dataset_deleted"] == upload_env.dataset_id


def test_full_bytes_helper_is_gone():
    assert not hasattr(minio_client, "upload_staging_file")
