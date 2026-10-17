import pandas as pd
import psycopg
from psycopg import sql


def _safe_table_identifier(table: str) -> sql.Composable:
    """Build a safely-quoted identifier for a (possibly schema-qualified) table name.

    Splits on '.' and quotes each part independently via ``psycopg.sql.Identifier``,
    so a value like ``public.orders`` becomes ``"public"."orders"`` and cannot be used
    to inject arbitrary SQL regardless of its contents.
    """
    parts = [p for p in table.split(".") if p]
    if not parts:
        raise ValueError("Table name must not be empty")
    return sql.SQL(".").join(sql.Identifier(p) for p in parts)


class PostgresConnector:
    def __init__(self, config: dict):
        self.config = config

    def _connect(self):
        conn = psycopg.connect(**self._connect_kwargs())
        # Belt-and-suspenders: even if the composed query above is safe, force the
        # session read-only so a malicious/careless user-supplied `query` (passthrough
        # mode) cannot mutate the source database. Named (server-side) cursors require
        # autocommit to stay off, which is the default here.
        conn.read_only = True
        return conn

    def _connect_kwargs(self) -> dict:
        # `_`-prefixed keys (e.g. `_transforms`, `_pending_schema`) are pipeline state
        # stored on source_config, not libpq connection options.
        kwargs = {
            k: v for k, v in self.config.items()
            if k not in ("table", "query") and not k.startswith("_")
        }
        # psycopg 3 only accepts libpq's `dbname`; the API/UI sends `database`.
        if "database" in kwargs:
            kwargs["dbname"] = kwargs.pop("database")
        return kwargs

    def _build_query(self) -> sql.Composable | str:
        table = self.config.get("table")
        user_query = self.config.get("query")
        if user_query:
            # User-supplied passthrough query, executed on a read-only session/txn.
            return user_query
        return sql.SQL("SELECT * FROM {}").format(_safe_table_identifier(table))

    def stream_table(self, chunk_size: int = 100_000):
        conn = self._connect()
        cursor = conn.cursor(name="stream_cursor")
        cursor.execute(self._build_query())
        columns = [desc[0] for desc in cursor.description]

        while True:
            rows = cursor.fetchmany(chunk_size)
            if not rows:
                break
            yield columns, rows

        cursor.close()
        conn.close()

    def read_all(self) -> pd.DataFrame:
        chunks = []
        for columns, rows in self.stream_table():
            # coerce_float: NUMERIC arrives as Decimal; make it float like pd.read_sql does.
            chunks.append(pd.DataFrame.from_records(rows, columns=columns, coerce_float=True))

        return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
