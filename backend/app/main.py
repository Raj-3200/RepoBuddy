"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

import app.models
from app.api.router import api_router
from app.config import get_settings
from app.core.exceptions import RepoBuddyError
from app.core.logging import get_logger, setup_logging

settings = get_settings()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log_level = "DEBUG" if settings.app_debug else "INFO"
    setup_logging(log_level)
    logger.info("RepoBuddy starting", env=settings.app_env)

    # Production safety checks — warn loudly but don't crash, so misconfigured
    # deploys are obvious in the logs.
    if settings.app_env == "production":
        if settings.app_debug:
            logger.warning(
                "production_misconfig",
                issue="APP_DEBUG is true in production — disable it",
            )
        if settings.app_secret_key == "change-me-in-production":
            logger.warning(
                "production_misconfig",
                issue="APP_SECRET_KEY is still the default — set a real secret",
            )
        if not settings.cors_origin_list or "localhost" in settings.cors_origins:
            logger.warning(
                "production_misconfig",
                issue="CORS_ORIGINS includes localhost or is empty — restrict to real frontend origin",
            )

    yield
    logger.info("RepoBuddy shutting down")


app = FastAPI(
    title="RepoBuddy",
    description="Intelligent Codebase Understanding Platform",
    version="0.1.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/docs" if settings.app_debug else None,
    redoc_url="/redoc" if settings.app_debug else None,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Error handlers ──
@app.exception_handler(RepoBuddyError)
async def repobuddy_error_handler(_request: Request, exc: RepoBuddyError) -> ORJSONResponse:
    logger.warning("application_error", error=exc.message)
    return ORJSONResponse(
        status_code=400,
        content={"error": exc.message},
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_request: Request, exc: Exception) -> ORJSONResponse:
    logger.exception("unhandled_error", error=str(exc))
    return ORJSONResponse(
        status_code=500,
        content={"error": "An internal error occurred. Please try again later."},
    )


# ── Routes ──
app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "repobuddy"}
