from psycopg.conninfo import make_conninfo

from modules.ingestion.connectors.postgres_connector import PostgresConnector


def test_connect_kwargs_are_valid_psycopg_conninfo():
    config = {
        "host": "localhost", "port": 5432, "database": "src", "user": "u",
        "password": "p", "table": "public.orders",
        # pipeline state the commit/resolve flow stores on source_config
        "_transforms": [{"type": "dedupe"}], "_pending_schema": {"id": "integer"},
    }
    kwargs = PostgresConnector(config)._connect_kwargs()

    assert kwargs["dbname"] == "src"
    assert "database" not in kwargs and "table" not in kwargs
    assert not any(k.startswith("_") for k in kwargs)
    make_conninfo(**kwargs)  # raises on any option libpq doesn't know
