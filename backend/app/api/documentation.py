"""Documentation routes."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import Analysis, Repository
from app.schemas.repository import DocumentationResponse

router = APIRouter()

_EXT_LANG = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
}


def _backfill_snippets(entry_points: list[dict], repo_local_path: str | None) -> list[dict]:
    """Add snippet/language to entry points that are missing them."""
    if not repo_local_path:
        return entry_points
    repo_dir = Path(repo_local_path)
    enriched = []
    for ep in entry_points:
        if ep.get("snippet"):
            enriched.append(ep)
            continue
        ep = dict(ep)  # copy
        try:
            fp = repo_dir / ep["path"]
            raw = fp.read_text(encoding="utf-8", errors="replace")
            ep["snippet"] = "\n".join(raw.splitlines()[:20])
            ext = Path(ep["path"]).suffix.lower()
            ep["language"] = _EXT_LANG.get(ext, "text")
        except Exception:
            ep["snippet"] = ""
            ep["language"] = "text"
        enriched.append(ep)
    return enriched


@router.get("/{analysis_id}", response_model=DocumentationResponse)
async def get_documentation(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    # Fetch the repository for name/framework/language
    repo_result = await db.execute(
        select(Repository).where(Repository.id == analysis.repository_id)
    )
    repo = repo_result.scalar_one_or_none()

    summary = analysis.summary_json or {}
    graph_metrics = summary.get("graph_metrics", {})
    modules = summary.get("key_modules", [])
    top_modules = summary.get("top_modules", modules)

    return DocumentationResponse(
        onboarding_doc=analysis.onboarding_doc,
        architecture_doc=analysis.architecture_doc,
        key_modules=modules,
        repo_name=repo.name if repo else None,
        detected_framework=repo.detected_framework if repo else None,
        detected_language=repo.detected_language if repo else None,
        stats={
            "total_files": summary.get("total_files", analysis.total_files or 0),
            "total_lines": summary.get("total_lines", analysis.total_lines or 0),
            "total_functions": summary.get("total_functions", analysis.total_functions or 0),
            "total_classes": summary.get("total_classes", analysis.total_classes or 0),
            "modules": len(top_modules),
            "cycle_count": summary.get("cycle_count", 0),
        },
        entry_points=_backfill_snippets(
            summary.get("entry_points", []),
            repo.local_path if repo else None,
        ),
        modules=top_modules,
        central_files=graph_metrics.get("central_files", summary.get("central_files", [])),
        cycles=[],  # cycles stored in insights, not summary_json
        risk_areas=summary.get("risk_areas", []),
        most_imported=graph_metrics.get("most_imported", []),
        graph_metrics={
            "density": graph_metrics.get("density", 0),
            "total_edges": graph_metrics.get("total_edges", 0),
            "avg_in_degree": graph_metrics.get("avg_in_degree", 0),
            "avg_out_degree": graph_metrics.get("avg_out_degree", 0),
        },
    )
