"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgvector extension is created later (conditionally)

    # ── repositories ──
    op.create_table(
        "repositories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, index=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("url", sa.String(2048), nullable=True),
        sa.Column("local_path", sa.String(1024), nullable=False),
        sa.Column("default_branch", sa.String(255), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("detected_language", sa.String(50), nullable=True),
        sa.Column("detected_framework", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── analyses ──
    op.create_table(
        "analyses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(30), nullable=False, default="pending"),
        sa.Column("current_step", sa.String(255), nullable=True),
        sa.Column("progress", sa.Integer, default=0),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("total_files", sa.Integer, default=0),
        sa.Column("total_functions", sa.Integer, default=0),
        sa.Column("total_classes", sa.Integer, default=0),
        sa.Column("total_lines", sa.Integer, default=0),
        sa.Column("summary_json", JSONB, nullable=True),
        sa.Column("onboarding_doc", sa.Text, nullable=True),
        sa.Column("architecture_doc", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── repo_files ──
    op.create_table(
        "repo_files",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("path", sa.String(2048), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("extension", sa.String(50), nullable=True),
        sa.Column("language", sa.String(50), nullable=True),
        sa.Column("size_bytes", sa.Integer, default=0),
        sa.Column("line_count", sa.Integer, default=0),
        sa.Column("is_entry_point", sa.Boolean, default=False),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── symbols ──
    op.create_table(
        "symbols",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("file_path", sa.String(2048), nullable=False),
        sa.Column("name", sa.String(512), nullable=False, index=True),
        sa.Column("symbol_type", sa.String(30), nullable=False),
        sa.Column("line_start", sa.Integer, nullable=False),
        sa.Column("line_end", sa.Integer, nullable=True),
        sa.Column("signature", sa.Text, nullable=True),
        sa.Column("docstring", sa.Text, nullable=True),
        sa.Column("is_exported", sa.Boolean, default=False),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── dependency_edges ──
    op.create_table(
        "dependency_edges",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_path", sa.String(2048), nullable=False),
        sa.Column("target_path", sa.String(2048), nullable=False),
        sa.Column("edge_type", sa.String(30), nullable=False),
        sa.Column("source_symbol", sa.String(512), nullable=True),
        sa.Column("target_symbol", sa.String(512), nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── insights ──
    op.create_table(
        "insights",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("category", sa.String(100), nullable=False, index=True),
        sa.Column("severity", sa.String(50), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("affected_files", JSONB, nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── semantic_chunks ──
    op.create_table(
        "semantic_chunks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("file_path", sa.String(2048), nullable=False),
        sa.Column("chunk_type", sa.String(50), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("symbol_name", sa.String(512), nullable=True),
        sa.Column("line_start", sa.Integer, nullable=False),
        sa.Column("line_end", sa.Integer, nullable=False),
        sa.Column("token_count", sa.Integer, default=0),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Add embedding vector column via raw SQL (pgvector) — optional
    from sqlalchemy import text
    conn = op.get_bind()
    try:
        conn.execute(text("SAVEPOINT pgvector_check"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text("RELEASE SAVEPOINT pgvector_check"))
        conn.execute(text("ALTER TABLE semantic_chunks ADD COLUMN embedding vector(1536)"))
        conn.execute(text("CREATE INDEX idx_semantic_chunks_embedding ON semantic_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"))
    except Exception:
        conn.execute(text("ROLLBACK TO SAVEPOINT pgvector_check"))
        # pgvector not installed — semantic search embeddings will be unavailable


def downgrade() -> None:
    op.drop_table("semantic_chunks")
    op.drop_table("insights")
    op.drop_table("dependency_edges")
    op.drop_table("symbols")
    op.drop_table("repo_files")
    op.drop_table("analyses")
    op.drop_table("repositories")
