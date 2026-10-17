import uuid

from celery_app import celery_app
from core.database import SessionLocal
from modules.ingestion import repository as repo
from modules.ingestion.engine.select import select_engine
from modules.ingestion.enums import JobStatus


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

        engine = select_engine(job.staging_metadata)
        df = engine["load_source"](job)

        # Apply the transform plan the user built in the import wizard (DataForge).
        transforms = (job.source_config or {}).get("_transforms") or []
        if transforms:
            df = engine["apply_transforms"](df, transforms)

        inferred_schema = engine["infer_schema"](df)

        latest_version = repo.get_latest_version(db, job.dataset_id)
        next_version = (latest_version.version + 1) if latest_version else 1

        # Storage layout (inside bucket 'datasets'): {workspace_id}/{dataset_id}/raw/v{n}/data.parquet
        storage_path = f"{dataset.workspace_id}/{dataset.id}/raw/v{next_version}/data.parquet"

        file_size = engine["write_parquet"](df, storage_path)

        repo.create_dataset_version(db, {
            "dataset_id": job.dataset_id,
            "version": next_version,
            "storage_path": storage_path,
            "row_count": engine["row_count"](df),
            "column_count": engine["column_count"](df),
            "schema": inferred_schema,
            "file_size": file_size,
        })

        repo.update_job_status(db, job.id, JobStatus.SUCCESS)

        # Delete staging file after marking SUCCESS so the path is still known
        if staging_path:
            try:
                from modules.ingestion.storage.minio_client import delete_object
                delete_object(staging_path)
            except Exception:
                pass

        return {"status": "SUCCESS", "storage_path": storage_path, "version": next_version}

    except Exception as exc:
        repo.update_job_status(db, job.id, JobStatus.FAILED, error_message=str(exc))
        raise
    finally:
        db.close()
