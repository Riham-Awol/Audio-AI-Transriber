import math
import shutil
import time
from pathlib import Path
from typing import Any

import httpx

from app.config import settings
from app.providers.base import TranscriptionChunkResult, TranscriptSegmentResult
from app.providers.whisperx_provider import get_transcription_provider
from app.services.audio_processor import extract_normalized_wav, segment_wav_file


def merge_chunk_results(
    chunk_outputs: list[tuple[int, TranscriptionChunkResult]],
    speaker_hints: list[str] | None = None,
) -> dict[str, Any]:
    """Merges chunk-level WhisperX + pyannote results into a single timeline.

    Adjusts segment and word timestamps by each chunk's millisecond offset,
    deduplicates overlap boundaries, and preserves consistent speaker labels.
    """
    merged_segments: list[dict[str, Any]] = []
    speaker_durations_ms: dict[str, int] = {}
    speaker_order: list[str] = []
    confidence_values: list[float] = []

    last_end_ms = -1

    for offset_ms, result in chunk_outputs:
        if result.average_confidence is not None:
            confidence_values.append(result.average_confidence)

        for seg in result.segments:
            abs_start = seg.start_ms + offset_ms
            abs_end = max(abs_start, seg.end_ms + offset_ms)

            # Skip segments completely inside the previous chunk's overlap window
            if last_end_ms >= 0 and abs_end <= last_end_ms + 250:
                continue

            if abs_start < last_end_ms:
                abs_start = last_end_ms

            speaker_key = seg.speaker_key or "SPEAKER_00"
            if speaker_key not in speaker_durations_ms:
                speaker_durations_ms[speaker_key] = 0
                speaker_order.append(speaker_key)
            speaker_durations_ms[speaker_key] += max(0, abs_end - abs_start)

            shifted_words = [
                {
                    "word": w.get("word", ""),
                    "startMs": int(w.get("startMs", 0)) + offset_ms,
                    "endMs": int(w.get("endMs", 0)) + offset_ms,
                    "confidence": w.get("confidence"),
                }
                for w in seg.words
            ]

            merged_segments.append(
                {
                    "speakerKey": speaker_key,
                    "startMs": abs_start,
                    "endMs": abs_end,
                    "text": seg.text.strip(),
                    "confidence": seg.confidence,
                    "words": shifted_words,
                }
            )
            last_end_ms = abs_end

    hints = [h.strip() for h in (speaker_hints or []) if h and h.strip()]
    speakers_payload = []
    for idx, key in enumerate(speaker_order):
        display_name = hints[idx] if idx < len(hints) else f"Speaker {idx + 1}"
        speakers_payload.append(
            {
                "speakerKey": key,
                "displayName": display_name,
                "totalSpeakingSeconds": int(round(speaker_durations_ms[key] / 1000.0)),
            }
        )

    full_text = " ".join(seg["text"] for seg in merged_segments if seg["text"]).strip()
    avg_conf = (
        round(sum(confidence_values) / len(confidence_values), 4)
        if confidence_values
        else None
    )

    return {
        "fullText": full_text,
        "speakers": speakers_payload,
        "segments": merged_segments,
        "averageConfidence": avg_conf,
    }


def _post_callback(callback_url: str, payload: dict[str, Any]) -> None:
    headers = {"X-API-Key": settings.ai_service_api_key, "Content-Type": "application/json"}
    with httpx.Client(timeout=30.0) as client:
        response = client.post(callback_url, json=payload, headers=headers)
        response.raise_for_status()


def _download_recording(file_url: str, dest_path: Path) -> None:
    headers = {"X-API-Key": settings.ai_service_api_key}
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=300.0, follow_redirects=True) as client:
        with client.stream("GET", file_url, headers=headers) as response:
            response.raise_for_status()
            with dest_path.open("wb") as handle:
                for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                    handle.write(chunk)


