from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ai_service_host: str = "0.0.0.0"
    ai_service_port: int = 8000
    ai_service_api_key: str = "dev-ai-service-secret-change-me"

    transcription_provider: str = "whisperx"
    whisper_model: str = "large-v3"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_batch_size: int = 8
    segment_duration_seconds: int = 900  # 15 minutes per chunk for 2-hour+ recordings
    segment_overlap_seconds: int = 2

    hf_token: str = ""

    redis_url: str = ""
    transcription_queue_key: str = "voxameet:transcription:jobs"

    ollama_url: str = "http://localhost:11434"
    llm_model: str = "qwen2.5:7b"
    llm_provider: str = "ollama"

    ai_work_dir: Path = Path("./work")


settings = Settings()

