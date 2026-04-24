"""File explorer routes."""

import uuid
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import DependencyEdge, RepoFile, Repository, Symbol
from app.schemas.repository import (
    FileDetailResponse,
    FileResponse,
    FileTreeNode,
    SymbolResponse,
)

router = APIRouter()


@router.get("/repository/{repo_id}", response_model=list[FileResponse])
async def list_files(
    repo_id: uuid.UUID,
    extension: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    query = select(RepoFile).where(RepoFile.repository_id == repo_id)
    if extension:
        query = query.where(RepoFile.extension == extension)
    query = query.order_by(RepoFile.path)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/repository/{repo_id}/tree", response_model=list[FileTreeNode])
async def get_file_tree(repo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RepoFile).where(RepoFile.repository_id == repo_id).order_by(RepoFile.path)
    )
    files = result.scalars().all()

    # Build tree structure using a directory lookup map
    root_children: list[FileTreeNode] = []
    dirs: dict[str, FileTreeNode] = {}

    for f in files:
        parts = PurePosixPath(f.path).parts

        # Ensure all parent directories exist
        for i in range(len(parts) - 1):
            dir_path = "/".join(parts[: i + 1])
            if dir_path not in dirs:
                node = FileTreeNode(
                    name=parts[i],
                    path=dir_path,
                    is_directory=True,
                )
                dirs[dir_path] = node
                if i == 0:
                    root_children.append(node)
                else:
                    parent_path = "/".join(parts[:i])
                    dirs[parent_path].children.append(node)

        # Add the file node
        file_node = FileTreeNode(
            id=f.id,
            name=parts[-1],
            path=f.path,
            is_directory=False,
            extension=f.extension,
            size_bytes=f.size_bytes,
        )
        if len(parts) == 1:
            root_children.append(file_node)
        else:
            parent_path = "/".join(parts[:-1])
            dirs[parent_path].children.append(file_node)

    return root_children


@router.get("/{file_id}", response_model=FileDetailResponse)
async def get_file_detail(file_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RepoFile).where(RepoFile.id == file_id))
    file = result.scalar_one_or_none()
    if not file:
        raise_not_found("File not found")

    # Get repository
    repo_result = await db.execute(select(Repository).where(Repository.id == file.repository_id))
    repo = repo_result.scalar_one_or_none()

    # Read file content from disk
    content = None
    if repo and repo.local_path:
        from pathlib import Path

        actual_path = Path(repo.local_path).resolve() / file.path
        if actual_path.exists() and actual_path.is_file():
            try:
                content = actual_path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                content = None

    # Get symbols for this file from latest analysis
    from app.models.repository import Analysis

    analysis_result = await db.execute(
        select(Analysis)
        .where(Analysis.repository_id == file.repository_id)
        .order_by(Analysis.created_at.desc())
        .limit(1)
    )
    analysis = analysis_result.scalar_one_or_none()

    symbols: list[SymbolResponse] = []
    imports: list[str] = []
    dependencies: list[str] = []
    dependents: list[str] = []

    if analysis:
        sym_result = await db.execute(
            select(Symbol).where(
                Symbol.analysis_id == analysis.id,
                Symbol.file_path == file.path,
            )
        )
        symbols = [SymbolResponse.model_validate(s) for s in sym_result.scalars().all()]

        # Get dependencies (files this file imports)
        dep_result = await db.execute(
            select(DependencyEdge.target_path)
            .where(
                DependencyEdge.analysis_id == analysis.id, DependencyEdge.source_path == file.path
            )
            .distinct()
        )
        dependencies = [row[0] for row in dep_result.all()]

        # Get dependents (files that import this file)
        dependent_result = await db.execute(
            select(DependencyEdge.source_path)
            .where(
                DependencyEdge.analysis_id == analysis.id, DependencyEdge.target_path == file.path
            )
            .distinct()
        )
        dependents = [row[0] for row in dependent_result.all()]

    return FileDetailResponse(
        id=file.id,
        path=file.path,
        name=file.name,
        extension=file.extension,
        language=file.language,
        size_bytes=file.size_bytes,
        line_count=file.line_count,
        is_entry_point=file.is_entry_point,
        content=content,
        symbols=symbols,
        imports=imports,
        dependencies=dependencies,
        dependents=dependents,
    )
