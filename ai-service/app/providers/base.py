from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class WordTimestamp:
    word: str
    start_ms: int
    end_ms: int
    confidence: float | None = None
    speaker_key: str | None = None


@dataclass
class TranscriptSegmentResult:
    speaker_key: str
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None = None
    words: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class TranscriptionChunkResult:
    segments: list[TranscriptSegmentResult]
    language_code: str = "en"
    average_confidence: float | None = None


class TranscriptionProvider(ABC):
    """Abstract transcription & diarization provider interface.

    Default implementation uses self-hosted open-source WhisperX + pyannote.audio.
    Optional paid providers can implement this interface later without modifying
    the backend or frontend.
    """

    name: str = "base"

    @abstractmethod
    def transcribe_and_diarize(
        self,
        wav_path: Path,
        *,
        language_code: str = "en",
        custom_vocabulary: list[str] | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> TranscriptionChunkResult:
        """Transcribes an audio chunk and attaches speaker diarization labels."""
        raise NotImplementedError


@dataclass
class SummaryResult:
    executive_summary: str
    meeting_purpose: str = ""
    main_topics: list[str] = field(default_factory=list)
    discussion_points: list[dict[str, Any]] = field(default_factory=list)
    decisions: list[dict[str, Any]] = field(default_factory=list)
    action_items: list[dict[str, Any]] = field(default_factory=list)
    challenges_concerns: list[str] = field(default_factory=list)
    risks_identified: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)
    minutes_markdown: str = ""
    model_name: str = "qwen2.5:7b"


class LLMProvider(ABC):
    """Abstract LLM provider interface for summarization and meeting intelligence.

    Default implementation connects to self-hosted Ollama (Qwen3.5 9B / Qwen2.5 7B).
    Optional external LLM APIs (OpenAI, Claude, etc.) can implement this interface.
    """

    name: str = "base"

    @abstractmethod
    def summarize_meeting(
        self,
        transcript_text: str,
        *,
        title: str = "",
        detail_level: str = "standard",
        speakers: list[str] | None = None,
    ) -> SummaryResult:
        """Generates structured meeting summary, minutes, decisions and action items."""
        raise NotImplementedError


@dataclass
class CitationResult:
    segment_id: str
    meeting_id: str
    speaker_name: str
    start_ms: int
    end_ms: int
    quote: str
    meeting_title: str = ""


@dataclass
class ChatResponseResult:
    answer: str
    citations: list[CitationResult] = field(default_factory=list)
    model_name: str = "qwen2.5:7b"


class EmbeddingProvider(ABC):
    """Abstract embedding provider interface for semantic search & RAG.

    Default implementation uses self-hosted Ollama with `nomic-embed-text`.
    """

    name: str = "base"
    vector_dim: int = 768

    @abstractmethod
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embeds a batch of texts into dense vectors."""
        raise NotImplementedError

    @abstractmethod
    def embed_query(self, text: str) -> list[float]:
        """Embeds a single query string into a dense vector."""
        raise NotImplementedError


