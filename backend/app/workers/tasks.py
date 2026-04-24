"""Background analysis tasks."""

from __future__ import annotations

import contextlib
import uuid
from pathlib import Path

from celery import shared_task
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.analysis.identity_engine import IdentityEngine
from app.analysis.quality_engine import QualityEngine
from app.analysis.stack_detector import StackDetector
from app.config import get_settings
from app.core.exceptions import InvalidRepositoryError
from app.core.logging import get_logger
from app.graph.analyzer import (
    compute_graph_metrics,
    compute_risk_scores,
    detect_cycles,
    find_isolated_nodes,
    identify_modules,
)
from app.graph.builder import build_dependency_graph
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
from app.services.embedding_service import generate_embeddings_sync
from app.services.repository_service import (
    clone_github_repo,
    detect_framework,
    extract_zip_repo,
    scan_repository_files,
)
from app.workers.celery_app import celery_app  # noqa: F401 — ensures app is loaded for shared_task

settings = get_settings()
logger = get_logger(__name__)


def _get_sync_session() -> Session:
    engine = create_engine(settings.database_url_sync)
    return Session(engine)


def _update_analysis(session: Session, analysis_id: str, **kwargs) -> None:
    with contextlib.suppress(Exception):
        session.rollback()
    analysis = session.get(Analysis, uuid.UUID(analysis_id))
    if analysis:
        for key, value in kwargs.items():
            setattr(analysis, key, value)
        session.commit()


