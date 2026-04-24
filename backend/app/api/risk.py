"""Operational Risk Surface API.

Exposes a repository-wide list of concrete risk areas (coupling, blast
radius, reviewability, fragility, runtime, boundary) computed from the
deterministic graph + file + symbol data.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.risk_surface import RiskSurfaceEngine
from app.analysis.snapshot import load_analysis_snapshot
from app.dependencies import get_db
from app.graph.analyzer import detect_cycles

router = APIRouter()


@router.get("/{analysis_id}")
async def get_risk_surface(
    analysis_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    snap = await load_analysis_snapshot(analysis_id, db)

    # Cycles are a shared input — compute once from the edge list.
    cycles: list[list[str]] = []
    try:
        import networkx as nx

        g = nx.DiGraph()
        for e in snap.edges:
            g.add_edge(e["source_path"], e["target_path"])
        cycles = detect_cycles(g)
    except Exception:
        cycles = []

    engine = RiskSurfaceEngine(
        edges=snap.edges,
        file_infos=snap.file_infos,
        symbols_per_file=snap.symbols_per_file,
        cycles=cycles,
    )
    return engine.analyze().to_dict()
