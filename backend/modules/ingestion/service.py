import uuid

from fastapi import HTTPException, status
from modules.ingestion import repository as repo
from modules.ingestion.enums import JobStatus, SourceType, TransformType
from modules.ingestion.schemas import (
    CreateIngestionJobRequest,
    ResolveSchemaMappingRequest,
)
from modules.ingestion.tasks import run_ingestion_pipeline
from sqlalchemy.orm import Session


def create_ingestion_job(db: Session, payload: CreateIngestionJobRequest) -> tuple:
    """Create dataset (if new) + ingestion job. Returns (dataset, job)."""
    dataset = repo.get_dataset(db, payload.dataset_id)
    if not dataset:
        dataset = repo.create_dataset(
            db,
            {
                "id": payload.dataset_id,
                "workspace_id": payload.workspace_id,
                "name": payload.dataset_name,
                "description": payload.description,
                "source_type": payload.source_type,
            },
        )

    source_config = None
    staging_metadata = None
    if payload.db_config:
        source_config = payload.db_config.model_dump()
        # Try to estimate row count for engine selection.
        try:
            from modules.ingestion.source_loader import load_source
            temp_job = type("TempJob", (), {
                "source_type": SourceType(payload.source_type),
                "staging_path": None,
                "source_config": source_config,
            })()
            count_df = load_source(temp_job, nrows=1)
            staging_metadata = {
                "row_count": None,
                "column_count": len(count_df.columns),
                "source_format": payload.source_type,
            }
        except Exception:
            staging_metadata = {"source_format": payload.source_type}

    job = repo.create_job(
        db,
        {
            "dataset_id": dataset.id,
            "status": JobStatus.PENDING,
            "source_type": SourceType(payload.source_type),
            "source_config": source_config,
            "staging_metadata": staging_metadata,
        },
    )

    return dataset, job


def resolve_schema_mapping(
    db: Session,
    job_id: uuid.UUID,
    payload: ResolveSchemaMappingRequest,
) -> "IngestionJob":

    job = repo.get_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Job not found"
        )

    if job.status != JobStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job is not awaiting schema resolution (status={job.status.value})",
        )

    if payload.rules:
        rules = [
            {
                "source_column": r.source_column,
                "target_column": r.target_column,
                "transform_type": TransformType(r.transform_type),
                "cast_to_type": r.cast_to_type,
            }
            for r in payload.rules
        ]
        repo.upsert_mapping_rules(db, job.dataset_id, rules)
        repo.clear_pending_schema(db, job_id)  # resolved → not awaiting anymore
        repo.update_job_status(db, job_id, JobStatus.PENDING)
    else:
        # Accept the inferred schema as-is → version it without any transforms.
        repo.set_accept_new_schema(db, job_id)

    run_ingestion_pipeline.delay(str(job_id))
    return repo.get_job(db, job_id)
