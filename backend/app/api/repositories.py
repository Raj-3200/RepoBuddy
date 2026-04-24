"""Repository management routes."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import raise_bad_request, raise_not_found
from app.core.logging import get_logger
from app.dependencies import get_db
from app.models.repository import Analysis, AnalysisStatus, Repository, RepositorySource
from app.schemas.repository import (
    DashboardResponse,
    RepositoryCreate,
    RepositoryListResponse,
    RepositoryResponse,
)

router = APIRouter()
settings = get_settings()
logger = get_logger(__name__)


def _dispatch_analysis(repo_id: str, analysis_id: str, access_token: str | None = None) -> None:
    """Dispatch analysis to Celery if workers are active, otherwise run in a background thread."""
    import threading

    use_celery = False
    try:
        from app.workers.celery_app import celery_app

        inspector = celery_app.control.inspect(timeout=1.0)
        active = inspector.active_queues()
        if active:
            from app.workers.tasks import run_analysis_pipeline

            run_analysis_pipeline.delay(repo_id, analysis_id, access_token=access_token)
            use_celery = True
            logger.info("celery_dispatch_ok", repo_id=repo_id)
    except Exception as exc:
        logger.warning("celery_check_failed", error=str(exc))

    if not use_celery:
        logger.info("using_thread_fallback", repo_id=repo_id, analysis_id=analysis_id)
        t = threading.Thread(
            target=_run_analysis_in_thread,
            args=(repo_id, analysis_id),
            kwargs={"access_token": access_token},
            daemon=True,
        )
        t.start()
        logger.info("analysis_thread_started", repo_id=repo_id, analysis_id=analysis_id)


def _run_analysis_in_thread(
    repo_id: str, analysis_id: str, access_token: str | None = None
) -> None:
    """Run the analysis pipeline synchronously (used when Celery is unavailable)."""
    import uuid
    from pathlib import Path

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession

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
    from app.services.repository_service import (
        clone_github_repo,
        detect_framework,
        extract_zip_repo,
        scan_repository_files,
    )

    engine = create_engine(settings.database_url_sync)
    session = SyncSession(engine)

    def _update(session, analysis_id, **kwargs):
        analysis = session.get(Analysis, uuid.UUID(analysis_id))
        if analysis:
            for k, v in kwargs.items():
                setattr(analysis, k, v)
            session.commit()

    try:
        repo = session.get(Repository, uuid.UUID(repo_id))
        if not repo:
            logger.error("thread_analysis_repo_not_found", repo_id=repo_id)
            return

        repo_dir = Path(repo.local_path)

        # Step 1: Clone / Extract
        _update(
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

        # Step 2: Scan files
        _update(
            session,
            analysis_id,
            status=AnalysisStatus.SCANNING,
            current_step="Scanning repository files...",
            progress=15,
        )

        file_infos = scan_repository_files(repo_dir)
        if not file_infos:
            _update(
                session,
                analysis_id,
                status=AnalysisStatus.FAILED,
                error_message="No supported source files found in repository",
            )
            return

        framework, language = detect_framework(repo_dir)
        repo.detected_framework = framework
        repo.detected_language = language
        session.commit()

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

        # Step 3: Parse source files
        _update(
            session,
            analysis_id,
            status=AnalysisStatus.PARSING,
            current_step="Parsing source files and extracting symbols...",
            progress=30,
        )

        parse_results = []
        total_functions = total_classes = total_lines = parse_errors = 0

        for fi in file_infos:
            file_path = repo_dir / fi["path"]
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
                result = parse_file(fi["path"], content)
                if result:
                    parse_results.append(result)
                    total_lines += result.line_count
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
                    for sym in result.symbols:
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
                        if sym.kind.value == "function":
                            total_functions += 1
                        elif sym.kind.value == "class":
                            total_classes += 1

                    # Create semantic chunks
                    lines = content.split("\n")
                    for sym in result.symbols:
                        start = sym.line_start - 1
                        end = (sym.line_end or sym.line_start) - 1
                        chunk_lines = lines[start : end + 1]
                        chunk_content = "\n".join(chunk_lines)
                        if len(chunk_content.strip()) < 10:
                            continue
                        chunk = SemanticChunk(
                            analysis_id=uuid.UUID(analysis_id),
                            file_path=fi["path"],
                            chunk_type=sym.kind.value
                            if hasattr(sym.kind, "value")
                            else str(sym.kind),
                            content=chunk_content[:4000],
                            symbol_name=sym.name,
                            line_start=sym.line_start,
                            line_end=sym.line_end or sym.line_start,
                            token_count=len(chunk_content.split()),
                        )
                        session.add(chunk)

                if result and result.errors:
                    parse_errors += len(result.errors)
            except Exception as e:
                logger.warning("file_parse_failed", file=fi["path"], error=str(e))
                parse_errors += 1

        session.commit()

        # Step 4: Build dependency graph
        _update(
            session,
            analysis_id,
            status=AnalysisStatus.BUILDING_GRAPH,
            current_step="Building dependency graph...",
            progress=55,
        )

        repo_file_paths = {fi["path"] for fi in file_infos}
        graph = build_dependency_graph(parse_results, repo_file_paths)

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

        # Step 5: Compute insights
        _update(
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

        for cycle in cycles:
            insight = Insight(
                analysis_id=uuid.UUID(analysis_id),
                category="circular_dependency",
                severity="warning" if len(cycle) <= 3 else "info",
                title=f"Circular dependency involving {len(cycle)} files",
                description=f"Dependency cycle: {' → '.join(cycle)} → {cycle[0]}",
                affected_files=cycle,
            )
            session.add(insight)
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

        # Step 6: Generate documentation
        _update(
            session,
            analysis_id,
            status=AnalysisStatus.GENERATING_DOCS,
            current_step="Generating documentation...",
            progress=85,
        )

        from app.workers.tasks import _generate_architecture_doc, _generate_onboarding_doc

        onboarding_doc = _generate_onboarding_doc(repo, file_infos, modules, metrics, cycles)
        architecture_doc = _generate_architecture_doc(repo, modules, metrics, risk_scores)

        # Step 7: Finalize
        _update(
            session,
            analysis_id,
            status=AnalysisStatus.INDEXING,
            current_step="Generating embeddings and indexing...",
            progress=95,
        )

        try:
            from app.services.embedding_service import generate_embeddings_sync

            generate_embeddings_sync(session, analysis_id)
        except Exception as e:
            logger.warning("embedding_generation_failed", error=str(e))

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

        _update(
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
            "thread_analysis_completed",
            repo_id=repo_id,
            analysis_id=analysis_id,
            files=len(file_infos),
        )

    except Exception as e:
        logger.exception("thread_analysis_failed", repo_id=repo_id, error=str(e))
        _update(session, analysis_id, status=AnalysisStatus.FAILED, error_message=str(e)[:2000])
    finally:
        session.close()
        engine.dispose()


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
    _dispatch_analysis(str(repo.id), str(analysis.id), access_token=payload.access_token)

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
    _dispatch_analysis(str(repo.id), str(analysis.id))

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

    # Get entry point files from DB
    from app.models.repository import RepoFile

    ep_result = await db.execute(
        select(RepoFile).where(
            RepoFile.repository_id == repo_id,
            RepoFile.is_entry_point == True,  # noqa: E712
        )
    )
    ep_files = ep_result.scalars().all()
    entry_points = summary.get("entry_points", [])
    if not entry_points and ep_files:
        entry_points = [{"path": f.path, "type": "entry_point"} for f in ep_files]

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
        entry_points=entry_points,
    )


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repository(repo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Repository).where(Repository.id == repo_id))
    repo = result.scalar_one_or_none()
    if not repo:
        raise_not_found("Repository not found")

    await db.delete(repo)
    logger.info("repository_deleted", repo_id=str(repo_id))
