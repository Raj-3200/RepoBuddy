"""Embedding service — generates and queries OpenAI embeddings for semantic search."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    import uuid

settings = get_settings()
logger = get_logger(__name__)

# Maximum tokens per embedding request batch
_BATCH_SIZE = 100
_MAX_INPUT_TOKENS = 8000  # text-embedding-3-small limit per input


def _truncate_for_embedding(text_content: str, max_chars: int = 28000) -> str:
    """Truncate content to fit within embedding model token limits."""
    if len(text_content) <= max_chars:
        return text_content
    return text_content[:max_chars]


# ── Sync version (for Celery workers) ──


def generate_embeddings_sync(session: Session, analysis_id: str) -> int:
    """Generate embeddings for all semantic chunks of an analysis. Returns count."""
    if not settings.openai_api_key:
        logger.info("skipping_embeddings", reason="no OpenAI API key configured")
        return 0

    import openai

    client = openai.OpenAI(api_key=settings.openai_api_key)

    # Fetch chunks that don't have embeddings yet
    rows = session.execute(
        text(
            "SELECT id, content FROM semantic_chunks "
            "WHERE analysis_id = :aid AND (embedding IS NULL) "
            "ORDER BY id"
        ),
        {"aid": analysis_id},
    ).fetchall()

    if not rows:
        return 0

    total_embedded = 0

    for batch_start in range(0, len(rows), _BATCH_SIZE):
        batch = rows[batch_start : batch_start + _BATCH_SIZE]
        texts = [_truncate_for_embedding(row[1]) for row in batch]
        ids = [str(row[0]) for row in batch]

        try:
            response = client.embeddings.create(
                model=settings.embedding_model,
                input=texts,
            )

            for i, embedding_data in enumerate(response.data):
                vec = embedding_data.embedding
                vec_str = "[" + ",".join(str(v) for v in vec) + "]"
                session.execute(
                    text("UPDATE semantic_chunks SET embedding = :vec WHERE id = :cid"),
                    {"vec": vec_str, "cid": ids[i]},
                )

            session.commit()
            total_embedded += len(batch)
            logger.info(
                "embeddings_batch_complete",
                batch_size=len(batch),
                total=total_embedded,
                remaining=len(rows) - total_embedded,
            )

        except Exception as e:
            logger.warning("embedding_batch_failed", error=str(e), batch_start=batch_start)
            session.rollback()
            continue

    return total_embedded


# ── Async version (for API search) ──


async def query_similar_chunks(
    db: AsyncSession,
    analysis_id: uuid.UUID,
    query: str,
    limit: int = 10,
) -> list[dict]:
    """Find semantically similar chunks using pgvector cosine similarity."""
    if not settings.openai_api_key:
        return []

    import openai

    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    try:
        response = await client.embeddings.create(
            model=settings.embedding_model,
            input=[_truncate_for_embedding(query)],
        )
        query_vec = response.data[0].embedding
    except Exception as e:
        logger.warning("query_embedding_failed", error=str(e))
        return []

    vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

    # Use pgvector cosine distance operator (<=>)
    try:
        result = await db.execute(
            text(
                "SELECT id, file_path, chunk_type, content, symbol_name, "
                "line_start, line_end, "
                "1 - (embedding <=> :qvec::vector) AS similarity "
                "FROM semantic_chunks "
                "WHERE analysis_id = :aid AND embedding IS NOT NULL "
                "ORDER BY embedding <=> :qvec::vector "
                "LIMIT :lim"
            ),
            {"qvec": vec_str, "aid": str(analysis_id), "lim": limit},
        )
        rows = result.fetchall()
    except Exception as e:
        logger.warning("vector_search_failed", error=str(e))
        return []

    return [
        {
            "file_path": row[1],
            "chunk_type": row[2],
            "content": row[3][:500],
            "symbol_name": row[4],
            "line_start": row[5],
            "line_end": row[6],
            "score": float(row[7]) if row[7] is not None else 0.0,
        }
        for row in rows
    ]


async def has_embeddings(db: AsyncSession, analysis_id: uuid.UUID) -> bool:
    """Check if embeddings exist for this analysis."""
    try:
        result = await db.execute(
            text(
                "SELECT EXISTS(SELECT 1 FROM semantic_chunks "
                "WHERE analysis_id = :aid AND embedding IS NOT NULL LIMIT 1)"
            ),
            {"aid": str(analysis_id)},
        )
        return result.scalar() or False
    except Exception:
        return False
