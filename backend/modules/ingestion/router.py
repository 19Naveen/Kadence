import uuid
from typing import Literal

import pandas as pd

from core.database import get_db
from core.dependencies import get_current_user
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from modules.ingestion import repository as repo
from modules.ingestion.auth import (
    assert_dataset_owned,
    assert_job_owned,
    assert_workspace_owned,
)
from modules.ingestion.enums import JobStatus, SourceType
from modules.ingestion.schema_diff import SchemaDiff, compute_diff
from modules.ingestion.schema_inference import infer_schema
from modules.ingestion.source_loader import load_source
from modules.ingestion.schemas import (
    ColumnDiff,
    CombineDatasetsRequest,
    CommitJobRequest,
    CreateIngestionJobRequest,
    DatasetLineageResponse,
    DatasetResponse,
    DatasetVersionResponse,
    IngestionJobResponse,
    LineageSource,
    ResolveSchemaMappingRequest,
    SchemaDiffResponse,
    StagedPreviewResponse,
    TransformPreviewRequest,
    TransformPreviewResponse,
)
from modules.ingestion.service import (
    create_combine_job,
    create_ingestion_job,
    resolve_join_sources,
    resolve_schema_mapping,
)
from infrastructure.blob.minio_client import delete_object, upload_staging_stream
from modules.ingestion.tasks import run_ingestion_pipeline
from modules.ingestion.transforms import (
    OPS_CATALOG,
    TransformStepError,
    apply_transforms,
    parse_steps,
)
from modules.workspace.repository import get_workspace
from sqlalchemy.orm import Session

router = APIRouter(prefix="/data-ingest", tags=["data-ingest"])


def _diff_to_response(dataset_id, diff: SchemaDiff) -> SchemaDiffResponse:
    return SchemaDiffResponse(
        dataset_id=dataset_id,
        has_diff=diff.has_diff,
        added_columns=diff.added_columns,
        missing_columns=diff.missing_columns,
        type_changes=[
            ColumnDiff(
                column=c["column"], old_type=c["old_type"], new_type=c["new_type"]
            )
            for c in diff.type_changes
        ],
        suggested_mappings=[
            ColumnDiff(column=s["column"], suggested_target=s["suggested_target"])
            for s in diff.suggested_mappings
        ],
    )


