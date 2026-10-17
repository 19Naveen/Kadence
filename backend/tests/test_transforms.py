import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from modules.ingestion.transforms import (
    apply_transforms,
    parse_steps,
)


# ---------------------------------------------------------------------------
# Validator tests
# ---------------------------------------------------------------------------


def test_parse_drop_step():
    steps = parse_steps([{"type": "drop", "column": "a"}])
    assert steps[0].type == "drop"
    assert steps[0].column == "a"


def test_parse_rename_step():
    steps = parse_steps([{"type": "rename", "column": "a", "to": "b"}])
    assert steps[0].to == "b"


def test_parse_cast_step():
    steps = parse_steps([{"type": "cast", "column": "a", "to_type": "integer"}])
    assert steps[0].to_type == "integer"


def test_cast_bad_to_type_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "cast", "column": "a", "to_type": "bogus"}])


def test_filter_eq_without_value_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "filter", "column": "a", "op": "eq"}])


def test_filter_isnull_without_value_ok():
    steps = parse_steps([{"type": "filter", "column": "a", "op": "isnull"}])
    assert steps[0].op == "isnull"


def test_filter_bad_op_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "filter", "column": "a", "op": "between", "value": 1}])


@pytest.mark.parametrize("label,code", [
    ("equals", "eq"), ("not equals", "ne"), ("less than", "lt"), ("less or equal", "le"),
    ("greater than", "gt"), ("greater or equal", "ge"), ("contains", "contains"),
    ("is null", "isnull"), ("is not null", "notnull"), ("starts_with", "starts_with"),
])
def test_filter_accepts_legacy_labels(label, code):
    steps = parse_steps([{"type": "filter", "column": "a", "op": label, "value": "x"}])
    assert steps[0].op == code


def test_filter_text_op_without_value_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "filter", "column": "a", "op": "contains"}])


def test_select_requires_columns():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "select", "columns": []}])


def test_calc_requires_to():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "calc", "column": "a", "op": "add", "column2": "b", "to": ""}])


def test_group_defaults_and_requires_column():
    count, avg = parse_steps([
        {"type": "group", "by": "k", "agg": "count", "column": "", "to": ""},
        {"type": "group", "by": "k", "agg": "avg", "column": "v"},
    ])
    assert (count.column, count.to) == (None, "count")
    assert avg.to == "avg_v"
    with pytest.raises(ValidationError):
        parse_steps([{"type": "group", "by": "k", "agg": "sum", "column": ""}])


def test_catalog_exposes_new_ops():
    from modules.ingestion.transforms import OPS_CATALOG, STEP_TYPES

    assert set(OPS_CATALOG) == set(STEP_TYPES)  # every step model has a catalog entry
    kinds = {op: [f["kind"] for f in OPS_CATALOG[op]["fields"]] for op in OPS_CATALOG}
    assert kinds["sort"] == ["column", "select"]
    assert kinds["select"] == ["columns"]
    assert kinds["calc"] == ["column", "select", "column", "text"]
    assert kinds["group"] == ["column", "select", "column", "text"]
    assert kinds["append"] == ["dataset"]
    assert OPS_CATALOG["group"]["cat"] == "Summarize"
    # every select field with option_labels labels exactly its options
    for op in OPS_CATALOG.values():
        for f in op["fields"]:
            if "option_labels" in f:
                assert set(f["option_labels"]) == set(f["options"])
    op_field = OPS_CATALOG["filter"]["fields"][1]
    assert op_field["options"][:6] == ["eq", "ne", "lt", "le", "gt", "ge"]
    assert op_field["option_labels"]["in"] == "is one of (comma separated)"
    # every offered filter option is accepted by FilterStep
    for code in op_field["options"]:
        parse_steps([{"type": "filter", "column": "a", "op": code, "value": "x"}])


def test_fillna_value_without_value_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "fillna", "column": "a", "strategy": "value"}])


def test_fillna_mean_without_value_ok():
    steps = parse_steps([{"type": "fillna", "column": "a", "strategy": "mean"}])
    assert steps[0].strategy == "mean"


def test_fillna_bad_strategy_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "fillna", "column": "a", "strategy": "bogus"}])


def test_unknown_type_raises():
    with pytest.raises(ValidationError):
        parse_steps([{"type": "explode", "column": "a"}])


# ---------------------------------------------------------------------------
# apply_transforms — drop
# ---------------------------------------------------------------------------


def test_drop_present():
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    out = apply_transforms(df, [{"type": "drop", "column": "a"}])
    assert list(out.columns) == ["b"]


def test_drop_absent_noop():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "drop", "column": "zzz"}])
    assert list(out.columns) == ["a"]


# ---------------------------------------------------------------------------
# apply_transforms — rename
# ---------------------------------------------------------------------------


def test_rename_present():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "rename", "column": "a", "to": "x"}])
    assert list(out.columns) == ["x"]


def test_rename_absent_noop():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "rename", "column": "zzz", "to": "x"}])
    assert list(out.columns) == ["a"]


# ---------------------------------------------------------------------------
# apply_transforms — cast
# ---------------------------------------------------------------------------


def test_cast_integer():
    df = pd.DataFrame({"a": ["1", "2", "3"]})
    out = apply_transforms(df, [{"type": "cast", "column": "a", "to_type": "integer"}])
    assert out["a"].dtype == "int64"


def test_cast_string():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "cast", "column": "a", "to_type": "string"}])
    assert out["a"].dtype == "object"


