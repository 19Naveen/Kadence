"""Select the appropriate transform engine based on data size."""

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


def select_engine(staging_metadata: dict | None) -> dict:
    """Return a dict of engine functions suitable for the data size.

    Currently only the pandas engine is implemented.
    DuckDB and Polars engines will be added as future backends,
    selected here based on staging_metadata (e.g. row_count, file_size).
    """
    return _PANDAS_ENGINE
