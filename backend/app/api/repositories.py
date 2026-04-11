"""Repository management routes."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.dependencies import get_db
from app.models.repository import Repository, Analysis, RepositorySource, AnalysisStatus
from app.schemas.repository import (
    RepositoryCreate,
    RepositoryResponse,
    RepositoryListResponse,
    DashboardResponse,
    AnalysisResponse,
)
from app.core.exceptions import raise_not_found, raise_bad_request
from app.core.logging import get_logger

router = APIRouter()
settings = get_settings()
logger = get_logger(__name__)


@router.get("", response_model=RepositoryListResponse)
async def list_repositories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Repository).order_by(Repository.created_at.desc()))
    repos = result.scalars().all()
    return RepositoryListResponse(items=repos, total=len(repos))


@router.get("/{repo_id}", response_model=RepositoryResponse)
async def get_repository(repo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Repository).where(Repository.id == repo_id))
    repo = result.scalar_one_or_none()
    if not repo:
        raise_not_found("Repository not found")
    return repo


@router.post("", response_model=RepositoryResponse, status_code=status.HTTP_201_CREATED)
async def create_repository_from_url(
    payload: RepositoryCreate,
    db: AsyncSession = Depends(get_db),
):
    if not payload.url:
        raise_bad_request("GitHub URL is required for URL-based repository creation")

    repo_dir = settings.repos_path / str(uuid.uuid4())
    repo = Repository(
        name=payload.name,
        source=RepositorySource.GITHUB,
        url=payload.url,
        local_path=str(repo_dir),
    )
    db.add(repo)
    await db.flush()

    # Create initial analysis
    analysis = Analysis(
        repository_id=repo.id,
        status=AnalysisStatus.PENDING,
    )
    db.add(analysis)
    await db.flush()

    # Trigger background analysis
    from app.workers.tasks import run_analysis_pipeline

    run_analysis_pipeline.delay(str(repo.id), str(analysis.id))

    logger.info("repository_created", repo_id=str(repo.id), source="github")
    return repo


@router.post("/upload", response_model=RepositoryResponse, status_code=status.HTTP_201_CREATED)
async def upload_repository(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    # Validate file
    if not file.filename:
        raise_bad_request("Filename is required")

    if not file.filename.endswith(".zip"):
        raise_bad_request("Only ZIP files are supported")

    # Read and validate size
    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise_bad_request(f"File exceeds maximum size of {settings.max_upload_size_mb}MB")

    # Save upload
    repo_id = uuid.uuid4()
    upload_path = settings.upload_path / f"{repo_id}.zip"
    upload_path.write_bytes(content)

    repo_dir = settings.repos_path / str(repo_id)
    repo_name = Path(file.filename).stem

    repo = Repository(
        id=repo_id,
        name=repo_name,
        source=RepositorySource.UPLOAD,
        local_path=str(repo_dir),
    )
    db.add(repo)
    await db.flush()

    analysis = Analysis(
        repository_id=repo.id,
        status=AnalysisStatus.PENDING,
    )
    db.add(analysis)
    await db.flush()

    # Trigger background analysis
    from app.workers.tasks import run_analysis_pipeline

    run_analysis_pipeline.delay(str(repo.id), str(analysis.id))

    logger.info("repository_uploaded", repo_id=str(repo.id), filename=file.filename)
    return repo


@router.get("/{repo_id}/dashboard", response_model=DashboardResponse)
async def get_dashboard(repo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Repository).where(Repository.id == repo_id))
    repo = result.scalar_one_or_none()
    if not repo:
        raise_not_found("Repository not found")

    # Get latest analysis
    analysis_result = await db.execute(
        select(Analysis)
        .where(Analysis.repository_id == repo_id)
        .order_by(Analysis.created_at.desc())
        .limit(1)
    )
    analysis = analysis_result.scalar_one_or_none()

    summary = analysis.summary_json or {} if analysis else {}

    return DashboardResponse(
        repository=repo,
        analysis=analysis,
        file_count=analysis.total_files if analysis else 0,
        function_count=analysis.total_functions if analysis else 0,
        class_count=analysis.total_classes if analysis else 0,
        total_lines=analysis.total_lines if analysis else 0,
        detected_framework=repo.detected_framework,
        top_modules=summary.get("top_modules", []),
        central_files=summary.get("central_files", []),
        risk_summary=summary.get("risk_summary", {}),
        cycle_count=summary.get("cycle_count", 0),
    )


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repository(repo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Repository).where(Repository.id == repo_id))
    repo = result.scalar_one_or_none()
    if not repo:
        raise_not_found("Repository not found")

    await db.delete(repo)
    logger.info("repository_deleted", repo_id=str(repo_id))