def test_cast_decimal():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "cast", "column": "a", "to_type": "decimal"}])
    assert out["a"].dtype == "float64"


def test_cast_boolean():
    df = pd.DataFrame({"a": [1, 0]})
    out = apply_transforms(df, [{"type": "cast", "column": "a", "to_type": "boolean"}])
    assert out["a"].dtype == "bool"


def test_cast_timestamp():
    df = pd.DataFrame({"a": ["2021-01-01", "not-a-date"]})
    out = apply_transforms(
        df, [{"type": "cast", "column": "a", "to_type": "timestamp"}]
    )
    assert pd.api.types.is_datetime64_any_dtype(out["a"])
    assert pd.isna(out["a"].iloc[1])  # coerced


def test_cast_absent_noop():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "cast", "column": "zzz", "to_type": "integer"}])
    assert list(out.columns) == ["a"]


# ---------------------------------------------------------------------------
# apply_transforms — filter
# ---------------------------------------------------------------------------


def test_filter_eq():
    df = pd.DataFrame({"a": [1, 2, 2, 3]})
    out = apply_transforms(df, [{"type": "filter", "column": "a", "op": "eq", "value": 2}])
    assert out["a"].tolist() == [2, 2]


def test_filter_ne():
    df = pd.DataFrame({"a": [1, 2, 3]})
    out = apply_transforms(df, [{"type": "filter", "column": "a", "op": "ne", "value": 2}])
    assert out["a"].tolist() == [1, 3]


def test_filter_lt_le_gt_ge():
    df = pd.DataFrame({"a": [1, 2, 3, 4]})
    assert apply_transforms(df, [{"type": "filter", "column": "a", "op": "lt", "value": 3}])["a"].tolist() == [1, 2]
    assert apply_transforms(df, [{"type": "filter", "column": "a", "op": "le", "value": 3}])["a"].tolist() == [1, 2, 3]
    assert apply_transforms(df, [{"type": "filter", "column": "a", "op": "gt", "value": 3}])["a"].tolist() == [4]
    assert apply_transforms(df, [{"type": "filter", "column": "a", "op": "ge", "value": 3}])["a"].tolist() == [3, 4]


def test_filter_isnull():
    df = pd.DataFrame({"a": [1, None, 3]})
    out = apply_transforms(df, [{"type": "filter", "column": "a", "op": "isnull"}])
    assert len(out) == 1
    assert pd.isna(out["a"].iloc[0])


def test_filter_notnull():
    df = pd.DataFrame({"a": [1, None, 3]})
    out = apply_transforms(df, [{"type": "filter", "column": "a", "op": "notnull"}])
    assert out["a"].tolist() == [1.0, 3.0]


def test_filter_absent_noop():
    df = pd.DataFrame({"a": [1, 2]})
    out = apply_transforms(df, [{"type": "filter", "column": "zzz", "op": "eq", "value": 1}])
    assert len(out) == 2


# ---------------------------------------------------------------------------
# apply_transforms — fillna
# ---------------------------------------------------------------------------


def test_fillna_value():
    df = pd.DataFrame({"a": [1.0, None, 3.0]})
    out = apply_transforms(df, [{"type": "fillna", "column": "a", "strategy": "value", "value": 0}])
    assert out["a"].tolist() == [1.0, 0.0, 3.0]


def test_fillna_mean():
    df = pd.DataFrame({"a": [1.0, None, 3.0]})
    out = apply_transforms(df, [{"type": "fillna", "column": "a", "strategy": "mean"}])
    assert out["a"].tolist() == [1.0, 2.0, 3.0]


def test_fillna_median():
    df = pd.DataFrame({"a": [1.0, None, 3.0, 5.0]})
    out = apply_transforms(df, [{"type": "fillna", "column": "a", "strategy": "median"}])
    # median of [1,3,5] is 3
    assert out["a"].iloc[1] == 3.0


def test_fillna_mode():
    df = pd.DataFrame({"a": ["x", None, "x", "y"]})
    out = apply_transforms(df, [{"type": "fillna", "column": "a", "strategy": "mode"}])
    assert out["a"].iloc[1] == "x"


def test_fillna_absent_noop():
    df = pd.DataFrame({"a": [1.0, None]})
    out = apply_transforms(df, [{"type": "fillna", "column": "zzz", "strategy": "value", "value": 0}])
    assert pd.isna(out["a"].iloc[1])


# ---------------------------------------------------------------------------
# Ordering & immutability
# ---------------------------------------------------------------------------


def test_rename_then_cast_renamed_column():
    df = pd.DataFrame({"a": ["1", "2"]})
    steps = [
        {"type": "rename", "column": "a", "to": "b"},
        {"type": "cast", "column": "b", "to_type": "integer"},
    ]
    out = apply_transforms(df, steps)
    assert list(out.columns) == ["b"]
    assert out["b"].dtype == "int64"


def test_input_not_mutated():
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    snapshot = df.copy()
    apply_transforms(
        df,
        [
            {"type": "drop", "column": "b"},
            {"type": "filter", "column": "a", "op": "eq", "value": 1},
        ],
    )
    pd.testing.assert_frame_equal(df, snapshot)


def test_accepts_parsed_models():
    df = pd.DataFrame({"a": [1, 2, 3]})
    steps = parse_steps([{"type": "filter", "column": "a", "op": "gt", "value": 1}])
    out = apply_transforms(df, steps)
    assert out["a"].tolist() == [2, 3]
