"""Select the appropriate transform engine based on staging file size."""

from core.config import settings
from modules.ingestion.engine import duckdb_engine
from modules.ingestion.engine.pandas_engine import (
    apply_transforms,
    column_count,
    infer_schema,
    load_source,
    row_count,
    write_parquet,
)

_PANDAS_ENGINE = {
    "load_source": load_source,
    "apply_transforms": apply_transforms,
    "infer_schema": infer_schema,
    "write_parquet": write_parquet,
    "row_count": row_count,
    "column_count": column_count,
}

_DUCKDB_ENGINE = {
    "load_source": duckdb_engine.load_source,
    "apply_transforms": duckdb_engine.apply_transforms,
    "infer_schema": duckdb_engine.infer_schema,
    "write_parquet": duckdb_engine.write_parquet,
    "row_count": duckdb_engine.row_count,
    "column_count": duckdb_engine.column_count,
    # Fused load->transform->write; the Celery task uses this when present.
    "run": duckdb_engine.run,
}


def select_engine(staging_metadata: dict | None) -> dict:
    """Return the engine dict suited to the staged data size.

    Files larger than ``TRANSFORM_ENGINE_THRESHOLD_BYTES`` use the streaming
    DuckDB engine; everything else (and any input with no known file_size) uses
    the pandas engine, which is exact-parity with the live preview.
    """
    file_size = (staging_metadata or {}).get("file_size")
    if file_size is not None and file_size > settings.TRANSFORM_ENGINE_THRESHOLD_BYTES:
        return _DUCKDB_ENGINE
    return _PANDAS_ENGINE
