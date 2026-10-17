"""Pandas ↔ DuckDB engine parity: every transform op run through
`apply_transforms` (pandas) and through `compile_plan` + in-memory DuckDB on the
same fixture frame, asserting equal results after dtype normalization.

Documented deliberate divergences (each has a targeted test below):

1. `cast` — (a) pandas `astype(errors="ignore")` is all-or-nothing per column,
   DuckDB `TRY_CAST` nulls only the unparseable values; (b) pandas cast-to-string
   is `astype(object)` which keeps original values, DuckDB emits true VARCHARs;
   (c) pandas 3.0 `to_datetime(errors="coerce")` locks the format inferred from
   the first value, DuckDB parses each value independently. Parity holds when
   every value casts cleanly in one format.
2. `round` — numpy/pandas use banker's rounding on exact .5 ties, DuckDB rounds
   half away from zero. Parity holds off ties.
3. `capitalize` — pandas `.str.title()` capitalizes after any non-letter
   (digits, quotes); the SQL title-cases space-separated words only.
4. `fillna mode` — on ties pandas picks the smallest value, DuckDB picks an
   arbitrary one. Parity holds with a unique mode.
5. `zscore` on a zero-variance column — pandas leaves values unchanged, SQL
   yields NULL.
6. Missing *source* column — pandas silently skips the step; the compiler can
   only skip columns removed by earlier steps, an unknown source column is a
   runtime binder error (mapped to TransformStepError by the task).
"""

import uuid

import duckdb
import numpy as np
import pandas as pd
import pytest

from modules.ingestion.engine.sql_compiler import compile_plan
from modules.ingestion.transforms import apply_transforms


def fixture_df() -> pd.DataFrame:
    df = pd.DataFrame({
        "name": ["  Alice ", "bob smith", None, "Ω'quote \"dq\"", "élan vital"],
        "city": ["NY,US", "LA", None, "SF,CA", "Paris"],
        "ints": [1, 2, 2, -5, 10],
        "floats": [1.5, None, 2.25, -3.75, 100.0],
        "ts": pd.to_datetime([
            "2021-01-01 00:00:00", "2022-06-15 12:30:00", None,
            "2023-12-31 23:59:59", "2020-02-29 06:00:00",
        ]),
    })
    return df


def run_pandas(df, steps):
    return apply_transforms(df, steps)


