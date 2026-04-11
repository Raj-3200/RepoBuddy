"""Documentation routes."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.repository import Analysis
from app.schemas.repository import DocumentationResponse
from app.core.exceptions import raise_not_found

router = APIRouter()


@router.get("/{analysis_id}", response_model=DocumentationResponse)
async def get_documentation(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    summary = analysis.summary_json or {}

    return DocumentationResponse(
        onboarding_doc=analysis.onboarding_doc,
        architecture_doc=analysis.architecture_doc,
        key_modules=summary.get("key_modules", []),
    )
