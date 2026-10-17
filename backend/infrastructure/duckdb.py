"""Shared DuckDB connection wired to the MinIO S3 endpoint.

Used by the query module (read-only compute over the latest version) and the
ingestion DuckDB transform engine (large-file transform + write). Kept in one
place so the httpfs/S3 configuration — including the `lock_configuration` guard —
never drifts between callers.
"""

import duckdb

from core.config import settings
from infrastructure.blob.minio_client import BUCKET_NAME


def connect() -> duckdb.DuckDBPyConnection:
    """Open an in-memory DuckDB connection wired to the MinIO S3 endpoint."""
    con = duckdb.connect(database=":memory:")
    try:
        con.execute("INSTALL httpfs;")
    except Exception:
        # Already installed / bundled — autoloaded builds raise here harmlessly.
        pass
    con.execute("LOAD httpfs;")
    con.execute("SET s3_url_style='path';")
    con.execute("SET s3_use_ssl=false;")
    con.execute("SET s3_region='us-east-1';")
    con.execute(f"SET s3_endpoint='{settings.MINIO_ENDPOINT}';")
    con.execute(f"SET s3_access_key_id='{settings.MINIO_ACCESS_KEY}';")
    con.execute(f"SET s3_secret_access_key='{settings.MINIO_SECRET_KEY}';")
    # Lock the configuration last so a subsequently-executed user query cannot
    # re-enable dangerous settings (e.g. flipping to a different S3 endpoint, or
    # toggling extension auto-install) via `SET ...` / `PRAGMA ...`.
    con.execute("SET lock_configuration=true;")
    return con


def s3_uri(storage_path: str) -> str:
    return f"s3://{BUCKET_NAME}/{storage_path}"
