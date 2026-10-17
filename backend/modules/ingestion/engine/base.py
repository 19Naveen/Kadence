"""Abstract interface for transform engines.

A TransformEngine encapsulates loading, transforming, schema-inferring, and
writing a dataset. Concrete implementations use different backends (pandas,
DuckDB, Polars, etc.) depending on data size.
"""

from typing import Any, Protocol


class DataContainer(Protocol):
    """A container for tabular data that each engine produces and consumes.

    Concrete types vary per engine — pandas DataFrame, DuckDB relation, etc.
    The engine methods are the intended API.
    """
    pass


class TransformEngine(Protocol):
    """Pluggable engine for the ingestion pipeline."""

    def load_source(self, job: Any) -> DataContainer:
        """Load the job's source into the engine's native container."""
        ...

    def apply_transforms(self, data: DataContainer, steps: list) -> DataContainer:
        """Apply transform steps in order, returning a new container."""
        ...

    def infer_schema(self, data: DataContainer) -> dict[str, str]:
        """Return {column_name: type_string} for the data."""
        ...

    def write_parquet(self, data: DataContainer, storage_path: str) -> int:
        """Write data as Parquet to MinIO. Returns byte size."""
        ...

    def row_count(self, data: DataContainer) -> int:
        """Number of rows in the data."""
        ...

    def column_count(self, data: DataContainer) -> int:
        """Number of columns in the data."""
        ...
