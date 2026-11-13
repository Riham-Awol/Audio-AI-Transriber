import json
import logging
import urllib.request
import urllib.error
from typing import Any

from app.config import settings
from app.providers.ollama_provider import get_llm_provider

logger = logging.getLogger(__name__)


def process_summarization_job(
    *,
    meeting_id: str,
    organization_id: str,
    transcript_text: str,
    title: str = "",
    detail_level: str = "standard",
    speakers: list[str] | None = None,
    callback_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Execute AI summarization job and notify the Node.js backend."""
    provider = get_llm_provider()
    summary = provider.summarize_meeting(
        transcript_text,
        title=title,
        detail_level=detail_level,
        speakers=speakers,
    )

    payload = {
        "meetingId": meeting_id,
        "organizationId": organization_id,
        "detailLevel": detail_level,
        "modelName": summary.model_name,
        "executiveSummary": summary.executive_summary,
        "meetingPurpose": summary.meeting_purpose,
        "mainTopics": summary.main_topics,
        "discussionPoints": summary.discussion_points,
        "decisions": summary.decisions,
        "actionItems": summary.action_items,
        "challengesConcerns": summary.challenges_concerns,
        "risksIdentified": summary.risks_identified,
        "nextSteps": summary.next_steps,
        "minutesMarkdown": summary.minutes_markdown,
    }

    target_url = callback_url or "http://localhost:4002/api/internal/summary-callback"
    target_key = api_key or settings.ai_service_api_key

    try:
        req = urllib.request.Request(
            target_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-API-Key": target_key,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            logger.info("Summary callback delivered for meeting %s (HTTP %s)", meeting_id, resp.status)
    except Exception as e:
        logger.error("Failed to post summary callback to %s: %s", target_url, e)

    return payload

