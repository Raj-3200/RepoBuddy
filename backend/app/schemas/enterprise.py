"""Enterprise Pydantic schemas — teams, webhooks, PR analysis, alerts, digests."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

# ────────────────────────── Teams ──────────────────────────


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class TeamResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    avatar_url: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TeamMemberAdd(BaseModel):
    user_id: str = Field(min_length=1, max_length=255)
    role: str = "member"


class TeamMemberResponse(BaseModel):
    id: UUID
    team_id: UUID
    user_id: str
    role: str
    invited_by: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TeamRepoAdd(BaseModel):
    repository_id: UUID


class TeamRepoResponse(BaseModel):
    id: UUID
    team_id: UUID
    repository_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


# ────────────────────────── Webhooks ──────────────────────────


class WebhookCreate(BaseModel):
    repository_id: UUID
    events: list[str] = ["push", "pull_request"]


class WebhookResponse(BaseModel):
    id: UUID
    team_id: UUID
    repository_id: UUID
    is_active: bool
    events: list | None
    last_delivery_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class WebhookDeliveryResponse(BaseModel):
    id: UUID
    webhook_id: UUID
    event_type: str
    processed: bool
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ────────────────────────── PR Analysis ──────────────────────────


class PRAnalysisResponse(BaseModel):
    id: UUID
    repository_id: UUID
    pr_number: int
    pr_title: str
    pr_url: str
    head_branch: str
    base_branch: str
    status: str
    changed_files: list | None
    impact_summary: dict | None
    risk_score: int
    risk_report: str | None
    affected_modules: list | None
    new_cycles_introduced: list | None
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PRAnalysisListResponse(BaseModel):
    items: list[PRAnalysisResponse]
    total: int


# ────────────────────────── Architecture ──────────────────────────


class ArchitectureSnapshotResponse(BaseModel):
    id: UUID
    repository_id: UUID
    analysis_id: UUID
    commit_sha: str | None
    branch: str | None
    snapshot_data: dict
    drift_from_previous: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ArchitectureSnapshotListResponse(BaseModel):
    items: list[ArchitectureSnapshotResponse]
    total: int


# ────────────────────────── Hotspots / Ownership ──────────────────────────


class HotspotResponse(BaseModel):
    id: UUID
    repository_id: UUID
    file_path: str
    hotspot_score: int
    reasons: list | None
    recommendation: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class FileOwnershipResponse(BaseModel):
    id: UUID
    repository_id: UUID
    file_path: str
    primary_owner: str | None
    contributors: list | None
    commit_count: int
    churn_score: int
    last_modified_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ────────────────────────── Alerts ──────────────────────────


class AlertConfigCreate(BaseModel):
    repository_id: UUID | None = None
    alert_type: str = Field(min_length=1)
    threshold_json: dict | None = None
    notify_channel: str = "in_app"


class AlertConfigResponse(BaseModel):
    id: UUID
    team_id: UUID
    repository_id: UUID | None
    alert_type: str
    threshold_json: dict | None
    is_enabled: bool
    notify_channel: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertResponse(BaseModel):
    id: UUID
    repository_id: UUID
    severity: str
    status: str
    title: str
    description: str
    alert_type: str
    affected_files: list | None
    metadata_json: dict | None
    acknowledged_by: str | None
    resolved_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertListResponse(BaseModel):
    items: list[AlertResponse]
    total: int


class AlertAcknowledge(BaseModel):
    user_id: str


# ────────────────────────── Digests ──────────────────────────


class DigestConfigCreate(BaseModel):
    frequency: str = "weekly"
    include_repos: list[str] | None = None


class DigestConfigResponse(BaseModel):
    id: UUID
    team_id: UUID
    frequency: str
    is_enabled: bool
    include_repos: list | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DigestResponse(BaseModel):
    id: UUID
    config_id: UUID
    period_start: datetime
    period_end: datetime
    content: str
    summary_json: dict | None
    sent: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DigestListResponse(BaseModel):
    items: list[DigestResponse]
    total: int
