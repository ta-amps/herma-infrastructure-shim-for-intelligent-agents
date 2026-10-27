"""Context-shimming interception, direct-response short-circuiting, and upstream LLM forwarding."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from herma.errors import HermaError
from herma.harness_gate import HarnessPrincipal
from herma.injector import assemble_augmented_request, extract_envelope
from herma.schemas import InjectionReceipt, TriggerMatch, WireFormat
from herma.store import ProvisionStore
from herma.triggers.engine import evaluate_provisions

DEFAULT_UPSTREAMS: dict[str, str] = {
    "chat_completions": "https://ollama.com/v1/chat/completions",
    "responses": "https://api.llama.com/v1/responses",
    "messages": "https://api.anthropic.com/v1/messages",
}


@dataclass(frozen=True)
class InterceptionOutcome:
    """Result of evaluating triggers, shimming noun/verb context, or answering directly."""

    augmented_payload: dict[str, Any]
    matches: list[TriggerMatch]
    receipt: InjectionReceipt


def build_direct_protocol_response(
    wire_format: WireFormat,
    receipt: InjectionReceipt,
) -> dict[str, Any]:
    """Build a protocol-faithful JSON completion when action == 'respond_directly'."""
    rendered_direct_response = receipt.direct_response_text or ""
    created_ts = int(receipt.created_at)

    if wire_format == "responses":
        return {
            "id": f"resp_{receipt.receipt_id}",
            "object": "response",
            "created_at": created_ts,
            "status": "completed",
            "model": receipt.model,
            "output_text": rendered_direct_response,
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": rendered_direct_response,
                        }
                    ],
                }
            ],
            "usage": {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
            },
        }

    if wire_format == "messages":
        return {
            "id": f"msg_{receipt.receipt_id}",
            "type": "message",
            "role": "assistant",
            "model": receipt.model,
            "content": [
                {
                    "type": "text",
                    "text": rendered_direct_response,
                }
            ],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {
                "input_tokens": 0,
                "output_tokens": 0,
            },
        }

    return {
        "id": f"chatcmpl-{receipt.receipt_id}",
        "object": "chat.completion",
        "created": created_ts,
        "model": receipt.model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": rendered_direct_response,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }


def _resolve_upstream_url(wire_format: WireFormat, headers: Mapping[str, str]) -> str:
    env_map = {
        "chat_completions": os.environ.get("HERMA_UPSTREAM_CHAT_URL", "").strip(),
        "responses": os.environ.get("HERMA_UPSTREAM_RESPONSES_URL", "").strip(),
        "messages": os.environ.get("HERMA_UPSTREAM_MESSAGES_URL", "").strip(),
    }
    lower = {k.lower(): v for k, v in headers.items()}
    override = lower.get("x-herma-upstream-url", "").strip()
    if override:
        parsed = urlparse(override)
        if parsed.scheme not in ("https", "http") or not parsed.hostname:
            raise HermaError(
                400, "invalid_upstream", "Invalid Upstream URL", "Malformed X-Herma-Upstream-Url."
            )
        allow_raw = os.environ.get(
            "HERMA_ALLOWED_UPSTREAM_HOSTS",
            "ollama.com,api.llama.com,api.openai.com,api.anthropic.com,127.0.0.1,localhost",
        )
        allowed_hosts = {h.strip().lower() for h in allow_raw.split(",") if h.strip()}
        if parsed.hostname.lower() not in allowed_hosts:
            raise HermaError(
                403,
                "upstream_not_allowed",
                "Upstream Host Not Allowlisted",
                f"Upstream host {parsed.hostname!r} is not in HERMA_ALLOWED_UPSTREAM_HOSTS.",
            )
        return override

    chosen = env_map.get(wire_format, "")
    if chosen:
        return chosen
    return DEFAULT_UPSTREAMS.get(wire_format, DEFAULT_UPSTREAMS["chat_completions"])


def _resolve_upstream_headers(
    wire_format: WireFormat, incoming: Mapping[str, str]
) -> dict[str, str]:
    lower = {k.lower(): v for k, v in incoming.items()}
    out: dict[str, str] = {"Content-Type": "application/json"}
    upstream_key = (
        lower.get("x-upstream-api-key", "").strip()
        or os.environ.get("HERMA_UPSTREAM_API_KEY", "").strip()
    )

    if wire_format == "messages":
        if upstream_key:
            out["x-api-key"] = upstream_key
        out["anthropic-version"] = lower.get("anthropic-version", "2023-06-01")
    else:
        if upstream_key:
            out["Authorization"] = f"Bearer {upstream_key}"
        elif lower.get("authorization", "").lower().startswith("bearer ") and not lower[
            "authorization"
        ][7:].strip().startswith("hmk_"):
            out["Authorization"] = (
                incoming.get("Authorization") or incoming.get("authorization") or ""
            )
    return out


class HermaMiddleware:
    """Evaluates rules, shims noun/verb/URI context or responds directly, and proxies upstream."""

    def __init__(self, store: ProvisionStore, *, max_total_chars: int = 8000) -> None:
        self.store = store
        self.max_total_chars = max_total_chars

    async def intercept(
        self,
        *,
        principal: HarnessPrincipal,
        wire_format: WireFormat,
        payload: dict[str, Any],
        workspace_paths: list[str] | None = None,
    ) -> InterceptionOutcome:
        envelope = extract_envelope(wire_format, payload, extra_paths=workspace_paths)
        active = self.store.list_provisions(enabled_only=True)
        matched_pairs = await evaluate_provisions(active, envelope.trigger_context)
        all_refs = [ref for stored, _ in matched_pairs for ref in stored.provision.context_refs]
        context_map = (
            {entry.entry_id: entry for entry in self.store.get_context_entries(all_refs)}
            if all_refs
            else {}
        )
        augmented, receipt = assemble_augmented_request(
            principal=principal,
            envelope=envelope,
            payload=payload,
            matches=matched_pairs,
            max_total_chars=self.max_total_chars,
            context_entries=context_map,
        )
        self.store.record_receipt(receipt)
        return InterceptionOutcome(
            augmented_payload=augmented,
            matches=[m for _, m in matched_pairs],
            receipt=receipt,
        )

    async def forward_upstream(
        self,
        *,
        wire_format: WireFormat,
        outcome: InterceptionOutcome,
        incoming_headers: Mapping[str, str],
    ) -> tuple[int, dict[str, str], bytes | AsyncIterator[bytes]]:
        meta_headers: dict[str, str] = {
            "x-herma-receipt": outcome.receipt.receipt_sha256,
            "x-herma-receipt-sha256": outcome.receipt.receipt_sha256,
            "x-herma-provisions-fired": ",".join(outcome.receipt.provisions_fired),
        }
        if outcome.receipt.shimmed_context_refs:
            meta_headers["x-herma-shimmed-context"] = ",".join(outcome.receipt.shimmed_context_refs)

        if outcome.receipt.responded_directly and outcome.receipt.direct_response_text is not None:
            direct_body = build_direct_protocol_response(wire_format, outcome.receipt)
            resp_headers = {
                "content-type": "application/json",
                "x-herma-direct-response": "true",
                **meta_headers,
            }
            return 200, resp_headers, json.dumps(direct_body, ensure_ascii=False).encode("utf-8")

        target_url = _resolve_upstream_url(wire_format, incoming_headers)
        up_headers = _resolve_upstream_headers(wire_format, incoming_headers)

        is_stream = bool(outcome.augmented_payload.get("stream"))
        if not is_stream:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    target_url,
                    headers=up_headers,
                    json=outcome.augmented_payload,
                )
                resp_headers = {
                    "content-type": resp.headers.get("content-type", "application/json"),
                    **meta_headers,
                }
                return resp.status_code, resp_headers, resp.content

        client = httpx.AsyncClient(timeout=120.0)
        req = client.build_request(
            "POST",
            target_url,
            headers=up_headers,
            json=outcome.augmented_payload,
        )
        upstream_resp = await client.send(req, stream=True)
        resp_headers = {
            "content-type": upstream_resp.headers.get("content-type", "text/event-stream"),
            **meta_headers,
        }

        async def _iter_chunks() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream_resp.aiter_raw():
                    yield chunk
            finally:
                await upstream_resp.aclose()
                await client.aclose()

        return upstream_resp.status_code, resp_headers, _iter_chunks()
