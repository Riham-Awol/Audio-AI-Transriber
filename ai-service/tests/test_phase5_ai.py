from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.providers.embedding_provider import OllamaEmbeddingProvider
from app.services.vector_store import VectorStoreService, cosine_similarity

client = TestClient(app)
AUTH_HEADERS = {"X-API-Key": settings.ai_service_api_key}


def test_embedding_provider_pseudo_vectors():
    provider = OllamaEmbeddingProvider()
    v1 = provider.embed_query("budget allocation Q4 financial planning")
    v2 = provider.embed_query("budget planning Q4 financials")
    v3 = provider.embed_query("completely unrelated cooking recipe with pasta and tomatoes")

    assert len(v1) == 768
    assert len(v2) == 768
    assert len(v3) == 768

    sim_related = cosine_similarity(v1, v2)
    sim_unrelated = cosine_similarity(v1, v3)

    assert sim_related > sim_unrelated, f"Expected {sim_related} > {sim_unrelated}"


def test_rag_index_and_query_endpoints():
    org_id = "test-org-123"
    meeting_id = "test-meet-456"

    # Index segments
    index_res = client.post(
        "/rag/index",
        headers=AUTH_HEADERS,
        json={
            "organizationId": org_id,
            "meetingId": meeting_id,
            "meetingTitle": "Executive Sprint Planning",
            "segments": [
                {
                    "id": "seg-1",
                    "speakerName": "Sarah Connor",
                    "startMs": 15000,
                    "endMs": 28000,
                    "text": "We decided to increase our infrastructure budget by twenty percent for cloud migrations.",
                },
                {
                    "id": "seg-2",
                    "speakerName": "John Doe",
                    "startMs": 30000,
                    "endMs": 42000,
                    "text": "I will handle setting up the Redis cluster by next Friday before lunch.",
                },
            ],
        },
    )
    assert index_res.status_code == 200
    assert index_res.json()["indexed"] is True
    assert index_res.json()["chunkCount"] == 2

    # Query similarity
    query_res = client.post(
        "/rag/query",
        headers=AUTH_HEADERS,
        json={
            "organizationId": org_id,
            "meetingId": meeting_id,
            "query": "infrastructure budget increase",
            "topK": 2,
        },
    )
    assert query_res.status_code == 200
    results = query_res.json()["results"]
    assert len(results) > 0
    assert "infrastructure budget" in results[0]["text"]
    assert results[0]["metadata"]["speaker_name"] == "Sarah Connor"


def test_rag_chat_endpoint_grounded_citations():
    org_id = "test-org-chat"
    meeting_id = "test-meet-chat"

    # Index meeting
    client.post(
        "/rag/index",
        headers=AUTH_HEADERS,
        json={
            "organizationId": org_id,
            "meetingId": meeting_id,
            "meetingTitle": "Architecture Review",
            "segments": [
                {
                    "id": "seg-arch-1",
                    "speakerName": "Alex",
                    "startMs": 65000,
                    "endMs": 75000,
                    "text": "We must ensure MySQL 8.4 connection pooling has a maximum of twenty connections.",
                }
            ],
        },
    )

    # Chat asking about connection pooling
    chat_res = client.post(
        "/rag/chat",
        headers=AUTH_HEADERS,
        json={
            "organizationId": org_id,
            "meetingId": meeting_id,
            "query": "What did Alex say about MySQL connection pooling?",
            "meetingContext": {
                "title": "Architecture Review",
                "executiveSummary": "Reviewed MySQL pooling.",
            },
        },
    )
    assert chat_res.status_code == 200
    data = chat_res.json()
    assert "answer" in data
    assert len(data["citations"]) > 0
    citation = data["citations"][0]
    assert citation["speakerName"] == "Alex"
    assert citation["startMs"] == 65000
    assert "MySQL" in citation["quote"]

