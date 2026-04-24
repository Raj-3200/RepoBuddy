"""AI assistant routes."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import Analysis
from app.schemas.ai import ChatRequest, ChatResponse
from app.services.ai_service import AIService

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Ask questions about a repository using AI with grounded context."""
    result = await db.execute(select(Analysis).where(Analysis.id == request.analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    ai_service = AIService(db)
    response = await ai_service.answer_question(
        analysis=analysis,
        message=request.message,
        history=request.history,
    )
    return response


@router.get("/suggestions/{analysis_id}", response_model=list[str])
async def get_suggested_questions(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Get suggested questions for a repository."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    return [
        "What does this codebase do?",
        "Where should I start reading?",
        "What are the main modules?",
        "Where is authentication handled?",
        "What are the key dependencies?",
        "What files are most central to the architecture?",
        "Are there any circular dependencies?",
        "What should a new developer read first?",
    ]
