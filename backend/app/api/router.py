"""Central API router."""

from fastapi import APIRouter

from app.api.repositories import router as repositories_router
from app.api.analysis import router as analysis_router
from app.api.graph import router as graph_router
from app.api.files import router as files_router
from app.api.search import router as search_router
from app.api.ai import router as ai_router
from app.api.insights import router as insights_router
from app.api.documentation import router as documentation_router

api_router = APIRouter()

api_router.include_router(repositories_router, prefix="/repositories", tags=["repositories"])
api_router.include_router(analysis_router, prefix="/analyses", tags=["analysis"])
api_router.include_router(graph_router, prefix="/graph", tags=["graph"])
api_router.include_router(files_router, prefix="/files", tags=["files"])
api_router.include_router(search_router, prefix="/search", tags=["search"])
api_router.include_router(ai_router, prefix="/ai", tags=["ai"])
api_router.include_router(insights_router, prefix="/insights", tags=["insights"])
api_router.include_router(documentation_router, prefix="/documentation", tags=["documentation"])