def run_transcription_job(job: dict[str, Any]) -> None:
    """Executes the end-to-end Phase 2 audio transcription & diarization pipeline."""
    meeting_id = job["meetingId"]
    recording_id = job["recordingId"]
    organization_id = job["organizationId"]
    user_id = job.get("userId")
    callback_url = job["callbackUrl"]
    file_url = job["fileDownloadUrl"]
    file_name = job.get("fileName") or "recording.webm"
    language_code = job.get("languageCode") or "en"
    speaker_hints = job.get("speakerHints") or []
    custom_vocabulary = job.get("customVocabulary") or []

    work_dir = settings.ai_work_dir / meeting_id
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        _post_callback(
            callback_url,
            {
                "meetingId": meeting_id,
                "recordingId": recording_id,
                "organizationId": organization_id,
                "userId": user_id,
                "status": "processing",
                "progress": 10,
            },
        )

        suffix = Path(file_name).suffix or ".webm"
        source_path = work_dir / f"source{suffix}"
        normalized_wav = work_dir / "normalized_16k.wav"

        _download_recording(file_url, source_path)

        _post_callback(
            callback_url,
            {
                "meetingId": meeting_id,
                "recordingId": recording_id,
                "organizationId": organization_id,
                "userId": user_id,
                "status": "processing",
                "progress": 25,
            },
        )

        duration_seconds = extract_normalized_wav(source_path, normalized_wav)
        chunk_specs = segment_wav_file(
            normalized_wav,
            work_dir / "chunks",
            duration_seconds,
            chunk_seconds=settings.segment_duration_seconds,
            overlap_seconds=settings.segment_overlap_seconds,
        )

        provider = get_transcription_provider()
        chunk_outputs: list[tuple[int, TranscriptionChunkResult]] = []
        total_chunks = max(1, len(chunk_specs))

        for idx, spec in enumerate(chunk_specs):
            last_error: Exception | None = None
            result: TranscriptionChunkResult | None = None

            # Retry failed segments up to 3 attempts
            for attempt in range(3):
                try:
                    result = provider.transcribe_and_diarize(
                        spec.wav_path,
                        language_code=language_code,
                        custom_vocabulary=custom_vocabulary,
                    )
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if attempt < 2:
                        time.sleep(1.5 * (attempt + 1))

            if result is None:
                raise RuntimeError(
                    f"Segment {spec.index} failed after retries: {last_error}"
                )

            chunk_outputs.append((spec.offset_ms, result))
            progress_pct = 25 + int(math.floor(((idx + 1) / total_chunks) * 65))
            _post_callback(
                callback_url,
                {
                    "meetingId": meeting_id,
                    "recordingId": recording_id,
                    "organizationId": organization_id,
                    "userId": user_id,
                    "status": "processing",
                    "progress": min(92, progress_pct),
                },
            )

        merged = merge_chunk_results(chunk_outputs, speaker_hints=speaker_hints)

        _post_callback(
            callback_url,
            {
                "meetingId": meeting_id,
                "recordingId": recording_id,
                "organizationId": organization_id,
                "userId": user_id,
                "status": "completed",
                "progress": 100,
                "durationSeconds": round(duration_seconds),
                "languageCode": language_code,
                "modelName": settings.whisper_model,
                "diarizationModel": (
                    "pyannote/speaker-diarization-3.1" if settings.hf_token else "none"
                ),
                "averageConfidence": merged["averageConfidence"],
                "fullText": merged["fullText"],
                "speakers": merged["speakers"],
                "segments": merged["segments"],
            },
        )
    except Exception as exc:  # noqa: BLE001
        try:
            _post_callback(
                callback_url,
                {
                    "meetingId": meeting_id,
                    "recordingId": recording_id,
                    "organizationId": organization_id,
                    "userId": user_id,
                    "status": "failed",
                    "error": str(exc),
                },
            )
        except Exception:  # noqa: BLE001
            pass
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

