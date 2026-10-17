"""Load an ingestion job's source into a DataFrame.

Shared by the Celery pipeline (full load) and the staged-preview endpoint (sampled load).
Connectors are imported lazily so importing this module stays cheap.
"""

from modules.ingestion.enums import SourceType


def _decrypted_config(source_config: dict | None) -> dict | None:
    """Return a copy of a DB source_config with the ``password`` field decrypted.

    ``source_config`` may also carry pipeline bookkeeping keys (``_pending_schema``,
    ``_transforms``, ``_accept_new_schema``) which are passed through untouched.
    The password is decrypted just-in-time so it never sits in memory longer than
    the connection attempt requires.

    Tolerant of an already-plaintext password (e.g. the row-count dry-run in
    ``create_ingestion_job`` runs before the password is encrypted for storage):
    if decryption fails, the original value is used as-is.
    """
    if not source_config or not source_config.get("password"):
        return source_config

    from cryptography.fernet import InvalidToken

    from core.crypto import decrypt_secret

    config = dict(source_config)
    try:
        config["password"] = decrypt_secret(config["password"])
    except (InvalidToken, ValueError, TypeError):
        # Already plaintext (pre-storage dry-run) — use as-is.
        pass
    return config


def load_source(job, nrows: int | None = None):
    """Read the job's staged file / connected table into a pandas DataFrame.

    ``nrows`` bounds the result for previews (applied after read for v1 — file connectors
    read the whole staged object, then we slice). ``None`` returns the full dataset.
    """
    from modules.ingestion.connectors.csv import CsvConnector, XlsxConnector
    from modules.ingestion.connectors.parquet import ParquetConnector
    from modules.ingestion.connectors.postgres_connector import PostgresConnector
    from modules.ingestion.connectors.snowflake_connector import SnowflakeConnector
    from modules.ingestion.connectors.mysql_connector import MySQLConnector
    from modules.ingestion.connectors.mssql_connector import MSSQLConnector

    source = job.source_type
    if source == SourceType.CSV:
        df = CsvConnector(job.staging_path).read()
    elif source == SourceType.XLSX:
        df = XlsxConnector(job.staging_path).read()
    elif source == SourceType.PARQUET:
        df = ParquetConnector(job.staging_path).read()
    elif source == SourceType.POSTGRES:
        df = PostgresConnector(_decrypted_config(job.source_config)).read_all()
    elif source == SourceType.SNOWFLAKE:
        df = SnowflakeConnector(_decrypted_config(job.source_config)).read_all()
    elif source == SourceType.MYSQL:
        df = MySQLConnector(_decrypted_config(job.source_config)).read_all()
    elif source == SourceType.MSSQL:
        df = MSSQLConnector(_decrypted_config(job.source_config)).read_all()
    else:
        raise ValueError(f"Unknown source type: {source}")

    if nrows is not None:
        df = df.head(nrows)
    return df
