import hmac
import shutil
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.services.pipeline import run_transcription_job
from app.services.summarizer import process_summarization_job

app = FastAPI(title="VoxaMeet AI Processing Service", version="1.0.0")
executor = ThreadPoolExecutor(max_workers=2)


def verify_api_key(x_api_key: str = Header(default="")) -> None:
    if not x_api_key or not hmac.compare_digest(x_api_key, settings.ai_service_api_key):
        raise HTTPException(status_code=401, detail="Invalid AI service API key.")


class TranscribeJobRequest(BaseModel):
    recordingId: str
    meetingId: str
    organizationId: str
    userId: str | None = None
    fileDownloadUrl: str
    callbackUrl: str
    fileName: str = "recording.webm"
    languageCode: str = "en"
    speakerHints: list[str] = Field(default_factory=list)
    customVocabulary: list[str] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "voxameet-ai-service",
        "provider": settings.transcription_provider,
        "whisperModel": settings.whisper_model,
        "device": settings.whisper_device,
        "ffmpegAvailable": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
        "diarizationConfigured": bool(settings.hf_token),
    }


@app.get("/providers", dependencies=[Depends(verify_api_key)])
def list_providers() -> dict[str, Any]:
    return {
        "active": settings.transcription_provider,
        "supported": ["whisperx"],
        "whisperModel": settings.whisper_model,
    }


@app.post("/jobs/transcribe", status_code=202, dependencies=[Depends(verify_api_key)])
def enqueue_transcription(job: TranscribeJobRequest) -> dict[str, Any]:
    executor.submit(run_transcription_job, job.model_dump())
    return {
        "accepted": True,
        "meetingId": job.meetingId,
        "recordingId": job.recordingId,
    }


class SummarizeJobRequest(BaseModel):
    meetingId: str
    organizationId: str
    transcriptText: str
    title: str = ""
    detailLevel: str = "standard"
    speakers: list[str] = Field(default_factory=list)
    callbackUrl: str | None = None


@app.post("/jobs/summarize", status_code=202, dependencies=[Depends(verify_api_key)])
def enqueue_summarization(job: SummarizeJobRequest) -> dict[str, Any]:
    executor.submit(
        process_summarization_job,
        meeting_id=job.meetingId,
        organization_id=job.organizationId,
        transcript_text=job.transcriptText,
        title=job.title,
        detail_level=job.detailLevel,
        speakers=job.speakers,
        callback_url=job.callbackUrl,
    )
    return {
        "accepted": True,
        "meetingId": job.meetingId,
        "detailLevel": job.detailLevel,
    }


