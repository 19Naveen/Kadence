"""DuckDB-backed transform engine for large staging files.

Fuses load -> transform -> write into a single SQL execution that streams and
spills to disk, so a 10-100 GB dataset never lands in RAM. The transform plan is
compiled to SQL by ``sql_compiler.compile_plan`` and executed directly against
``read_csv_auto`` / ``read_parquet`` over the MinIO S3 endpoint; the result is
``COPY``-ed straight back to the version's parquet object.

``run(job, transforms, storage_path) -> dict`` is the fused entry point the Celery
task uses (keys: row_count, column_count, schema, file_size). The individual
``TransformEngine`` dict keys are also provided for uniformity with the pandas
engine, but the task prefers ``run``.
"""

from infrastructure.duckdb import connect, s3_uri
from infrastructure.blob.minio_client import object_size
from modules.ingestion.enums import SourceType
from modules.ingestion.engine.sql_compiler import compile_plan


# DuckDB type name -> canonical schema type (matching schema_inference.infer_schema).
def _canonical_type(duckdb_type: str) -> str:
    t = duckdb_type.upper()
    if "TIMESTAMP" in t or t == "DATE" or "TIME" in t:
        return "timestamp"
    if t == "BOOLEAN":
        return "boolean"
    if "INT" in t or t == "HUGEINT":
        return "integer"
    if t in ("DOUBLE", "FLOAT", "REAL") or t.startswith("DECIMAL") or t.startswith("NUMERIC"):
        return "decimal"
    return "string"


def _source_relation(con, job) -> str:
    """A DuckDB FROM-expression for the job's staged source.

    CSV / Parquet are read natively over S3. Everything else (xlsx, live DB
    sources) is loaded via the shared pandas source loader and registered — those
    inputs are never large enough to matter for the streaming path.
    """
    src = job.source_type
    if src == SourceType.CSV:
        return f"read_csv_auto('{s3_uri(job.staging_path)}')"
    if src == SourceType.PARQUET:
        return f"read_parquet('{s3_uri(job.staging_path)}')"
    from modules.ingestion.source_loader import load_source as _load_source
    df = _load_source(job)  # noqa: F841 — referenced by the registered view below
    con.register("__staging_src", df)
    return "__staging_src"


def _schema_from_parquet(con, dest_uri: str) -> dict[str, str]:
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{dest_uri}')").fetchall()
    # DESCRIBE rows: (column_name, column_type, null, key, default, extra)
    return {r[0]: _canonical_type(r[1]) for r in rows}


def _describe(con):
    """Return a callable rel-string -> column names, for the compiler's join support."""
    return lambda rel: [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()]


def run(job, transforms: list, storage_path: str, join_sources: dict[str, str] | None = None) -> dict:
    """Compile + execute the plan and write the result parquet. Returns version stats.

    `join_sources` maps dataset_id -> a `read_parquet('s3://…')` relation string
    for each right-hand dataset a join step references (resolved by the caller).
    """
    con = connect()
    try:
        source_rel = _source_relation(con, job)
        sql = compile_plan(transforms, source_rel, join_sources=join_sources, describe=_describe(con))
        dest = s3_uri(storage_path)
        con.execute(f"COPY ({sql}) TO '{dest}' (FORMAT PARQUET);")

        # Stats from the written parquet (row count / schema are footer metadata).
        row_count = con.execute(
            f"SELECT count(*) FROM read_parquet('{dest}')"
        ).fetchone()[0]
        schema = _schema_from_parquet(con, dest)
    finally:
        con.close()

    return {
        "row_count": int(row_count),
        "column_count": len(schema),
        "schema": schema,
        "file_size": object_size(storage_path),
    }


# ── dict-contract shims (parity with the pandas engine; run() is preferred) ─────

def load_source(job):
    from modules.ingestion.source_loader import load_source as _load_source
    return _load_source(job)


def apply_transforms(data, steps):
    from modules.ingestion.transforms import apply_transforms as _apply
    return _apply(data, steps)


def infer_schema(data):
    from modules.ingestion.schema_inference import infer_schema as _infer
    return _infer(data)


def write_parquet(data, storage_path: str) -> int:
    from infrastructure.blob.minio_client import upload_dataframe_as_parquet
    return upload_dataframe_as_parquet(data, storage_path)


def row_count(data) -> int:
    return len(data)


def column_count(data) -> int:
    return len(data.columns)
