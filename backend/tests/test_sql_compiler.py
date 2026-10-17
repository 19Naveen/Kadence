"""Unit tests for the transform-plan → DuckDB SQL compiler (per-op + injection)."""

import duckdb
import pytest

from modules.ingestion.engine.sql_compiler import compile_plan, lit, q


def _compile(steps):
    return compile_plan(steps, "src")


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------


def test_empty_plan_is_plain_select():
    assert _compile([]) == "SELECT * FROM src"


def test_chained_ctes_in_order():
    sql = _compile([
        {"type": "drop", "column": "a"},
        {"type": "keeptop", "n": 3},
    ])
    assert sql.index("__s1") < sql.index("__s2")
    assert sql.strip().endswith("SELECT * FROM __s2")


# ---------------------------------------------------------------------------
# Per-op compilation
# ---------------------------------------------------------------------------


def test_drop():
    assert 'EXCLUDE ("a")' in _compile([{"type": "drop", "column": "a"}])


def test_rename():
    assert 'RENAME ("a" AS "b")' in _compile([{"type": "rename", "column": "a", "to": "b"}])


def test_cast_uses_try_cast():
    sql = _compile([{"type": "cast", "column": "a", "to_type": "integer"}])
    assert 'TRY_CAST("a" AS BIGINT)' in sql


def test_cast_timestamp():
    sql = _compile([{"type": "cast", "column": "a", "to_type": "timestamp"}])
    assert 'TRY_CAST("a" AS TIMESTAMP)' in sql


def test_duplicate_appends_copy():
    sql = _compile([{"type": "duplicate", "column": "a"}])
    assert '"a" AS "a_copy"' in sql


def test_merge_concats_with_coalesce():
    sql = _compile([{"type": "merge", "column": "a", "column2": "b", "sep": "-", "to": "m"}])
    assert "COALESCE" in sql and "|| '-' ||" in sql and 'AS "m"' in sql


def test_filter_eq():
    sql = _compile([{"type": "filter", "column": "a", "op": "eq", "value": 2}])
    assert 'WHERE "a" = 2' in sql


def test_filter_ne_is_distinct_from():
    sql = _compile([{"type": "filter", "column": "a", "op": "ne", "value": 2}])
    assert 'IS DISTINCT FROM 2' in sql


def test_filter_isnull_notnull():
    assert 'IS NULL' in _compile([{"type": "filter", "column": "a", "op": "isnull"}])
    assert 'IS NOT NULL' in _compile([{"type": "filter", "column": "a", "op": "notnull"}])


def test_dropnulls():
    assert '"a" IS NOT NULL' in _compile([{"type": "dropnulls", "column": "a"}])


def test_dedupe():
    assert "SELECT DISTINCT *" in _compile([{"type": "dedupe"}])


def test_keeptop_limit():
    assert "LIMIT 7" in _compile([{"type": "keeptop", "n": 7}])


def test_fillna_value():
    sql = _compile([{"type": "fillna", "column": "a", "strategy": "value", "value": 0}])
    assert 'COALESCE("a", 0)' in sql


def test_fillna_mean_median_mode_windows():
    assert "avg(" in _compile([{"type": "fillna", "column": "a", "strategy": "mean"}])
    assert "median(" in _compile([{"type": "fillna", "column": "a", "strategy": "median"}])
    assert "mode(" in _compile([{"type": "fillna", "column": "a", "strategy": "mode"}])


def test_upper_lower():
    assert "upper(" in _compile([{"type": "upper", "column": "a"}])
    assert "lower(" in _compile([{"type": "lower", "column": "a"}])


def test_capitalize_title_cases_words():
    sql = _compile([{"type": "capitalize", "column": "a"}])
    assert "string_split" in sql and "list_transform" in sql


def test_trim_regexp():
    sql = _compile([{"type": "trim", "column": "a"}])
    assert "regexp_replace" in sql


def test_replace_is_literal():
    sql = _compile([{"type": "replace", "column": "a", "find": ".", "repl": "X"}])
    assert "replace(" in sql and "'.'" in sql and "regexp_replace" not in sql


