import re

import pandas as pd

from infrastructure.blob.minio_client import download_staging_file

_UNNAMED = re.compile(r"^Unnamed: \d+$")


def _looks_unnamed(columns) -> bool:
    """True when most parsed column names are pandas placeholders (`Unnamed: N`),
    which signals the real header row was not on the first line."""
    cols = [str(c) for c in columns]
    if not cols:
        return True
    unnamed = sum(1 for c in cols if _UNNAMED.match(c))
    return unnamed / len(cols) > 0.5


def _detect_header_row(raw: pd.DataFrame) -> int:
    """Pick the most likely header row: the first fully-populated row in the top of
    the sheet, else the row with the most non-null cells (scans first 20 rows)."""
    best_idx, best_count = 0, -1
    for i in range(min(len(raw), 20)):
        row = raw.iloc[i]
        non_null = int(row.notna().sum())
        if bool(row.notna().all()) and non_null > 1:
            return i
        if non_null > best_count:
            best_idx, best_count = i, non_null
    return best_idx


def _clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Drop entirely-empty columns and give any leftover placeholder columns a
    deterministic name so the inferred schema never surfaces `Unnamed: N`."""
    df = df.dropna(axis=1, how="all")
    df = df.rename(
        columns={
            c: (f"column_{i}" if _UNNAMED.match(str(c)) else str(c))
            for i, c in enumerate(df.columns)
        }
    )
    return df


class CsvConnector:
    def __init__(self, staging_path: str):
        self.staging_path = staging_path

    def read(self) -> pd.DataFrame:
        local_path = f"/tmp/{self.staging_path.replace('/', '_')}"
        download_staging_file(self.staging_path, local_path)
        df = pd.read_csv(local_path)
        if _looks_unnamed(df.columns):
            raw = pd.read_csv(local_path, header=None)
            header_row = _detect_header_row(raw)
            df = pd.read_csv(local_path, header=header_row)
        return _clean_columns(df)


class XlsxConnector:
    def __init__(self, staging_path: str):
        self.staging_path = staging_path

    def read(self) -> pd.DataFrame:
        local_path = f"/tmp/{self.staging_path.replace('/', '_')}"
        download_staging_file(self.staging_path, local_path)
        df = pd.read_excel(local_path, engine="openpyxl")
        if _looks_unnamed(df.columns):
            raw = pd.read_excel(local_path, engine="openpyxl", header=None)
            header_row = _detect_header_row(raw)
            df = pd.read_excel(local_path, engine="openpyxl", header=header_row)
        return _clean_columns(df)
