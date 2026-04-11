"""Background analysis tasks."""

from __future__ import annotations

import uuid
from pathlib import Path

from celery import shared_task
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger
from app.models.repository import (
    Analysis,
    AnalysisStatus,
    DependencyEdge,
    EdgeType,
    Insight,
    RepoFile,
    Repository,
    RepositorySource,
    SemanticChunk,
    Symbol,
    SymbolType,
)
from app.parsers.registry import parse_file
from app.graph.builder import build_dependency_graph
from app.graph.analyzer import (
    compute_graph_metrics,
    detect_cycles,
    compute_risk_scores,
    identify_modules,
    find_isolated_nodes,
)
from app.services.repository_service import (
    clone_github_repo,
    extract_zip_repo,
    scan_repository_files,
    detect_framework,
)

settings = get_settings()
logger = get_logger(__name__)


def _get_sync_session() -> Session:
    engine = create_engine(settings.database_url_sync)
    return Session(engine)


def _update_analysis(session: Session, analysis_id: str, **kwargs) -> None:
    analysis = session.get(Analysis, uuid.UUID(analysis_id))
    if analysis:
        for key, value in kwargs.items():
            setattr(analysis, key, value)
        session.commit()


@shared_task(bind=True, max_retries=2)
def run_analysis_pipeline(self, repo_id: str, analysis_id: str) -> dict:
    """Main analysis pipeline — runs as a Celery background task."""
    session = _get_sync_session()

    try:
        repo = session.get(Repository, uuid.UUID(repo_id))
        if not repo:
            return {"error": "Repository not found"}

        repo_dir = Path(repo.local_path)

        # ── Step 1: Clone / Extract ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.CLONING,
            current_step="Cloning or extracting repository...",
            progress=5,
        )

        if repo.source == RepositorySource.GITHUB and repo.url:
            clone_github_repo(repo.url, repo_dir, settings.github_token or None)
        elif repo.source == RepositorySource.UPLOAD:
            zip_path = settings.upload_path / f"{repo_id}.zip"
            if zip_path.exists():
                extract_zip_repo(zip_path, repo_dir)
            else:
                raise FileNotFoundError(f"Upload file not found: {zip_path}")

        # ── Step 2: Scan files ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.SCANNING,
            current_step="Scanning repository files...",
            progress=15,
        )

        file_infos = scan_repository_files(repo_dir)
        if not file_infos:
            _update_analysis(
                session, analysis_id,
                status=AnalysisStatus.FAILED,
                error_message="No supported source files found in repository",
            )
            return {"error": "No source files found"}

        # Detect framework
        framework, language = detect_framework(repo_dir)
        repo.detected_framework = framework
        repo.detected_language = language
        session.commit()

        # Save file records
        for fi in file_infos:
            repo_file = RepoFile(
                repository_id=uuid.UUID(repo_id),
                path=fi["path"],
                name=fi["name"],
                extension=fi["extension"],
                language=fi["language"],
                size_bytes=fi["size_bytes"],
                line_count=fi["line_count"],
                is_entry_point=fi["is_entry_point"],
            )
            session.add(repo_file)
        session.commit()

        # ── Step 3: Parse source files ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.PARSING,
            current_step="Parsing source files and extracting symbols...",
            progress=30,
        )

        parse_results = []
        total_functions = 0
        total_classes = 0
        total_lines = 0
        parse_errors = 0

        for fi in file_infos:
            file_path = repo_dir / fi["path"]
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
                result = parse_file(fi["path"], content)
                if result:
                    parse_results.append(result)
                    total_lines += result.line_count

                    for sym in result.symbols:
                        symbol_type_map = {
                            "function": SymbolType.FUNCTION,
                            "class": SymbolType.CLASS,
                            "method": SymbolType.METHOD,
                            "variable": SymbolType.VARIABLE,
                            "interface": SymbolType.INTERFACE,
                            "type_alias": SymbolType.TYPE_ALIAS,
                            "enum": SymbolType.ENUM,
                            "constant": SymbolType.CONSTANT,
                            "export": SymbolType.EXPORT,
                        }
                        db_symbol = Symbol(
                            analysis_id=uuid.UUID(analysis_id),
                            file_path=fi["path"],
                            name=sym.name,
                            symbol_type=symbol_type_map.get(sym.kind.value, SymbolType.VARIABLE),
                            line_start=sym.line_start,
                            line_end=sym.line_end,
                            signature=sym.signature,
                            docstring=sym.docstring,
                            is_exported=sym.is_exported,
                        )
                        session.add(db_symbol)

                        if sym.kind == "function":
                            total_functions += 1
                        elif sym.kind == "class":
                            total_classes += 1

                    # Create semantic chunks
                    _create_semantic_chunks(session, analysis_id, fi["path"], content, result)

                if result and result.errors:
                    parse_errors += len(result.errors)
            except Exception as e:
                logger.warning("file_parse_failed", file=fi["path"], error=str(e))
                parse_errors += 1
                continue

        session.commit()

        # ── Step 4: Build dependency graph ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.BUILDING_GRAPH,
            current_step="Building dependency graph...",
            progress=55,
        )

        repo_file_paths = {fi["path"] for fi in file_infos}
        graph = build_dependency_graph(parse_results, repo_file_paths)

        # Save edges to DB
        for source, target, data in graph.edges(data=True):
            edge = DependencyEdge(
                analysis_id=uuid.UUID(analysis_id),
                source_path=source,
                target_path=target,
                edge_type=EdgeType.IMPORTS,
                source_symbol=None,
                target_symbol=None,
                metadata_json={"specifiers": data.get("specifiers", [])},
            )
            session.add(edge)
        session.commit()

        # ── Step 5: Compute insights ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.COMPUTING_INSIGHTS,
            current_step="Computing architecture insights...",
            progress=70,
        )

        metrics = compute_graph_metrics(graph)
        cycles = detect_cycles(graph)
        risk_scores = compute_risk_scores(graph)
        modules = identify_modules(graph)
        isolated = find_isolated_nodes(graph)

        # Save cycle insights
        for i, cycle in enumerate(cycles):
            insight = Insight(
                analysis_id=uuid.UUID(analysis_id),
                category="circular_dependency",
                severity="warning" if len(cycle) <= 3 else "info",
                title=f"Circular dependency involving {len(cycle)} files",
                description=f"Dependency cycle: {' → '.join(cycle)} → {cycle[0]}",
                affected_files=cycle,
            )
            session.add(insight)

        # Save risk insights
        for risk in risk_scores:
            insight = Insight(
                analysis_id=uuid.UUID(analysis_id),
                category="high_risk",
                severity="warning" if risk["risk_score"] > 0.6 else "info",
                title=f"High-risk file: {risk['path']}",
                description=risk["reason"],
                affected_files=[risk["path"]],
                metadata_json=risk,
            )
            session.add(insight)

        # Save isolated file insights
        if isolated:
            insight = Insight(
                analysis_id=uuid.UUID(analysis_id),
                category="dead_code_suspect",
                severity="info",
                title=f"{len(isolated)} isolated files detected",
                description="These files have no import/export relationships and may be unused",
                affected_files=isolated[:20],
            )
            session.add(insight)

        session.commit()

        # ── Step 6: Generate documentation ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.GENERATING_DOCS,
            current_step="Generating documentation...",
            progress=85,
        )

        onboarding_doc = _generate_onboarding_doc(
            repo, file_infos, modules, metrics, cycles
        )
        architecture_doc = _generate_architecture_doc(
            repo, modules, metrics, risk_scores
        )

        # ── Step 7: Finalize ──
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.INDEXING,
            current_step="Finalizing...",
            progress=95,
        )

        summary = {
            "total_files": len(file_infos),
            "total_functions": total_functions,
            "total_classes": total_classes,
            "total_lines": total_lines,
            "parse_errors": parse_errors,
            "graph_metrics": metrics,
            "cycle_count": len(cycles),
            "top_modules": modules[:10],
            "central_files": metrics.get("central_files", [])[:10],
            "risk_summary": {
                "high_risk_count": len([r for r in risk_scores if r["risk_score"] > 0.6]),
                "moderate_risk_count": len([r for r in risk_scores if r["risk_score"] <= 0.6]),
            },
            "key_modules": modules[:5],
        }

        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.COMPLETED,
            current_step="Analysis complete",
            progress=100,
            total_files=len(file_infos),
            total_functions=total_functions,
            total_classes=total_classes,
            total_lines=total_lines,
            summary_json=summary,
            onboarding_doc=onboarding_doc,
            architecture_doc=architecture_doc,
            error_message=None,
        )

        logger.info(
            "analysis_completed",
            repo_id=repo_id,
            analysis_id=analysis_id,
            files=len(file_infos),
            symbols=total_functions + total_classes,
        )

        return {"status": "completed", "files": len(file_infos)}

    except Exception as e:
        logger.exception("analysis_pipeline_failed", repo_id=repo_id, error=str(e))
        _update_analysis(
            session, analysis_id,
            status=AnalysisStatus.FAILED,
            error_message=str(e)[:2000],
        )
        raise self.retry(exc=e, countdown=30)
    finally:
        session.close()


