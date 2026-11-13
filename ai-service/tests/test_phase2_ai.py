import unittest
from pathlib import Path

from app.providers.base import TranscriptionChunkResult, TranscriptSegmentResult
from app.providers.whisperx_provider import get_transcription_provider
from app.services.audio_processor import (
    build_extract_wav_command,
    build_slice_wav_command,
    plan_audio_chunks,
)
from app.services.pipeline import merge_chunk_results


class Phase2AIPipelineTests(unittest.TestCase):
    def test_ffmpeg_command_builders(self) -> None:
        cmd = build_extract_wav_command(Path("input.mp4"), Path("out.wav"))
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("16000", cmd)
        self.assertIn("pcm_s16le", cmd)

        slice_cmd = build_slice_wav_command(Path("out.wav"), Path("chunk_0.wav"), 900.0, 900.0)
        self.assertIn("-ss", slice_cmd)
        self.assertIn("900.000", slice_cmd)

    def test_plan_audio_chunks_for_two_hour_recording(self) -> None:
        # 2 hours = 7200 seconds
        chunks = plan_audio_chunks(7200.0, chunk_seconds=900, overlap_seconds=2)
        self.assertGreaterEqual(len(chunks), 8)
        self.assertEqual(chunks[0][1], 0.0)
        self.assertLess(chunks[-1][1], 7200.0)

    def test_merge_chunk_results_offsets_and_speaker_hints(self) -> None:
        chunk0 = TranscriptionChunkResult(
            average_confidence=0.92,
            segments=[
                TranscriptSegmentResult(
                    speaker_key="SPEAKER_00",
                    start_ms=0,
                    end_ms=4000,
                    text="Welcome everyone to the review.",
                    confidence=0.92,
                    words=[{"word": "Welcome", "startMs": 0, "endMs": 500, "confidence": 0.95}],
                )
            ],
        )
        chunk1 = TranscriptionChunkResult(
            average_confidence=0.88,
            segments=[
                TranscriptSegmentResult(
                    speaker_key="SPEAKER_01",
                    start_ms=1000,
                    end_ms=5000,
                    text="Let's check the migration timeline.",
                    confidence=0.88,
                    words=[{"word": "Let's", "startMs": 1000, "endMs": 1300, "confidence": 0.90}],
                )
            ],
        )

        merged = merge_chunk_results(
            [(0, chunk0), (900_000, chunk1)],
            speaker_hints=["Elena Vance", "Marcus Chen"],
        )

        self.assertEqual(len(merged["segments"]), 2)
        self.assertEqual(merged["segments"][1]["startMs"], 901_000)
        self.assertEqual(merged["segments"][1]["words"][0]["startMs"], 901_000)
        self.assertEqual(merged["speakers"][0]["displayName"], "Elena Vance")
        self.assertEqual(merged["speakers"][1]["displayName"], "Marcus Chen")
        self.assertAlmostEqual(merged["averageConfidence"], 0.9, places=3)

    def test_provider_factory_returns_whisperx_by_default(self) -> None:
        provider = get_transcription_provider()
        self.assertEqual(provider.name, "whisperx")
        with self.assertRaises(ValueError):
            get_transcription_provider("unknown_provider")


if __name__ == "__main__":
    unittest.main()

