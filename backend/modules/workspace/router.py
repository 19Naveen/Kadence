import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_user
from infrastructure.blob.minio_client import delete_prefix
from modules.ingestion import repository as ingest_repo
from modules.workspace import repository as repo
from modules.workspace.schemas import CreateWorkspaceRequest, WorkspaceResponse

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
def create_workspace(
    payload: CreateWorkspaceRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    ws = repo.create_workspace(db, owner_id=user["sub"], name=payload.name, description=payload.description)
    return ws


@router.get("", response_model=list[WorkspaceResponse])
def list_workspaces(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return repo.list_workspaces(db, owner_id=user["sub"])


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if not repo.get_workspace(db, workspace_id, user["sub"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    # datasets.workspace_id has no FK, so cascade by hand: rows first, then stored objects.
    for dataset in ingest_repo.list_datasets(db, workspace_id):
        ingest_repo.delete_dataset(db, dataset.id, workspace_id)
    repo.delete_workspace(db, workspace_id, owner_id=user["sub"])
    try:
        delete_prefix(f"{workspace_id}/")
    except Exception:
        pass  # DB is already consistent; leftover objects are unreachable, not user-visible