def _create_semantic_chunks(
    session: Session,
    analysis_id: str,
    file_path: str,
    content: str,
    parse_result,
) -> None:
    """Create semantic chunks for search and AI retrieval."""
    lines = content.split("\n")

    # Chunk by symbols (function/class bodies)
    for sym in parse_result.symbols:
        start = sym.line_start - 1
        end = (sym.line_end or sym.line_start) - 1
        chunk_lines = lines[start : end + 1]
        chunk_content = "\n".join(chunk_lines)

        if len(chunk_content.strip()) < 10:
            continue

        chunk = SemanticChunk(
            analysis_id=uuid.UUID(analysis_id),
            file_path=file_path,
            chunk_type=sym.kind.value if hasattr(sym.kind, "value") else str(sym.kind),
            content=chunk_content[:4000],
            symbol_name=sym.name,
            line_start=sym.line_start,
            line_end=sym.line_end or sym.line_start,
            token_count=len(chunk_content.split()),
        )
        session.add(chunk)

    # Also chunk the full file in windows for context
    window_size = 50
    for i in range(0, len(lines), window_size):
        chunk_lines = lines[i : i + window_size]
        chunk_content = "\n".join(chunk_lines)
        if len(chunk_content.strip()) < 20:
            continue

        chunk = SemanticChunk(
            analysis_id=uuid.UUID(analysis_id),
            file_path=file_path,
            chunk_type="file_window",
            content=chunk_content[:4000],
            symbol_name=None,
            line_start=i + 1,
            line_end=min(i + window_size, len(lines)),
            token_count=len(chunk_content.split()),
        )
        session.add(chunk)


