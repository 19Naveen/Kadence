import re
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from modules.ingestion.auth import assert_dataset_owned
from modules.query import duckdb_executor as ddb
from modules.query.schemas import (
    AggregatePoint,
    AggregateRequest,
    AggregateResponse,
    DatasetPreviewResponse,
    QueryExecuteRequest,
    QueryResult,
)

_FORBIDDEN = (
    "insert", "update", "delete", "drop", "create", "alter",
    "attach", "copy", "pragma", "call", "export", "install", "load",
)
# Word-boundary matcher: rejects the keyword `create` but not an identifier like
# `created_at` (a plain substring check over-blocks legitimate column names).
_FORBIDDEN_RE = re.compile(
    r"\b(" + "|".join(re.escape(kw) for kw in _FORBIDDEN) + r")\b",
    re.IGNORECASE,
)


def _require_latest(db: Session, dataset_id: uuid.UUID, owner_id: str) -> tuple[str, dict]:
    assert_dataset_owned(db, dataset_id, owner_id)
    resolved = ddb.resolve_latest(db, dataset_id)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset has no versions yet",
        )
    return resolved


def _validate_select(sql: str) -> str:
    cleaned = sql.strip().rstrip(";").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty query")
    if ";" in cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a single statement is allowed",
        )
    lowered = cleaned.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only read-only SELECT queries are allowed",
        )
    if _FORBIDDEN_RE.search(lowered):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Query contains a disallowed keyword",
        )
    return cleaned


def execute_query(db: Session, payload: QueryExecuteRequest, owner_id: str) -> QueryResult:
    storage_path, _schema = _require_latest(db, payload.dataset_id, owner_id)
    sql = _validate_select(payload.sql)
    try:
        result = ddb.run_select(storage_path, sql, payload.row_limit)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return QueryResult(**result)


def aggregate(db: Session, payload: AggregateRequest, owner_id: str) -> AggregateResponse:
    storage_path, schema = _require_latest(db, payload.dataset_id, owner_id)
    try:
        points = ddb.run_aggregate(
            storage_path, schema, payload.dimension, payload.measure,
            payload.aggregation, payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return AggregateResponse(data=[AggregatePoint(**p) for p in points])


def preview(db: Session, dataset_id: uuid.UUID, limit: int, owner_id: str) -> DatasetPreviewResponse:
    storage_path, schema = _require_latest(db, dataset_id, owner_id)
    try:
        result = ddb.run_preview(storage_path, limit)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return DatasetPreviewResponse(
        columns=result["columns"], rows=result["rows"], dataset_schema=schema
    )
