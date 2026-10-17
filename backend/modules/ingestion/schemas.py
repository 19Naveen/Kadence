import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from modules.ingestion.transforms import TransformStep


ColumnType = Literal["string", "integer", "decimal", "boolean", "timestamp"]


class DatasetResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str | None
    source_type: str
    created_at: datetime
    version_count: int = 0
    latest_row_count: int | None = None
    latest_file_size: int | None = None

    model_config = {"from_attributes": True}


class PostgresSourceConfig(BaseModel):
    host: str
    port: int = 5432
    database: str
    user: str
    password: str
    table: str
    query: str | None = None


class CreateIngestionJobRequest(BaseModel):
    dataset_id: uuid.UUID
    dataset_name: str = Field(min_length=1, max_length=255)
    workspace_id: uuid.UUID
    source_type: Literal["csv", "xlsx", "parquet", "postgres", "snowflake", "mysql", "mssql"]
    db_config: PostgresSourceConfig | None = None
    description: str | None = None

    @model_validator(mode="after")
    def validate_db_config(self) -> "CreateIngestionJobRequest":
        db_sources = {"postgres", "snowflake", "mysql", "mssql"}
        if self.source_type in db_sources and self.db_config is None:
            raise ValueError("db_config is required for database sources")
        return self


class IngestionJobResponse(BaseModel):
    id: uuid.UUID
    dataset_id: uuid.UUID
    status: str
    source_type: str
    staging_metadata: dict | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ColumnDiff(BaseModel):
    column: str
    old_type: str | None = None
    new_type: str | None = None
    suggested_target: str | None = None


class SchemaDiffResponse(BaseModel):
    dataset_id: uuid.UUID
    has_diff: bool
    added_columns: list[str]
    missing_columns: list[str]
    type_changes: list[ColumnDiff]
    suggested_mappings: list[ColumnDiff]


class MappingRuleRequest(BaseModel):
    source_column: str
    target_column: str | None = None
    transform_type: Literal["map", "drop", "cast"]
    cast_to_type: ColumnType | None = None

    @model_validator(mode="after")
    def validate_rule(self) -> "MappingRuleRequest":
        if self.transform_type == "cast" and self.cast_to_type is None:
            raise ValueError("cast_to_type is required when transform_type is 'cast'")
        if self.transform_type == "drop" and self.target_column is not None:
            raise ValueError("target_column must be None when transform_type is 'drop'")
        return self


class CommitJobRequest(BaseModel):
    """The transform plan the user builds in DataForge, submitted to commit an import."""
    transforms: list[TransformStep] = Field(default_factory=list)


class CombineDatasetsRequest(BaseModel):
    """Ad-hoc combine of an already-imported dataset with others via join steps,
    saved as a new dataset or a new version of an existing one (no fresh import)."""
    workspace_id: uuid.UUID
    primary_dataset_id: uuid.UUID
    transforms: list[TransformStep] = Field(default_factory=list)
    new_dataset_name: str | None = Field(default=None, min_length=1, max_length=255)
    target_dataset_id: uuid.UUID | None = None
    description: str | None = None

    @model_validator(mode="after")
    def validate_target(self) -> "CombineDatasetsRequest":
        if bool(self.new_dataset_name) == bool(self.target_dataset_id):
            raise ValueError("Provide exactly one of new_dataset_name or target_dataset_id")
        return self


class ResolveSchemaMappingRequest(BaseModel):
    rules: list[MappingRuleRequest]
    accept_new_schema: bool = False

    @model_validator(mode="after")
    def validate_resolution(self) -> "ResolveSchemaMappingRequest":
        if not self.rules and not self.accept_new_schema:
            raise ValueError(
                "Provide mapping rules or set accept_new_schema to resolve the schema diff"
            )
        return self


class MappingRuleResponse(BaseModel):
    id: uuid.UUID
    dataset_id: uuid.UUID
    source_column: str
    target_column: str | None = None
    transform_type: str
    cast_to_type: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class StagedPreviewResponse(BaseModel):
    """Sampled preview of a staged (not-yet-committed) ingestion source, for the import wizard."""
    columns: list[str]
    dataset_schema: dict[str, str]
    sample_rows: list[list]
    previous_schema: dict[str, str] | None = None
    diff: SchemaDiffResponse | None = None


class TransformPreviewRequest(BaseModel):
    """Request to preview transforms on a sampled table."""
    columns: list[str]
    rows: list[list]
    steps: list[TransformStep] = Field(default_factory=list)


class TransformPreviewResponse(BaseModel):
    """Result of applying transforms to a sample for preview."""
    columns: list[str]
    rows: list[list]
    errors: dict[int, str] = Field(default_factory=dict)


class LineageSource(BaseModel):
    """One immediate join edge feeding into a dataset's latest version."""
    dataset_id: uuid.UUID
    dataset_name: str
    how: str
    left_on: str
    right_on: str


class DatasetLineageResponse(BaseModel):
    """Single-hop lineage: where this dataset originally came from (source_type +
    origin_detail, e.g. a DB table name) plus the datasets joined into its latest
    version, per the most recent successful ingestion job's transform plan. The
    frontend recurses (calling this endpoint again per source) for a multi-hop graph."""
    dataset_id: uuid.UUID
    dataset_name: str
    source_type: str
    origin_detail: str | None = None
    version: int | None
    sources: list[LineageSource]


class DatasetVersionResponse(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

    id: uuid.UUID
    dataset_id: uuid.UUID
    version: int
    storage_path: str
    row_count: int
    column_count: int
    dataset_schema: dict[str, str] = Field(alias="schema")
    file_size: int
    created_at: datetime