def _job_to_response(job) -> IngestionJobResponse:
    return IngestionJobResponse(
        id=job.id,
        dataset_id=job.dataset_id,
        status=job.status.value,
        source_type=job.source_type.value,
        staging_metadata=job.staging_metadata,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


# ── Create job from DB source ─────────────────────────────────────────────────
@router.post(
    "/jobs", response_model=IngestionJobResponse, status_code=status.HTTP_202_ACCEPTED
)
async def create_job(
    payload: CreateIngestionJobRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    _, job = create_ingestion_job(db, payload, owner_id=user["sub"])
    # No auto-dispatch: the user reviews + transforms in DataForge, then POSTs /commit.
    return _job_to_response(job)


# ── Create job from file upload ───────────────────────────────────────────────
@router.post(
    "/jobs/upload",
    response_model=IngestionJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_job_from_file(
    dataset_id: uuid.UUID = Form(...),
    dataset_name: str = Form(...),
    workspace_id: uuid.UUID = Form(...),
    source_type: Literal["csv", "xlsx", "parquet"] = Form(...),
    file: UploadFile = File(...),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    workspace = get_workspace(db, workspace_id, owner_id=user["sub"])
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )

    dataset = repo.get_dataset(db, dataset_id)
    if not dataset:
        dataset = repo.create_dataset(
            db,
            {
                "id": dataset_id,
                "workspace_id": workspace_id,
                "name": dataset_name,
                "description": description,
                "source_type": source_type,
            },
        )

    job = repo.create_job(
        db,
        {
            "dataset_id": dataset.id,
            "status": JobStatus.PENDING,
            "source_type": SourceType(source_type),
            "source_config": None,
        },
    )

    # Never use the client-supplied filename in the storage path (path traversal risk).
    # Only a validated extension consistent with source_type is carried over; the
    # object name itself is fully server-controlled (job id).
    _ext_by_type = {"csv": ".csv", "xlsx": ".xlsx", "parquet": ".parquet"}
    ext = _ext_by_type[source_type]
    staging_path = (
        f"{dataset.workspace_id}/{dataset.id}/staging/{job.id}/source{ext}"
    )
    # Stream the upload to MinIO in chunks — never buffer the whole file in RAM.
    file_size = upload_staging_stream(file.file, staging_path)
    if file_size == 0:
        try:
            delete_object(staging_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty"
        )

    # Parse to get row count for metadata (also converts to Parquet for DuckDB).
    temp_df = load_source(job, nrows=1)  # quick schema peek
    col_count = len(temp_df.columns)
    staging_metadata = {
        "file_size": file_size,
        "row_count": None,
        "column_count": col_count,
        "source_format": source_type,
    }
    job.staging_path = staging_path
    job.staging_metadata = staging_metadata
    db.commit()
    db.refresh(job)

    # No auto-dispatch: the user reviews + transforms in DataForge, then POSTs /commit.
    return _job_to_response(job)


# ── Get job status ────────────────────────────────────────────────────────────
@router.get("/jobs/{job_id}", response_model=IngestionJobResponse)
async def get_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = assert_job_owned(db, job_id, owner_id=user["sub"])
    return _job_to_response(job)


# ── Staged preview (for the import wizard) ────────────────────────────────────


@router.get("/jobs/{job_id}/staged-preview", response_model=StagedPreviewResponse)
async def staged_preview(
    job_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Sample rows + inferred schema of a staged (uncommitted) source, plus the diff
    against the dataset's latest version. Powers the DataForge import-review step."""
    import json

    job = assert_job_owned(db, job_id, owner_id=user["sub"])

    try:
        df = load_source(job, nrows=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not read staged source: {exc}",
        )

    inferred = infer_schema(df)
    # JSON-safe rows (NaN→null, numpy/datetime → native/iso) via pandas' own encoder.
    sample_rows = json.loads(df.to_json(orient="values", date_format="iso"))

    latest = repo.get_latest_version(db, job.dataset_id)
    previous_schema = dict(latest.schema) if latest else None
    diff_resp = (
        _diff_to_response(job.dataset_id, compute_diff(latest.schema, inferred))
        if latest
        else None
    )

    return StagedPreviewResponse(
        columns=list(df.columns),
        dataset_schema=inferred,
        sample_rows=sample_rows,
        previous_schema=previous_schema,
        diff=diff_resp,
    )


# ── Transform op catalog ───────────────────────────────────────────────────────

@router.get("/transforms/ops")
async def list_ops():
    """Return the canonical transform op catalog for UI rendering."""
    return OPS_CATALOG


# ── Transform preview ──────────────────────────────────────────────────────────

@router.post("/transforms/preview", response_model=TransformPreviewResponse)
async def transform_preview(
    payload: TransformPreviewRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Apply transform steps to a sampled table and return the result.

    Used by the frontend when the user clicks "Apply" to see updated results,
    or when a step's local apply() is unavailable. Join steps resolve + authorize
    the referenced dataset (unauthorized/missing → 404) and read the right side
    (capped at 100k rows for preview) via DuckDB.
    """
    df = pd.DataFrame(payload.rows, columns=payload.columns)
    steps_dicts = [
        s.model_dump() if hasattr(s, "model_dump") else s for s in payload.steps
    ]

    # Resolve + authorize any join right datasets before applying (404 propagates).
    join_sources = resolve_join_sources(db, payload.steps, owner_id=user["sub"])

    def join_loader(step):
        from infrastructure.duckdb import connect, s3_uri
        path = join_sources[str(step.dataset_id)]
        con = connect()
        try:
            return con.execute(
                f"SELECT * FROM read_parquet('{s3_uri(path)}') LIMIT 100000"
            ).df()
        finally:
            con.close()

    try:
        result = apply_transforms(df, steps_dicts, join_loader=join_loader)
        rows = result.where(result.notna(), None).values.tolist()
        return TransformPreviewResponse(
            columns=list(result.columns),
            rows=rows,
        )
    except TransformStepError as e:
        return TransformPreviewResponse(
            columns=payload.columns,
            rows=payload.rows,
            errors={e.step_index: str(e)},
        )
    except Exception as e:
        return TransformPreviewResponse(
            columns=payload.columns,
            rows=payload.rows,
            errors={0: str(e)},
        )


# ── Commit an import (apply transform plan + run pipeline) ─────────────────────


@router.post("/jobs/{job_id}/commit", response_model=IngestionJobResponse)
async def commit_job(
    job_id: uuid.UUID,
    payload: CommitJobRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Persist the user's transform plan and dispatch the pipeline to write the version."""
    job = assert_job_owned(db, job_id, owner_id=user["sub"])
    if job.status != JobStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job is not awaiting commit (status={job.status.value})",
        )

    # mode="json": join steps carry a uuid.UUID dataset_id — plain model_dump() leaves
    # it as a UUID object, which the JSONB column's json.dumps can't serialize.
    repo.set_transform_plan(db, job_id, [s.model_dump(mode="json") for s in payload.transforms])
    run_ingestion_pipeline.delay(str(job_id))
    return _job_to_response(repo.get_job(db, job_id))


# ── Ad-hoc combine of existing datasets (no fresh import required) ─────────────


@router.post(
    "/jobs/combine", response_model=IngestionJobResponse, status_code=status.HTTP_202_ACCEPTED
)
async def combine_datasets(
    payload: CombineDatasetsRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Join one or more owned datasets against a primary dataset and save the
    result as a new (or existing) dataset — reuses the same background pipeline
    as an import commit, so it scales identically."""
    job = create_combine_job(db, payload, owner_id=user["sub"])
    run_ingestion_pipeline.delay(str(job.id))
    return _job_to_response(job)


# ── Submit schema resolution ──────────────────────────────────────────────────

@router.post("/jobs/{job_id}/resolve", response_model=IngestionJobResponse)
async def resolve_schema(
    job_id: uuid.UUID,
    payload: ResolveSchemaMappingRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    assert_job_owned(db, job_id, owner_id=user["sub"])
    job = resolve_schema_mapping(db, job_id, payload)
    return _job_to_response(job)


# ── List dataset versions ─────────────────────────────────────────────────────

@router.get("/datasets", response_model=list[DatasetResponse])
async def list_datasets(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    assert_workspace_owned(db, workspace_id, owner_id=user["sub"])
    datasets = repo.list_datasets(db, workspace_id)
    result = []
    for ds in datasets:
        versions = repo.list_versions(db, ds.id)
        latest = versions[-1] if versions else None
        result.append(
            DatasetResponse(
                id=ds.id,
                workspace_id=ds.workspace_id,
                name=ds.name,
                description=ds.description,
                source_type=ds.source_type,
                created_at=ds.created_at,
                version_count=len(versions),
                latest_row_count=latest.row_count if latest else None,
                latest_file_size=latest.file_size if latest else None,
            )
        )
    return result


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: uuid.UUID,
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from infrastructure.blob.minio_client import delete_object

    assert_workspace_owned(db, workspace_id, owner_id=user["sub"])
    assert_dataset_owned(db, dataset_id, owner_id=user["sub"])

    storage_paths = repo.delete_dataset(db, dataset_id, workspace_id)
    if not storage_paths and not repo.get_dataset(db, dataset_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
        )
    for path in storage_paths:
        try:
            delete_object(path)
        except Exception:
            pass


@router.get(
    "/datasets/{dataset_id}/versions",
    response_model=list[DatasetVersionResponse],
    # Serialize by field name so the JSON key is `dataset_schema` (the field aliases
    # `schema` only for reading the ORM attribute). Matches the frontend + preview endpoint.
    response_model_by_alias=False,
)
async def list_versions(
    dataset_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    assert_dataset_owned(db, dataset_id, owner_id=user["sub"])
    versions = repo.list_versions(db, dataset_id)
    return [DatasetVersionResponse.model_validate(v) for v in versions]


# ── Data lineage (single-hop; frontend recurses for multi-hop) ─────────────────


@router.get("/datasets/{dataset_id}/lineage", response_model=DatasetLineageResponse)
async def get_dataset_lineage(
    dataset_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Where this dataset originally came from (source_type + origin_detail, e.g. a DB
    table name) plus any join steps in the job that produced its latest version. Only
    the immediate join sources — the frontend calls this again per source dataset_id
    to walk further back and render a multi-hop lineage graph."""
    dataset = assert_dataset_owned(db, dataset_id, owner_id=user["sub"])
    latest = repo.get_latest_version(db, dataset_id)
    job = repo.get_latest_success_job(db, dataset_id)
    first_job = repo.get_first_success_job(db, dataset_id)

    # Table name only — never expose credentials, even though the password field
    # is encrypted at rest, this endpoint has no reason to touch it.
    origin_detail = (
        (first_job.source_config or {}).get("table") if first_job and first_job.source_config else None
    )

    sources: list[LineageSource] = []
    transforms = (job.source_config or {}).get("_transforms") if job else None
    for step in transforms or []:
        if (step or {}).get("type") != "join":
            continue
        src_id = step.get("dataset_id")
        if not src_id:
            continue
        src_dataset = repo.get_dataset(db, uuid.UUID(str(src_id)))
        if not src_dataset:
            continue
        sources.append(LineageSource(
            dataset_id=src_dataset.id,
            dataset_name=src_dataset.name,
            how=step.get("how", "inner"),
            left_on=step.get("left_on", ""),
            right_on=step.get("right_on", ""),
        ))

    return DatasetLineageResponse(
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        source_type=dataset.source_type,
        origin_detail=origin_detail,
        version=latest.version if latest else None,
        sources=sources,
    )


# ── Get latest schema / diff ──────────────────────────────────────────────────


@router.get("/datasets/{dataset_id}/schema", response_model=SchemaDiffResponse)
async def get_schema_diff(
    dataset_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    assert_dataset_owned(db, dataset_id, owner_id=user["sub"])
    versions = repo.list_versions(db, dataset_id)
    if not versions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No versions found for dataset",
        )

    # If an ingestion is awaiting schema resolution, diff the latest committed
    # version against the *incoming* (pending) schema — that is what the user resolves.
    pending_job = repo.get_latest_pending_job(db, dataset_id)
    pending_schema = (
        pending_job.source_config.get("_pending_schema")
        if pending_job and pending_job.source_config
        else None
    )
    if pending_schema:
        diff = compute_diff(versions[-1].schema, pending_schema)
    elif len(versions) == 1:
        return SchemaDiffResponse(
            dataset_id=dataset_id,
            has_diff=False,
            added_columns=[],
            missing_columns=[],
            type_changes=[],
            suggested_mappings=[],
        )
    else:
        prev, latest = versions[-2], versions[-1]
        diff = compute_diff(prev.schema, latest.schema)

    return SchemaDiffResponse(
        dataset_id=dataset_id,
        has_diff=diff.has_diff,
        added_columns=diff.added_columns,
        missing_columns=diff.missing_columns,
        type_changes=[
            ColumnDiff(
                column=c["column"],
                old_type=c["old_type"],
                new_type=c["new_type"],
            )
            for c in diff.type_changes
        ],
        suggested_mappings=[
            ColumnDiff(
                column=s["column"],
                suggested_target=s["suggested_target"],
            )
            for s in diff.suggested_mappings
        ],
    )
