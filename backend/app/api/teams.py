"""Team workspace management routes."""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.dependencies import get_db
from app.models.enterprise import (
    Team,
    TeamMember,
    TeamRepository,
    TeamRole,
)
from app.schemas.enterprise import (
    TeamCreate,
    TeamMemberAdd,
    TeamMemberResponse,
    TeamRepoAdd,
    TeamRepoResponse,
    TeamResponse,
    TeamUpdate,
)

router = APIRouter()
logger = get_logger(__name__)


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug[:255]


@router.post("", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    payload: TeamCreate,
    user_id: str = "anonymous",  # TODO: extract from auth
    db: AsyncSession = Depends(get_db),
):
    slug = _slugify(payload.name)
    existing = await db.execute(select(Team).where(Team.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    team = Team(
        name=payload.name,
        slug=slug,
        description=payload.description,
    )
    db.add(team)
    await db.flush()

    # Add creator as owner
    member = TeamMember(
        team_id=team.id,
        user_id=user_id,
        role=TeamRole.OWNER,
    )
    db.add(member)
    await db.flush()

    logger.info("team_created", team_id=str(team.id), slug=slug)
    return team


@router.get("", response_model=list[TeamResponse])
async def list_teams(
    user_id: str = "anonymous",
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == user_id)
        .order_by(Team.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(team_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.patch("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: uuid.UUID,
    payload: TeamUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if payload.name is not None:
        team.name = payload.name
    if payload.description is not None:
        team.description = payload.description
    await db.flush()
    return team


# ── Members ──


@router.get("/{team_id}/members", response_model=list[TeamMemberResponse])
async def list_members(team_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id).order_by(TeamMember.created_at)
    )
    return result.scalars().all()


@router.post(
    "/{team_id}/members", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED
)
async def add_member(
    team_id: uuid.UUID,
    payload: TeamMemberAdd,
    db: AsyncSession = Depends(get_db),
):
    # Check team exists
    team = await db.execute(select(Team).where(Team.id == team_id))
    if not team.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Team not found")

    # Check not already member
    existing = await db.execute(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == payload.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User is already a team member")

    member = TeamMember(
        team_id=team_id,
        user_id=payload.user_id,
        role=TeamRole(payload.role),
    )
    db.add(member)
    await db.flush()
    return member


@router.delete("/{team_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TeamMember).where(
            TeamMember.id == member_id,
            TeamMember.team_id == team_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    await db.delete(member)


# ── Team Repositories ──


@router.get("/{team_id}/repositories", response_model=list[TeamRepoResponse])
async def list_team_repos(team_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TeamRepository).where(TeamRepository.team_id == team_id))
    return result.scalars().all()


@router.post(
    "/{team_id}/repositories", response_model=TeamRepoResponse, status_code=status.HTTP_201_CREATED
)
async def add_team_repo(
    team_id: uuid.UUID,
    payload: TeamRepoAdd,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(TeamRepository).where(
            TeamRepository.team_id == team_id,
            TeamRepository.repository_id == payload.repository_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Repository already in team")

    tr = TeamRepository(
        team_id=team_id,
        repository_id=payload.repository_id,
    )
    db.add(tr)
    await db.flush()
    return tr


@router.delete("/{team_id}/repositories/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_repo(
    team_id: uuid.UUID,
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TeamRepository).where(
            TeamRepository.team_id == team_id,
            TeamRepository.repository_id == repo_id,
        )
    )
    tr = result.scalar_one_or_none()
    if not tr:
        raise HTTPException(status_code=404, detail="Repository not found in team")
    await db.delete(tr)
