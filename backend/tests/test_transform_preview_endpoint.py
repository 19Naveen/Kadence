import pandas as pd
import pytest

from modules.ingestion.transforms import apply_transforms, TransformStepError


def test_apply_transforms_raises_with_failing_step_index():
    df = pd.DataFrame({"a": [1, 2]})
    steps = [
        {"type": "drop", "column": "a"},
        {"type": "drop", "column": "a"},  # second drop fails: already dropped
    ]
    with pytest.raises(TransformStepError) as exc_info:
        apply_transforms(df, steps)
    assert exc_info.value.step_index == 1


def test_apply_transforms_succeeds_without_raising_error_wrapper():
    df = pd.DataFrame({"a": [1, 2]})
    steps = [{"type": "drop", "column": "a"}]
    result = apply_transforms(df, steps)
    assert list(result.columns) == []


import anyio

from modules.ingestion.router import transform_preview
from modules.ingestion.schemas import TransformPreviewRequest


def test_preview_endpoint_returns_schema_and_transformed_rows():
    payload = TransformPreviewRequest(
        columns=["a", "b"],
        rows=[[1, "x"], [2, "y"]],
        steps=[{"type": "drop", "column": "b"}],
    )
    response = anyio.run(transform_preview, payload)
    assert response.columns == ["a"]
    assert response.rows == [[1], [2]]
    assert response.schema == {"a": "integer"}
    assert response.errors == {}


def test_preview_endpoint_reports_correct_failing_step_index():
    payload = TransformPreviewRequest(
        columns=["a"],
        rows=[[1], [2]],
        steps=[
            {"type": "drop", "column": "a"},
            {"type": "drop", "column": "a"},
        ],
    )
    response = anyio.run(transform_preview, payload)
    assert response.errors == {1: pytest_error_substring(response.errors[1])}


def pytest_error_substring(msg: str) -> str:
    # helper so the assertion above just checks the key exists with a non-empty message
    assert isinstance(msg, str) and len(msg) > 0
    return msg