def _generate_onboarding_doc(repo, file_infos, modules, metrics, cycles) -> str:
    """Generate a deterministic onboarding document."""
    doc = f"# Onboarding Guide: {repo.name}\n\n"

    if repo.detected_framework:
        doc += f"This is a **{repo.detected_framework}** project"
        if repo.detected_language:
            doc += f" written in **{repo.detected_language}**"
        doc += ".\n\n"

    doc += f"## Quick Stats\n\n"
    doc += f"- **Files:** {len(file_infos)}\n"
    doc += f"- **Total Lines:** {sum(f['line_count'] for f in file_infos):,}\n"
    doc += f"- **Modules:** {len(modules)}\n"
    doc += f"- **Circular Dependencies:** {len(cycles)}\n\n"

    doc += "## Where to Start\n\n"
    entry_points = [f for f in file_infos if f.get("is_entry_point")]
    if entry_points:
        doc += "Start by reading these entry point files:\n\n"
        for ep in entry_points[:5]:
            doc += f"- `{ep['path']}`\n"
    else:
        doc += "Look at the top-level files in the repository root for entry points.\n"

    doc += "\n## Key Modules\n\n"
    for mod in modules[:7]:
        doc += f"### {mod['name']}/\n"
        doc += f"- {mod['file_count']} files\n"
        doc += f"- Cohesion: {mod['cohesion']:.0%}\n\n"

    if cycles:
        doc += "## ⚠️ Circular Dependencies\n\n"
        doc += f"Found {len(cycles)} circular dependency chain(s). "
        doc += "These should be addressed to improve maintainability.\n\n"
        for cycle in cycles[:5]:
            doc += f"- {' → '.join(cycle)}\n"

    central = metrics.get("central_files", [])
    if central:
        doc += "\n## Central Files\n\n"
        doc += "These files are the most connected and should be understood early:\n\n"
        for cf in central[:5]:
            doc += f"- `{cf['path']}` ({cf['connections']} connections)\n"

    return doc


def _generate_architecture_doc(repo, modules, metrics, risk_scores) -> str:
    """Generate architecture overview documentation."""
    doc = f"# Architecture Overview: {repo.name}\n\n"

    doc += "## Module Structure\n\n"
    doc += "| Module | Files | Cohesion | External Deps |\n"
    doc += "|--------|-------|----------|---------------|\n"
    for mod in modules[:15]:
        doc += f"| {mod['name']} | {mod['file_count']} | {mod['cohesion']:.0%} | {mod['external_edges']} |\n"

    doc += "\n## Dependency Metrics\n\n"
    doc += f"- **Graph Density:** {metrics.get('density', 0):.4f}\n"
    doc += f"- **Total Edges:** {metrics.get('total_edges', 0)}\n"
    doc += f"- **Avg In-Degree:** {metrics.get('avg_in_degree', 0):.2f}\n"
    doc += f"- **Avg Out-Degree:** {metrics.get('avg_out_degree', 0):.2f}\n"

    if risk_scores:
        doc += "\n## Risk Areas\n\n"
        for risk in risk_scores[:10]:
            doc += f"- **{risk['path']}** (risk: {risk['risk_score']:.2f}): {risk['reason']}\n"

    most_imported = metrics.get("most_imported", [])
    if most_imported:
        doc += "\n## Most Imported Files\n\n"
        for mi in most_imported[:10]:
            doc += f"- `{mi['path']}` — imported by {mi['importers']} files\n"

    return doc
