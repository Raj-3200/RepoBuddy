"""GitHub webhook service — handles incoming webhook events and triggers re-analysis."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.logging import get_logger
from app.models.enterprise import (
    PRAnalysisStatus,
    PullRequestAnalysis,
    Webhook,
    WebhookDelivery,
)
from app.models.repository import Analysis, AnalysisStatus, Repository

settings = get_settings()
logger = get_logger(__name__)


def verify_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify GitHub webhook HMAC-SHA256 signature."""
    expected = "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def generate_webhook_secret() -> str:
    """Generate a secure random webhook secret."""
    return secrets.token_hex(32)


async def handle_push_event(db: AsyncSession, webhook: Webhook, payload: dict) -> dict:
    """Handle a GitHub push event — triggers re-analysis."""
    ref = payload.get("ref", "")
    branch = ref.replace("refs/heads/", "") if ref.startswith("refs/heads/") else ref
    commit_sha = payload.get("after", "")
    payload.get("repository", {}).get("clone_url", "")

    repo_result = await db.execute(select(Repository).where(Repository.id == webhook.repository_id))
    repo = repo_result.scalar_one_or_none()
    if not repo:
        return {"skipped": True, "reason": "repository not found"}

    # Only re-analyze on default branch pushes
    default_branch = repo.default_branch or "main"
    if branch != default_branch:
        return {"skipped": True, "reason": f"push to {branch}, not {default_branch}"}

    # Create new analysis
    analysis = Analysis(
        repository_id=repo.id,
        status=AnalysisStatus.PENDING,
        current_step="Triggered by push webhook",
        progress=0,
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    # Queue Celery task
    from app.workers.tasks import run_analysis_pipeline

    run_analysis_pipeline.delay(str(repo.id), str(analysis.id))

    logger.info(
        "webhook_push_reanalysis",
        repo_id=str(repo.id),
        analysis_id=str(analysis.id),
        branch=branch,
        commit=commit_sha[:8],
    )

    return {
        "triggered": True,
        "analysis_id": str(analysis.id),
        "branch": branch,
        "commit": commit_sha[:8],
    }


async def handle_pull_request_event(db: AsyncSession, webhook: Webhook, payload: dict) -> dict:
    """Handle a GitHub pull_request event — triggers PR impact analysis."""
    action = payload.get("action", "")
    if action not in ("opened", "synchronize", "reopened"):
        return {"skipped": True, "reason": f"PR action '{action}' ignored"}

    pr = payload.get("pull_request", {})
    pr_number = pr.get("number", 0)
    pr_title = pr.get("title", "")
    pr_url = pr.get("html_url", "")
    head_branch = pr.get("head", {}).get("ref", "")
    base_branch = pr.get("base", {}).get("ref", "")

    # Get latest completed analysis as baseline
    base_result = await db.execute(
        select(Analysis)
        .where(
            Analysis.repository_id == webhook.repository_id,
            Analysis.status == AnalysisStatus.COMPLETED,
        )
        .order_by(Analysis.created_at.desc())
        .limit(1)
    )
    base_analysis = base_result.scalar_one_or_none()

    # Get changed files from payload
    for _commit in payload.get("pull_request", {}).get("commits", []):
        pass  # commits aren't in PR payload directly

    pr_analysis = PullRequestAnalysis(
        repository_id=webhook.repository_id,
        base_analysis_id=base_analysis.id if base_analysis else None,
        pr_number=pr_number,
        pr_title=pr_title,
        pr_url=pr_url,
        head_branch=head_branch,
        base_branch=base_branch,
        status=PRAnalysisStatus.PENDING,
    )
    db.add(pr_analysis)
    await db.commit()
    await db.refresh(pr_analysis)

    # Queue PR analysis task
    from app.workers.enterprise_tasks import run_pr_analysis

    run_pr_analysis.delay(str(webhook.repository_id), str(pr_analysis.id))

    logger.info(
        "webhook_pr_analysis",
        repo_id=str(webhook.repository_id),
        pr_number=pr_number,
        pr_analysis_id=str(pr_analysis.id),
    )

    return {
        "triggered": True,
        "pr_analysis_id": str(pr_analysis.id),
        "pr_number": pr_number,
    }


async def record_delivery(
    db: AsyncSession,
    webhook_id: uuid.UUID,
    event_type: str,
    payload: dict,
    result: dict,
) -> None:
    """Record a webhook delivery for audit trail."""
    delivery = WebhookDelivery(
        webhook_id=webhook_id,
        event_type=event_type,
        payload_json=payload,
        status_code=200,
        processed=True,
    )
    db.add(delivery)
    await db.commit()
