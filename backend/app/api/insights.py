"""Insight routes — engineering signals & repository health."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.repo_health import RepoHealthEngine
from app.analysis.snapshot import load_analysis_snapshot
from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import Analysis, Insight
from app.schemas.repository import InsightListResponse

router = APIRouter()


@router.get("/{analysis_id}/health")
async def get_repo_health(
    analysis_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Repository Health & Engineering Signals.

    Structured diagnostics layer — distinct from the Intelligence Report.
    Returns health dimensions, pattern signals, long-term concerns, priority
    fixes, and a review guidance path. All evidence-backed.
    """
    snap = await load_analysis_snapshot(analysis_id, db)
    engine = RepoHealthEngine(
        edges=snap.edges,
        file_infos=snap.file_infos,
        symbols_per_file=snap.symbols_per_file,
    )
    return engine.analyze().to_dict()


@router.get("/{analysis_id}", response_model=InsightListResponse)
async def get_insights(
    analysis_id: uuid.UUID,
    category: str | None = Query(None),
    severity: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    if not result.scalar_one_or_none():
        raise_not_found("Analysis not found")

    query = select(Insight).where(Insight.analysis_id == analysis_id)
    if category:
        query = query.where(Insight.category == category)
    if severity:
        query = query.where(Insight.severity == severity)
    query = query.order_by(Insight.severity.desc(), Insight.category)

    insight_result = await db.execute(query)
    insights = insight_result.scalars().all()

    return InsightListResponse(items=insights, total=len(insights))
