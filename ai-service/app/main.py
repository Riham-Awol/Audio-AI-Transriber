import hmac
import shutil
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.services.pipeline import run_transcription_job
from app.services.rag_chat import rag_chat_service
from app.services.summarizer import process_summarization_job
from app.services.vector_store import vector_store

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


class IndexSegmentsRequest(BaseModel):
    organizationId: str
    meetingId: str
    meetingTitle: str = ""
    segments: list[dict[str, Any]] = Field(default_factory=list)


@app.post("/rag/index", dependencies=[Depends(verify_api_key)])
def index_meeting_segments(req: IndexSegmentsRequest) -> dict[str, Any]:
    count = vector_store.index_segments(
        organization_id=req.organizationId,
        meeting_id=req.meetingId,
        segments=req.segments,
        meeting_title=req.meetingTitle,
    )
    return {
        "indexed": True,
        "meetingId": req.meetingId,
        "chunkCount": count,
    }


class QuerySegmentsRequest(BaseModel):
    organizationId: str
    meetingId: str | None = None
    query: str
    topK: int = 5


@app.post("/rag/query", dependencies=[Depends(verify_api_key)])
def query_segments(req: QuerySegmentsRequest) -> dict[str, Any]:
    results = vector_store.similarity_search(
        organization_id=req.organizationId,
        query=req.query,
        meeting_id=req.meetingId,
        top_k=req.topK,
    )
    return {
        "results": results,
        "count": len(results),
    }


class ChatRAGRequest(BaseModel):
    organizationId: str
    meetingId: str | None = None
    query: str
    history: list[dict[str, str]] = Field(default_factory=list)
    meetingContext: dict[str, Any] | None = None


@app.post("/rag/chat", dependencies=[Depends(verify_api_key)])
def chat_rag(req: ChatRAGRequest) -> dict[str, Any]:
    result = rag_chat_service.generate_chat_answer(
        organization_id=req.organizationId,
        query=req.query,
        history=req.history,
        meeting_id=req.meetingId,
        meeting_context=req.meetingContext,
    )
    return {
        "answer": result.answer,
        "citations": [
            {
                "segmentId": c.segment_id,
                "meetingId": c.meeting_id,
                "meetingTitle": c.meeting_title,
                "speakerName": c.speaker_name,
                "startMs": c.start_ms,
                "endMs": c.end_ms,
                "quote": c.quote,
            }
            for c in result.citations
        ],
        "modelName": result.model_name,
    }


@app.delete("/rag/meeting/{meetingId}", dependencies=[Depends(verify_api_key)])
def delete_indexed_meeting(meetingId: str, organizationId: str) -> dict[str, Any]:
    deleted_count = vector_store.delete_meeting(organization_id=organizationId, meeting_id=meetingId)
    return {"deleted": True, "meetingId": meetingId, "removedCount": deleted_count}


