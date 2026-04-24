"""Intelligence Report routes."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.exceptions import raise_not_found
from app.core.logging import get_logger
from app.dependencies import get_db
from app.models.repository import Analysis, Repository
from app.schemas.intelligence import IntelligenceReportResponse
from app.services.intelligence_service import IntelligenceService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/{analysis_id}", response_model=IntelligenceReportResponse)
async def get_intelligence_report(
    analysis_id: uuid.UUID,
    refresh: bool = Query(False, description="Force regeneration, bypass cache"),
    db: AsyncSession = Depends(get_db),
):
    """Generate (or return cached) evidence-based intelligence report."""

    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    repo_result = await db.execute(
        select(Repository).where(Repository.id == analysis.repository_id)
    )
    repo = repo_result.scalar_one_or_none()
    if not repo:
        raise_not_found("Repository not found")

    # ── Cached fast path ──
    summary = analysis.summary_json or {}
    cached = summary.get("intelligence_report_cache")
    if cached and not refresh:
        try:
            logger.info("intelligence_report_cache_hit", analysis_id=str(analysis_id))
            return IntelligenceReportResponse(**cached)
        except Exception as e:
            logger.warning("intelligence_report_cache_invalid", error=str(e))

    logger.info(
        "generating_intelligence_report",
        analysis_id=str(analysis_id),
        repo_id=str(repo.id),
        refresh=refresh,
    )

    service = IntelligenceService(db)
    report = await service.generate_report(analysis, repo)

    # ── Persist cache ──
    try:
        new_summary = dict(summary)
        new_summary["intelligence_report_cache"] = report.model_dump(mode="json")
        analysis.summary_json = new_summary
        flag_modified(analysis, "summary_json")
        await db.commit()
    except Exception as e:
        logger.warning("intelligence_report_cache_persist_failed", error=str(e))
        await db.rollback()

    return report