@shared_task(bind=True, max_retries=2)
def run_analysis_pipeline(
    self, repo_id: str, analysis_id: str, access_token: str | None = None
) -> dict:
    """Main analysis pipeline — runs as a Celery background task.

    ``access_token`` is an optional per-request GitHub PAT used for private
    repositories. It is not persisted anywhere; Celery carries it across
    retries via the task's kwargs.
    """
    session = _get_sync_session()

    try:
        repo = session.get(Repository, uuid.UUID(repo_id))
        if not repo:
            return {"error": "Repository not found"}

        repo_dir = Path(repo.local_path)

        # ── Step 1: Clone / Extract ──
        _update_analysis(
            session,
            analysis_id,
            status=AnalysisStatus.CLONING,
            current_step="Cloning or extracting repository...",
            progress=5,
        )

        if repo.source == RepositorySource.GITHUB and repo.url:
            token = access_token or (settings.github_token or None)
            clone_github_repo(repo.url, repo_dir, token)
        elif repo.source == RepositorySource.UPLOAD:
            zip_path = settings.upload_path / f"{repo_id}.zip"
            if zip_path.exists():
                extract_zip_repo(zip_path, repo_dir)
            else:
                raise FileNotFoundError(f"Upload file not found: {zip_path}")

        # ── Step 2: Scan files ──
        _update_analysis(
            session,
            analysis_id,
            status=AnalysisStatus.SCANNING,
            current_step="Scanning repository files...",
            progress=15,
        )

        file_infos = scan_repository_files(repo_dir)
        if not file_infos:
            _update_analysis(
                session,
                analysis_id,
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
            session,
            analysis_id,
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
                content = content.replace("\x00", "")
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
            session,
            analysis_id,
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
            session,
            analysis_id,
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
        for _i, cycle in enumerate(cycles):
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
            session,
            analysis_id,
            status=AnalysisStatus.GENERATING_DOCS,
            current_step="Generating documentation...",
            progress=85,
        )

        onboarding_doc = _generate_onboarding_doc(repo, file_infos, modules, metrics, cycles)
        architecture_doc = _generate_architecture_doc(repo, modules, metrics, risk_scores)

        # ── Step 7: Finalize ──
        _update_analysis(
            session,
            analysis_id,
            status=AnalysisStatus.INDEXING,
            current_step="Generating embeddings and indexing...",
            progress=95,
        )

        # Generate embeddings for semantic search
        embedded_count = 0
        try:
            embedded_count = generate_embeddings_sync(session, analysis_id)
            logger.info("embeddings_generated", count=embedded_count, analysis_id=analysis_id)
        except Exception as e:
            logger.warning("embedding_generation_failed", error=str(e))
            # Non-fatal — text search still works

        # Trigger enterprise tasks (architecture snapshot + hotspots)
        try:
            from app.workers.enterprise_tasks import (
                compute_architecture_snapshot,
                compute_hotspots_and_ownership,
            )

            compute_architecture_snapshot.delay(repo_id, analysis_id)
            compute_hotspots_and_ownership.delay(repo_id, analysis_id)
            logger.info("enterprise_tasks_dispatched", repo_id=repo_id)
        except Exception as e:
            logger.warning("enterprise_tasks_dispatch_failed", error=str(e))
            # Non-fatal — core analysis still succeeds

        entry_points_list = []
        for f in file_infos:
            if not f.get("is_entry_point"):
                continue
            snippet = ""
            lang = "text"
            try:
                ep_path = repo_dir / f["path"]
                raw = ep_path.read_text(encoding="utf-8", errors="replace")
                raw = raw.replace("\x00", "")
                snippet = "\n".join(raw.splitlines()[:20])
                ext = Path(f["path"]).suffix.lower()
                lang = {
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
                }.get(ext, "text")
            except Exception:
                pass
            entry_points_list.append(
                {
                    "path": f["path"],
                    "name": f["name"],
                    "snippet": snippet,
                    "language": lang,
                }
            )

        # ── Engine: Stack Detection ──
        stack_result_dict: dict = {}
        try:
            file_contents_sample = _sample_file_contents_sync(repo_dir, file_infos, max_files=30)
            stack_detector = StackDetector(file_infos, file_contents_sample, repo_dir)
            stack_result = stack_detector.detect()
            stack_result_dict = stack_result.to_dict()
            logger.info("stack_detection_complete", technologies=len(stack_result.technologies))
        except Exception as e:
            logger.warning("stack_detection_failed", error=str(e))

        # ── Engine: Project Identity ──
        identity_result_dict: dict = {}
        try:
            all_symbol_names = []
            sym_result = session.execute(
                select(Symbol.name).where(Symbol.analysis_id == uuid.UUID(analysis_id))
            )
            all_symbol_names = [row[0] for row in sym_result.all()]

            identity_engine = IdentityEngine(file_infos, file_contents_sample, all_symbol_names)
            identity_result = identity_engine.detect()
            identity_result_dict = identity_result.to_dict()
            logger.info(
                "identity_detection_complete",
                project_type=identity_result.project_type,
                confidence=identity_result.confidence_level.value,
            )
        except Exception as e:
            logger.warning("identity_detection_failed", error=str(e))

        # ── Engine: Quality & Risk ──
        quality_result_dict: dict = {}
        try:
            edge_dicts = [
                {"source_path": e.source_path, "target_path": e.target_path}
                for e in session.execute(
                    select(DependencyEdge).where(
                        DependencyEdge.analysis_id == uuid.UUID(analysis_id)
                    )
                )
                .scalars()
                .all()
            ]
            sym_per_file: dict[str, int] = {}
            for row in session.execute(
                select(Symbol.file_path, Symbol.id).where(
                    Symbol.analysis_id == uuid.UUID(analysis_id)
                )
            ).all():
                sym_per_file[row[0]] = sym_per_file.get(row[0], 0) + 1

            quality_engine = QualityEngine(
                file_infos=file_infos,
                edges=edge_dicts,
                symbols_per_file=sym_per_file,
                graph_metrics=metrics,
                cycle_count=len(cycles),
                risk_scores=risk_scores,
                modules=modules,
            )
            quality_report = quality_engine.compute()
            quality_result_dict = quality_report.to_dict()
            logger.info(
                "quality_engine_complete",
                overall_score=quality_report.overall_score,
                anti_patterns=len(quality_report.anti_patterns),
            )
        except Exception as e:
            logger.warning("quality_engine_failed", error=str(e))

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
            "entry_points": entry_points_list[:10],
            "risk_areas": [
                {"path": r["path"], "risk_score": r["risk_score"], "reason": r["reason"]}
                for r in risk_scores[:10]
            ],
            # ── New intelligence engines ──
            "stack": stack_result_dict,
            "identity": identity_result_dict,
            "quality": quality_result_dict,
        }

        _update_analysis(
            session,
            analysis_id,
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

    except InvalidRepositoryError as e:
        # User-facing error (private repo, bad URL, etc.) — do NOT retry.
        logger.warning("analysis_pipeline_user_error", repo_id=repo_id, error=str(e))
        _update_analysis(
            session,
            analysis_id,
            status=AnalysisStatus.FAILED,
            error_message=str(e)[:2000],
        )
        return {"status": "failed", "error": str(e)}
    except Exception as e:
        logger.exception("analysis_pipeline_failed", repo_id=repo_id, error=str(e))
        _update_analysis(
            session,
            analysis_id,
            status=AnalysisStatus.FAILED,
            error_message=str(e)[:2000],
        )
        raise self.retry(exc=e, countdown=30) from e
    finally:
        session.close()


def _sample_file_contents_sync(
    repo_dir: Path, file_infos: list[dict], max_files: int = 30
) -> dict[str, str]:
    """Read a sample of key files for stack/identity detection (sync version)."""
    contents: dict[str, str] = {}
    priority_names = {
        "package.json",
        "tsconfig.json",
        "pyproject.toml",
        "requirements.txt",
        "setup.py",
        "Cargo.toml",
        "go.mod",
        "Gemfile",
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "vite.config.ts",
        "vite.config.js",
        "tailwind.config.js",
        "tailwind.config.ts",
        "angular.json",
        "svelte.config.js",
        "jest.config.ts",
        "jest.config.js",
        "vitest.config.ts",
        "README.md",
        "readme.md",
        "bun.lockb",
        "bunfig.toml",
        "prisma/schema.prisma",
    }
    config_files = [
        f
        for f in file_infos
        if Path(f["path"]).name in priority_names or f["path"] in priority_names
    ]
    entry_files = [f for f in file_infos if f.get("is_entry_point")]
    other_files = [f for f in file_infos if f not in config_files and f not in entry_files]
    ordered = config_files + entry_files + other_files

    for fi in ordered[:max_files]:
        try:
            fp = repo_dir / fi["path"]
            if fp.exists() and fp.stat().st_size < 200_000:
                raw = fp.read_text(encoding="utf-8", errors="replace")
                contents[fi["path"]] = "\n".join(raw.splitlines()[:200])
        except Exception:
            continue
    return contents


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

    doc += "## Quick Stats\n\n"
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
