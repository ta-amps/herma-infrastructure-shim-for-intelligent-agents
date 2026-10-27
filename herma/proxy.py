"""Core interception & upstream LLM forwarding engine (supports JSON and SSE streaming)."""

from __future__ import annotations

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
    """Result of evaluating triggers and augmenting an outbound request."""

    augmented_payload: dict[str, Any]
    matches: list[TriggerMatch]
    receipt: InjectionReceipt


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
    """Evaluates provisions, injects matched text + URIs, logs receipts, and proxies upstream."""

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
        augmented, receipt = assemble_augmented_request(
            principal=principal,
            envelope=envelope,
            payload=payload,
            matches=matched_pairs,
            max_total_chars=self.max_total_chars,
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
        target_url = _resolve_upstream_url(wire_format, incoming_headers)
        up_headers = _resolve_upstream_headers(wire_format, incoming_headers)
        meta_headers = {
            "x-herma-receipt": outcome.receipt.receipt_sha256,
            "x-herma-provisions-fired": ",".join(outcome.receipt.provisions_fired),
        }

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
