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

