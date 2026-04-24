"""Enterprise background tasks — PR analysis, architecture drift, hotspots, digests."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import networkx as nx
from celery import shared_task
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger
from app.graph.analyzer import (
    compute_graph_metrics,
    compute_risk_scores,
    detect_cycles,
    identify_modules,
)
from app.models.enterprise import (
    Alert,
    AlertSeverity,
    AlertStatus,
    ArchitectureSnapshot,
    Digest,
    DigestConfig,
    FileOwnership,
    Hotspot,
    PRAnalysisStatus,
    PullRequestAnalysis,
)
from app.models.repository import (
    Analysis,
    AnalysisStatus,
    DependencyEdge,
    Insight,
    RepoFile,
    Repository,
)

settings = get_settings()
logger = get_logger(__name__)


def _get_sync_session() -> Session:
    engine = create_engine(settings.database_url_sync)
    return Session(engine)


# ────────────────────────── PR Impact Analysis ──────────────────────────


@shared_task(bind=True, max_retries=1)
def run_pr_analysis(self, repo_id: str, pr_analysis_id: str) -> dict:
    """Analyze the impact of a pull request on the codebase architecture."""
    session = _get_sync_session()
    try:
        pr_analysis = session.get(PullRequestAnalysis, uuid.UUID(pr_analysis_id))
        if not pr_analysis:
            return {"error": "PR analysis not found"}

        pr_analysis.status = PRAnalysisStatus.ANALYZING
        session.commit()

        repo = session.get(Repository, uuid.UUID(repo_id))
        if not repo:
            pr_analysis.status = PRAnalysisStatus.FAILED
            pr_analysis.error_message = "Repository not found"
            session.commit()
            return {"error": "Repository not found"}

        # Get the base analysis to compare against
        base_analysis = None
        if pr_analysis.base_analysis_id:
            base_analysis = session.get(Analysis, pr_analysis.base_analysis_id)

        # Fetch changed files from GitHub API
        changed_files = _fetch_pr_changed_files(repo, pr_analysis.pr_number)
        pr_analysis.changed_files = changed_files

        if not base_analysis:
            pr_analysis.status = PRAnalysisStatus.COMPLETED
            pr_analysis.impact_summary = {
                "message": "No baseline analysis available for comparison",
                "changed_file_count": len(changed_files),
            }
            session.commit()
            return {"status": "completed", "note": "no baseline"}

        # Load existing dependency graph from base analysis
        edges = (
            session.execute(
                select(DependencyEdge).where(DependencyEdge.analysis_id == base_analysis.id)
            )
            .scalars()
            .all()
        )

        graph = nx.DiGraph()
        for edge in edges:
            graph.add_edge(edge.source_path, edge.target_path)

        # Compute impact
        changed_paths = [f["filename"] for f in changed_files] if changed_files else []
        impacted_files = set()
        for path in changed_paths:
            if path in graph:
                # Files that depend on this changed file (reverse dependents)
                try:
                    descendants = nx.descendants(graph, path)
                    impacted_files.update(descendants)
                except nx.NetworkXError:
                    pass
                # Files this changed file depends on
                try:
                    ancestors = nx.ancestors(graph, path)
                    impacted_files.update(ancestors)
                except nx.NetworkXError:
                    pass

        # Check if changes introduce new cycles
        existing_cycles = detect_cycles(graph)
        {frozenset(c) for c in existing_cycles}

        # Check risk of changed files
        risk_scores = compute_risk_scores(graph)
        risk_map = {r["path"]: r for r in risk_scores}

        high_risk_changes = []
        for path in changed_paths:
            if path in risk_map and risk_map[path]["risk_score"] > 0.5:
                high_risk_changes.append(risk_map[path])

        # Compute affected modules
        affected_modules = set()
        for path in changed_paths:
            parts = path.split("/")
            if len(parts) > 1:
                affected_modules.add(parts[0])

        overall_risk = min(
            100, int(len(changed_paths) * 5 + len(impacted_files) * 2 + len(high_risk_changes) * 15)
        )

        # Generate risk report
        risk_report = _generate_pr_risk_report(
            pr_analysis,
            changed_paths,
            impacted_files,
            high_risk_changes,
            affected_modules,
            overall_risk,
        )

        pr_analysis.impact_summary = {
            "changed_file_count": len(changed_paths),
            "impacted_file_count": len(impacted_files),
            "high_risk_change_count": len(high_risk_changes),
            "affected_module_count": len(affected_modules),
            "impacted_files": list(impacted_files)[:50],
        }
        pr_analysis.risk_score = overall_risk
        pr_analysis.risk_report = risk_report
        pr_analysis.affected_modules = list(affected_modules)
        pr_analysis.status = PRAnalysisStatus.COMPLETED
        session.commit()

        # Generate alerts if risk is high
        if overall_risk > 60:
            _create_alert(
                session,
                uuid.UUID(repo_id),
                AlertSeverity.WARNING,
                "high_risk_pr",
                f"High-risk PR #{pr_analysis.pr_number}: {pr_analysis.pr_title}",
                f"Risk score: {overall_risk}/100. "
                f"{len(high_risk_changes)} high-risk files changed, "
                f"{len(impacted_files)} files potentially impacted.",
                changed_paths,
            )

        logger.info(
            "pr_analysis_completed",
            pr_number=pr_analysis.pr_number,
            risk_score=overall_risk,
            changed=len(changed_paths),
            impacted=len(impacted_files),
        )

        return {"status": "completed", "risk_score": overall_risk}

    except Exception as e:
        logger.exception("pr_analysis_failed", error=str(e))
        if pr_analysis:
            pr_analysis.status = PRAnalysisStatus.FAILED
            pr_analysis.error_message = str(e)[:2000]
            session.commit()
        raise self.retry(exc=e, countdown=30) from e
    finally:
        session.close()


def _fetch_pr_changed_files(repo: Repository, pr_number: int) -> list[dict]:
    """Fetch changed files from GitHub API."""
    if not repo.url:
        return []

    try:
        import httpx

        # Extract owner/repo from URL
        url = repo.url.rstrip("/").rstrip(".git")
        parts = url.split("/")
        owner = parts[-2]
        repo_name = parts[-1]

        headers = {"Accept": "application/vnd.github+json"}
        if settings.github_token:
            headers["Authorization"] = f"Bearer {settings.github_token}"

        response = httpx.get(
            f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/files",
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()

        return [
            {
                "filename": f["filename"],
                "status": f["status"],
                "additions": f.get("additions", 0),
                "deletions": f.get("deletions", 0),
                "changes": f.get("changes", 0),
            }
            for f in response.json()
        ]
    except Exception as e:
        logger.warning("github_pr_files_fetch_failed", error=str(e))
        return []


def _generate_pr_risk_report(
    pr_analysis,
    changed_paths,
    impacted_files,
    high_risk_changes,
    affected_modules,
    overall_risk,
) -> str:
    """Generate a markdown risk report for a PR."""
    lines = [
        f"# PR Impact Report — #{pr_analysis.pr_number}",
        f"**{pr_analysis.pr_title}**",
        "",
        f"Branch: `{pr_analysis.head_branch}` → `{pr_analysis.base_branch}`",
        "",
        f"## Risk Score: {overall_risk}/100",
        "",
        "## Summary",
        "| Metric | Count |",
        "|--------|-------|",
        f"| Files Changed | {len(changed_paths)} |",
        f"| Files Impacted | {len(impacted_files)} |",
        f"| High-Risk Changes | {len(high_risk_changes)} |",
        f"| Modules Affected | {len(affected_modules)} |",
        "",
    ]

    if high_risk_changes:
        lines.append("## High-Risk Files Changed")
        for r in high_risk_changes[:10]:
            lines.append(f"- `{r['path']}` — risk: {r['risk_score']:.2f} — {r.get('reason', '')}")
        lines.append("")

    if affected_modules:
        lines.append("## Affected Modules")
        for m in sorted(affected_modules):
            lines.append(f"- `{m}/`")
        lines.append("")

    if impacted_files:
        lines.append("## Potentially Impacted Files (via dependency chain)")
        for f in sorted(impacted_files)[:20]:
            lines.append(f"- `{f}`")
        if len(impacted_files) > 20:
            lines.append(f"- ... and {len(impacted_files) - 20} more")

    return "\n".join(lines)


# ────────────────────────── Architecture Drift ──────────────────────────


@shared_task(bind=True, max_retries=1)
def compute_architecture_snapshot(self, repo_id: str, analysis_id: str) -> dict:
    """Create an architecture snapshot and detect drift from previous snapshot."""
    session = _get_sync_session()
    try:
        analysis = session.get(Analysis, uuid.UUID(analysis_id))
        repo = session.get(Repository, uuid.UUID(repo_id))
        if not analysis or not repo:
            return {"error": "Not found"}

        # Build current snapshot data from analysis
        edges = (
            session.execute(select(DependencyEdge).where(DependencyEdge.analysis_id == analysis.id))
            .scalars()
            .all()
        )

        files = (
            session.execute(select(RepoFile).where(RepoFile.repository_id == repo.id))
            .scalars()
            .all()
        )

        session.execute(select(Insight).where(Insight.analysis_id == analysis.id)).scalars().all()

        graph = nx.DiGraph()
        for edge in edges:
            graph.add_edge(edge.source_path, edge.target_path)

        metrics = compute_graph_metrics(graph)
        cycles = detect_cycles(graph)
        modules = identify_modules(graph)

        snapshot_data = {
            "file_count": len(files),
            "total_functions": analysis.total_functions,
            "total_classes": analysis.total_classes,
            "total_lines": analysis.total_lines,
            "edge_count": len(edges),
            "cycle_count": len(cycles),
            "cycles": [c[:5] for c in cycles[:20]],  # truncate
            "module_count": len(modules),
            "modules": [{"name": m["name"], "file_count": m["file_count"]} for m in modules[:20]],
            "central_files": metrics.get("central_files", [])[:10],
            "graph_density": metrics.get("density", 0),
            "framework": repo.detected_framework,
        }

        # Get previous snapshot
        prev_result = session.execute(
            select(ArchitectureSnapshot)
            .where(ArchitectureSnapshot.repository_id == repo.id)
            .order_by(ArchitectureSnapshot.created_at.desc())
            .limit(1)
        )
        previous = prev_result.scalar_one_or_none()

        drift = None
        if previous and previous.snapshot_data:
            drift = _compute_drift(previous.snapshot_data, snapshot_data)

        # Get commit SHA if available
        commit_sha = None
        try:
            import git

            repo_dir = Path(repo.local_path)
            if (repo_dir / ".git").exists():
                git_repo = git.Repo(repo_dir)
                commit_sha = git_repo.head.commit.hexsha
        except Exception:
            pass

        snapshot = ArchitectureSnapshot(
            repository_id=repo.id,
            analysis_id=analysis.id,
            commit_sha=commit_sha,
            branch=repo.default_branch,
            snapshot_data=snapshot_data,
            drift_from_previous=drift,
        )
        session.add(snapshot)
        session.commit()

        # Generate alerts for significant drift
        if drift:
            if drift.get("new_cycle_count", 0) > 0:
                _create_alert(
                    session,
                    repo.id,
                    AlertSeverity.WARNING,
                    "new_cycles",
                    f"{drift['new_cycle_count']} new circular dependencies detected",
                    f"Architecture drift: {drift['new_cycle_count']} new cycles introduced since last analysis.",
                    drift.get("new_cycles", []),
                )

            risk_increase = drift.get("risk_change", 0)
            if risk_increase > 10:
                _create_alert(
                    session,
                    repo.id,
                    AlertSeverity.WARNING,
                    "architecture_drift",
                    "Significant architecture change detected",
                    f"Architecture drift score: {risk_increase}. "
                    f"Files added: {drift.get('files_added', 0)}, "
                    f"Files removed: {drift.get('files_removed', 0)}, "
                    f"Dependencies changed: {drift.get('deps_added', 0)} added / {drift.get('deps_removed', 0)} removed.",
                    [],
                )

        logger.info(
            "architecture_snapshot_created",
            repo_id=repo_id,
            drift_detected=drift is not None,
        )

        return {"status": "completed", "drift": drift}

    except Exception as e:
        logger.exception("architecture_snapshot_failed", error=str(e))
        raise self.retry(exc=e, countdown=30) from e
    finally:
        session.close()


def _compute_drift(previous: dict, current: dict) -> dict:
    """Compute drift between two architecture snapshots."""
    prev_cycles = set(tuple(c) for c in previous.get("cycles", []))
    curr_cycles = set(tuple(c) for c in current.get("cycles", []))
    new_cycles = curr_cycles - prev_cycles
    resolved_cycles = prev_cycles - curr_cycles

    prev_modules = {m["name"] for m in previous.get("modules", [])}
    curr_modules = {m["name"] for m in current.get("modules", [])}

    files_added = max(0, current.get("file_count", 0) - previous.get("file_count", 0))
    files_removed = max(0, previous.get("file_count", 0) - current.get("file_count", 0))
    deps_added = max(0, current.get("edge_count", 0) - previous.get("edge_count", 0))
    deps_removed = max(0, previous.get("edge_count", 0) - current.get("edge_count", 0))

    risk_change = (
        abs(files_added - files_removed) + abs(deps_added - deps_removed) * 2 + len(new_cycles) * 5
    )

    return {
        "files_added": files_added,
        "files_removed": files_removed,
        "deps_added": deps_added,
        "deps_removed": deps_removed,
        "new_cycle_count": len(new_cycles),
        "resolved_cycle_count": len(resolved_cycles),
        "new_cycles": [list(c) for c in new_cycles],
        "resolved_cycles": [list(c) for c in resolved_cycles],
        "modules_added": list(curr_modules - prev_modules),
        "modules_removed": list(prev_modules - curr_modules),
        "risk_change": risk_change,
        "lines_delta": current.get("total_lines", 0) - previous.get("total_lines", 0),
        "functions_delta": current.get("total_functions", 0) - previous.get("total_functions", 0),
    }


# ────────────────────────── Hotspot / Ownership ──────────────────────────


@shared_task(bind=True, max_retries=1)
def compute_hotspots_and_ownership(self, repo_id: str, analysis_id: str) -> dict:
    """Compute file hotspots and ownership from git history."""
    session = _get_sync_session()
    try:
        repo = session.get(Repository, uuid.UUID(repo_id))
        if not repo:
            return {"error": "Repository not found"}

        repo_dir = Path(repo.local_path)

        # Try to extract git history
        ownership_data = {}
        try:
            import git

            git_repo = git.Repo(repo_dir)
            for commit in git_repo.iter_commits(max_count=500):
                author = commit.author.name or commit.author.email
                for diff in commit.diff(commit.parents[0] if commit.parents else git.NULL_TREE):
                    path = diff.b_path or diff.a_path
                    if not path:
                        continue
                    if path not in ownership_data:
                        ownership_data[path] = {
                            "contributors": {},
                            "commit_count": 0,
                            "last_modified": commit.committed_datetime,
                        }
                    ownership_data[path]["commit_count"] += 1
                    ownership_data[path]["contributors"][author] = (
                        ownership_data[path]["contributors"].get(author, 0) + 1
                    )
                    if commit.committed_datetime > ownership_data[path]["last_modified"]:
                        ownership_data[path]["last_modified"] = commit.committed_datetime
        except Exception as e:
            logger.warning("git_history_extraction_failed", error=str(e))

        # Save ownership records
        for path, data in ownership_data.items():
            contributors = data["contributors"]
            primary_owner = max(contributors, key=contributors.get) if contributors else None
            churn = data["commit_count"]

            existing = session.execute(
                select(FileOwnership).where(
                    FileOwnership.repository_id == uuid.UUID(repo_id),
                    FileOwnership.file_path == path,
                )
            ).scalar_one_or_none()

            if existing:
                existing.primary_owner = primary_owner
                existing.contributors = [
                    {"name": k, "commits": v}
                    for k, v in sorted(contributors.items(), key=lambda x: x[1], reverse=True)
                ]
                existing.commit_count = churn
                existing.churn_score = min(100, churn * 3)
                existing.last_modified_at = data["last_modified"]
            else:
                session.add(
                    FileOwnership(
                        repository_id=uuid.UUID(repo_id),
                        file_path=path,
                        primary_owner=primary_owner,
                        contributors=[
                            {"name": k, "commits": v}
                            for k, v in sorted(
                                contributors.items(), key=lambda x: x[1], reverse=True
                            )
                        ],
                        commit_count=churn,
                        churn_score=min(100, churn * 3),
                        last_modified_at=data["last_modified"],
                    )
                )

        session.commit()

        # Compute hotspots by combining churn with graph risk
        analysis = session.get(Analysis, uuid.UUID(analysis_id))
        if not analysis:
            return {"ownership": len(ownership_data), "hotspots": 0}

        edges = (
            session.execute(select(DependencyEdge).where(DependencyEdge.analysis_id == analysis.id))
            .scalars()
            .all()
        )

        graph = nx.DiGraph()
        for edge in edges:
            graph.add_edge(edge.source_path, edge.target_path)

        risk_scores = {r["path"]: r["risk_score"] for r in compute_risk_scores(graph)}

        # Delete old hotspots for this analysis
        session.execute(
            select(Hotspot).where(Hotspot.analysis_id == analysis.id)
        )  # just to verify exists

        hotspot_count = 0
        for path, data in ownership_data.items():
            churn = data["commit_count"]
            risk = risk_scores.get(path, 0)
            in_degree = graph.in_degree(path) if path in graph else 0
            out_degree = graph.out_degree(path) if path in graph else 0

            # Hotspot score: combination of churn + graph risk + connectivity
            score = int(
                min(100, churn * 2) * 0.4
                + risk * 100 * 0.3
                + min(100, (in_degree + out_degree) * 10) * 0.3
            )

            if score < 20:
                continue

            reasons = []
            if churn > 10:
                reasons.append("high_churn")
            if risk > 0.5:
                reasons.append("high_complexity")
            if in_degree > 5:
                reasons.append("many_dependents")
            if out_degree > 10:
                reasons.append("many_dependencies")

            # Check if part of a cycle
            cycles = detect_cycles(graph)
            for cycle in cycles:
                if path in cycle:
                    reasons.append("cycle_member")
                    break

            recommendation = _generate_hotspot_recommendation(path, score, reasons)

            session.add(
                Hotspot(
                    repository_id=uuid.UUID(repo_id),
                    analysis_id=analysis.id,
                    file_path=path,
                    hotspot_score=score,
                    reasons=reasons,
                    recommendation=recommendation,
                )
            )
            hotspot_count += 1

        session.commit()

        logger.info(
            "hotspots_computed",
            repo_id=repo_id,
            ownership_files=len(ownership_data),
            hotspots=hotspot_count,
        )

        return {"ownership": len(ownership_data), "hotspots": hotspot_count}

    except Exception as e:
        logger.exception("hotspot_computation_failed", error=str(e))
        raise self.retry(exc=e, countdown=30) from e
    finally:
        session.close()


def _generate_hotspot_recommendation(path: str, score: int, reasons: list[str]) -> str:
    """Generate a recommendation for a hotspot file."""
    parts = [f"**{path}** (hotspot score: {score}/100)"]
    if "high_churn" in reasons:
        parts.append("- This file changes frequently. Consider refactoring into smaller modules.")
    if "high_complexity" in reasons:
        parts.append("- High architectural risk. Changes here may have cascading effects.")
    if "many_dependents" in reasons:
        parts.append("- Many files depend on this. Add tests and review changes carefully.")
    if "many_dependencies" in reasons:
        parts.append("- This file imports many modules. Consider reducing coupling.")
    if "cycle_member" in reasons:
        parts.append(
            "- Part of a circular dependency. Breaking this cycle would improve architecture."
        )
    return "\n".join(parts)


# ────────────────────────── Weekly Digest ──────────────────────────


@shared_task(bind=True)
def generate_weekly_digest(self, config_id: str) -> dict:
    """Generate a weekly architecture digest for a team."""
    session = _get_sync_session()
    try:
        config = session.get(DigestConfig, uuid.UUID(config_id))
        if not config or not config.is_enabled:
            return {"skipped": True}

        now = datetime.now(UTC)
        period_start = now - timedelta(days=7)
        period_end = now

        # Get repos for this team
        from app.models.enterprise import TeamRepository

        team_repos = (
            session.execute(select(TeamRepository).where(TeamRepository.team_id == config.team_id))
            .scalars()
            .all()
        )

        repo_ids = [tr.repository_id for tr in team_repos]
        if config.include_repos:
            repo_ids = [
                uuid.UUID(r) for r in config.include_repos if r in [str(rid) for rid in repo_ids]
            ]

        if not repo_ids:
            return {"skipped": True, "reason": "no repos"}

        digest_parts = [
            "# Weekly Architecture Digest",
            f"Period: {period_start.date()} to {period_end.date()}",
            "",
        ]

        summary_data = {
            "repos_count": len(repo_ids),
            "new_analyses": 0,
            "new_alerts": 0,
            "total_drift_score": 0,
        }

        for repo_id in repo_ids:
            repo = session.get(Repository, repo_id)
            if not repo:
                continue

            # Get analyses from this period
            analyses = (
                session.execute(
                    select(Analysis).where(
                        Analysis.repository_id == repo_id,
                        Analysis.created_at >= period_start,
                        Analysis.status == AnalysisStatus.COMPLETED,
                    )
                )
                .scalars()
                .all()
            )

            summary_data["new_analyses"] += len(analyses)

            # Get alerts from this period
            alerts = (
                session.execute(
                    select(Alert).where(
                        Alert.repository_id == repo_id,
                        Alert.created_at >= period_start,
                    )
                )
                .scalars()
                .all()
            )

            summary_data["new_alerts"] += len(alerts)

            # Get latest snapshot drift
            snapshot = session.execute(
                select(ArchitectureSnapshot)
                .where(
                    ArchitectureSnapshot.repository_id == repo_id,
                    ArchitectureSnapshot.created_at >= period_start,
                )
                .order_by(ArchitectureSnapshot.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()

            digest_parts.append(f"## {repo.name}")

            if analyses:
                latest = analyses[-1]
                digest_parts.append(f"- **{len(analyses)} analysis runs** this period")
                digest_parts.append(
                    f"- Files: {latest.total_files} | Functions: {latest.total_functions} | Classes: {latest.total_classes}"
                )

            if alerts:
                critical = [a for a in alerts if a.severity == "critical"]
                warnings = [a for a in alerts if a.severity == "warning"]
                digest_parts.append(
                    f"- **Alerts:** {len(critical)} critical, {len(warnings)} warnings"
                )
                for a in alerts[:5]:
                    digest_parts.append(f"  - [{a.severity}] {a.title}")

            if snapshot and snapshot.drift_from_previous:
                drift = snapshot.drift_from_previous
                drift_score = drift.get("risk_change", 0)
                summary_data["total_drift_score"] += drift_score
                digest_parts.append(f"- **Architecture drift:** score {drift_score}")
                if drift.get("new_cycle_count", 0):
                    digest_parts.append(f"  - {drift['new_cycle_count']} new circular dependencies")
                if drift.get("files_added", 0):
                    digest_parts.append(f"  - {drift['files_added']} files added")
                if drift.get("modules_added"):
                    digest_parts.append(f"  - New modules: {', '.join(drift['modules_added'][:5])}")

            digest_parts.append("")

        content = "\n".join(digest_parts)

        digest = Digest(
            config_id=config.id,
            period_start=period_start,
            period_end=period_end,
            content=content,
            summary_json=summary_data,
            sent=False,
        )
        session.add(digest)
        session.commit()

        logger.info("weekly_digest_generated", config_id=config_id, repos=len(repo_ids))

        return {"status": "generated", "repos": len(repo_ids)}

    except Exception as e:
        logger.exception("digest_generation_failed", error=str(e))
        return {"error": str(e)}
    finally:
        session.close()


# ────────────────────────── Helpers ──────────────────────────


def _create_alert(
    session: Session,
    repository_id: uuid.UUID,
    severity: AlertSeverity,
    alert_type: str,
    title: str,
    description: str,
    affected_files: list,
) -> None:
    """Create an alert record."""
    alert = Alert(
        repository_id=repository_id,
        severity=severity,
        status=AlertStatus.ACTIVE,
        title=title,
        description=description,
        alert_type=alert_type,
        affected_files=affected_files[:50],
    )
    session.add(alert)
    session.commit()
