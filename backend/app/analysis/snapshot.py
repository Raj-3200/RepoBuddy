"""Shared analysis data loader.

Provides a single place to fetch the raw graph + file + symbol data an
analysis needs. Used by impact, insights/health, risk_surface endpoints so
they all see the same snapshot.
"""

from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import raise_not_found
from app.models.repository import Analysis, DependencyEdge, RepoFile, Symbol


@dataclass
class AnalysisSnapshot:
    analysis: Analysis
    edges: list[dict]
    file_infos: list[dict]
    symbols_per_file: dict[str, int]
    known_paths: set[str]


async def load_analysis_snapshot(analysis_id: uuid.UUID, db: AsyncSession) -> AnalysisSnapshot:
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
        select(RepoFile.path, RepoFile.is_entry_point, RepoFile.line_count).where(
            RepoFile.repository_id == analysis.repository_id
        )
    )
    file_infos = [
        {
            "path": row.path,
            "is_entry_point": bool(row.is_entry_point),
            "line_count": row.line_count or 0,
        }
        for row in file_result.all()
    ]

    sym_result = await db.execute(select(Symbol.file_path).where(Symbol.analysis_id == analysis_id))
    counts = Counter(row.file_path for row in sym_result.all() if row.file_path)
    symbols_per_file = dict(counts)

    return AnalysisSnapshot(
        analysis=analysis,
        edges=edges,
        file_infos=file_infos,
        symbols_per_file=symbols_per_file,
        known_paths={f["path"] for f in file_infos},
    )
