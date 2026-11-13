# VoxaMeet AI — Python AI Microservice (Phase 2)

Independent Python service for FFmpeg media normalization, long-recording segmentation, WhisperX (`whisper-large-v3`) transcription, word-level alignment, and `pyannote.audio` speaker diarization.

## Prerequisites
- Python 3.10–3.12
- `ffmpeg` and `ffprobe` installed and on `PATH`
- Hugging Face token (`HF_TOKEN`) accepted on `pyannote/speaker-diarization-3.1` and `pyannote/segmentation-3.0` for speaker diarization
- Optional: GPU with CUDA for fast `whisper-large-v3` inference (`WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16`)

## Installation
```bash
cd ai-service
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Running the Service
### Mode A: FastAPI Async Background Worker (No Redis required locally)
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Mode B: Standalone Redis Queue Worker (Production / Docker)
```bash
python -m app.worker
```

## Running Tests
```bash
python -m unittest discover -s tests
```
