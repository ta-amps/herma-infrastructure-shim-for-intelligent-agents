"""Bounded provider calls with fixed credential destinations and explicit tool schemas."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any

import httpx

from herma.errors import HermaError
from herma.harness_gate import refuse_contributor_model

# Microdollars per token, from the standard-mode provider tariff.
META_RATES = {"muse-spark-1.3": (1.25, 4.25), "muse-wonder-1.0": (4.0, 20.0)}
MAX_REQUEST_BYTES = 32768
MAX_RESPONSE_BYTES = 1048576


def encode(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, allow_nan=False).encode()


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    max_output: int = 2048
    reasoning_effort: str = "low"
    timeout_seconds: float = 25
    meta_budget_usd: float = 5

    @classmethod
    def from_env(cls, provider: str) -> ProviderConfig:
        model = os.environ.get(
            "HERMA_CONVERSATION_" + provider.upper() + "_MODEL",
            "muse-spark-1.3" if provider == "meta" else "muse-spark-open",
        )
        config = cls(
            provider=provider,
            model=model,
            max_output=int(os.environ.get("HERMA_CONVERSATION_MAX_OUTPUT", "2048")),
            reasoning_effort=os.environ.get("HERMA_CONVERSATION_REASONING", "low"),
            meta_budget_usd=float(os.environ.get("HERMA_META_BUDGET_USD", "5")),
        )
        config.validate()
        return config

    def validate(self) -> None:
        refuse_contributor_model(self.model)
        if self.provider not in {"meta", "ollama"}:
            raise ValueError("unsupported provider")
        if self.provider == "meta" and self.model not in META_RATES:
            raise ValueError("model needs a configured standard-mode price ceiling")
        if not 512 <= self.max_output <= 8192 or not 1 <= self.timeout_seconds <= 60:
            raise ValueError("invalid output or timeout limit")
        if not math.isfinite(self.meta_budget_usd) or not 0 < self.meta_budget_usd <= 150:
            raise ValueError("invalid operator budget")
        if self.reasoning_effort not in {"minimal", "low", "medium", "high"}:
            raise ValueError("invalid reasoning effort")

    @property
    def url(self) -> str:
        return (
            "https://api.meta.ai/v1/chat/completions"
            if self.provider == "meta"
            else "https://ollama.com/api/chat"
        )

    def reservation(self, body: dict[str, Any]) -> tuple[int, int]:
        size = len(encode(body))
        if size > MAX_REQUEST_BYTES:
            raise HermaError(
                413,
                "context_too_large",
                "Context too large",
                "Select fewer contracts or a smaller conversation context.",
            )
        # UTF-8 bytes are a conservative input-token ceiling; allow protocol overhead.
        input_ceiling = size + 4096
        rates = META_RATES.get(self.model) if self.provider == "meta" else None
        dollars = math.ceil(input_ceiling * rates[0] + self.max_output * rates[1]) if rates else 0
        return input_ceiling + self.max_output, dollars


class ProviderFailure(Exception):
    """Contains only a stable safe code, never a provider response or credential."""


async def request_model(
    config: ProviderConfig,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    config.validate()
    config.reservation(body)
    key = os.environ.get("META_API_KEY" if config.provider == "meta" else "OLLAMA_API_KEY", "")
    if not key:
        raise ProviderFailure("provider_not_configured")
    try:
        async with (
            httpx.AsyncClient(
                timeout=config.timeout_seconds, follow_redirects=False, transport=transport
            ) as client,
            client.stream(
                "POST",
                config.url,
                content=encode(body),
                headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
            ) as response,
        ):
            if response.status_code != 200:
                raise ProviderFailure(
                    "provider_rate_limited" if response.status_code == 429 else "provider_rejected"
                )
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ProviderFailure("provider_response_too_large")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ProviderFailure("provider_invalid_response")
        return parsed
    except (httpx.HTTPError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProviderFailure("provider_unavailable") from exc


def usage_for(provider: str, reply: dict[str, Any]) -> dict[str, Any]:
    data = reply.get("usage", {}) if provider == "meta" else reply
    fields = (
        ("prompt_tokens", "completion_tokens")
        if provider == "meta"
        else ("prompt_eval_count", "eval_count")
    )
    return {
        name: data.get(field)
        if isinstance(data, dict) and type(data.get(field)) is int and data[field] >= 0
        else None
        for name, field in zip(("input_tokens", "output_tokens"), fields, strict=True)
    }
