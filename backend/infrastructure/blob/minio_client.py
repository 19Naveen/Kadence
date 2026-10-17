import io

import pandas as pd
from minio import Minio

from core.config import settings

client = Minio(
    endpoint=settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=False,
)

BUCKET_NAME = "datasets"


def ensure_bucket() -> None:
    if not client.bucket_exists(BUCKET_NAME):
        client.make_bucket(BUCKET_NAME)


def upload_file(local_path: str, object_name: str) -> None:
    ensure_bucket()
    client.fput_object(
        bucket_name=BUCKET_NAME, object_name=object_name, file_path=local_path
    )


def upload_staging_stream(fileobj, object_name: str) -> int:
    """Stream a file-like object to staging in 8MB parts (unknown length).
    Returns the number of bytes uploaded."""
    ensure_bucket()
    fileobj.seek(0)
    client.put_object(
        BUCKET_NAME, object_name, fileobj, length=-1, part_size=8 * 1024 * 1024
    )
    # put_object consumed the stream to EOF, so tell() is the byte size.
    return fileobj.tell()


def _sanitize_df(df: pd.DataFrame) -> pd.DataFrame:
    """Cast mixed-type object columns to string so PyArrow can write them."""
    df = df.copy()
    for col in df.columns:
        if df[col].dtype == object:
            # If the column has mixed types, cast everything to str
            inferred = pd.api.types.infer_dtype(df[col].dropna(), skipna=True)
            if inferred not in ("string", "unicode", "empty"):
                df[col] = df[col].astype(str).where(df[col].notna(), other=None)
    return df


def upload_dataframe_as_parquet(df: pd.DataFrame, object_name: str) -> int:
    """Write DataFrame → in-memory Parquet → MinIO. Returns byte size."""
    ensure_bucket()
    df = _sanitize_df(df)
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow")
    size = buf.tell()
    buf.seek(0)
    client.put_object(
        BUCKET_NAME,
        object_name,
        buf,
        size,
        content_type="application/octet-stream",
    )
    return size


def download_staging_file(object_name: str, local_path: str) -> None:
    client.fget_object(BUCKET_NAME, object_name, local_path)


def delete_object(object_name: str) -> None:
    client.remove_object(BUCKET_NAME, object_name)


def object_size(object_name: str) -> int:
    """Byte size of a stored object (via stat)."""
    return client.stat_object(BUCKET_NAME, object_name).size