def run_duckdb(df, steps):
    con = duckdb.connect()
    try:
        con.register("src", df)
        return con.execute(compile_plan(steps, "src")).df()
    finally:
        con.close()


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Widen dtypes so the two engines' frames compare: numerics → float64,
    datetimes → datetime64[ns], everything else → object with None for nulls."""
    out = {}
    for c in df.columns:
        s = df[c].reset_index(drop=True)
        if s.isna().all():
            s = pd.Series([None] * len(s), dtype="object")
        elif pd.api.types.is_datetime64_any_dtype(s):
            s = s.astype("datetime64[ns]")
        elif pd.api.types.is_bool_dtype(s):
            s = s.astype("object").where(s.notna(), None)
        elif pd.api.types.is_numeric_dtype(s):
            s = s.astype("float64")
        else:
            s = s.astype("object").where(s.notna(), None)
        out[c] = s
    return pd.DataFrame(out)


def assert_parity(steps, df=None, sort=False):
    df = fixture_df() if df is None else df
    p = normalize(run_pandas(df, steps))
    d = normalize(run_duckdb(df, steps))
    assert list(p.columns) == list(d.columns)
    if sort:  # DISTINCT does not guarantee row order
        p = p.sort_values(list(p.columns)).reset_index(drop=True)
        d = d.sort_values(list(d.columns)).reset_index(drop=True)
    pd.testing.assert_frame_equal(p, d, check_dtype=False)


# ---------------------------------------------------------------------------
# Columns
# ---------------------------------------------------------------------------


def test_drop():
    assert_parity([{"type": "drop", "column": "city"}])


def test_rename():
    assert_parity([{"type": "rename", "column": "name", "to": "person"}])


def test_cast_string_divergence():
    # Divergence 1b: pandas "cast to string" is astype(object), which keeps the
    # original values (ints stay ints); DuckDB produces true VARCHAR strings.
    steps = [{"type": "cast", "column": "ints", "to_type": "string"}]
    assert run_pandas(fixture_df(), steps)["ints"].tolist() == [1, 2, 2, -5, 10]
    assert run_duckdb(fixture_df(), steps)["ints"].tolist() == ["1", "2", "2", "-5", "10"]


def test_cast_integer():
    df = pd.DataFrame({"a": ["1", "2", "3"]})
    assert_parity([{"type": "cast", "column": "a", "to_type": "integer"}], df=df)


def test_cast_decimal():
    assert_parity([{"type": "cast", "column": "ints", "to_type": "decimal"}])


def test_cast_boolean():
    df = pd.DataFrame({"a": [1, 0, 1]})
    assert_parity([{"type": "cast", "column": "a", "to_type": "boolean"}], df=df)


def test_cast_timestamp():
    df = pd.DataFrame({"a": ["2021-01-01 00:00:00", "2022-06-15 12:30:00", None]})
    assert_parity([{"type": "cast", "column": "a", "to_type": "timestamp"}], df=df)


def test_cast_timestamp_mixed_format_divergence():
    # Divergence 1c: pandas 3.0 to_datetime(errors="coerce") infers the format
    # from the first value and coerces other formats to NaT; DuckDB TRY_CAST
    # parses each value independently.
    df = pd.DataFrame({"a": ["2021-01-01", "2022-06-15 12:30:00"]})
    steps = [{"type": "cast", "column": "a", "to_type": "timestamp"}]
    assert run_pandas(df, steps)["a"].isna().tolist() == [False, True]
    assert run_duckdb(df, steps)["a"].isna().tolist() == [False, False]


def test_cast_divergence_bad_values():
    # Divergence 1: pandas errors="ignore" keeps the WHOLE column as strings when
    # any value fails; DuckDB TRY_CAST nulls just the bad value.
    df = pd.DataFrame({"a": ["1", "x", "3"]})
    steps = [{"type": "cast", "column": "a", "to_type": "integer"}]
    assert run_pandas(df, steps)["a"].tolist() == ["1", "x", "3"]
    assert [None if pd.isna(v) else v for v in run_duckdb(df, steps)["a"]] == [1, None, 3]


def test_duplicate():
    assert_parity([{"type": "duplicate", "column": "ints"}])


def test_merge():
    assert_parity([{"type": "merge", "column": "name", "column2": "city", "sep": " - ", "to": "combo"}])


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------


def test_filter_eq():
    assert_parity([{"type": "filter", "column": "ints", "op": "eq", "value": 2}])


def test_filter_ne_keeps_nulls():
    assert_parity([{"type": "filter", "column": "floats", "op": "ne", "value": 2.25}])


def test_filter_comparisons_drop_nulls():
    for op, v in (("lt", 3), ("le", 2.25), ("gt", 0), ("ge", 1.5)):
        assert_parity([{"type": "filter", "column": "floats", "op": op, "value": v}])


def test_filter_isnull_notnull():
    assert_parity([{"type": "filter", "column": "floats", "op": "isnull"}])
    assert_parity([{"type": "filter", "column": "floats", "op": "notnull"}])


def test_filter_string_value():
    assert_parity([{"type": "filter", "column": "city", "op": "eq", "value": "LA"}])


def test_dropnulls():
    assert_parity([{"type": "dropnulls", "column": "name"}])


def test_dedupe():
    df = pd.DataFrame({"a": [1, 1, 2, 1], "b": ["x", "x", "y", "z"]})
    assert_parity([{"type": "dedupe"}], df=df, sort=True)


def test_dedupe_nulls_equal():
    df = pd.DataFrame({"a": [None, None, 1.0], "b": ["x", "x", "x"]})
    assert_parity([{"type": "dedupe"}], df=df, sort=True)


def test_keeptop():
    assert_parity([{"type": "keeptop", "n": 3}])


def test_keeptop_zero():
    assert_parity([{"type": "keeptop", "n": 0}])


def test_fillna_value():
    assert_parity([{"type": "fillna", "column": "floats", "strategy": "value", "value": 0}])
    assert_parity([{"type": "fillna", "column": "city", "strategy": "value", "value": "unknown"}])


def test_fillna_mean():
    assert_parity([{"type": "fillna", "column": "floats", "strategy": "mean"}])


def test_fillna_median():
    assert_parity([{"type": "fillna", "column": "floats", "strategy": "median"}])


def test_fillna_mode():
    # Unique mode — divergence 4 only applies on ties.
    df = pd.DataFrame({"a": ["x", None, "x", "y"]})
    assert_parity([{"type": "fillna", "column": "a", "strategy": "mode"}], df=df)


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------


def test_upper():
    assert_parity([{"type": "upper", "column": "name"}])


def test_lower():
    assert_parity([{"type": "lower", "column": "name"}])


def test_capitalize_space_words():
    df = pd.DataFrame({"a": ["hello world", "  Carol ", "élan vital", "ABC def", None]})
    assert_parity([{"type": "capitalize", "column": "a"}], df=df)


def test_capitalize_divergence_after_punctuation():
    # Divergence 3: pandas title() capitalizes after any non-letter.
    df = pd.DataFrame({"a": ["abc123def", "o'brien"]})
    steps = [{"type": "capitalize", "column": "a"}]
    assert run_pandas(df, steps)["a"].tolist() == ["Abc123Def", "O'Brien"]
    assert run_duckdb(df, steps)["a"].tolist() == ["Abc123def", "O'brien"]


def test_trim():
    assert_parity([{"type": "trim", "column": "name"}])


def test_trim_tabs_newlines():
    df = pd.DataFrame({"a": ["\t hi \n", " x", None]})
    assert_parity([{"type": "trim", "column": "a"}], df=df)


def test_replace_literal_dot():
    df = pd.DataFrame({"a": ["a.b.c", "no-dots", None]})
    assert_parity([{"type": "replace", "column": "a", "find": ".", "repl": "X"}], df=df)


def test_replace_quotes():
    df = pd.DataFrame({"a": ["it's", "quote\"d"]})
    assert_parity([{"type": "replace", "column": "a", "find": "'", "repl": "\""}], df=df)


def test_split():
    assert_parity([{"type": "split", "column": "city", "sep": ","}])


def test_split_multichar_sep():
    df = pd.DataFrame({"a": ["x::y::z", "plain", None]})
    assert_parity([{"type": "split", "column": "a", "sep": "::"}], df=df)


def test_extract():
    assert_parity([{"type": "extract", "column": "name", "start": 1, "len": 3}])


def test_length():
    assert_parity([{"type": "length", "column": "name"}])


# ---------------------------------------------------------------------------
# Numeric
# ---------------------------------------------------------------------------


def test_round():
    # Off .5 ties — divergence 2 covers ties.
    df = pd.DataFrame({"a": [1.234, -2.718, None, 100.001]})
    assert_parity([{"type": "round", "column": "a", "n": 2}], df=df)


def test_round_tie_divergence():
    # Divergence 2: banker's rounding vs half-away-from-zero on exact ties.
    df = pd.DataFrame({"a": [2.5, 3.5]})
    steps = [{"type": "round", "column": "a", "n": 0}]
    assert run_pandas(df, steps)["a"].tolist() == [2.0, 4.0]
    assert run_duckdb(df, steps)["a"].tolist() == [3.0, 4.0]


def test_abs():
    assert_parity([{"type": "abs", "column": "floats"}])


def test_math_add_subtract_multiply_divide():
    for op in ("add", "subtract", "multiply", "divide"):
        assert_parity([{"type": "math", "column": "floats", "op": op, "operand": 2.5}])


def test_math_divide_by_zero_nulls_column():
    assert_parity([{"type": "math", "column": "ints", "op": "divide", "operand": 0}])


def test_zscore():
    assert_parity([{"type": "zscore", "column": "floats"}])
    assert_parity([{"type": "zscore", "column": "ints"}])


def test_zscore_zero_variance_divergence():
    # Divergence 5: pandas leaves a zero-variance column unchanged; SQL -> NULL.
    df = pd.DataFrame({"a": [3.0, 3.0, 3.0]})
    steps = [{"type": "zscore", "column": "a"}]
    assert run_pandas(df, steps)["a"].tolist() == [3.0, 3.0, 3.0]
    assert run_duckdb(df, steps)["a"].isna().all()


# ---------------------------------------------------------------------------
# Date & Time
# ---------------------------------------------------------------------------


def test_datepart_year_month_day():
    for part in ("year", "month", "day"):
        assert_parity([{"type": "datepart", "column": "ts", "part": part}])


def test_datepart_from_string_column():
    df = pd.DataFrame({"a": ["2021-05-06", "2022-12-31", None]})
    assert_parity([{"type": "datepart", "column": "a", "part": "month"}], df=df)


# ---------------------------------------------------------------------------
# Chaining & skip-if-missing
# ---------------------------------------------------------------------------


def test_chained_plan():
    assert_parity([
        {"type": "trim", "column": "name"},
        {"type": "rename", "column": "name", "to": "person"},
        {"type": "upper", "column": "person"},
        {"type": "dropnulls", "column": "floats"},
        {"type": "math", "column": "floats", "op": "multiply", "operand": 2},
        {"type": "duplicate", "column": "ints"},
        {"type": "filter", "column": "ints", "op": "gt", "value": 0},
        {"type": "keeptop", "n": 2},
    ])


def test_step_on_dropped_column_skipped_both_engines():
    assert_parity([
        {"type": "drop", "column": "city"},
        {"type": "upper", "column": "city"},       # skipped: column was removed
        {"type": "filter", "column": "city", "op": "eq", "value": "LA"},  # skipped too
    ])


def test_rename_frees_old_name():
    assert_parity([
        {"type": "rename", "column": "name", "to": "person"},
        {"type": "lower", "column": "name"},       # old name gone -> skipped
        {"type": "lower", "column": "person"},
    ])


# ---------------------------------------------------------------------------
# Combine (join)
# ---------------------------------------------------------------------------
#
# The join right-hand side is not resolved from the DB in these tests — it's a
# fixture frame registered as a DuckDB view / handed to apply_transforms via a
# join_loader, exactly mirroring how the two engines are wired at runtime
# (duckdb_engine.run's join_sources map / tasks.py's DuckDB-backed loaders).


def _join_left() -> pd.DataFrame:
    return pd.DataFrame({"id": [1, 2, 3], "name": ["a", "b", "c"]})


def _join_right_same_key() -> pd.DataFrame:
    return pd.DataFrame({"id": [1, 2, 4], "name": ["x", "y", "z"], "val": [10, 20, 40]})


def _join_right_diff_key() -> pd.DataFrame:
    return pd.DataFrame({"rid": [1, 2, 4], "name": ["x", "y", "z"], "val": [10, 20, 40]})


def _assert_join_parity(steps, left, right, sort=True):
    p = normalize(apply_transforms(left, steps, join_loader=lambda step: right))

    con = duckdb.connect()
    try:
        con.register("__left", left)
        con.register("__right", right)
        dataset_id = steps[0]["dataset_id"]
        sql = compile_plan(
            steps, "__left",
            join_sources={dataset_id: "__right"},
            describe=lambda rel: [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()],
        )
        d = normalize(con.execute(sql).df())
    finally:
        con.close()

    assert list(p.columns) == list(d.columns)
    if sort:
        p = p.sort_values(list(p.columns)).reset_index(drop=True)
        d = d.sort_values(list(d.columns)).reset_index(drop=True)
    pd.testing.assert_frame_equal(p, d, check_dtype=False)
    return p


@pytest.mark.parametrize("how", ["inner", "left", "right", "full"])
def test_join_how(how):
    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "id", "right_on": "id", "how": how}]
    _assert_join_parity(steps, _join_left(), _join_right_same_key())


def test_join_key_collision_suffixing():
    # Non-key column "name" exists on both sides -> right one gets "_right".
    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "id", "right_on": "id", "how": "inner"}]
    result = _assert_join_parity(steps, _join_left(), _join_right_same_key())
    assert list(result.columns) == ["id", "name", "name_right", "val"]


def test_join_equal_key_names_keep_one():
    # left_on == right_on -> a single "id" column survives (pandas merges it).
    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "id", "right_on": "id", "how": "inner"}]
    result = _assert_join_parity(steps, _join_left(), _join_right_same_key())
    assert result.columns.tolist().count("id") == 1


def test_join_differing_key_names_keep_both():
    # left_on != right_on -> both key columns survive (pandas does not merge them).
    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "id", "right_on": "rid", "how": "inner"}]
    result = _assert_join_parity(steps, _join_left(), _join_right_diff_key())
    assert "id" in result.columns and "rid" in result.columns


def test_join_missing_left_key_skipped():
    # Missing *left* column follows the same skip-if-missing contract as every
    # other op — the join step is a pass-through in both engines.
    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "nope", "right_on": "id", "how": "inner"}]
    left = _join_left()
    result = apply_transforms(left, steps, join_loader=lambda step: _join_right_same_key())
    assert list(result.columns) == list(left.columns)


def test_join_missing_right_key_raises():
    from modules.ingestion.transforms import TransformStepError

    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "id", "right_on": "nope", "how": "inner"}]
    with pytest.raises(TransformStepError):
        apply_transforms(_join_left(), steps, join_loader=lambda step: _join_right_same_key())


def test_join_without_loader_raises():
    from modules.ingestion.transforms import TransformStepError

    dataset_id = str(uuid.uuid4())
    steps = [{"type": "join", "dataset_id": dataset_id, "left_on": "id", "right_on": "id", "how": "inner"}]
    with pytest.raises(TransformStepError) as exc:
        apply_transforms(_join_left(), steps)
    assert exc.value.step_index == 0
