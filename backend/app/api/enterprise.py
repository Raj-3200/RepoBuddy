"""PR analysis, architecture, hotspot, alert, and digest routes."""

import uuid
from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.dependencies import get_db
from app.models.enterprise import (
    Alert,
    AlertConfig,
    AlertStatus,
    ArchitectureSnapshot,
    Digest,
    DigestConfig,
    FileOwnership,
    Hotspot,
    PullRequestAnalysis,
)
from app.schemas.enterprise import (
    AlertAcknowledge,
    AlertConfigCreate,
    AlertConfigResponse,
    AlertListResponse,
    AlertResponse,
    ArchitectureSnapshotListResponse,
    ArchitectureSnapshotResponse,
    DigestConfigCreate,
    DigestConfigResponse,
    DigestListResponse,
    DigestResponse,
    FileOwnershipResponse,
    HotspotResponse,
    PRAnalysisListResponse,
    PRAnalysisResponse,
)

router = APIRouter()
logger = get_logger(__name__)


# ────────────────────────── PR Analysis ──────────────────────────


@router.get("/pr-analyses/{repo_id}", response_model=PRAnalysisListResponse)
async def list_pr_analyses(
    repo_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PullRequestAnalysis)
        .where(PullRequestAnalysis.repository_id == repo_id)
        .order_by(PullRequestAnalysis.created_at.desc())
        .limit(limit)
    )
    items = result.scalars().all()
    count = await db.execute(
        select(func.count(PullRequestAnalysis.id)).where(
            PullRequestAnalysis.repository_id == repo_id
        )
    )
    return PRAnalysisListResponse(items=items, total=count.scalar_one())


@router.get("/pr-analyses/{repo_id}/{pr_id}", response_model=PRAnalysisResponse)
async def get_pr_analysis(
    repo_id: uuid.UUID,
    pr_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PullRequestAnalysis).where(
            PullRequestAnalysis.id == pr_id,
            PullRequestAnalysis.repository_id == repo_id,
        )
    )
    pra = result.scalar_one_or_none()
    if not pra:
        raise HTTPException(status_code=404, detail="PR analysis not found")
    return pra


# ────────────────────────── Architecture Snapshots ──────────────────────────


@router.get("/architecture/{repo_id}", response_model=ArchitectureSnapshotListResponse)
async def list_architecture_snapshots(
    repo_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ArchitectureSnapshot)
        .where(ArchitectureSnapshot.repository_id == repo_id)
        .order_by(ArchitectureSnapshot.created_at.desc())
        .limit(limit)
    )
    items = result.scalars().all()
    count = await db.execute(
        select(func.count(ArchitectureSnapshot.id)).where(
            ArchitectureSnapshot.repository_id == repo_id
        )
    )
    return ArchitectureSnapshotListResponse(items=items, total=count.scalar_one())


@router.get("/architecture/{repo_id}/latest", response_model=ArchitectureSnapshotResponse)
async def get_latest_snapshot(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ArchitectureSnapshot)
        .where(ArchitectureSnapshot.repository_id == repo_id)
        .order_by(ArchitectureSnapshot.created_at.desc())
        .limit(1)
    )
    snap = result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="No architecture snapshots found")
    return snap


