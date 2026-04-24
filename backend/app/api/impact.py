"""Change impact analysis API — on-demand blast radius for any file in a repository."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.impact_analyzer import ImpactAnalyzer
from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import Analysis, DependencyEdge, RepoFile
from app.schemas.intelligence import ImpactAnalysisSchema, ImpactCandidateSchema

router = APIRouter()


async def _build_analyzer(
    analysis_id: uuid.UUID, db: AsyncSession
) -> tuple[ImpactAnalyzer, set[str]]:
    """Shared loader: returns (analyzer, known_paths) for a given analysis."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    edge_result = await db.execute(
        select(DependencyEdge.source_path, DependencyEdge.target_path).where(
            DependencyEdge.analysis_id == analysis_id
        )
    )
    edges = [
        {"source_path": row.source_path, "target_path": row.target_path}
        for row in edge_result.all()
    ]

    file_result = await db.execute(
        select(
            RepoFile.path,
            RepoFile.is_entry_point,
            RepoFile.line_count,
        ).where(RepoFile.repository_id == analysis.repository_id)
    )
    file_infos = [
        {
            "path": row.path,
            "is_entry_point": bool(row.is_entry_point),
            "line_count": row.line_count or 0,
        }
        for row in file_result.all()
    ]
    return ImpactAnalyzer(edges=edges, file_infos=file_infos), {f["path"] for f in file_infos}


@router.get("/{analysis_id}/candidates", response_model=list[ImpactCandidateSchema])
async def get_impact_candidates(
    analysis_id: uuid.UUID,
    limit: int = Query(6, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> list[ImpactCandidateSchema]:
    """Return the most central / highest-impact files in the repo.

    Used by the Impact page to suggest a meaningful first-load file instead of
    defaulting to a trivial low-impact one.
    """
    analyzer, _ = await _build_analyzer(analysis_id, db)
    return [ImpactCandidateSchema(**c) for c in analyzer.top_candidates(limit=limit)]


@router.get("/{analysis_id}", response_model=ImpactAnalysisSchema)
async def get_change_impact(
    analysis_id: uuid.UUID,
    file_path: str = Query(
        ..., description="Repo-relative path of the file to analyse, e.g. src/auth/login.ts"
    ),
    db: AsyncSession = Depends(get_db),
) -> ImpactAnalysisSchema:
    """
    Compute the blast radius of changing *file_path*.

    Returns every file that transitively imports the target (up to 3 hops),
    grouped by module, with a risk score, structured review plan,
    file-type-aware suggested checks, related files and a final verdict.
    """
    analyzer, known_paths = await _build_analyzer(analysis_id, db)

    if file_path not in known_paths:
        raise_not_found(
            f"File '{file_path}' was not found in this repository. Pick a path from the Files tab."
        )

    impact = analyzer.analyze(file_path)
    data = impact.to_dict()

    from app.schemas.intelligence import ImpactedFileSchema, ImpactedModuleSchema

    return ImpactAnalysisSchema(
        target_path=data["target_path"],
        blast_radius=data["blast_radius"],
        blast_radius_score=data["blast_radius_score"],
        blast_radius_label=data["blast_radius_label"],
        direct_dependents=[ImpactedFileSchema(**f) for f in data.get("direct_dependents", [])],
        second_order_dependents=[
            ImpactedFileSchema(**f) for f in data.get("second_order_dependents", [])
        ],
        third_order_dependents=[
            ImpactedFileSchema(**f) for f in data.get("third_order_dependents", [])
        ],
        affected_modules=[ImpactedModuleSchema(**m) for m in data.get("affected_modules", [])],
        affected_entry_points=data.get("affected_entry_points", []),
        affected_runtime_entry_points=data.get("affected_runtime_entry_points", []),
        suggested_tests=data.get("suggested_tests", []),
        safe_to_change=data.get("safe_to_change", True),
        change_risk_score=data.get("change_risk_score", 0.0),
        change_risk_label=data.get("change_risk_label", "low"),
        review_path=data.get("review_path", []),
        reasoning=data.get("reasoning", []),
        file_summary=data.get("file_summary", {}),
        impact_classification=data.get("impact_classification", []),
        review_plan=data.get("review_plan", []),
        suggested_checks=data.get("suggested_checks", []),
        related_files=data.get("related_files", []),
        verdict=data.get("verdict", {}),
        confidence=data.get("confidence", {}),
    )
