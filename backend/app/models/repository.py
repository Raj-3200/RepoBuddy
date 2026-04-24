"""Repository and analysis-related models."""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

# ────────────────────────── Enums ──────────────────────────


class RepositorySource(str, enum.Enum):
    UPLOAD = "upload"
    GITHUB = "github"


class AnalysisStatus(str, enum.Enum):
    PENDING = "pending"
    CLONING = "cloning"
    SCANNING = "scanning"
    PARSING = "parsing"
    BUILDING_GRAPH = "building_graph"
    COMPUTING_INSIGHTS = "computing_insights"
    GENERATING_DOCS = "generating_docs"
    INDEXING = "indexing"
    COMPLETED = "completed"
    FAILED = "failed"


class SymbolType(str, enum.Enum):
    FUNCTION = "function"
    CLASS = "class"
    METHOD = "method"
    VARIABLE = "variable"
    INTERFACE = "interface"
    TYPE_ALIAS = "type_alias"
    ENUM = "enum"
    CONSTANT = "constant"
    EXPORT = "export"


class EdgeType(str, enum.Enum):
    IMPORTS = "imports"
    EXPORTS = "exports"
    CALLS = "calls"
    EXTENDS = "extends"
    IMPLEMENTS = "implements"
    DEPENDS_ON = "depends_on"
    CONTAINS = "contains"


# ────────────────────────── Repository ──────────────────────────


class Repository(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "repositories"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source: Mapped[RepositorySource] = mapped_column(
        Enum(RepositorySource, native_enum=False), nullable=False
    )
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    local_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    detected_framework: Mapped[str | None] = mapped_column(String(100), nullable=True)
    owner_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Relationships
    analyses: Mapped[list[Analysis]] = relationship(
        back_populates="repository", cascade="all, delete-orphan"
    )
    files: Mapped[list[RepoFile]] = relationship(
        back_populates="repository", cascade="all, delete-orphan"
    )


# ────────────────────────── Analysis ──────────────────────────


class Analysis(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "analyses"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[AnalysisStatus] = mapped_column(
        Enum(AnalysisStatus, native_enum=False), nullable=False, default=AnalysisStatus.PENDING
    )
    current_step: Mapped[str | None] = mapped_column(String(255), nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Summary data
    total_files: Mapped[int] = mapped_column(Integer, default=0)
    total_functions: Mapped[int] = mapped_column(Integer, default=0)
    total_classes: Mapped[int] = mapped_column(Integer, default=0)
    total_lines: Mapped[int] = mapped_column(Integer, default=0)
    summary_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    onboarding_doc: Mapped[str | None] = mapped_column(Text, nullable=True)
    architecture_doc: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    repository: Mapped[Repository] = relationship(back_populates="analyses")
    symbols: Mapped[list[Symbol]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )
    edges: Mapped[list[DependencyEdge]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )
    insights: Mapped[list[Insight]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )


# ────────────────────────── RepoFile ──────────────────────────


class RepoFile(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "repo_files"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    path: Mapped[str] = mapped_column(String(2048), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    extension: Mapped[str | None] = mapped_column(String(50), nullable=True)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    line_count: Mapped[int] = mapped_column(Integer, default=0)
    is_entry_point: Mapped[bool] = mapped_column(Boolean, default=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    repository: Mapped[Repository] = relationship(back_populates="files")


# ────────────────────────── Symbol ──────────────────────────


class Symbol(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "symbols"

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    name: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    symbol_type: Mapped[SymbolType] = mapped_column(
        Enum(SymbolType, native_enum=False), nullable=False
    )
    line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    line_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    docstring: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_exported: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    analysis: Mapped[Analysis] = relationship(back_populates="symbols")


# ────────────────────────── DependencyEdge ──────────────────────────


class DependencyEdge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "dependency_edges"

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    target_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    edge_type: Mapped[EdgeType] = mapped_column(Enum(EdgeType, native_enum=False), nullable=False)
    source_symbol: Mapped[str | None] = mapped_column(String(512), nullable=True)
    target_symbol: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    analysis: Mapped[Analysis] = relationship(back_populates="edges")


# ────────────────────────── Insight ──────────────────────────


class Insight(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "insights"

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    affected_files: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    analysis: Mapped[Analysis] = relationship(back_populates="insights")


# ────────────────────────── SemanticChunk (for pgvector) ──────────────────────────


class SemanticChunk(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "semantic_chunks"

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    chunk_type: Mapped[str] = mapped_column(String(50), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    symbol_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    line_end: Mapped[int] = mapped_column(Integer, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # embedding vector added via pgvector Column in migration
