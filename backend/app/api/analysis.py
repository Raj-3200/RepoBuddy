"""Analysis routes."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.repository import Analysis
from app.schemas.repository import AnalysisResponse, AnalysisProgressResponse
from app.core.exceptions import raise_not_found

router = APIRouter()


@router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")
    return analysis


@router.get("/{analysis_id}/progress", response_model=AnalysisProgressResponse)
async def get_analysis_progress(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")
    return AnalysisProgressResponse(
        status=analysis.status.value if hasattr(analysis.status, "value") else analysis.status,
        current_step=analysis.current_step,
        progress=analysis.progress,
        error_message=analysis.error_message,
    )


@router.get("/repository/{repo_id}", response_model=list[AnalysisResponse])
async def list_analyses_for_repository(repo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Analysis)
        .where(Analysis.repository_id == repo_id)
        .order_by(Analysis.created_at.desc())
    )
    return result.scalars().all()


@router.post("/{analysis_id}/retry", response_model=AnalysisResponse)
async def retry_analysis(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    from app.models.repository import AnalysisStatus

    analysis.status = AnalysisStatus.PENDING
    analysis.progress = 0
    analysis.error_message = None
    analysis.current_step = None
    await db.flush()

    from app.workers.tasks import run_analysis_pipeline

    run_analysis_pipeline.delay(str(analysis.repository_id), str(analysis.id))

    return analysis
