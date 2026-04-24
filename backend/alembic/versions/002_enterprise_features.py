"""Add enterprise features — teams, webhooks, PR analysis, architecture snapshots, alerts, digests

Revision ID: 002
Revises: 001
Create Date: 2026-04-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── teams ──
    op.create_table(
        "teams",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("avatar_url", sa.String(2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── team_members ──
    op.create_table(
        "team_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.String(255), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("invited_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("team_id", "user_id", name="uq_team_member"),
    )

    # ── team_repositories ──
    op.create_table(
        "team_repositories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("team_id", "repository_id", name="uq_team_repo"),
    )

    # ── webhooks ──
    op.create_table(
        "webhooks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("github_webhook_id", sa.Integer, nullable=True),
        sa.Column("secret", sa.String(255), nullable=False),
        sa.Column("events", JSONB, nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("last_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── webhook_deliveries ──
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("webhook_id", UUID(as_uuid=True), sa.ForeignKey("webhooks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("payload_json", JSONB, nullable=True),
        sa.Column("status_code", sa.Integer, nullable=True),
        sa.Column("processed", sa.Boolean, server_default="false"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── pull_request_analyses ──
    op.create_table(
        "pull_request_analyses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("base_analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pr_number", sa.Integer, nullable=False),
        sa.Column("pr_title", sa.String(512), nullable=False),
        sa.Column("pr_url", sa.String(2048), nullable=False),
        sa.Column("head_branch", sa.String(255), nullable=False),
        sa.Column("base_branch", sa.String(255), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("changed_files", JSONB, nullable=True),
        sa.Column("impact_summary", JSONB, nullable=True),
        sa.Column("risk_score", sa.Integer, server_default="0"),
        sa.Column("risk_report", sa.Text, nullable=True),
        sa.Column("affected_modules", JSONB, nullable=True),
        sa.Column("new_cycles_introduced", JSONB, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── architecture_snapshots ──
    op.create_table(
        "architecture_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("commit_sha", sa.String(40), nullable=True),
        sa.Column("branch", sa.String(255), nullable=True),
        sa.Column("snapshot_data", JSONB, nullable=False),
        sa.Column("drift_from_previous", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── file_ownership ──
    op.create_table(
        "file_ownership",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("file_path", sa.String(2048), nullable=False),
        sa.Column("primary_owner", sa.String(255), nullable=True),
        sa.Column("contributors", JSONB, nullable=True),
        sa.Column("commit_count", sa.Integer, server_default="0"),
        sa.Column("last_modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("churn_score", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── hotspots ──
    op.create_table(
        "hotspots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("analysis_id", UUID(as_uuid=True), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_path", sa.String(2048), nullable=False),
        sa.Column("hotspot_score", sa.Integer, server_default="0"),
        sa.Column("reasons", JSONB, nullable=True),
        sa.Column("recommendation", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── alert_configs ──
    op.create_table(
        "alert_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("alert_type", sa.String(100), nullable=False),
        sa.Column("threshold_json", JSONB, nullable=True),
        sa.Column("is_enabled", sa.Boolean, server_default="true"),
        sa.Column("notify_channel", sa.String(50), server_default="'in_app'"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── alerts ──
    op.create_table(
        "alerts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("config_id", UUID(as_uuid=True), sa.ForeignKey("alert_configs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("repository_id", UUID(as_uuid=True), sa.ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("alert_type", sa.String(100), nullable=False),
        sa.Column("affected_files", JSONB, nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("acknowledged_by", sa.String(255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── digest_configs ──
    op.create_table(
        "digest_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("frequency", sa.String(20), nullable=False, server_default="weekly"),
        sa.Column("is_enabled", sa.Boolean, server_default="true"),
        sa.Column("include_repos", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── digests ──
    op.create_table(
        "digests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("config_id", UUID(as_uuid=True), sa.ForeignKey("digest_configs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("summary_json", JSONB, nullable=True),
        sa.Column("sent", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── Add owner_id to repositories ──
    op.add_column("repositories", sa.Column("owner_id", sa.String(255), nullable=True, index=True))


def downgrade() -> None:
    op.drop_column("repositories", "owner_id")
    op.drop_table("digests")
    op.drop_table("digest_configs")
    op.drop_table("alerts")
    op.drop_table("alert_configs")
    op.drop_table("hotspots")
    op.drop_table("file_ownership")
    op.drop_table("architecture_snapshots")
    op.drop_table("pull_request_analyses")
    op.drop_table("webhook_deliveries")
    op.drop_table("webhooks")
    op.drop_table("team_repositories")
    op.drop_table("team_members")
    op.drop_table("teams")