@router.get("/architecture/{repo_id}/{snapshot_id}/diff")
async def get_snapshot_diff(
    repo_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get drift details between a snapshot and its predecessor."""
    result = await db.execute(
        select(ArchitectureSnapshot).where(
            ArchitectureSnapshot.id == snapshot_id,
            ArchitectureSnapshot.repository_id == repo_id,
        )
    )
    snap = result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {
        "snapshot_id": str(snap.id),
        "drift": snap.drift_from_previous,
        "snapshot": snap.snapshot_data,
    }


# ────────────────────────── Hotspots ──────────────────────────


@router.get("/hotspots/{repo_id}", response_model=list[HotspotResponse])
async def list_hotspots(
    repo_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Hotspot)
        .where(Hotspot.repository_id == repo_id)
        .order_by(Hotspot.hotspot_score.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/ownership/{repo_id}", response_model=list[FileOwnershipResponse])
async def list_file_ownership(
    repo_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileOwnership)
        .where(FileOwnership.repository_id == repo_id)
        .order_by(FileOwnership.churn_score.desc())
        .limit(limit)
    )
    return result.scalars().all()


# ────────────────────────── Alerts ──────────────────────────


@router.get("/alerts/{repo_id}", response_model=AlertListResponse)
async def list_alerts(
    repo_id: uuid.UUID,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    query = select(Alert).where(Alert.repository_id == repo_id)
    if status_filter:
        query = query.where(Alert.status == status_filter)
    query = query.order_by(Alert.created_at.desc()).limit(limit)

    result = await db.execute(query)
    items = result.scalars().all()

    count_q = select(func.count(Alert.id)).where(Alert.repository_id == repo_id)
    if status_filter:
        count_q = count_q.where(Alert.status == status_filter)
    count = await db.execute(count_q)

    return AlertListResponse(items=items, total=count.scalar_one())


@router.patch("/alerts/{alert_id}/acknowledge", response_model=AlertResponse)
async def acknowledge_alert(
    alert_id: uuid.UUID,
    payload: AlertAcknowledge,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_by = payload.user_id
    await db.flush()
    return alert


@router.patch("/alerts/{alert_id}/resolve", response_model=AlertResponse)
async def resolve_alert(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime

    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = datetime.now(UTC)
    await db.flush()
    return alert


# ── Alert Configs ──


@router.post("/alert-configs/{team_id}", response_model=AlertConfigResponse, status_code=201)
async def create_alert_config(
    team_id: uuid.UUID,
    payload: AlertConfigCreate,
    db: AsyncSession = Depends(get_db),
):
    config = AlertConfig(
        team_id=team_id,
        repository_id=payload.repository_id,
        alert_type=payload.alert_type,
        threshold_json=payload.threshold_json,
        notify_channel=payload.notify_channel,
        is_enabled=True,
    )
    db.add(config)
    await db.flush()
    return config


@router.get("/alert-configs/{team_id}", response_model=list[AlertConfigResponse])
async def list_alert_configs(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AlertConfig).where(AlertConfig.team_id == team_id))
    return result.scalars().all()


# ────────────────────────── Digests ──────────────────────────


@router.post("/digest-configs/{team_id}", response_model=DigestConfigResponse, status_code=201)
async def create_digest_config(
    team_id: uuid.UUID,
    payload: DigestConfigCreate,
    db: AsyncSession = Depends(get_db),
):
    config = DigestConfig(
        team_id=team_id,
        frequency=payload.frequency,
        include_repos=payload.include_repos,
        is_enabled=True,
    )
    db.add(config)
    await db.flush()
    return config


@router.get("/digest-configs/{team_id}", response_model=list[DigestConfigResponse])
async def list_digest_configs(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DigestConfig).where(DigestConfig.team_id == team_id))
    return result.scalars().all()


@router.get("/digests/{team_id}", response_model=DigestListResponse)
async def list_digests(
    team_id: uuid.UUID,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    configs = await db.execute(select(DigestConfig.id).where(DigestConfig.team_id == team_id))
    config_ids = [c for c in configs.scalars().all()]

    if not config_ids:
        return DigestListResponse(items=[], total=0)

    result = await db.execute(
        select(Digest)
        .where(Digest.config_id.in_(config_ids))
        .order_by(Digest.created_at.desc())
        .limit(limit)
    )
    items = result.scalars().all()
    return DigestListResponse(items=items, total=len(items))


@router.get("/digests/{team_id}/{digest_id}", response_model=DigestResponse)
async def get_digest(
    team_id: uuid.UUID,
    digest_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Digest).where(Digest.id == digest_id))
    digest = result.scalar_one_or_none()
    if not digest:
        raise HTTPException(status_code=404, detail="Digest not found")
    return digest


@router.post("/digests/{team_id}/generate")
async def trigger_digest_generation(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger digest generation for a team."""
    configs = await db.execute(
        select(DigestConfig).where(
            DigestConfig.team_id == team_id,
            DigestConfig.is_enabled,
        )
    )
    config_list = configs.scalars().all()

    if not config_list:
        raise HTTPException(status_code=404, detail="No active digest configs found")

    from app.workers.enterprise_tasks import generate_weekly_digest

    results = []
    for config in config_list:
        try:
            generate_weekly_digest.delay(str(config.id))
            results.append({"config_id": str(config.id), "status": "queued"})
        except Exception as exc:
            results.append({"config_id": str(config.id), "status": "failed", "error": str(exc)})

    return {"triggered": len(results), "results": results}
