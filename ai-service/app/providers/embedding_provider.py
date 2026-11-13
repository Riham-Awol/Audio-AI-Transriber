import hashlib
import json
import logging
import math
import re
from typing import Any
import urllib.request
import urllib.error

from app.config import settings
from app.providers.base import EmbeddingProvider

logger = logging.getLogger(__name__)


class OllamaEmbeddingProvider(EmbeddingProvider):
    """Embedding provider using Ollama with `nomic-embed-text` (or fallback)."""

    name: str = "ollama-embeddings"
    vector_dim: int = 768

    def __init__(
        self,
        ollama_url: str | None = None,
        model_name: str | None = None,
        vector_dim: int = 768,
    ):
        self.ollama_url = (ollama_url or settings.ollama_url).rstrip("/")
        self.model_name = model_name or settings.embedding_model
        self.vector_dim = vector_dim

    def _call_ollama_embed(self, texts: list[str]) -> list[list[float]] | None:
        """Attempt to call Ollama embed endpoint (/api/embed or /api/embeddings)."""
        # Try modern /api/embed batch endpoint
        try:
            url = f"{self.ollama_url}/api/embed"
            payload = {"model": self.model_name, "input": texts}
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                embeddings = data.get("embeddings")
                if embeddings and len(embeddings) == len(texts):
                    return embeddings
        except Exception:
            pass

        # Try legacy /api/embeddings single-text endpoint
        try:
            results: list[list[float]] = []
            for text in texts:
                url = f"{self.ollama_url}/api/embeddings"
                payload = {"model": self.model_name, "prompt": text}
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    emb = data.get("embedding")
                    if not emb:
                        return None
                    results.append(emb)
            return results
        except Exception as e:
            logger.debug("Ollama embedding endpoint unavailable (%s). Falling back to local vectorizer.", e)
            return None

    def _deterministic_pseudo_embedding(self, text: str) -> list[float]:
        """Generate a deterministic 768-dim normalized embedding based on word n-grams and hashing.

        Ensures that semantically overlapping texts share higher cosine similarity,
        enabling offline tests, CI, and local dev without requiring an active Ollama instance.
        """
        dim = self.vector_dim
        vec = [0.0] * dim
        tokens = [t.lower() for t in re.findall(r"\b\w+\b", text)]

        if not tokens:
            vec[0] = 1.0
            return vec

        # Unigrams and bigrams
        features = list(tokens)
        for i in range(len(tokens) - 1):
            features.append(f"{tokens[i]}_{tokens[i+1]}")

        for feat in features:
            h = int(hashlib.md5(feat.encode("utf-8")).hexdigest(), 16)
            idx = h % dim
            sign = 1.0 if ((h >> 8) & 1) == 1 else -1.0
            weight = 1.0 + (len(feat) * 0.1)
            vec[idx] += sign * weight

        # L2 normalize
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        else:
            vec[0] = 1.0

        return vec

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        res = self._call_ollama_embed(texts)
        if res is not None:
            return res

        return [self._deterministic_pseudo_embedding(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        results = self.embed_texts([text])
        return results[0] if results else [0.0] * self.vector_dim

