import uuid

from core.crypto import encrypt_secret
from fastapi import HTTPException, status
from modules.ingestion import repository as repo
from modules.ingestion.enums import JobStatus, SourceType, TransformType
from modules.ingestion.schemas import (
    CombineDatasetsRequest,
    CreateIngestionJobRequest,
    ResolveSchemaMappingRequest,
)
from modules.ingestion.tasks import run_ingestion_pipeline
from modules.workspace.repository import get_workspace
from sqlalchemy.orm import Session


def create_ingestion_job(
    db: Session, payload: CreateIngestionJobRequest, owner_id: str
) -> tuple:
    """Validate workspace ownership, then create dataset (if new) + ingestion job.

    Returns (dataset, job).
    """
    workspace = get_workspace(db, payload.workspace_id, owner_id=owner_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )

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
        plaintext_config = payload.db_config.model_dump()
        # Try to estimate row count for engine selection. Uses the plaintext config
        # (a live connection needs the real password) — never persisted as-is.
        try:
            from modules.ingestion.source_loader import load_source
            temp_job = type("TempJob", (), {
                "source_type": SourceType(payload.source_type),
                "staging_path": None,
                "source_config": plaintext_config,
            })()
            count_df = load_source(temp_job, nrows=1)
            staging_metadata = {
                "row_count": None,
                "column_count": len(count_df.columns),
                "source_format": payload.source_type,
            }
        except Exception:
            staging_metadata = {"source_format": payload.source_type}

        # Encrypt the password before it is ever written to the DB.
        source_config = dict(plaintext_config)
        if source_config.get("password"):
            source_config["password"] = encrypt_secret(source_config["password"])

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


def resolve_join_sources(db: Session, steps: list, owner_id: str) -> dict[str, str]:
    """Resolve every join step's right dataset to its latest-version storage_path,
    enforcing that the caller owns each dataset's workspace chain.

    Returns {dataset_id_str: storage_path}. Unauthorized or missing datasets raise
    404 "Dataset not found" (no info leak). Non-join plans resolve to {} without
    touching the DB.
    """
    from modules.ingestion.auth import assert_dataset_owned
    from modules.ingestion.transforms import JoinStep, _coerce

    result: dict[str, str] = {}
    for step in steps:
        step = _coerce(step)
        if not isinstance(step, JoinStep):
            continue
        key = str(step.dataset_id)
        if key in result:
            continue
        assert_dataset_owned(db, step.dataset_id, owner_id)  # 404 on missing/unauthorized
        latest = repo.get_latest_version(db, step.dataset_id)
        if not latest:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        result[key] = latest.storage_path
    return result


def create_combine_job(db: Session, payload: CombineDatasetsRequest, owner_id: str) -> IngestionJob:
    """Ad-hoc combine: build a job whose "staging file" is an already-imported
    dataset's latest version instead of an upload, so the existing pipeline
    (engine selection, join resolution, version write) runs unmodified.
    """
    from modules.ingestion.auth import assert_dataset_owned

    workspace = get_workspace(db, payload.workspace_id, owner_id=owner_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )
    primary = assert_dataset_owned(db, payload.primary_dataset_id, owner_id)
    primary_latest = repo.get_latest_version(db, primary.id)
    if not primary_latest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset has no committed version yet"
        )

    # 404s early on any missing/unauthorized join dataset, before creating anything.
    resolve_join_sources(db, payload.transforms, owner_id)

    if payload.target_dataset_id:
        target = assert_dataset_owned(db, payload.target_dataset_id, owner_id)
    else:
        target = repo.create_dataset(
            db,
            {
                "id": uuid.uuid4(),
                "workspace_id": payload.workspace_id,
                "name": payload.new_dataset_name,
                "description": payload.description,
                "source_type": "parquet",
            },
        )

    return repo.create_job(
        db,
        {
            "dataset_id": target.id,
            "status": JobStatus.PENDING,
            "source_type": SourceType.PARQUET,
            # mode="json": join steps carry a uuid.UUID dataset_id — plain model_dump()
            # leaves it as a UUID object, which the JSONB column's json.dumps can't serialize.
            "source_config": {"_transforms": [s.model_dump(mode="json") for s in payload.transforms]},
            "staging_path": primary_latest.storage_path,
            "staging_metadata": {
                "file_size": primary_latest.file_size,
                "row_count": primary_latest.row_count,
                "column_count": primary_latest.column_count,
                "source_format": "parquet",
            },
        },
    )


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
