import math
from pathlib import Path
from typing import Any

from app.config import settings
from app.providers.base import (
    TranscriptionChunkResult,
    TranscriptionProvider,
    TranscriptSegmentResult,
)


def _normalize_confidence(raw_scores: list[float]) -> float | None:
    valid = [s for s in raw_scores if isinstance(s, (int, float)) and not math.isnan(s)]
    if not valid:
        return None
    avg = sum(valid) / len(valid)
    return round(max(0.0, min(1.0, avg)), 4)


class WhisperXProvider(TranscriptionProvider):
    """Self-hosted WhisperX (large-v3) + pyannote.audio speaker diarization provider."""

    name = "whisperx"

    def __init__(self) -> None:
        self._model = None
        self._align_models: dict[str, tuple[Any, Any]] = {}
        self._diarize_pipeline = None

    def _ensure_models(self, language_code: str) -> tuple[Any, Any, Any, Any]:
        try:
            import whisperx  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "WhisperX is not installed in this Python environment. "
                "Install dependencies from ai-service/requirements.txt."
            ) from exc

        if self._model is None:
            self._model = whisperx.load_model(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
                language=language_code,
            )

        if language_code not in self._align_models:
            align_model, align_metadata = whisperx.load_align_model(
                language_code=language_code,
                device=settings.whisper_device,
            )
            self._align_models[language_code] = (align_model, align_metadata)

        if self._diarize_pipeline is None and settings.hf_token:
            from whisperx.diarize import DiarizationPipeline  # type: ignore

            self._diarize_pipeline = DiarizationPipeline(
                use_auth_token=settings.hf_token,
                device=settings.whisper_device,
            )

        align_model, align_metadata = self._align_models[language_code]
        return whisperx, self._model, (align_model, align_metadata), self._diarize_pipeline

    def transcribe_and_diarize(
        self,
        wav_path: Path,
        *,
        language_code: str = "en",
        custom_vocabulary: list[str] | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> TranscriptionChunkResult:
        whisperx, model, (align_model, align_metadata), diarize_pipeline = self._ensure_models(
            language_code
        )

        audio = whisperx.load_audio(str(wav_path))
        transcribe_kwargs: dict[str, Any] = {
            "batch_size": settings.whisper_batch_size,
            "language": language_code,
        }
        if custom_vocabulary:
            # Supply domain vocabulary hints cleanly via initial_prompt when supported
            prompt = "Domain terminology: " + ", ".join(custom_vocabulary[:50])
            transcribe_kwargs["asr_options"] = {"initial_prompt": prompt}

        try:
            raw_result = model.transcribe(audio, **transcribe_kwargs)
        except TypeError:
            transcribe_kwargs.pop("asr_options", None)
            raw_result = model.transcribe(audio, **transcribe_kwargs)

        aligned = whisperx.align(
            raw_result["segments"],
            align_model,
            align_metadata,
            audio,
            settings.whisper_device,
            return_char_alignments=False,
        )

        if diarize_pipeline is not None:
            diarize_kwargs: dict[str, Any] = {}
            if min_speakers is not None:
                diarize_kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                diarize_kwargs["max_speakers"] = max_speakers
            diarize_segments = diarize_pipeline(audio, **diarize_kwargs)
            aligned = whisperx.assign_word_speakers(diarize_segments, aligned)

        segments: list[TranscriptSegmentResult] = []
        confidence_samples: list[float] = []

        for seg in aligned.get("segments", []):
            words_payload: list[dict[str, Any]] = []
            seg_word_scores: list[float] = []

            for w in seg.get("words", []):
                score = w.get("score")
                if isinstance(score, (int, float)):
                    seg_word_scores.append(float(score))
                    confidence_samples.append(float(score))
                words_payload.append(
                    {
                        "word": str(w.get("word", "")).strip(),
                        "startMs": int(round(float(w.get("start", seg.get("start", 0.0))) * 1000)),
                        "endMs": int(round(float(w.get("end", seg.get("end", 0.0))) * 1000)),
                        "confidence": round(float(score), 4) if isinstance(score, (int, float)) else None,
                    }
                )

            seg_conf = _normalize_confidence(seg_word_scores)
            speaker_key = str(seg.get("speaker") or "SPEAKER_00")
            segments.append(
                TranscriptSegmentResult(
                    speaker_key=speaker_key,
                    start_ms=int(round(float(seg.get("start", 0.0)) * 1000)),
                    end_ms=int(round(float(seg.get("end", 0.0)) * 1000)),
                    text=str(seg.get("text", "")).strip(),
                    confidence=seg_conf,
                    words=words_payload,
                )
            )

        return TranscriptionChunkResult(
            segments=[s for s in segments if s.text],
            language_code=str(raw_result.get("language") or language_code),
            average_confidence=_normalize_confidence(confidence_samples),
        )


def get_transcription_provider(provider_name: str | None = None) -> TranscriptionProvider:
    selected = (provider_name or settings.transcription_provider or "whisperx").lower()
    if selected == "whisperx":
        return WhisperXProvider()
    raise ValueError(f"Unsupported transcription provider: {selected}")

