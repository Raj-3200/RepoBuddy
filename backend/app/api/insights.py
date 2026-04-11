"""Insight routes."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.repository import Insight, Analysis
from app.schemas.repository import InsightResponse, InsightListResponse
from app.core.exceptions import raise_not_found

router = APIRouter()


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
