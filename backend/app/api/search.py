"""Search routes."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import Analysis, SemanticChunk, Symbol
from app.schemas.ai import SearchRequest, SearchResponse, SearchResult
from app.services.embedding_service import has_embeddings, query_similar_chunks

router = APIRouter()


@router.post("", response_model=SearchResponse)
async def semantic_search(request: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Search repository content using semantic similarity with text fallback."""
    # Verify analysis exists
    result = await db.execute(select(Analysis).where(Analysis.id == request.analysis_id))
    if not result.scalar_one_or_none():
        raise_not_found("Analysis not found")

    results: list[SearchResult] = []

    # Try vector similarity search first
    use_vectors = await has_embeddings(db, request.analysis_id)
    if use_vectors:
        similar = await query_similar_chunks(
            db, request.analysis_id, request.query, limit=request.limit
        )
        for chunk in similar:
            results.append(
                SearchResult(
                    file_path=chunk["file_path"],
                    symbol_name=chunk["symbol_name"],
                    content=chunk["content"][:500],
                    line_start=chunk["line_start"],
                    line_end=chunk["line_end"],
                    score=chunk["score"],
                    chunk_type=chunk["chunk_type"],
                )
            )

    # Supplement with text-based search
    if len(results) < request.limit:
        remaining = request.limit - len(results)
        query = select(SemanticChunk).where(
            SemanticChunk.analysis_id == request.analysis_id,
            SemanticChunk.content.ilike(f"%{request.query}%"),
        )
        if request.file_filter:
            query = query.where(SemanticChunk.file_path.ilike(f"%{request.file_filter}%"))
        query = query.limit(remaining)

        chunk_result = await db.execute(query)
        for chunk in chunk_result.scalars().all():
            results.append(
                SearchResult(
                    file_path=chunk.file_path,
                    symbol_name=chunk.symbol_name,
                    content=chunk.content[:500],
                    line_start=chunk.line_start,
                    line_end=chunk.line_end,
                    score=0.5,
                    chunk_type=chunk.chunk_type,
                )
            )

    # Also search symbols by name
    sym_result = await db.execute(
        select(Symbol)
        .where(
            Symbol.analysis_id == request.analysis_id,
            Symbol.name.ilike(f"%{request.query}%"),
        )
        .limit(request.limit)
    )
    for sym in sym_result.scalars().all():
        results.append(
            SearchResult(
                file_path=sym.file_path,
                symbol_name=sym.name,
                content=sym.signature or sym.name,
                line_start=sym.line_start,
                line_end=sym.line_end or sym.line_start,
                score=0.9 if not use_vectors else 0.4,
                chunk_type="symbol",
            )
        )

    # Deduplicate
    seen: set[str] = set()
    unique_results: list[SearchResult] = []
    for r in results:
        key = f"{r.file_path}:{r.line_start}"
        if key not in seen:
            seen.add(key)
            unique_results.append(r)

    unique_results.sort(key=lambda x: x.score, reverse=True)

    return SearchResponse(
        results=unique_results[: request.limit],
        query=request.query,
        total=len(unique_results),
    )
