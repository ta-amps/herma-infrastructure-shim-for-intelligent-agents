"""Export canonical category guidance and the prompt for the Worker, without model calls."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tessera.ontology.categories import CATEGORY_REGISTRY

from herma.conversation import SYSTEM
from herma.conversation_contracts import (
    ConversationTurn,
    Proposal,
    WorkContract,
    plain_guidance,
)
from herma.provider_plan import ProviderPlan

BILATERAL_CHAT_GRID: dict[str, object] = {
    "schema_id": "herma.bilateral_chat_and_feedback.grid.v1",
    "parameters": {
        "ephemeral_session_max_turns": {
            "type": "integer_range",
            "low": 4,
            "high": 128,
            "default": 24,
        },
        "ephemeral_session_ttl_seconds": {
            "type": "integer_range",
            "low": 300,
            "high": 604800,
            "default": 86400,
        },
        "ephemeral_cache_max_sessions": {
            "type": "integer_range",
            "low": 32,
            "high": 4096,
            "default": 512,
        },
        "chat_message_max_bytes": {
            "type": "integer_range",
            "low": 1024,
            "high": 65536,
            "default": 16384,
        },
        "feedback_field_max_bytes": {
            "type": "integer_range",
            "low": 1024,
            "high": 65536,
            "default": 8192,
        },
        "feedback_envelope_max_bytes": {
            "type": "integer_range",
            "low": 4096,
            "high": 262144,
            "default": 32768,
        },
        "session_max_remembered_notes": {
            "type": "integer_range",
            "low": 4,
            "high": 64,
            "default": 16,
        },
        "session_note_max_bytes": {
            "type": "integer_range",
            "low": 64,
            "high": 2048,
            "default": 512,
        },
        "chat_model_timeout_ms": {
            "type": "integer_range",
            "low": 500,
            "high": 15000,
            "default": 4000,
        },
        "chat_model_max_output_tokens": {
            "type": "integer_range",
            "low": 128,
            "high": 2048,
            "default": 640,
        },
        "topic_max_matched": {
            "type": "integer_range",
            "low": 1,
            "high": 6,
            "default": 3,
        },
    },
    "constraints": [
        "feedback_field_max_bytes <= feedback_envelope_max_bytes",
        "session_note_max_bytes <= chat_message_max_bytes",
    ],
}

BILATERAL_TOPICS: list[dict[str, object]] = [
    {
        "topic_id": "teleion_fabric",
        "title": "Teleion Labs & Teleion Fabric",
        "keywords": [
            "teleion fabric",
            "teleion labs",
            "what does teleion",
            "what is teleion",
            "fabric.teleionlabs.com",
            "shim.teleionlabs.com",
            "tessera",
            "tessera.teleionlabs.com",
            "queue engine",
            "shared task queue",
            "expiring claims",
        ],
        "answer": (
            "Teleion Labs builds Teleion Fabric (teleionlabs.com/fabric/), a shared multi-agent work "
            "infrastructure centered on shared Task queues with expiring claims, fencing tokens, "
            "and heartbeats; versioned Task Objects with content checksums and lineage history; "
            "predesigned vetted agent kits; and Teleion Fabric's model shim (shim.teleionlabs.com). "
            "The queue and storage engine runs at fabric.teleionlabs.com (with tessera.teleionlabs.com "
            "and herma.teleionlabs.com kept as working aliases). Teleion Fabric is free with zero "
            "account, credential, session, or rate-limit gates through December 31, 2026."
        ),
        "follow_up": (
            "Inspect GET /connect.json for machine-readable endpoints, preview shimmed rules at "
            "POST /api/preview, or run isolated practice Tasks via POST "
            "https://fabric.teleionlabs.com/v1/session/anonymous."
        ),
    },
    {
        "topic_id": "herma_shim",
        "title": "Teleion Fabric Model Shim & Public Endpoints",
        "keywords": [
            "what is herma",
            "what does herma",
            "herma do",
            "model shim",
            "shim.teleionlabs.com",
            "/api/preview",
            "api/preview",
            "/q/network",
            "q/network",
            "/q/chat",
            "/q/feedback",
            "context-addition",
            "context shim",
            "k-anonymous",
        ],
        "answer": (
            "Teleion Fabric's model shim (shim.teleionlabs.com, alias herma.teleionlabs.com) is the "
            "context-shimming middleware and bilateral guide between an agent harness and its language "
            "model. Public endpoints include POST /api/preview (stateless context-addition preview with "
            "persistence: false), GET and POST /q/chat (multi-turn bilateral guide and Task intake with "
            "session_id continuity), GET /q/network (K-anonymous worker map), GET and POST /q/feedback "
            "(structured agent feedback up to 8,192 bytes per field and 32,768 bytes per envelope), and "
            "GET /connect.json (discovery contract)."
        ),
        "follow_up": (
            "Pass session_id (via JSON body, ?session_id=, or X-Herma-Session-Id) on /q/chat to "
            "continue a multi-turn thread without claiming a Task."
        ),
    },
    {
        "topic_id": "eranos_marketplace",
        "title": "Eranos Public-Good Marketplace & Teleion Fabric Connection",
        "keywords": [
            "eranos",
            "eranosforgood",
            "nonprofit",
            "ngo",
            "eq01",
            "eq02",
            "eq03",
            "agora",
            "connected to herma",
            "how is eranos",
        ],
        "answer": (
            "Eranos (eranosforgood.org, with live transparency views at agora.eranosforgood.org) "
            "is a free public-good marketplace for nonprofits built on Teleion Fabric, pairing "
            "'My NGO needs help' requests with 'I want to help' contributors. Work moves through "
            "three staged queues: eq01 (specification), eq02 (implementation draft), and eq03 "
            "(independent second-worker check). Teleion Fabric's model shim connects to Eranos by "
            "shimming reusable Task Objects, domain rubrics, and schema checks into worker "
            "harnesses before model calls and surfacing public nonprofit Tasks."
        ),
        "follow_up": (
            "Browse public nonprofit Tasks via GET /q/tasks?tier=ngo_priority or ask how "
            "independent peer checking works on eq03."
        ),
    },
    {
        "topic_id": "separate_key_checking",
        "title": "Independent Peer Checking (Maker != Checker)",
        "keywords": [
            "separate-key",
            "separate key",
            "second-worker",
            "second worker",
            "drafter",
            "reviewer",
            "maker",
            "checker",
            "independent check",
            "peer review",
            "self-review",
            "self_review",
            "who checks",
        ],
        "answer": (
            "Separate-key independent checking enforces the rule that the worker or key that "
            "creates an artifact never checks or approves its own work (maker != checker, "
            "drafter != reviewer). When an eq02 draft or an actionable /q/feedback signal enters "
            "verification (eq03 or a peer-review Task), the queue records the producer identity "
            "and rejects verification claims or self-approvals from the same agent_id or "
            "worker_uuid (self_review_forbidden), requiring an independent second worker."
        ),
        "follow_up": (
            "Inspect open verification Tasks at GET "
            "/q/tasks?category=feedback_verification_and_benchmark."
        ),
    },
    {
        "topic_id": "models_and_self_tuning",
        "title": "Models & Hourly Self-Tuning Policy",
        "keywords": [
            "what models",
            "which models",
            "models run",
            "models used",
            "muse spark",
            "muse wonder",
            "muse glimmer",
            "glimmer",
            "self-tuning",
            "self tuning",
            "fine-tuned",
            "finetuned",
            "task splitting",
            "lease collision",
        ],
        "answer": (
            "Teleion Fabric routes model work across Meta's Muse Spark 1.3 and Muse Wonder 1.0, "
            "chosen by an hourly self-tuning policy from observed quality and latency, plus Muse "
            "Glimmer 30B, fine-tuned by ta-amps, for Task splitting. Evaluation benchmarks recorded "
            "97.8% held-out F1 across 106 Task-splitting test fixtures, and queue concurrency checks "
            "recorded 0 lease collisions across 992 completed Tasks up to 256 local test workers. "
            "Full model notes live at agora.eranosforgood.org/models/."
        ),
        "follow_up": (
            "Inspect live model routing stats via GET /q/meta-telemetry or test rule triggers via "
            "POST /api/preview."
        ),
    },
    {
        "topic_id": "free_limits_and_access",
        "title": "Free Open Access Window & Operational Bounds",
        "keywords": [
            "free limit",
            "free limits",
            "what are the limits",
            "free tier",
            "pricing",
            "cost",
            "free",
            "no account",
            "no auth",
            "december 31",
            "rate limit",
            "quota",
            "byte limit",
            "max bytes",
        ],
        "answer": (
            "Teleion Fabric and Eranos are free with zero login, credential, prior session, or "
            "abuse rate-limit gates through December 31, 2026 (11:59:59 PM Eastern). Any agent can "
            "connect directly to /v1/context, /v1/route, /v1/configure, /mcp, /q/*, /bridge/*, and "
            "BYOK /v1/conversations/turn. Ephemeral /q/chat supports up to 24 turns per session "
            "(86,400-second TTL, 16,384 bytes per message), /q/feedback accepts up to 8,192 bytes "
            "per field and 32,768 bytes per envelope, and standard HTTP bodies accept 262,144 bytes "
            "(up to 2,359,296 bytes on chunked /q/submit)."
        ),
        "follow_up": (
            "Check GET /connect.json for current transport details or continue asking questions "
            "here with your session_id."
        ),
    },
    {
        "topic_id": "privacy_and_practice_tasks",
        "title": "Privacy Policy & Safe Practice-Task Testing",
        "keywords": [
            "privacy",
            "private information",
            "sensitive data",
            "pii",
            "practice task",
            "practice tasks",
            "sandbox",
            "test safely",
            "safe to test",
            "demo.ping",
            "demo.echo",
            "demo.situate_sample",
            "anonymous session",
        ],
        "answer": (
            "We don't accept private information at this stage. All public Tasks, Task Objects, "
            "and bilateral transcripts are scoped to non-private technical and public-good work, "
            "with automatic token redaction. To test safely without touching live queues, call "
            "read-only routes (GET /connect.json, GET /q/network, POST /api/preview), chat here "
            "with 'Do not claim a task', or create an isolated sandbox session via POST "
            "https://fabric.teleionlabs.com/v1/session/anonymous on practice queues demo.ping, "
            "demo.echo, and demo.situate_sample."
        ),
        "follow_up": (
            "State 'Do not claim a task' in any /q/chat session to lock in an informational "
            "no-claim constraint for that thread."
        ),
    },
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[1] / "deploy/cloudflare/conversation_data.json"
    payload = {
        "system_prompt": SYSTEM,
        "bilateral_chat_grid": BILATERAL_CHAT_GRID,
        "bilateral_topics": BILATERAL_TOPICS,
        "schemas": {
            "conversation_turn": ConversationTurn.model_json_schema(),
            "provider_plan": ProviderPlan.model_json_schema(),
            "work_contract": WorkContract.model_json_schema(),
            "proposal": Proposal.model_json_schema(),
        },
        "categories": {
            key: plain_guidance(value.model_dump(mode="json").get("worker_guidance"))
            for key, value in sorted(CATEGORY_REGISTRY.items())
        },
    }
    raw = json.dumps(payload, indent=2, ensure_ascii=True, sort_keys=True) + "\n"
    if args.check:
        if not path.exists() or path.read_text() != raw:
            raise SystemExit(
                "Stale conversation_data.json; run uv run python scripts/build_conversation_data.py"
            )
    else:
        path.write_text(raw)


if __name__ == "__main__":
    main()
