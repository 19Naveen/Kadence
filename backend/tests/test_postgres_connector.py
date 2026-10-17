from psycopg.conninfo import make_conninfo

from modules.ingestion.connectors.postgres_connector import PostgresConnector


def test_connect_kwargs_are_valid_psycopg_conninfo():
    config = {
        "host": "localhost", "port": 5432, "database": "src", "user": "u",
        "password": "p", "table": "public.orders",
    }
    kwargs = PostgresConnector(config)._connect_kwargs()

    assert kwargs["dbname"] == "src"
    assert "database" not in kwargs and "table" not in kwargs
    make_conninfo(**kwargs)  # raises on any option libpq doesn't know
