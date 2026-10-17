"""Pandas-backed TransformEngine (function-based; see engine/base.py for the target Protocol shape)."""

import pandas as pd

from modules.ingestion.schema_inference import infer_schema as _infer_schema
from modules.ingestion.source_loader import load_source as _load_source
from infrastructure.blob.minio_client import upload_dataframe_as_parquet
from modules.ingestion.transforms import apply_transforms as _apply_transforms


def load_source(job, nrows: int | None = None) -> pd.DataFrame:
    """Load source into a pandas DataFrame."""
    return _load_source(job, nrows=nrows)


def apply_transforms(data: pd.DataFrame, steps: list, join_loader=None) -> pd.DataFrame:
    """Apply transform steps in order, returning a new DataFrame (input untouched)."""
    return _apply_transforms(data, steps, join_loader=join_loader)


def infer_schema(data: pd.DataFrame) -> dict[str, str]:
    """Infer schema from a DataFrame."""
    return _infer_schema(data)


def write_parquet(data: pd.DataFrame, storage_path: str) -> int:
    """Write DataFrame → Parquet → MinIO. Returns byte size."""
    return upload_dataframe_as_parquet(data, storage_path)


def row_count(data: pd.DataFrame) -> int:
    return len(data)


def column_count(data: pd.DataFrame) -> int:
    return len(data.columns)
