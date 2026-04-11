"""AI service — grounded Q&A over repository evidence."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.logging import get_logger
from app.models.repository import Analysis, SemanticChunk, Symbol, DependencyEdge
from app.schemas.ai import ChatMessage, ChatResponse, Citation

settings = get_settings()
logger = get_logger(__name__)


class AIService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def answer_question(
        self,
        analysis: Analysis,
        message: str,
        history: list[ChatMessage],
    ) -> ChatResponse:
        """Answer a question about the repository using retrieved evidence."""

        # Step 1: Retrieve relevant context
        context_chunks = await self._retrieve_context(analysis.id, message)

        # Step 2: Get summary info
        summary = analysis.summary_json or {}

        # Step 3: Build grounded prompt
        system_prompt = self._build_system_prompt(analysis, summary)
        evidence_text = self._format_evidence(context_chunks)

        # Step 4: Call LLM
        if not settings.openai_api_key:
            # Return a deterministic response based on retrieved evidence
            return self._build_fallback_response(message, context_chunks, summary)

        try:
            import openai

            client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

            messages = [{"role": "system", "content": system_prompt}]

            # Add conversation history
            for msg in history[-6:]:  # Keep last 6 messages
                messages.append({"role": msg.role, "content": msg.content})

            # Add current question with evidence
            user_content = f"""Question: {message}

Relevant code evidence from the repository:

{evidence_text}

Answer the question based ONLY on the evidence provided above. Cite specific files and line numbers."""

            messages.append({"role": "user", "content": user_content})

            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=messages,
                temperature=0.3,
                max_tokens=1500,
            )

            answer = response.choices[0].message.content or "I couldn't generate an answer."

            citations = [
                Citation(
                    file_path=chunk["file_path"],
                    line_start=chunk["line_start"],
                    line_end=chunk["line_end"],
                    symbol_name=chunk.get("symbol_name"),
                    snippet=chunk["content"][:200],
                )
                for chunk in context_chunks[:5]
            ]

            return ChatResponse(
                message=answer,
                citations=citations,
                suggested_questions=self._generate_followups(message),
            )

        except Exception as e:
            logger.warning("ai_call_failed", error=str(e))
            return self._build_fallback_response(message, context_chunks, summary)

    async def _retrieve_context(
        self, analysis_id, query: str, limit: int = 10
    ) -> list[dict]:
        """Retrieve relevant code chunks for the query."""
        # Text-based search (semantic search with embeddings would be added later)
        keywords = query.lower().split()

        chunks: list[dict] = []

        # Search semantic chunks
        for keyword in keywords[:5]:
            if len(keyword) < 3:
                continue
            result = await self.db.execute(
                select(SemanticChunk)
                .where(
                    SemanticChunk.analysis_id == analysis_id,
                    SemanticChunk.content.ilike(f"%{keyword}%"),
                )
                .limit(5)
            )
            for chunk in result.scalars().all():
                chunks.append({
                    "file_path": chunk.file_path,
                    "content": chunk.content[:500],
                    "symbol_name": chunk.symbol_name,
                    "line_start": chunk.line_start,
                    "line_end": chunk.line_end,
                    "chunk_type": chunk.chunk_type,
                })

        # Also search symbols
        for keyword in keywords[:5]:
            if len(keyword) < 3:
                continue
            result = await self.db.execute(
                select(Symbol)
                .where(
                    Symbol.analysis_id == analysis_id,
                    Symbol.name.ilike(f"%{keyword}%"),
                )
                .limit(5)
            )
            for sym in result.scalars().all():
                chunks.append({
                    "file_path": sym.file_path,
                    "content": sym.signature or sym.name,
                    "symbol_name": sym.name,
                    "line_start": sym.line_start,
                    "line_end": sym.line_end or sym.line_start,
                    "chunk_type": "symbol",
                })

        # Deduplicate
        seen: set[str] = set()
        unique: list[dict] = []
        for c in chunks:
            key = f"{c['file_path']}:{c['line_start']}"
            if key not in seen:
                seen.add(key)
                unique.append(c)

        return unique[:limit]

    def _build_system_prompt(self, analysis: Analysis, summary: dict) -> str:
        framework = ""
        if hasattr(analysis, "repository") and analysis.repository:
            framework = analysis.repository.detected_framework or ""

        return f"""You are an expert code assistant for the RepoBuddy platform. You help developers understand codebases.

Repository stats:
- Files: {analysis.total_files}
- Functions: {analysis.total_functions}
- Classes: {analysis.total_classes}
- Lines: {analysis.total_lines}
- Framework: {framework}
- Circular Dependencies: {summary.get('cycle_count', 0)}

Rules:
1. Only answer based on the code evidence provided
2. Always cite specific files and line numbers
3. If you don't have enough evidence, say so
4. Be concise and technical
5. Never make up code that isn't in the evidence"""

    def _format_evidence(self, chunks: list[dict]) -> str:
        if not chunks:
            return "No relevant code evidence found."

        parts = []
        for i, chunk in enumerate(chunks[:8], 1):
            header = f"[{i}] {chunk['file_path']}"
            if chunk.get("symbol_name"):
                header += f" — {chunk['symbol_name']}"
            header += f" (lines {chunk['line_start']}-{chunk['line_end']})"
            parts.append(f"{header}\n```\n{chunk['content']}\n```")

        return "\n\n".join(parts)

    def _build_fallback_response(
        self, message: str, chunks: list[dict], summary: dict
    ) -> ChatResponse:
        """Build a response without LLM, using retrieved evidence directly."""
        if not chunks:
            return ChatResponse(
                message="I couldn't find relevant code evidence for your question. Try rephrasing or searching for specific function/file names.",
                citations=[],
                suggested_questions=self._generate_followups(message),
            )

        # Build a structured response from evidence
        response_parts = [f"Based on the repository analysis, here's what I found:\n"]

        for chunk in chunks[:5]:
            if chunk.get("symbol_name"):
                response_parts.append(
                    f"- **{chunk['symbol_name']}** in `{chunk['file_path']}` "
                    f"(line {chunk['line_start']})"
                )
            else:
                response_parts.append(f"- `{chunk['file_path']}` (lines {chunk['line_start']}-{chunk['line_end']})")

        if summary:
            if summary.get("cycle_count", 0):
                response_parts.append(f"\n📊 The codebase has {summary['cycle_count']} circular dependencies.")
            modules = summary.get("top_modules", [])
            if modules:
                response_parts.append(f"\nKey modules: {', '.join(m['name'] for m in modules[:5])}")

        citations = [
            Citation(
                file_path=c["file_path"],
                line_start=c["line_start"],
                line_end=c["line_end"],
                symbol_name=c.get("symbol_name"),
                snippet=c["content"][:200],
            )
            for c in chunks[:5]
        ]

        return ChatResponse(
            message="\n".join(response_parts),
            citations=citations,
            suggested_questions=self._generate_followups(message),
        )

    def _generate_followups(self, message: str) -> list[str]:
        return [
            "What are the most central files?",
            "Are there any circular dependencies?",
            "What frameworks does this project use?",
            "Which files are the riskiest to change?",
        ]
