"""Reusable ownership guards for ingestion resources.

Ownership chain: IngestionJob.dataset_id -> Dataset.workspace_id -> Workspace.owner_id.
All guards raise 404 (never 403) on a mismatch so a caller cannot distinguish
"doesn't exist" from "exists but isn't yours".
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from modules.ingestion import repository as repo
from modules.ingestion.models import Dataset, IngestionJob
from modules.workspace.repository import get_workspace


def assert_dataset_owned(db: Session, dataset_id: uuid.UUID, owner_id: str) -> Dataset:
    """Return the Dataset if it exists and its workspace is owned by owner_id, else 404."""
    dataset = repo.get_dataset(db, dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
        )
    workspace = get_workspace(db, dataset.workspace_id, owner_id=owner_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
        )
    return dataset


def assert_job_owned(db: Session, job_id: uuid.UUID, owner_id: str) -> IngestionJob:
    """Return the IngestionJob if it exists and (via its dataset's workspace) is owned
    by owner_id, else 404."""
    job = repo.get_job(db, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Job not found"
        )
    assert_dataset_owned(db, job.dataset_id, owner_id)
    return job


def assert_workspace_owned(db: Session, workspace_id: uuid.UUID, owner_id: str):
    """Return the Workspace if owned by owner_id, else 404."""
    workspace = get_workspace(db, workspace_id, owner_id=owner_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )
    return workspace
