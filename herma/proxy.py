"""Context-shimming interception, direct-response short-circuiting, and upstream LLM forwarding."""

from __future__ import annotations

import json
import os
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from herma.errors import HermaError
from herma.harness_gate import HarnessPrincipal
from herma.injector import (
    assemble_augmented_request,
    extract_envelope,
    extract_shimmed_preview,
)
from herma.profiles import (
    CALLER_PROFILES_LIST,
    CallerProfile,
    get_caller_profile,
)
from herma.provider_health import operator_policy, provider_for_host
from herma.schemas import (
    SYSTEM_BUILTIN_SCOPE,
    CallerProfileId,
    ExtractedEntity,
    InjectionReceipt,
    ProfileCompareResponse,
    ProfileShimDiff,
    TriggerMatch,
    WireFormat,
)
from herma.store import ProvisionStore, passes_governance_lens, provision_passes_lens
from herma.triggers.engine import evaluate_provisions

DEFAULT_UPSTREAMS: dict[str, str] = {
    "chat_completions": "https://api.meta.ai/v1/chat/completions",
    "responses": "https://api.meta.ai/v1/responses",
    "messages": "https://api.anthropic.com/v1/messages",
}


@dataclass(frozen=True)
class InterceptionOutcome:
    """Result of evaluating triggers, shimming noun/verb context, or answering directly."""

    augmented_payload: dict[str, Any]
    matches: list[TriggerMatch]
    receipt: InjectionReceipt
    entities: list[ExtractedEntity] = field(default_factory=list)


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
    wire_paths: dict[WireFormat, str] = {
        "chat_completions": "/v1/chat/completions",
        "responses": "/v1/responses",
        "messages": "/v1/messages",
    }
    env_map = {
        "chat_completions": os.environ.get("HERMA_UPSTREAM_CHAT_URL", "").strip(),
        "responses": os.environ.get("HERMA_UPSTREAM_RESPONSES_URL", "").strip(),
        "messages": os.environ.get("HERMA_UPSTREAM_MESSAGES_URL", "").strip(),
    }
    lower = {k.lower(): v for k, v in headers.items()}
    override = (
        lower.get("x-herma-upstream-url", "").strip()
        or lower.get("x-upstream-base-url", "").strip()
    )
    if override:
        parsed = urlparse(override)
        if (
            parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise HermaError(
                400, "invalid_upstream", "Invalid Upstream URL", "Malformed X-Herma-Upstream-Url."
            )
        allow_raw = os.environ.get(
            "HERMA_ALLOWED_UPSTREAM_HOSTS",
            "api.meta.ai,api.openai.com,api.anthropic.com,127.0.0.1,localhost",
        )
        allowed_hosts = {h.strip().lower() for h in allow_raw.split(",") if h.strip()}
        if parsed.hostname.lower() not in allowed_hosts:
            raise HermaError(
                403,
                "upstream_not_allowed",
                "Upstream Host Not Allowlisted",
                f"Upstream host {parsed.hostname!r} is not in HERMA_ALLOWED_UPSTREAM_HOSTS.",
            )
        trimmed = override.rstrip("/")
        wire_path = wire_paths[wire_format]
        if parsed.path.rstrip("/") in ("", "/v1"):
            base = trimmed[:-3] if trimmed.endswith("/v1") else trimmed
            return f"{base}{wire_path}"
        return trimmed

    chosen = env_map.get(wire_format, "")
    if chosen:
        return chosen
    return DEFAULT_UPSTREAMS.get(wire_format, DEFAULT_UPSTREAMS["chat_completions"])


def _resolve_upstream_headers(
    wire_format: WireFormat, incoming: Mapping[str, str]
) -> dict[str, str]:
    lower = {k.lower(): v for k, v in incoming.items()}
    target = urlparse(_resolve_upstream_url(wire_format, incoming))
    configured = urlparse(_resolve_upstream_url(wire_format, {}))
    caller_key = lower.get("x-upstream-api-key", "").strip()
    operator_key = os.environ.get("HERMA_UPSTREAM_API_KEY", "").strip()
    if (
        operator_key
        and not caller_key
        and (target.scheme, target.hostname, target.port)
        != (configured.scheme, configured.hostname, configured.port)
    ):
        raise HermaError(
            403,
            "upstream_credential_origin_mismatch",
            "Credential Origin Mismatch",
            "Server credentials are bound to the configured provider origin. "
            "Supply your own upstream key for an allowlisted alternate provider.",
        )
    out: dict[str, str] = {"Content-Type": "application/json"}
    if operator_key and not caller_key:
        provider = provider_for_host(target.hostname)
        if provider and operator_policy(provider)[0]:
            raise HermaError(
                503,
                "provider_operator_disabled",
                "Operator provider paused",
                "The selected operator-funded provider is paused; caller-owned upstream credentials remain supported.",
            )
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
    """Evaluates caller-scoped rules, shims noun/verb/URI context or responds directly, and proxies upstream."""

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
        project_tag: str = "default",
        cohort: str = "",
        persist: bool = True,
        offline_only: bool = False,
        builtin_only: bool = False,
        caller_profile: CallerProfile | None = None,
        profile_explicit: bool = False,
    ) -> InterceptionOutcome:
        started = time.perf_counter()
        envelope = extract_envelope(wire_format, payload, extra_paths=workspace_paths)
        target_scope = SYSTEM_BUILTIN_SCOPE if builtin_only else principal.caller_scope
        candidates = (
            self.store.list_provisions(
                caller_scope=SYSTEM_BUILTIN_SCOPE,
                include_builtin=True,
                enabled_only=True,
            )
            if builtin_only
            else self.store.list_provisions_for_caller(target_scope, enabled_only=True)
        )
        active = [
            sp
            for sp in candidates
            if provision_passes_lens(sp, harness_kind=principal.harness_kind, cohort=cohort)
        ]
        matched_pairs = await evaluate_provisions(
            active,
            envelope.trigger_context,
            offline_only=offline_only,
        )
        all_refs = [ref for stored, _ in matched_pairs for ref in stored.provision.context_refs]
        if all_refs:
            entries = (
                self.store.get_context_entries(
                    all_refs,
                    caller_scope=SYSTEM_BUILTIN_SCOPE,
                    include_builtin=True,
                )
                if builtin_only
                else self.store.get_context_entries_for_caller(target_scope, all_refs)
            )
            context_map = {
                entry.entry_id: entry
                for entry in entries
                if entry.governance is None
                or passes_governance_lens(
                    {"governance": entry.governance},
                    harness_kind=principal.harness_kind,
                    cohort=cohort,
                )
            }
        else:
            context_map = {}

        augmented, receipt = assemble_augmented_request(
            principal=principal,
            envelope=envelope,
            payload=payload,
            matches=matched_pairs,
            max_total_chars=self.max_total_chars,
            context_entries=context_map,
            project_tag=project_tag,
            caller_profile=caller_profile,
            profile_explicit=profile_explicit,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        if persist:
            self.store.record_turn_telemetry(
                caller_scope=principal.caller_scope,
                project_tag=project_tag,
                receipt=receipt,
                entities=envelope.extracted_entities,
                prompt_text=envelope.trigger_context.text,
                latency_ms=elapsed_ms,
            )
        return InterceptionOutcome(
            augmented_payload=augmented,
            matches=[m for _, m in matched_pairs],
            receipt=receipt,
            entities=envelope.extracted_entities,
        )

    async def compare_profiles(
        self,
        *,
        principal: HarnessPrincipal,
        prompt: str,
        profile_ids: list[CallerProfileId] | list[str] | None = None,
        wire_format: Literal["chat_completions", "responses", "messages"] = "chat_completions",
        model: str = "muse-spark-1.3",
        workspace_paths: list[str] | None = None,
        cohort: str = "",
        builtin_only: bool = False,
    ) -> ProfileCompareResponse:
        """Compare deterministic shims across CallerProfile lenses in 0 upstream LLM calls."""
        if wire_format == "responses":
            payload: dict[str, Any] = {"model": model, "input": prompt}
        elif wire_format == "messages":
            payload = {
                "model": model,
                "max_tokens": 256,
                "messages": [{"role": "user", "content": prompt}],
            }
        else:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
            }

        specs: list[CallerProfile] = []
        seen_pids: set[str] = set()
        if profile_ids:
            for pid in profile_ids:
                spec = get_caller_profile(str(pid))
                if spec.profile_id not in seen_pids:
                    seen_pids.add(spec.profile_id)
                    specs.append(spec)
        else:
            specs = list(CALLER_PROFILES_LIST)

        envelope = extract_envelope(wire_format, payload, extra_paths=workspace_paths)
        target_scope = SYSTEM_BUILTIN_SCOPE if builtin_only else principal.caller_scope
        candidates = (
            self.store.list_provisions(
                caller_scope=SYSTEM_BUILTIN_SCOPE,
                include_builtin=True,
                enabled_only=True,
            )
            if builtin_only
            else self.store.list_provisions_for_caller(target_scope, enabled_only=True)
        )
        active = [
            sp
            for sp in candidates
            if provision_passes_lens(sp, harness_kind=principal.harness_kind, cohort=cohort)
        ]
        matched_pairs = await evaluate_provisions(
            active,
            envelope.trigger_context,
            offline_only=True,
        )
        all_refs = [ref for stored, _ in matched_pairs for ref in stored.provision.context_refs]
        if all_refs:
            entries = (
                self.store.get_context_entries(
                    all_refs,
                    caller_scope=SYSTEM_BUILTIN_SCOPE,
                    include_builtin=True,
                )
                if builtin_only
                else self.store.get_context_entries_for_caller(target_scope, all_refs)
            )
            context_map = {
                entry.entry_id: entry
                for entry in entries
                if entry.governance is None
                or passes_governance_lens(
                    {"governance": entry.governance},
                    harness_kind=principal.harness_kind,
                    cohort=cohort,
                )
            }
        else:
            context_map = {}

        comparisons: list[ProfileShimDiff] = []
        by_profile: dict[str, ProfileShimDiff] = {}
        for spec in specs:
            augmented, receipt = assemble_augmented_request(
                principal=principal,
                envelope=envelope,
                payload=payload,
                matches=matched_pairs,
                max_total_chars=self.max_total_chars,
                context_entries=context_map,
                project_tag="compare",
                caller_profile=spec,
                profile_explicit=True,
            )
            diff = ProfileShimDiff(
                caller_profile=spec.profile_id,
                ranking_strategy=spec.strategy,
                max_chars=spec.max_chars,
                suppress_code_dumps=spec.suppress_code_dumps,
                profile_guidance_header=spec.profile_guidance_header,
                injected_chars=receipt.injected_chars,
                selected_provisions=[p.split("@", 1)[0] for p in receipt.provisions_fired],
                provisions_fired=list(receipt.provisions_fired),
                selected_context_refs=list(receipt.shimmed_context_refs),
                uris_injected=list(receipt.uris_injected),
                responded_directly=receipt.responded_directly,
                direct_response_text=receipt.direct_response_text,
                shimmed_preview=extract_shimmed_preview(wire_format, augmented, receipt),
                receipt_sha256=receipt.receipt_sha256,
            )
            comparisons.append(diff)
            by_profile[spec.profile_id] = diff

        return ProfileCompareResponse(
            ok=True,
            persisted=False,
            upstream_llm_calls=0,
            scope_evaluated=target_scope,
            prompt=prompt,
            wire_format=wire_format,
            comparisons=comparisons,
            by_profile=by_profile,
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
            "x-herma-entities-tracked": str(outcome.receipt.entities_tracked),
            "x-herma-caller-profile": outcome.receipt.caller_profile,
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
