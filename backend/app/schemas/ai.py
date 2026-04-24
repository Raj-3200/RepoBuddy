"""AI and search schemas."""

from uuid import UUID

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    analysis_id: UUID
    limit: int = Field(default=10, ge=1, le=50)
    file_filter: str | None = None


class SearchResult(BaseModel):
    file_path: str
    symbol_name: str | None
    content: str
    line_start: int
    line_end: int
    score: float
    chunk_type: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    query: str
    total: int


class ChatMessage(BaseModel):
    role: str  # user | assistant
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    analysis_id: UUID
    history: list[ChatMessage] = []


class Citation(BaseModel):
    file_path: str
    line_start: int | None = None
    line_end: int | None = None
    symbol_name: str | None = None
    snippet: str | None = None


class ChatResponse(BaseModel):
    message: str
    citations: list[Citation] = []
    suggested_questions: list[str] = []

    # Structured answer sections. Populated when the model returns JSON;
    # otherwise left empty and `message` holds the fallback text.
    direct_answer: str | None = None
    explanation: str | None = None
    related_files: list[str] = []
    confidence: str | None = None  # strong | moderate | weak | unknown
    confidence_rationale: str | None = None
    limitations: list[str] = []
    grounded: bool = True  # did the model claim to rely on evidence
