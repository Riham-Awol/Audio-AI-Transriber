import json
import logging
import re
from typing import Any

from app.config import settings
from app.providers.base import ChatResponseResult, CitationResult
from app.providers.ollama_provider import OllamaProvider
from app.services.vector_store import vector_store

logger = logging.getLogger(__name__)


def format_ms_to_timestamp(ms: int) -> str:
    total_seconds = max(0, ms // 1000)
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"{minutes:02d}:{seconds:02d}"


class RAGChatService:
    """Conversational RAG assistant grounded in meeting transcripts & intelligence."""

    def __init__(self, llm_provider: OllamaProvider | None = None):
        self.llm_provider = llm_provider or OllamaProvider()

    def generate_chat_answer(
        self,
        organization_id: str,
        query: str,
        history: list[dict[str, str]] | None = None,
        meeting_id: str | None = None,
        meeting_context: dict[str, Any] | None = None,
    ) -> ChatResponseResult:
        clean_query = query.strip()
        if not clean_query:
            return ChatResponseResult(
                answer="Please enter a question or query about your meetings.",
                citations=[],
                model_name=self.llm_provider.model_name,
            )

        # 1. Retrieve top relevant segments from vector store
        chunks = vector_store.similarity_search(
            organization_id=organization_id,
            query=clean_query,
            meeting_id=meeting_id,
            top_k=6,
        )

        # 2. Build citations list
        citations: list[CitationResult] = []
        for chunk in chunks:
            meta = chunk.get("metadata", {})
            citations.append(
                CitationResult(
                    segment_id=meta.get("segment_id", chunk.get("id", "")),
                    meeting_id=meta.get("meeting_id", meeting_id or ""),
                    meeting_title=meta.get("meeting_title", ""),
                    speaker_name=meta.get("speaker_name", "Speaker"),
                    start_ms=int(meta.get("start_ms", 0)),
                    end_ms=int(meta.get("end_ms", 0)),
                    quote=chunk.get("text", "")[:300],
                )
            )

        # 3. If no relevant chunks and no meeting context found
        if not chunks and not meeting_context:
            return ChatResponseResult(
                answer=(
                    "I searched the meeting transcripts in your organization, but found no mentions or discussions "
                    f"related to **'{clean_query}'**. Please try different keywords or verify that the recording has been transcribed."
                ),
                citations=[],
                model_name=self.llm_provider.model_name,
            )

        # 4. Attempt Ollama grounded response
        ollama_answer = self._query_ollama(
            query=clean_query,
            chunks=chunks,
            citations=citations,
            history=history or [],
            meeting_context=meeting_context,
        )

        if ollama_answer:
            return ChatResponseResult(
                answer=ollama_answer,
                citations=citations,
                model_name=self.llm_provider.model_name,
            )

        # 5. Deterministic fallback grounded synthesis
        fallback_answer = self._deterministic_grounded_answer(
            query=clean_query,
            chunks=chunks,
            meeting_context=meeting_context,
        )

        return ChatResponseResult(
            answer=fallback_answer,
            citations=citations,
            model_name="voxameet-rag-local",
        )

    def _query_ollama(
        self,
        query: str,
        chunks: list[dict[str, Any]],
        citations: list[CitationResult],
        history: list[dict[str, str]],
        meeting_context: dict[str, Any] | None,
    ) -> str | None:
        """Invokes Ollama with prompt grounded strictly on transcript chunks."""
        system_prompt = (
            "You are VoxaMeet AI Assistant, an enterprise meeting intelligence assistant. "
            "Your task is to answer user questions accurately and concisely based strictly on the provided meeting context and transcript excerpts.\n"
            "Rules:\n"
            "1. Answer ONLY using the facts from the transcript excerpts and context provided below.\n"
            "2. Whenever mentioning a point or fact, cite the speaker and timestamp (e.g., [Alice at 04:15]).\n"
            "3. If the user asks about something not mentioned in the transcript or context, state clearly: "
            "'Based on the meeting transcript, this topic was not discussed.' Do not guess or hallucinate."
        )

        context_lines: list[str] = ["=== TRANSCRIPT EXCERPTS ==="]
        for idx, c in enumerate(citations, 1):
            ts = format_ms_to_timestamp(c.start_ms)
            meeting_prefix = f" [{c.meeting_title}]" if c.meeting_title else ""
            context_lines.append(f"[{idx}]{meeting_prefix} {c.speaker_name} ({ts}): \"{c.quote}\"")

        if meeting_context:
            context_lines.append("\n=== MEETING SUMMARY & DECISIONS ===")
            if meeting_context.get("title"):
                context_lines.append(f"Meeting Title: {meeting_context['title']}")
            if meeting_context.get("executiveSummary"):
                context_lines.append(f"Executive Summary: {meeting_context['executiveSummary']}")
            if meeting_context.get("decisions"):
                context_lines.append("Decisions: " + ", ".join([d.get("description", "") for d in meeting_context["decisions"]]))

        # Include recent history
        hist_text = ""
        if history:
            recent = history[-4:]
            hist_text = "\n".join([f"{h['role'].title()}: {h['content']}" for h in recent]) + "\n"

        full_prompt = (
            f"{chr(10).join(context_lines)}\n\n"
            f"{hist_text}"
            f"User: {query}\n"
            "Assistant (concise, factual, grounded):"
        )

        try:
            # Simple text generation call
            import urllib.request
            payload = {
                "model": self.llm_provider.model_name,
                "prompt": full_prompt,
                "system": system_prompt,
                "stream": False,
                "options": {"temperature": 0.2, "top_p": 0.85},
            }
            req = urllib.request.Request(
                f"{self.llm_provider.ollama_url}/api/generate",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                ans = data.get("response", "").strip()
                if ans:
                    return ans
        except Exception as e:
            logger.debug("Ollama RAG generate call failed (%s). Using fallback synthesis.", e)

        return None

    def _deterministic_grounded_answer(
        self,
        query: str,
        chunks: list[dict[str, Any]],
        meeting_context: dict[str, Any] | None,
    ) -> str:
        """Deterministic NLP answer synthesis when Ollama is offline or unavailable."""
        q_lower = query.lower()

        # Handle decisions question
        if "decision" in q_lower or "agreed" in q_lower or "conclude" in q_lower:
            if meeting_context and meeting_context.get("decisions"):
                items = meeting_context["decisions"]
                ans = "Here are the key decisions recorded:\n\n"
                for i, d in enumerate(items, 1):
                    ans += f"- **{d.get('description', '')}** (Status: *{d.get('status', 'approved')}*)\n"
                return ans

        # Handle action items question
        if "action" in q_lower or "task" in q_lower or "who" in q_lower and "assigned" in q_lower:
            if meeting_context and meeting_context.get("actionItems"):
                items = meeting_context["actionItems"]
                ans = "Here are the action items identified:\n\n"
                for i, a in enumerate(items, 1):
                    assignee = a.get("assigneeName") or "Unassigned"
                    ans += f"- **{a.get('title', '')}** — assigned to *{assignee}* (Priority: {a.get('priority', 'medium')})\n"
                return ans

        # Handle summary question
        if "summary" in q_lower or "overview" in q_lower or "recap" in q_lower:
            if meeting_context and meeting_context.get("executiveSummary"):
                return f"**Executive Summary:**\n\n{meeting_context['executiveSummary']}"

        # Default: Grounded synthesis from retrieved chunks
        if not chunks:
            return (
                "Based on the meeting transcript, this topic was not discussed or no matching statements were found."
            )

        paragraphs: list[str] = [
            f"Based on the transcript excerpts matching your question about **\"{query}\"**:\n"
        ]

        for chunk in chunks[:4]:
            meta = chunk.get("metadata", {})
            speaker = meta.get("speaker_name", "Speaker")
            start_ms = int(meta.get("start_ms", 0))
            ts = format_ms_to_timestamp(start_ms)
            meeting_name = f" in *{meta.get('meeting_title')}*" if meta.get("meeting_title") else ""
            paragraphs.append(f"• **{speaker}** ({ts}{meeting_name}): \"{chunk.get('text', '').strip()}\"")

        paragraphs.append("\n*You can click on any citation pill below to jump directly to the audio recording.*")
        return "\n".join(paragraphs)


rag_chat_service = RAGChatService()

