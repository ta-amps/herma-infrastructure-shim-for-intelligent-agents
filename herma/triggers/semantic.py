"""Tier-2 semantic similarity trigger (~1-5 ms): hybrid concept + subword cosine + optional embeddings."""

from __future__ import annotations

import math
import os
import re
from collections import Counter

import httpx

from herma.schemas import SemanticTrigger

TOKEN_RE = re.compile(r"[a-z0-9]{2,}")
STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "into",
        "when",
        "what",
        "how",
        "can",
        "you",
        "our",
        "are",
        "was",
        "were",
        "have",
        "has",
        "had",
        "will",
        "would",
        "should",
        "could",
        "please",
        "make",
        "use",
        "using",
        "need",
        "want",
        "help",
        "write",
        "build",
        "add",
        "code",
    }
)

# Domain-neutral concept equivalences so paraphrased engineering intents align cleanly offline:
CONCEPT_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "concept:atomic_queue",
        (
            "queue",
            "backlog",
            "worker",
            "swarm",
            "lease",
            "fencing",
            "duplicate",
            "concurrent",
            "race",
            "claim",
            "idempotent",
            "receipt",
            "retry",
            "deadletter",
        ),
    ),
    (
        "concept:cas_storage",
        (
            "cas",
            "optimistic",
            "version",
            "overwrite",
            "conflict",
            "blob",
            "sha256",
            "record",
            "state",
            "atomic",
        ),
    ),
    (
        "concept:harm_compliance",
        (
            "scam",
            "fraud",
            "coercion",
            "exploitation",
            "victim",
            "caseworker",
            "statute",
            "fee",
            "usury",
            "payee",
            "impersonation",
            "accuse",
            "synthetic",
        ),
    ),
    (
        "concept:ngo_autonomy",
        (
            "nonprofit",
            "ngo",
            "volunteer",
            "hotline",
            "shelter",
            "intake",
            "crisis",
            "steward",
            "reviewer",
            "drafter",
            "playbook",
            "sop",
        ),
    ),
    (
        "concept:edge_security",
        (
            "cloudflare",
            "worker",
            "origin",
            "proxy",
            "secret",
            "header",
            "csp",
            "hsts",
            "token",
            "auth",
            "credential",
            "leak",
        ),
    ),
)


def _stem(word: str) -> str:
    for suffix in ("ing", "tion", "ions", "ments", "ment", "ed", "es", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def vectorize_text(text: str) -> dict[str, float]:
    """Build a normalized sparse feature vector over stems, bigrams, char-4grams, and concept clusters."""
    lower = text.lower()[:16_384]
    raw_tokens = [t for t in TOKEN_RE.findall(lower) if t not in STOPWORDS]
    stems = [_stem(t) for t in raw_tokens]
    counts: Counter[str] = Counter()

    for s in stems:
        counts[f"w:{s}"] += 2
        if len(s) >= 5:
            for idx in range(len(s) - 3):
                counts[f"c4:{s[idx : idx + 4]}"] += 1

    for i in range(len(stems) - 1):
        counts[f"bg:{stems[i]}_{stems[i + 1]}"] += 2

    token_set = set(raw_tokens) | set(stems)
    for concept_id, members in CONCEPT_GROUPS:
        overlap = sum(1 for m in members if m in token_set or _stem(m) in token_set)
        if overlap:
            counts[concept_id] += overlap * 3

    vec: dict[str, float] = {feat: 1.0 + math.log(cnt) for feat, cnt in counts.items()}
    norm = math.sqrt(sum(v * v for v in vec.values()))
    if norm == 0.0:
        return {}
    return {k: v / norm for k, v in vec.items()}


def cosine_sparse(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    if len(a) > len(b):
        a, b = b, a
    return sum(val * b.get(key, 0.0) for key, val in a.items())


async def _remote_embedding_similarity(
    text: str,
    exemplars: list[str],
    url: str,
    model: str,
    api_key: str,
) -> float | None:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={"model": model, "input": [text[:4000], *exemplars]},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            vecs = [row["embedding"] for row in data]
            q = vecs[0]
            q_norm = math.sqrt(sum(x * x for x in q)) or 1.0
            best = 0.0
            for cand in vecs[1:]:
                c_norm = math.sqrt(sum(x * x for x in cand)) or 1.0
                sim = sum(x * y for x, y in zip(q, cand, strict=False)) / (q_norm * c_norm)
                best = max(best, sim)
            return best
    except Exception:
        return None


async def evaluate_semantic_trigger(
    spec: SemanticTrigger,
    text: str,
) -> tuple[bool, list[str], float]:
    """Return (matched, reasons, best_score) for a SemanticTrigger."""
    emb_url = os.environ.get("HERMA_EMBEDDINGS_URL", "").strip()
    emb_model = os.environ.get("HERMA_EMBEDDINGS_MODEL", "text-embedding-3-small").strip()
    emb_key = os.environ.get("HERMA_EMBEDDINGS_API_KEY", "").strip()

    if emb_url:
        remote_score = await _remote_embedding_similarity(
            text, spec.exemplars, emb_url, emb_model, emb_key
        )
        if remote_score is not None:
            matched = remote_score >= spec.threshold
            reasons = (
                [f"semantic:embeddings(score={remote_score:.3f}>={spec.threshold:.2f})"]
                if matched
                else []
            )
            return matched, reasons, round(remote_score, 4)

    query_vec = vectorize_text(text)
    if not query_vec:
        return False, [], 0.0

    best_score = 0.0
    best_exemplar = ""
    concept_context = " ".join(spec.concepts)
    for exemplar in spec.exemplars:
        target_text = f"{exemplar} {concept_context}".strip()
        ex_vec = vectorize_text(target_text)
        score = cosine_sparse(query_vec, ex_vec)
        if score > best_score:
            best_score = score
            best_exemplar = exemplar

    matched = best_score >= spec.threshold
    reasons = (
        [f"semantic:cosine({best_score:.3f}>={spec.threshold:.2f} ~ {best_exemplar[:48]!r})"]
        if matched
        else []
    )
    return matched, reasons, round(best_score, 4)