def test_split_two_columns():
    sql = _compile([{"type": "split", "column": "a", "sep": ","}])
    assert '"a.1"' in sql and '"a.2"' in sql and "strpos" in sql


def test_extract_is_one_based():
    sql = _compile([{"type": "extract", "column": "a", "start": 0, "len": 4}])
    assert "substr(" in sql and ", 1, 4)" in sql


def test_length_column():
    sql = _compile([{"type": "length", "column": "a"}])
    assert '"a_len"' in sql and "length(" in sql


def test_round_abs():
    assert "round(" in _compile([{"type": "round", "column": "a", "n": 2}])
    assert "abs(" in _compile([{"type": "abs", "column": "a"}])


def test_math_divide_by_zero_is_null():
    sql = _compile([{"type": "math", "column": "a", "op": "divide", "operand": 0}])
    assert "NULL AS" in sql


def test_zscore_sample_std():
    sql = _compile([{"type": "zscore", "column": "a"}])
    assert "stddev_samp" in sql and "NULLIF" in sql


def test_datepart():
    sql = _compile([{"type": "datepart", "column": "a", "part": "month"}])
    assert "month(" in sql and '"a_month"' in sql


def test_unknown_step_type_rejected():
    with pytest.raises(Exception):
        _compile([{"type": "explode", "column": "a"}])


# ---------------------------------------------------------------------------
# Missing-column skip (pandas parity)
# ---------------------------------------------------------------------------


def test_step_on_dropped_column_is_passthrough():
    sql = _compile([
        {"type": "drop", "column": "a"},
        {"type": "upper", "column": "a"},          # a is gone -> pass-through CTE
    ])
    assert "upper(" not in sql
    assert "__s2 AS (SELECT * FROM __s1)" in sql


def test_rename_then_old_name_is_passthrough_new_name_works():
    sql = _compile([
        {"type": "rename", "column": "a", "to": "b"},
        {"type": "upper", "column": "a"},          # old name gone
        {"type": "upper", "column": "b"},          # new name live
    ])
    assert sql.count("upper(") == 1


# ---------------------------------------------------------------------------
# Escaping / injection
# ---------------------------------------------------------------------------


def test_quote_ident_doubles_quotes():
    assert q('a"b') == '"a""b"'


def test_lit_escapes_quotes_and_types():
    assert lit("O'Brien") == "'O''Brien'"
    assert lit(None) == "NULL"
    assert lit(True) == "TRUE"
    assert lit(3) == "3"
    assert lit(2.5) == "2.5"


def test_injection_via_value_is_escaped():
    evil = "'; DROP TABLE x; --"
    sql = _compile([{"type": "filter", "column": "a", "op": "eq", "value": evil}])
    assert "'''; DROP TABLE x; --'" in sql
    assert "; DROP TABLE" not in sql.replace("'''; DROP TABLE x; --'", "")


def test_injection_via_column_is_escaped():
    evil = 'a"; DROP TABLE x; --'
    sql = _compile([{"type": "drop", "column": evil}])
    assert '"a""; DROP TABLE x; --"' in sql


def test_injection_executes_harmlessly():
    """End-to-end: evil step values run as data, the sibling table survives."""
    con = duckdb.connect()
    con.execute("CREATE TABLE x (v INTEGER); INSERT INTO x VALUES (1);")
    con.execute("CREATE TABLE src AS SELECT 'val' AS a, 'b' AS b;")
    steps = [
        {"type": "replace", "column": "a", "find": "'; DROP TABLE x; --", "repl": "y'); DROP TABLE x; --"},
        {"type": "filter", "column": "a", "op": "ne", "value": "'; DROP TABLE x; --"},
        {"type": "fillna", "column": "b", "strategy": "value", "value": "'||(DROP TABLE x)||'"},
    ]
    out = con.execute(compile_plan(steps, "src")).fetchall()
    assert out == [("val", "b")]
    assert con.execute("SELECT count(*) FROM x").fetchone()[0] == 1
    con.close()
