import importlib


def test_engine_package_imports_cleanly():
    module = importlib.import_module("modules.ingestion.engine")
    assert hasattr(module, "select_engine")


def test_select_engine_returns_pandas_callable_dict():
    from modules.ingestion.engine import select_engine

    engine = select_engine({"row_count": 10, "file_size": 100})
    for key in ("load_source", "apply_transforms", "infer_schema", "write_parquet", "row_count", "column_count"):
        assert key in engine
        assert callable(engine[key])


def test_select_engine_handles_none_metadata():
    from modules.ingestion.engine import select_engine

    engine = select_engine(None)
    assert callable(engine["apply_transforms"])
