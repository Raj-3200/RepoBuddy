"""Repository and analysis schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, field_validator
import re


# ────────────────────────── Repository ──────────────────────────


class RepositoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: str | None = None

    @field_validator("url")
    @classmethod
    def validate_github_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        pattern = r"^https://github\.com/[\w\-\.]+/[\w\-\.]+(?:\.git)?$"
        if not re.match(pattern, v):
            raise ValueError("Must be a valid GitHub repository URL (https://github.com/owner/repo)")
        return v


class RepositoryResponse(BaseModel):
    id: UUID
    name: str
    source: str
    url: str | None
    description: str | None
    detected_language: str | None
    detected_framework: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RepositoryListResponse(BaseModel):
    items: list[RepositoryResponse]
    total: int


# ────────────────────────── Analysis ──────────────────────────


class AnalysisResponse(BaseModel):
    id: UUID
    repository_id: UUID
    status: str
    current_step: str | None
    progress: int
    error_message: str | None
    total_files: int
    total_functions: int
    total_classes: int
    total_lines: int
    summary_json: dict | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AnalysisProgressResponse(BaseModel):
    status: str
    current_step: str | None
    progress: int
    error_message: str | None


# ────────────────────────── File ──────────────────────────


class FileResponse(BaseModel):
    id: UUID
    path: str
    name: str
    extension: str | None
    language: str | None
    size_bytes: int
    line_count: int
    is_entry_point: bool

    model_config = {"from_attributes": True}


class FileDetailResponse(FileResponse):
    content: str | None = None
    symbols: list["SymbolResponse"] = []
    imports: list[str] = []
    dependents: list[str] = []
    dependencies: list[str] = []


class FileTreeNode(BaseModel):
    id: UUID | None = None
    name: str
    path: str
    is_directory: bool
    children: list["FileTreeNode"] = []
    extension: str | None = None
    size_bytes: int = 0


# ────────────────────────── Symbol ──────────────────────────


class SymbolResponse(BaseModel):
    id: UUID
    file_path: str
    name: str
    symbol_type: str
    line_start: int
    line_end: int | None
    signature: str | None
    is_exported: bool

    model_config = {"from_attributes": True}


# ────────────────────────── Edge ──────────────────────────


class EdgeResponse(BaseModel):
    id: UUID
    source_path: str
    target_path: str
    edge_type: str
    source_symbol: str | None
    target_symbol: str | None

    model_config = {"from_attributes": True}


# ────────────────────────── Insight ──────────────────────────


class InsightResponse(BaseModel):
    id: UUID
    category: str
    severity: str
    title: str
    description: str
    affected_files: list[str] | None

    model_config = {"from_attributes": True}


class InsightListResponse(BaseModel):
    items: list[InsightResponse]
    total: int


# ────────────────────────── Graph ──────────────────────────


class GraphNode(BaseModel):
    id: str
    label: str
    type: str  # file, function, class, module
    metadata: dict = {}


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str
    label: str | None = None


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    metadata: dict = {}


class GraphNeighborhoodRequest(BaseModel):
    node_id: str
    depth: int = Field(default=1, ge=1, le=3)
    edge_types: list[str] | None = None


# ────────────────────────── Dashboard ──────────────────────────


class DashboardResponse(BaseModel):
    repository: RepositoryResponse
    analysis: AnalysisResponse | None
    file_count: int
    function_count: int
    class_count: int
    total_lines: int
    detected_framework: str | None
    top_modules: list[dict] = []
    central_files: list[dict] = []
    risk_summary: dict = {}
    cycle_count: int = 0


# ────────────────────────── Documentation ──────────────────────────


class DocumentationResponse(BaseModel):
    onboarding_doc: str | None
    architecture_doc: str | None
    key_modules: list[dict] = []
