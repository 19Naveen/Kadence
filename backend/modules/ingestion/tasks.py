import uuid

from celery_app import celery_app
from core.database import SessionLocal
from modules.ingestion import repository as repo
from modules.ingestion.engine.select import select_engine
from modules.ingestion.enums import JobStatus
from modules.ingestion.transforms import TransformStepError


def _read_parquet_sources(join_sources: dict[str, str]) -> dict[str, str]:
    """{dataset_id: storage_path} -> {dataset_id: read_parquet('s3://…') relation}."""
    from infrastructure.duckdb import s3_uri
    return {k: f"read_parquet('{s3_uri(v)}')" for k, v in join_sources.items()}


def _make_join_loader(join_sources: dict[str, str]):
    """Pandas-path loader: read the full right dataset (uncapped) via DuckDB."""
    from infrastructure.duckdb import connect, s3_uri

    def loader(step):
        con = connect()
        try:
            return con.execute(
                f"SELECT * FROM read_parquet('{s3_uri(join_sources[str(step.dataset_id)])}')"
            ).df()
        finally:
            con.close()

    return loader


def _locate_failing_step(job, transforms: list, join_sources=None) -> tuple[int, str]:
    """Find which step a DuckDB plan failed on by validating growing prefixes.

    Runs each prefix under ``LIMIT 0`` (cheap: binds/type-checks without scanning),
    returning (step_index, message) for the first prefix that errors. Row-level
    execution errors that only surface on a full scan aren't localizable this way —
    those are attributed to the last step. ponytail: LIMIT-0 catches compile/type
    errors (the common case); full per-prefix scans would be O(n·data) on failure.
    """
    from infrastructure.duckdb import connect
    from modules.ingestion.engine.duckdb_engine import _source_relation
    from modules.ingestion.engine.sql_compiler import compile_plan

    from modules.ingestion.engine.duckdb_engine import _describe

    con = connect()
    try:
        source_rel = _source_relation(con, job)
        for k in range(1, len(transforms) + 1):
            sql = compile_plan(
                transforms[:k], source_rel,
                join_sources=_read_parquet_sources(join_sources or {}),
                describe=_describe(con),
            )
            try:
                con.execute(f"SELECT * FROM ({sql}) LIMIT 0")
            except Exception as exc:
                return k - 1, str(exc)
    except Exception:
        pass
    finally:
        con.close()
    return max(len(transforms) - 1, 0), "transform execution failed"


@celery_app.task(bind=True, max_retries=0, name="ingestion.run_pipeline")
def run_ingestion_pipeline(self, job_id: str):
    db = SessionLocal()
    try:
        job = repo.get_job(db, uuid.UUID(job_id))
        if not job:
            return {"error": f"Job {job_id} not found"}

        # Capture staging_path before any DB refresh so delete still works
        staging_path = job.staging_path

        repo.update_job_status(db, job.id, JobStatus.RUNNING)
        db.refresh(job)

        dataset = repo.get_dataset(db, job.dataset_id)

        latest_version = repo.get_latest_version(db, job.dataset_id)
        next_version = (latest_version.version + 1) if latest_version else 1

        # Storage layout (inside bucket 'datasets'): {workspace_id}/{dataset_id}/raw/v{n}/data.parquet
        storage_path = f"{dataset.workspace_id}/{dataset.id}/raw/v{next_version}/data.parquet"

        # Transform plan the user built in the import wizard (Pipeline Studio).
        transforms = (job.source_config or {}).get("_transforms") or []

        # Re-resolve + re-authorize any join right datasets at run time (guards
        # TOCTOU deletion since the commit endpoint authorized). Fails the job
        # cleanly on a missing/unauthorized dataset.
        join_sources: dict[str, str] = {}
        if any((s or {}).get("type") == "join" for s in transforms):
            from modules.ingestion.service import resolve_join_sources
            from modules.workspace.models import Workspace
            owner_id = (
                db.query(Workspace.owner_id)
                .filter(Workspace.id == dataset.workspace_id)
                .scalar()
            )
            join_sources = resolve_join_sources(db, transforms, owner_id)

        engine = select_engine(job.staging_metadata)

        if "run" in engine:
            # Fused DuckDB path: one SQL execution loads, transforms, and writes.
            try:
                stats = engine["run"](
                    job, transforms, storage_path,
                    join_sources=_read_parquet_sources(join_sources),
                )
            except Exception as exc:
                step_index, msg = _locate_failing_step(job, transforms, join_sources)
                raise TransformStepError(step_index, msg) from exc
            version_stats = {
                "row_count": stats["row_count"],
                "column_count": stats["column_count"],
                "schema": stats["schema"],
                "file_size": stats["file_size"],
            }
        else:
            # Per-key pandas path (exact parity with the live preview).
            df = engine["load_source"](job)
            if transforms:
                if join_sources:
                    df = engine["apply_transforms"](
                        df, transforms, join_loader=_make_join_loader(join_sources)
                    )
                else:
                    df = engine["apply_transforms"](df, transforms)
            version_stats = {
                "row_count": engine["row_count"](df),
                "column_count": engine["column_count"](df),
                "schema": engine["infer_schema"](df),
                "file_size": engine["write_parquet"](df, storage_path),
            }

        repo.create_dataset_version(db, {
            "dataset_id": job.dataset_id,
            "version": next_version,
            "storage_path": storage_path,
            **version_stats,
        })

        repo.update_job_status(db, job.id, JobStatus.SUCCESS)

        # Delete staging file after marking SUCCESS so the path is still known.
        # Guard against combine jobs, whose "staging_path" is actually a permanent
        # source dataset's version file (see service.create_combine_job) — only
        # real ephemeral uploads live under .../staging/....
        if staging_path and "/staging/" in staging_path:
            try:
                from infrastructure.blob.minio_client import delete_object
                delete_object(staging_path)
            except Exception:
                pass

        return {"status": "SUCCESS", "storage_path": storage_path, "version": next_version}

    except Exception as exc:
        repo.update_job_status(db, job.id, JobStatus.FAILED, error_message=str(exc))
        raise
    finally:
        db.close()
