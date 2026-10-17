"""DuckDB compute over the latest Parquet version of a dataset, read from MinIO.

This is the single place where "always use the latest version" is enforced: every
helper resolves the dataset's latest ``DatasetVersion`` and reads its Parquet object
directly from object storage via DuckDB's ``httpfs`` (S3) extension. No data is loaded
into Postgres and nothing is staged on local disk.
"""

import uuid

import duckdb

from core.config import settings
from modules.ingestion import repository as repo
from modules.ingestion.storage.minio_client import BUCKET_NAME

# Aggregations allowed in the EDA aggregate endpoint, mapped to SQL templates.
ALLOWED_AGGREGATIONS = {
    "sum": "SUM({measure})",
    "avg": "AVG({measure})",
    "count": "COUNT(*)",
    "min": "MIN({measure})",
    "max": "MAX({measure})",
}


def _connect() -> duckdb.DuckDBPyConnection:
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


def _s3_uri(storage_path: str) -> str:
    return f"s3://{BUCKET_NAME}/{storage_path}"


def resolve_latest(db, dataset_id: uuid.UUID):
    """Return (storage_path, schema) for the dataset's latest version, or None."""
    latest = repo.get_latest_version(db, dataset_id)
    if not latest:
        return None
    return latest.storage_path, dict(latest.schema)


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _rows_from_cursor(cur) -> tuple[list[str], list[list]]:
    columns = [d[0] for d in cur.description] if cur.description else []
    rows = [list(r) for r in cur.fetchall()]
    return columns, rows


def run_select(storage_path: str, sql: str, row_limit: int = 1000) -> dict:
    """Run a validated read-only SELECT against the version, exposed as view ``dataset``."""
    con = _connect()
    try:
        con.execute(
            f"CREATE VIEW dataset AS SELECT * FROM read_parquet('{_s3_uri(storage_path)}');"
        )
        cur = con.execute(f"SELECT * FROM ({sql}) AS _q LIMIT {int(row_limit)};")
        columns, rows = _rows_from_cursor(cur)
        return {"columns": columns, "rows": rows}
    finally:
        con.close()


def run_aggregate(
    storage_path: str,
    schema: dict[str, str],
    dimension: str,
    measure: str | None,
    aggregation: str,
    limit: int = 100,
) -> list[dict]:
    """GROUP BY ``dimension`` and apply ``aggregation`` over ``measure`` → [{label, value}]."""
    if aggregation not in ALLOWED_AGGREGATIONS:
        raise ValueError(f"Unsupported aggregation: {aggregation}")
    if dimension not in schema:
        raise ValueError(f"Unknown dimension column: {dimension}")
    if aggregation != "count":
        if not measure or measure not in schema:
            raise ValueError(f"Unknown measure column: {measure}")

    dim = _quote_ident(dimension)
    agg_expr = ALLOWED_AGGREGATIONS[aggregation].format(
        measure=_quote_ident(measure) if measure else ""
    )

    con = _connect()
    try:
        cur = con.execute(
            f"SELECT {dim} AS label, {agg_expr} AS value "
            f"FROM read_parquet('{_s3_uri(storage_path)}') "
            f"GROUP BY {dim} ORDER BY value DESC LIMIT {int(limit)};"
        )
        _, rows = _rows_from_cursor(cur)
        return [{"label": None if r[0] is None else str(r[0]), "value": r[1]} for r in rows]
    finally:
        con.close()


def run_preview(storage_path: str, limit: int = 50) -> dict:
    """First ``limit`` rows of the version as {columns, rows}."""
    con = _connect()
    try:
        cur = con.execute(
            f"SELECT * FROM read_parquet('{_s3_uri(storage_path)}') LIMIT {int(limit)};"
        )
        columns, rows = _rows_from_cursor(cur)
        return {"columns": columns, "rows": rows}
    finally:
        con.close()
