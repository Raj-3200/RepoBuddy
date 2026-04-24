"""Enterprise models — teams, workspaces, webhooks, PR analysis, alerts, digests."""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

# ────────────────────────── Enums ──────────────────────────


class TeamRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class WebhookEvent(str, enum.Enum):
    PUSH = "push"
    PULL_REQUEST = "pull_request"
    PULL_REQUEST_REVIEW = "pull_request_review"


class PRAnalysisStatus(str, enum.Enum):
    PENDING = "pending"
    ANALYZING = "analyzing"
    COMPLETED = "completed"
    FAILED = "failed"


class AlertSeverity(str, enum.Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class AlertStatus(str, enum.Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class DigestFrequency(str, enum.Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


# ────────────────────────── Team / Workspace ──────────────────────────


class Team(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "teams"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    members: Mapped[list[TeamMember]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    repositories: Mapped[list[TeamRepository]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    webhooks: Mapped[list[Webhook]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    alert_configs: Mapped[list[AlertConfig]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    digest_configs: Mapped[list[DigestConfig]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )


class TeamMember(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[TeamRole] = mapped_column(
        Enum(TeamRole, native_enum=False), nullable=False, default=TeamRole.MEMBER
    )
    invited_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    team: Mapped[Team] = relationship(back_populates="members")


class TeamRepository(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "team_repositories"
    __table_args__ = (UniqueConstraint("team_id", "repository_id", name="uq_team_repo"),)

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    team: Mapped[Team] = relationship(back_populates="repositories")


# ────────────────────────── Webhook ──────────────────────────


class Webhook(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "webhooks"

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    github_webhook_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    secret: Mapped[str] = mapped_column(String(255), nullable=False)
    events: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_delivery_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)

    team: Mapped[Team] = relationship(back_populates="webhooks")


class WebhookDelivery(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "webhook_deliveries"

    webhook_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("webhooks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    payload_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


# ────────────────────────── PR Analysis ──────────────────────────


class PullRequestAnalysis(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "pull_request_analyses"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    base_analysis_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="SET NULL"), nullable=True
    )
    pr_number: Mapped[int] = mapped_column(Integer, nullable=False)
    pr_title: Mapped[str] = mapped_column(String(512), nullable=False)
    pr_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    head_branch: Mapped[str] = mapped_column(String(255), nullable=False)
    base_branch: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[PRAnalysisStatus] = mapped_column(
        Enum(PRAnalysisStatus, native_enum=False), nullable=False, default=PRAnalysisStatus.PENDING
    )
    changed_files: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    impact_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_modules: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    new_cycles_introduced: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


# ────────────────────────── Architecture Versions ──────────────────────────


class ArchitectureSnapshot(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "architecture_snapshots"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False
    )
    commit_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)
    branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    snapshot_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # snapshot_data includes: module_structure, dependency_counts, cycle_count,
    # central_files, risk_scores, file_count, function_count, class_count
    drift_from_previous: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # drift: added_files, removed_files, added_deps, removed_deps,
    # new_cycles, resolved_cycles, risk_changes


# ────────────────────────── File Ownership / Hotspots ──────────────────────────


class FileOwnership(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "file_ownership"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    primary_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contributors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    commit_count: Mapped[int] = mapped_column(Integer, default=0)
    last_modified_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    churn_score: Mapped[int] = mapped_column(Integer, default=0)  # higher = more changes


class Hotspot(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "hotspots"

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    hotspot_score: Mapped[int] = mapped_column(Integer, default=0)
    reasons: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # reasons: high_churn, high_complexity, many_dependents, cycle_member, etc.
    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)


# ────────────────────────── Alerts ──────────────────────────


class AlertConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "alert_configs"

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repository_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=True
    )
    alert_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # types: new_cycle, risk_increase, architecture_drift, large_pr, ownership_gap
    threshold_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_channel: Mapped[str] = mapped_column(String(50), default="in_app")
    # channels: in_app, email, webhook

    team: Mapped[Team] = relationship(back_populates="alert_configs")


class Alert(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "alerts"

    config_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alert_configs.id", ondelete="SET NULL"), nullable=True
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    severity: Mapped[AlertSeverity] = mapped_column(
        Enum(AlertSeverity, native_enum=False), nullable=False
    )
    status: Mapped[AlertStatus] = mapped_column(
        Enum(AlertStatus, native_enum=False), nullable=False, default=AlertStatus.ACTIVE
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    alert_type: Mapped[str] = mapped_column(String(100), nullable=False)
    affected_files: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resolved_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ────────────────────────── Digest ──────────────────────────


class DigestConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "digest_configs"

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    frequency: Mapped[DigestFrequency] = mapped_column(
        Enum(DigestFrequency, native_enum=False), nullable=False, default=DigestFrequency.WEEKLY
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    include_repos: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # null = all team repos

    team: Mapped[Team] = relationship(back_populates="digest_configs")


class Digest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "digests"

    config_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("digest_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period_start: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    summary_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # summary: repos_analyzed, new_insights, risk_changes, drift_detected, etc.
    sent: Mapped[bool] = mapped_column(Boolean, default=False)
