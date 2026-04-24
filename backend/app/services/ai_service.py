"""AI service — grounded Q&A over repository evidence."""

from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.logging import get_logger
from app.models.repository import Analysis, Repository, SemanticChunk, Symbol
from app.schemas.ai import ChatMessage, ChatResponse, Citation
from app.services.embedding_service import has_embeddings, query_similar_chunks

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

        # Step 2b: Load repository for framework info (avoid lazy load in async)
        repo_result = await self.db.execute(
            select(Repository).where(Repository.id == analysis.repository_id)
        )
        repo = repo_result.scalar_one_or_none()

        # Step 3: Build grounded prompt
        system_prompt = self._build_system_prompt(analysis, summary, repo)
        evidence_text = self._format_evidence(context_chunks)

        # Step 4: Call LLM
        if not settings.openai_api_key:
            # Return a deterministic response based on retrieved evidence
            return self._build_fallback_response(message, context_chunks, summary)

        try:
            import openai

            client = openai.AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url or None,
            )

            messages = [{"role": "system", "content": system_prompt}]

            # Add conversation history
            for msg in history[-6:]:  # Keep last 6 messages
                messages.append({"role": msg.role, "content": msg.content})

            # Add current question with evidence
            user_content = f"""Question: {message}

Relevant code evidence from the repository:

{evidence_text}

Answer the question based ONLY on the evidence provided above.

Respond as strict JSON matching exactly this schema (no prose outside the JSON):
{{
  "direct_answer": "1-3 sentence direct answer to the question",
  "explanation": "supporting explanation that walks the reader through the evidence",
  "related_files": ["path/to/file.ts", ...],
  "confidence": "strong | moderate | weak | unknown",
  "confidence_rationale": "one short sentence on why this confidence level",
  "limitations": ["what the evidence does not cover", ...],
  "follow_ups": ["suggested follow-up question", ...]
}}

Rules:
- If the evidence does not support a confident answer, set confidence to "weak" or "unknown" and say what is missing in `limitations`.
- `related_files` must only contain files that appear in the evidence block above.
- Do NOT invent code or files. Do NOT speculate. Do NOT wrap the JSON in markdown fences."""

            messages.append({"role": "user", "content": user_content})

            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=messages,
                temperature=0.2,
                max_tokens=1500,
            )

            raw = response.choices[0].message.content or ""
            parsed = _parse_structured_json(raw)

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

            if parsed is None:
                # Model didn't produce valid JSON — fall back to unstructured message.
                return ChatResponse(
                    message=raw.strip() or "I couldn't generate a structured answer.",
                    citations=citations,
                    suggested_questions=self._generate_followups(message),
                    grounded=bool(context_chunks),
                )

            direct = (parsed.get("direct_answer") or "").strip()
            explanation = (parsed.get("explanation") or "").strip()
            related = [str(p) for p in (parsed.get("related_files") or []) if p][:8]
            confidence = (parsed.get("confidence") or "moderate").strip().lower()
            if confidence not in {"strong", "moderate", "weak", "unknown"}:
                confidence = "moderate"
            rationale = (parsed.get("confidence_rationale") or "").strip() or None
            limitations = [str(x) for x in (parsed.get("limitations") or []) if x][:5]
            follow_ups = [str(x) for x in (parsed.get("follow_ups") or []) if x][:4]
            if not follow_ups:
                follow_ups = self._generate_followups(message)

            # Compose the plain-text `message` for clients that only read that field.
            composed = direct
            if explanation:
                composed += f"\n\n{explanation}"

            return ChatResponse(
                message=composed or "I couldn't generate an answer.",
                citations=citations,
                suggested_questions=follow_ups,
                direct_answer=direct or None,
                explanation=explanation or None,
                related_files=related,
                confidence=confidence,
                confidence_rationale=rationale,
                limitations=limitations,
                grounded=bool(context_chunks),
            )

        except Exception as e:
            logger.warning("ai_call_failed", error=str(e))
            return self._build_fallback_response(message, context_chunks, summary)

    async def _retrieve_context(self, analysis_id, query: str, limit: int = 10) -> list[dict]:
        """Retrieve relevant code chunks — vector search first, text fallback."""
        chunks: list[dict] = []

        # Try semantic vector search first
        use_vectors = await has_embeddings(self.db, analysis_id)
        if use_vectors:
            similar = await query_similar_chunks(self.db, analysis_id, query, limit=limit)
            for chunk in similar:
                chunks.append(chunk)

        # Supplement with text-based keyword search if not enough results
        if len(chunks) < limit:
            keywords = query.lower().split()
            limit - len(chunks)
            seen_keys = {f"{c['file_path']}:{c['line_start']}" for c in chunks}

            for keyword in keywords[:5]:
                if len(keyword) < 3 or len(chunks) >= limit:
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
                    key = f"{chunk.file_path}:{chunk.line_start}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        chunks.append(
                            {
                                "file_path": chunk.file_path,
                                "content": chunk.content[:500],
                                "symbol_name": chunk.symbol_name,
                                "line_start": chunk.line_start,
                                "line_end": chunk.line_end,
                                "chunk_type": chunk.chunk_type,
                                "score": 0.3,
                            }
                        )

        # Also search symbols
        keywords = query.lower().split()
        seen_keys = {f"{c['file_path']}:{c['line_start']}" for c in chunks}
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
                key = f"{sym.file_path}:{sym.line_start}"
                if key not in seen_keys:
                    seen_keys.add(key)
                    chunks.append(
                        {
                            "file_path": sym.file_path,
                            "content": sym.signature or sym.name,
                            "symbol_name": sym.name,
                            "line_start": sym.line_start,
                            "line_end": sym.line_end or sym.line_start,
                            "chunk_type": "symbol",
                            "score": 0.2,
                        }
                    )

        return chunks[:limit]

    def _build_system_prompt(
        self, analysis: Analysis, summary: dict, repo: Repository | None = None
    ) -> str:
        framework = ""
        if repo:
            framework = repo.detected_framework or ""

        return f"""You are a grounded code-analysis assistant for the RepoBuddy platform.

You answer questions about this specific repository using ONLY the evidence supplied in each turn.

Repository stats:
- Files: {analysis.total_files}
- Functions: {analysis.total_functions}
- Classes: {analysis.total_classes}
- Lines: {analysis.total_lines}
- Framework: {framework}
- Circular Dependencies: {summary.get("cycle_count", 0)}

Hard rules:
1. Answer only from the evidence provided in the user turn. Never invent code, symbols, or files.
2. If the evidence is insufficient, say so and set confidence accordingly — do not guess.
3. Always cite specific file paths when making a claim.
4. Be concise, technical, and neutral.
5. Your output MUST be valid JSON when the user turn asks for it — no markdown fences, no commentary."""

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
        """Deterministic response used when no LLM is configured or a call fails.

        Populates the structured answer fields so the UI rendering stays consistent.
        """
        follow_ups = self._generate_followups(message)

        if not chunks:
            return ChatResponse(
                message=(
                    "I couldn't find relevant code evidence for your question. "
                    "Try rephrasing or searching for specific file or symbol names."
                ),
                citations=[],
                suggested_questions=follow_ups,
                direct_answer="No supporting evidence was retrieved.",
                explanation=None,
                related_files=[],
                confidence="unknown",
                confidence_rationale="Retrieval returned no relevant code chunks.",
                limitations=[
                    "No semantic or keyword match was found for this query.",
                    "Try asking about specific file names, symbols, or modules.",
                ],
                grounded=False,
            )

        # Synthesize a structured answer from the retrieved chunks.
        top = chunks[:5]
        related = list({c["file_path"] for c in top})

        bullet_lines = []
        for c in top:
            if c.get("symbol_name"):
                bullet_lines.append(
                    f"- `{c['symbol_name']}` in `{c['file_path']}` "
                    f"(lines {c['line_start']}-{c['line_end']})"
                )
            else:
                bullet_lines.append(
                    f"- `{c['file_path']}` (lines {c['line_start']}-{c['line_end']})"
                )

        direct = (
            f"Found {len(top)} relevant location(s) in the codebase. "
            "No language model is configured, so the answer is limited to pointing at the evidence."
        )
        explanation_parts = ["The closest matches in the repository are:", *bullet_lines]
        if summary:
            if summary.get("cycle_count", 0):
                explanation_parts.append(
                    f"\nContext: the codebase has {summary['cycle_count']} circular dependencies."
                )
            modules = summary.get("top_modules", [])
            if modules:
                explanation_parts.append(
                    f"Key modules: {', '.join(m['name'] for m in modules[:5])}."
                )
        explanation = "\n".join(explanation_parts)

        citations = [
            Citation(
                file_path=c["file_path"],
                line_start=c["line_start"],
                line_end=c["line_end"],
                symbol_name=c.get("symbol_name"),
                snippet=c["content"][:200],
            )
            for c in top
        ]

        return ChatResponse(
            message=f"{direct}\n\n{explanation}",
            citations=citations,
            suggested_questions=follow_ups,
            direct_answer=direct,
            explanation=explanation,
            related_files=related,
            confidence="moderate",
            confidence_rationale="Answer is based on retrieval alone, without a language model.",
            limitations=[
                "No LLM is configured — synthesis is limited to retrieved snippets.",
                "This response does not interpret the evidence; it only locates it.",
            ],
            grounded=True,
        )

    def _generate_followups(self, message: str) -> list[str]:
        return [
            "What are the most central files?",
            "Are there any circular dependencies?",
            "What frameworks does this project use?",
            "Which files are the riskiest to change?",
        ]


# ─────────────────────────── Module-level helpers ───────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{[\s\S]*\}")


def _parse_structured_json(raw: str) -> dict | None:
    """Best-effort parse of a model-produced JSON answer.

    Tolerates markdown code fences, stray whitespace, and a leading/trailing prose
    paragraph. Returns None if no object can be recovered.
    """
    if not raw:
        return None
    text = raw.strip()
    # Strip ``` fences if present.
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].lstrip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = _JSON_BLOCK_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None
