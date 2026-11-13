import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AudioSegmentSpec:
    index: int
    wav_path: Path
    offset_ms: int
    duration_ms: int


def ensure_ffmpeg_available() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError(
            "FFmpeg and FFprobe must be installed and available on PATH for media processing."
        )


def build_extract_wav_command(input_path: Path, output_wav_path: Path) -> list[str]:
    """Builds the FFmpeg command to extract 16 kHz mono 16-bit PCM WAV audio."""
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_wav_path),
    ]


def build_slice_wav_command(
    source_wav: Path,
    output_wav: Path,
    start_seconds: float,
    duration_seconds: float,
) -> list[str]:
    """Builds the FFmpeg command to slice a deterministic time window from WAV."""
    return [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-t",
        f"{duration_seconds:.3f}",
        "-i",
        str(source_wav),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_wav),
    ]


def probe_duration_seconds(media_path: Path) -> float:
    ensure_ffmpeg_available()
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            str(media_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(proc.stdout or "{}")
    duration_str = info.get("format", {}).get("duration", "0")
    return max(0.0, float(duration_str))


def extract_normalized_wav(input_path: Path, output_wav_path: Path) -> float:
    """Converts any FFmpeg-supported audio/video file into 16 kHz mono WAV."""
    ensure_ffmpeg_available()
    cmd = build_extract_wav_command(input_path, output_wav_path)
    subprocess.run(cmd, capture_output=True, text=True, check=True)
    return probe_duration_seconds(output_wav_path)


def plan_audio_chunks(
    total_duration_seconds: float,
    chunk_seconds: int = 900,
    overlap_seconds: int = 2,
) -> list[tuple[int, float, float]]:
    """Plans (index, start_sec, slice_duration_sec) windows for long recordings."""
    if total_duration_seconds <= 0:
        return [(0, 0.0, 0.0)]
    if total_duration_seconds <= chunk_seconds:
        return [(0, 0.0, total_duration_seconds)]

    windows: list[tuple[int, float, float]] = []
    start = 0.0
    index = 0
    step = max(1, chunk_seconds - overlap_seconds)
    while start < total_duration_seconds:
        remaining = total_duration_seconds - start
        length = min(float(chunk_seconds), remaining)
        windows.append((index, start, length))
        if start + length >= total_duration_seconds:
            break
        start += step
        index += 1
    return windows


def segment_wav_file(
    source_wav: Path,
    chunks_dir: Path,
    total_duration_seconds: float,
    chunk_seconds: int = 900,
    overlap_seconds: int = 2,
) -> list[AudioSegmentSpec]:
    """Splits a long WAV file into manageable chunks for resilient transcription."""
    chunks_dir.mkdir(parents=True, exist_ok=True)
    windows = plan_audio_chunks(total_duration_seconds, chunk_seconds, overlap_seconds)

    if len(windows) == 1:
        return [
            AudioSegmentSpec(
                index=0,
                wav_path=source_wav,
                offset_ms=0,
                duration_ms=int(round(total_duration_seconds * 1000)),
            )
        ]

    specs: list[AudioSegmentSpec] = []
    for index, start_sec, slice_sec in windows:
        chunk_path = chunks_dir / f"chunk_{index:04d}.wav"
        cmd = build_slice_wav_command(source_wav, chunk_path, start_sec, slice_sec)
        subprocess.run(cmd, capture_output=True, text=True, check=True)
        specs.append(
            AudioSegmentSpec(
                index=index,
                wav_path=chunk_path,
                offset_ms=int(round(start_sec * 1000)),
                duration_ms=int(round(slice_sec * 1000)),
            )
        )
    return specs

