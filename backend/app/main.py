"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.config import get_settings
from app.core.exceptions import RepoBuddyError
from app.core.logging import setup_logging, get_logger
from app.api.router import api_router

settings = get_settings()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log_level = "DEBUG" if settings.app_debug else "INFO"
    setup_logging(log_level)
    logger.info("RepoBuddy starting", env=settings.app_env)
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
