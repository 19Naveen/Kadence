"""Select the appropriate transform engine based on data size."""

from modules.ingestion.enums import SourceType
from modules.ingestion.engine.pandas_engine import (
    apply,
    column_count_of,
    load_source,
    row_count_of,
    schema_of,
    write_parquet,
)

_PANDAS_ENGINE = {
    "load_source": load_source,
    "apply": apply,
    "schema": schema_of,
    "write_parquet": write_parquet,
    "row_count": row_count_of,
    "column_count": column_count_of,
}


def select_engine(staging_metadata: dict | None) -> dict:
    """Return a dict of engine functions suitable for the data size.

    Currently only the pandas engine is implemented.
    DuckDB and Polars engines will be added as future backends.
    """
    return _PANDAS_ENGINE
