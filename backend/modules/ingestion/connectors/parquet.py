import pandas as pd

from infrastructure.blob.minio_client import download_staging_file


class ParquetConnector:
    def __init__(self, staging_path: str):
        self.staging_path = staging_path

    def read(self) -> pd.DataFrame:
        local_path = f"/tmp/{self.staging_path.replace('/', '_')}"
        download_staging_file(self.staging_path, local_path)
        return pd.read_parquet(local_path, engine="pyarrow")
