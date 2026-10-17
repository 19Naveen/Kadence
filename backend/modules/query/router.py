import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_user
from modules.query import service
from modules.query.schemas import (
    AggregateRequest,
    AggregateResponse,
    DatasetPreviewResponse,
    QueryExecuteRequest,
    QueryResult,
)

router = APIRouter(prefix="/query", tags=["query"])


@router.post("/execute", response_model=QueryResult)
async def execute_query(
    payload: QueryExecuteRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Run a read-only SELECT against the latest version (exposed as the view `dataset`)."""
    return service.execute_query(db, payload, owner_id=user["sub"])


@router.post("/aggregate", response_model=AggregateResponse)
async def aggregate(
    payload: AggregateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Group the latest version by a dimension and aggregate a measure (for charts)."""
    return service.aggregate(db, payload, owner_id=user["sub"])


@router.get("/datasets/{dataset_id}/preview", response_model=DatasetPreviewResponse)
async def preview_dataset(
    dataset_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """First N rows + schema of the dataset's latest version."""
    return service.preview(db, dataset_id, limit, owner_id=user["sub"])
