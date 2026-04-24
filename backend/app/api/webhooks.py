"""Webhook management and delivery routes."""

import hashlib
import hmac
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.dependencies import get_db
from app.models.enterprise import (
    TeamRepository,
    Webhook,
    WebhookDelivery,
)
from app.models.repository import Analysis, AnalysisStatus, Repository
from app.schemas.enterprise import (
    WebhookCreate,
    WebhookDeliveryResponse,
    WebhookResponse,
)
from app.services.webhook_service import (
    generate_webhook_secret,
)

router = APIRouter()
logger = get_logger(__name__)


@router.post(
    "/teams/{team_id}", response_model=WebhookResponse, status_code=status.HTTP_201_CREATED
)
async def create_webhook(
    team_id: uuid.UUID,
    payload: WebhookCreate,
    db: AsyncSession = Depends(get_db),
):
    # Verify repo is in team
    tr = await db.execute(
        select(TeamRepository).where(
            TeamRepository.team_id == team_id,
            TeamRepository.repository_id == payload.repository_id,
        )
    )
    if not tr.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Repository not in team")

    secret = generate_webhook_secret()
    webhook = Webhook(
        team_id=team_id,
        repository_id=payload.repository_id,
        secret=secret,
        events=payload.events,
        is_active=True,
    )
    db.add(webhook)
    await db.flush()

    logger.info("webhook_created", webhook_id=str(webhook.id), team_id=str(team_id))
    return webhook


@router.get("/teams/{team_id}", response_model=list[WebhookResponse])
async def list_webhooks(team_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Webhook).where(Webhook.team_id == team_id).order_by(Webhook.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(webhook_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    wh = result.scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(wh)


@router.get("/{webhook_id}/deliveries", response_model=list[WebhookDeliveryResponse])
async def list_deliveries(webhook_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


# ── GitHub webhook receiver ──


@router.post("/github/callback")
async def github_webhook_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """Receive and process GitHub webhook events."""
    body = await request.body()
    event_type = request.headers.get("X-GitHub-Event", "")
    signature = request.headers.get("X-Hub-Signature-256", "")
    delivery_id = request.headers.get("X-GitHub-Delivery", "")

    if not event_type:
        raise HTTPException(status_code=400, detail="Missing X-GitHub-Event header")

    import orjson

    try:
        payload = orjson.loads(body)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from e

    # Determine which webhook this is for based on the repository URL
    repo_url = payload.get("repository", {}).get("html_url", "")
    if not repo_url:
        return {"status": "ignored", "reason": "no repository URL"}

    # Find matching webhook
    repo_result = await db.execute(select(Repository).where(Repository.url == repo_url))
    repo = repo_result.scalar_one_or_none()
    if not repo:
        # Try with .git suffix
        repo_result = await db.execute(
            select(Repository).where(Repository.url == repo_url + ".git")
        )
        repo = repo_result.scalar_one_or_none()

    if not repo:
        return {"status": "ignored", "reason": "repository not found"}

    webhook_result = await db.execute(
        select(Webhook).where(
            Webhook.repository_id == repo.id,
            Webhook.is_active,
        )
    )
    webhook = webhook_result.scalar_one_or_none()

    # Verify signature if webhook has a secret
    if webhook and signature:
        expected = "sha256=" + hmac.new(webhook.secret.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            logger.warning("webhook_signature_mismatch", webhook_id=str(webhook.id))
            raise HTTPException(status_code=403, detail="Invalid signature")

    # Process the event
    result = {"event": event_type, "delivery": delivery_id}

    if event_type == "push":
        from app.workers.tasks import run_analysis_pipeline

        # Get default branch
        default_branch = payload.get("repository", {}).get("default_branch", "main")
        ref = payload.get("ref", "")
        if ref == f"refs/heads/{default_branch}":
            # Create a new analysis on push to default branch
            analysis = Analysis(
                repository_id=repo.id,
                status=AnalysisStatus.PENDING,
            )
            db.add(analysis)
            await db.flush()

            try:
                run_analysis_pipeline.delay(str(repo.id), str(analysis.id))
                result["action"] = "re-analysis triggered"
                result["analysis_id"] = str(analysis.id)
            except Exception as exc:
                logger.warning("celery_dispatch_failed", error=str(exc))
                result["action"] = "re-analysis queued (celery unavailable)"
        else:
            result["action"] = "ignored (not default branch)"

    elif event_type == "pull_request":
        action = payload.get("action", "")
        if action in ("opened", "synchronize", "reopened"):
            from app.models.enterprise import PRAnalysisStatus, PullRequestAnalysis
            from app.workers.enterprise_tasks import run_pr_analysis

            pr = payload.get("pull_request", {})

            # Find latest completed analysis as baseline
            base_result = await db.execute(
                select(Analysis)
                .where(
                    Analysis.repository_id == repo.id,
                    Analysis.status == AnalysisStatus.COMPLETED,
                )
                .order_by(Analysis.created_at.desc())
                .limit(1)
            )
            base_analysis = base_result.scalar_one_or_none()

            pr_analysis = PullRequestAnalysis(
                repository_id=repo.id,
                base_analysis_id=base_analysis.id if base_analysis else None,
                pr_number=pr.get("number", 0),
                pr_title=pr.get("title", ""),
                pr_url=pr.get("html_url", ""),
                head_branch=pr.get("head", {}).get("ref", ""),
                base_branch=pr.get("base", {}).get("ref", ""),
                status=PRAnalysisStatus.PENDING,
            )
            db.add(pr_analysis)
            await db.flush()

            try:
                run_pr_analysis.delay(str(repo.id), str(pr_analysis.id))
                result["action"] = "PR analysis triggered"
                result["pr_analysis_id"] = str(pr_analysis.id)
            except Exception as exc:
                logger.warning("celery_dispatch_failed", error=str(exc))
                result["action"] = "PR analysis queued (celery unavailable)"
        else:
            result["action"] = f"ignored PR action: {action}"
    else:
        result["action"] = f"unhandled event: {event_type}"

    # Record delivery
    if webhook:
        delivery = WebhookDelivery(
            webhook_id=webhook.id,
            event_type=event_type,
            payload_json={"delivery_id": delivery_id, "action": result.get("action")},
            status_code=200,
            processed=True,
        )
        db.add(delivery)

    logger.info("webhook_processed", event=event_type, result=result.get("action"))
    return result
