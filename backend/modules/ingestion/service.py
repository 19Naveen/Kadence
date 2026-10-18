import uuid

from core.crypto import encrypt_secret
from fastapi import HTTPException, status
from modules.ingestion import repository as repo
from modules.ingestion.enums import JobStatus, SourceType, TransformType
from modules.ingestion.schemas import (
    CombineDatasetsRequest,
    CreateIngestionJobRequest,
    LineageGraphEdge,
    LineageGraphModel,
    LineageGraphNode,
    LineageGraphResponse,
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
    """Resolve every step's other dataset (any step with a `dataset_id`: join,
    append) to its latest-version storage_path, enforcing that the caller owns each
    dataset's workspace chain.

    Returns {dataset_id_str: storage_path}. Unauthorized or missing datasets raise
    404 "Dataset not found" (no info leak). Plans without such steps resolve to {}
    without touching the DB.
    """
    from modules.ingestion.auth import assert_dataset_owned
    from modules.ingestion.transforms import _coerce

    result: dict[str, str] = {}
    for step in steps:
        step = _coerce(step)
        if getattr(step, "dataset_id", None) is None:
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
            # _primary_dataset_id records the base so lineage can show it and the
            # model can be rebuilt later (`_` keys are pipeline state, ignored by connectors).
            "source_config": {
                "_transforms": [s.model_dump(mode="json") for s in payload.transforms],
                "_primary_dataset_id": str(primary.id),
            },
            "staging_path": primary_latest.storage_path,
            "staging_metadata": {
                "file_size": primary_latest.file_size,
                "row_count": primary_latest.row_count,
                "column_count": primary_latest.column_count,
                "source_format": "parquet",
            },
        },
    )


def job_recipe(job) -> tuple[str | None, list[dict]]:
    """(base dataset id as recorded, transform steps) from a job's source_config.
    The base is None for imports and for datasets combined before it was recorded."""
    config = (job.source_config or {}) if job else {}
    return config.get("_primary_dataset_id"), config.get("_transforms") or []


def is_model(base_id: str | None, steps: list[dict]) -> bool:
    """A model is built from other datasets: a recorded base or any join / append step."""
    return bool(base_id) or any((s or {}).get("type") in ("join", "append") for s in steps)


def build_lineage_graph(db: Session, workspace_id: uuid.UUID) -> LineageGraphResponse:
    """Whole-workspace lineage DAG for the Models screen: one node per dataset with at
    least one version, one edge per base / join / append input that is itself a node
    (deleted or other-workspace inputs are skipped; so are self-edges). Ownership of
    the workspace must be checked by the caller."""
    datasets = repo.list_datasets(db, workspace_id)
    ids = [ds.id for ds in datasets]
    latest_versions = repo.get_latest_versions(db, ids)
    first_jobs: dict = {}
    latest_jobs: dict = {}
    for job in repo.list_success_jobs(db, ids):  # oldest first
        first_jobs.setdefault(job.dataset_id, job)
        latest_jobs[job.dataset_id] = job

    datasets = [ds for ds in datasets if ds.id in latest_versions]
    node_ids = {str(ds.id) for ds in datasets}
    nodes: list[LineageGraphNode] = []
    edges: list[LineageGraphEdge] = []
    for ds in datasets:
        version = latest_versions[ds.id]
        first_job, job = first_jobs.get(ds.id), latest_jobs.get(ds.id)
        base_id, steps = job_recipe(job)
        target = str(ds.id)

        model = None
        if is_model(base_id, steps):
            visible_base = base_id if base_id in node_ids else None
            model = LineageGraphModel(
                base_dataset_id=visible_base,
                steps=steps,
                built_at=job.updated_at or job.created_at,
            )
            if visible_base and visible_base != target:
                edges.append(LineageGraphEdge(source=visible_base, target=target, role="base"))
            for step in steps:
                kind = (step or {}).get("type")
                src = str(step.get("dataset_id")) if kind in ("join", "append") else None
                if src not in node_ids or src == target:
                    continue
                edges.append(LineageGraphEdge(
                    source=src, target=target, role=kind,
                    how=step.get("how", "inner") if kind == "join" else None,
                    left_on=step.get("left_on") if kind == "join" else None,
                    right_on=step.get("right_on") if kind == "join" else None,
                ))

        # Table name only — never credentials (see get_dataset_lineage).
        first_config = (first_job.source_config or {}) if first_job else {}
        nodes.append(LineageGraphNode(
            id=ds.id,
            name=ds.name,
            source_type=ds.source_type,
            kind="model" if model else "source",
            row_count=version.row_count,
            column_count=version.column_count,
            version=version.version,
            updated_at=version.created_at,
            origin_detail=first_config.get("table"),
            model=model,
        ))
    return LineageGraphResponse(nodes=nodes, edges=edges)


def create_rebuild_job(
    db: Session, dataset_id: uuid.UUID, workspace_id: uuid.UUID, owner_id: str
) -> IngestionJob:
    """Re-run a model's recorded recipe (base + steps from its latest successful job)
    on the latest versions of its inputs, saved as a new version of the same dataset.
    Goes through create_combine_job, so every referenced dataset is ownership-checked.
    The caller dispatches the returned job."""
    from pydantic import ValidationError

    from modules.ingestion.auth import assert_dataset_owned, assert_workspace_owned

    def bad_request(detail: str) -> HTTPException:
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    assert_workspace_owned(db, workspace_id, owner_id)
    dataset = assert_dataset_owned(db, dataset_id, owner_id)
    if dataset.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")

    base_id, steps = job_recipe(repo.get_latest_success_job(db, dataset_id))
    if not is_model(base_id, steps):
        raise bad_request("This dataset is not a model, so there is nothing to rebuild")
    if not base_id:
        raise bad_request(
            "This dataset was combined before its base was recorded; open it in "
            "Pipeline Studio and save it again to enable rebuilds"
        )
    if base_id == str(dataset_id):
        # Re-applying the steps to the current version would apply them twice.
        raise bad_request(
            "This dataset's steps were applied on top of its own previous version, "
            "so it can't be rebuilt from its inputs"
        )
    if not repo.get_dataset(db, uuid.UUID(base_id)):
        raise bad_request("This model's base dataset no longer exists, so it can't be rebuilt")

    try:
        payload = CombineDatasetsRequest(
            workspace_id=workspace_id,
            primary_dataset_id=base_id,
            transforms=steps,
            target_dataset_id=dataset_id,
        )
    except ValidationError:
        raise bad_request("This model's saved steps are no longer valid; open it in Pipeline Studio and save it again")
    return create_combine_job(db, payload, owner_id)


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
