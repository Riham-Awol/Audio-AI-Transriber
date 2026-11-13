import logging
import math
from pathlib import Path
from typing import Any

from app.config import settings
from app.providers.embedding_provider import OllamaEmbeddingProvider

logger = logging.getLogger(__name__)


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)


class VectorStoreService:
    """Manages multi-tenant vector storage, semantic embedding, and similarity search."""

    def __init__(
        self,
        persist_dir: Path | None = None,
        embedding_provider: OllamaEmbeddingProvider | None = None,
    ):
        self.persist_dir = persist_dir or settings.chroma_dir
        self.embedding_provider = embedding_provider or OllamaEmbeddingProvider()
        self.chroma_client = None
        self._fallback_store: dict[str, list[dict[str, Any]]] = {}

        self._init_chroma()

    def _init_chroma(self) -> None:
        try:
            import chromadb
            from chromadb.config import Settings as ChromaSettings

            self.persist_dir.mkdir(parents=True, exist_ok=True)
            self.chroma_client = chromadb.PersistentClient(
                path=str(self.persist_dir),
                settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
            )
            logger.info("ChromaDB PersistentClient initialized at %s", self.persist_dir)
        except Exception as e:
            logger.warning(
                "ChromaDB not available or failed to initialize (%s). Using in-memory vector index fallback.",
                e,
            )
            self.chroma_client = None

    def _get_collection_name(self, organization_id: str) -> str:
        clean_org = organization_id.replace("-", "_")
        return f"voxa_{clean_org}"[:63]

    def index_segments(
        self,
        organization_id: str,
        meeting_id: str,
        segments: list[dict[str, Any]],
        meeting_title: str = "",
    ) -> int:
        """Indexes transcript segments into the organization's vector collection."""
        if not segments:
            return 0

        # Prepare records
        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict[str, Any]] = []

        for seg in segments:
            seg_id = str(seg.get("id") or f"{meeting_id}_{seg.get('sequenceIndex', len(ids))}")
            text = (seg.get("text") or "").strip()
            if not text:
                continue

            ids.append(seg_id)
            documents.append(text)
            metadatas.append({
                "segment_id": seg_id,
                "meeting_id": str(meeting_id),
                "organization_id": str(organization_id),
                "meeting_title": str(meeting_title or seg.get("meetingTitle") or ""),
                "speaker_name": str(seg.get("speakerName") or seg.get("speaker_name") or "Speaker"),
                "start_ms": int(seg.get("startMs") or seg.get("start_ms") or 0),
                "end_ms": int(seg.get("endMs") or seg.get("end_ms") or 0),
            })

        if not ids:
            return 0

        # Compute embeddings
        embeddings = self.embedding_provider.embed_texts(documents)

        # 1. Try ChromaDB
        if self.chroma_client:
            try:
                coll_name = self._get_collection_name(organization_id)
                collection = self.chroma_client.get_or_create_collection(
                    name=coll_name,
                    metadata={"organization_id": organization_id, "hnsw:space": "cosine"},
                )
                collection.upsert(
                    ids=ids,
                    documents=documents,
                    embeddings=embeddings,
                    metadatas=metadatas,
                )
                logger.info(
                    "Indexed %d segments into Chroma collection %s for meeting %s",
                    len(ids),
                    coll_name,
                    meeting_id,
                )
            except Exception as e:
                logger.warning("ChromaDB upsert failed (%s). Writing to fallback store.", e)
                self._index_fallback(organization_id, meeting_id, ids, documents, embeddings, metadatas)
                return len(ids)

        # 2. Also keep fallback store up-to-date for fast in-process retrieval
        self._index_fallback(organization_id, meeting_id, ids, documents, embeddings, metadatas)
        return len(ids)

    def _index_fallback(
        self,
        org_id: str,
        meeting_id: str,
        ids: list[str],
        docs: list[str],
        embeddings: list[list[float]],
        metas: list[dict[str, Any]],
    ) -> None:
        if org_id not in self._fallback_store:
            self._fallback_store[org_id] = []

        # Remove existing items for this meeting to support re-indexing
        self._fallback_store[org_id] = [
            item for item in self._fallback_store[org_id] if item["metadata"].get("meeting_id") != meeting_id
        ]

        for seg_id, doc, emb, meta in zip(ids, docs, embeddings, metas):
            self._fallback_store[org_id].append({
                "id": seg_id,
                "document": doc,
                "embedding": emb,
                "metadata": meta,
            })

    def similarity_search(
        self,
        organization_id: str,
        query: str,
        meeting_id: str | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Searches for segments semantically relevant to query within organization."""
        clean_query = query.strip()
        if not clean_query:
            return []

        query_emb = self.embedding_provider.embed_query(clean_query)

        # 1. Try ChromaDB
        if self.chroma_client:
            try:
                coll_name = self._get_collection_name(organization_id)
                collection = self.chroma_client.get_collection(name=coll_name)
                where_clause: dict[str, Any] | None = None
                if meeting_id:
                    where_clause = {"meeting_id": str(meeting_id)}

                query_params: dict[str, Any] = {
                    "query_embeddings": [query_emb],
                    "n_results": min(top_k * 2, 25),
                }
                if where_clause:
                    query_params["where"] = where_clause

                results = collection.query(**query_params)
                records: list[dict[str, Any]] = []

                if results and results.get("ids") and results["ids"][0]:
                    r_ids = results["ids"][0]
                    r_docs = results["documents"][0] if results.get("documents") else []
                    r_metas = results["metadatas"][0] if results.get("metadatas") else []
                    r_dists = results["distances"][0] if results.get("distances") else []

                    for i in range(len(r_ids)):
                        # Distance to similarity score conversion
                        dist = r_dists[i] if i < len(r_dists) else 0.5
                        sim = max(0.0, min(1.0, 1.0 - (dist / 2.0)))
                        records.append({
                            "id": r_ids[i],
                            "text": r_docs[i] if i < len(r_docs) else "",
                            "score": round(sim, 4),
                            "metadata": r_metas[i] if i < len(r_metas) else {},
                        })

                if records:
                    records.sort(key=lambda r: r["score"], reverse=True)
                    return records[:top_k]
            except Exception as e:
                logger.debug("ChromaDB query fallback triggered: %s", e)

        # 2. Fallback in-memory search
        org_items = self._fallback_store.get(organization_id, [])
        scored_items: list[dict[str, Any]] = []

        query_words = set(clean_query.lower().split())

        for item in org_items:
            meta = item["metadata"]
            if meeting_id and meta.get("meeting_id") != meeting_id:
                continue

            cos_sim = cosine_similarity(query_emb, item["embedding"])
            # Boost score if exact keywords match
            doc_lower = item["document"].lower()
            keyword_overlap = sum(1 for w in query_words if len(w) > 2 and w in doc_lower)
            boosted_score = cos_sim + (keyword_overlap * 0.05)

            scored_items.append({
                "id": item["id"],
                "text": item["document"],
                "score": round(min(1.0, max(0.0, boosted_score)), 4),
                "metadata": meta,
            })

        scored_items.sort(key=lambda x: x["score"], reverse=True)
        return scored_items[:top_k]

    def delete_meeting(self, organization_id: str, meeting_id: str) -> int:
        """Removes all indexed vectors belonging to a deleted meeting."""
        count = 0
        if self.chroma_client:
            try:
                coll_name = self._get_collection_name(organization_id)
                collection = self.chroma_client.get_collection(name=coll_name)
                collection.delete(where={"meeting_id": str(meeting_id)})
            except Exception as e:
                logger.debug("ChromaDB delete error: %s", e)

        if organization_id in self._fallback_store:
            prev_len = len(self._fallback_store[organization_id])
            self._fallback_store[organization_id] = [
                i for i in self._fallback_store[organization_id] if i["metadata"].get("meeting_id") != meeting_id
            ]
            count = prev_len - len(self._fallback_store[organization_id])

        return count


# Singleton instance
vector_store = VectorStoreService()
