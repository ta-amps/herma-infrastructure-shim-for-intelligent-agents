"""Bounded provider calls with fixed credential destinations and explicit tool schemas."""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from typing import Any

import httpx

from herma.conversation_schema import strict_json
from herma.errors import HermaError
from herma.harness_gate import refuse_contributor_model
from herma.provider_diagnostics import ERROR_BODY_BYTES, normalize_provider_error
from herma.provider_health import operator_policy, retry_guidance

# Dollars per million tokens (= microdollars per token), from the standard-mode tariff.
META_RATES = {"muse-spark-1.3": (1.25, 4.25), "muse-wonder-1.0": (4.0, 20.0)}
MAX_REQUEST_BYTES = 32768
MAX_RESPONSE_BYTES = 1048576
MAX_SAFE_INTEGER = 2**53 - 1
INTEGER = re.compile(r"[0-9]+")
DECIMAL = re.compile(r"[0-9]+(?:\.[0-9]+)?")


def encode(value: Any) -> bytes:
    """Canonical hashing encoding for fingerprints and IDs; never changes for stored receipts."""
    return json.dumps(value, ensure_ascii=True, sort_keys=True, allow_nan=False).encode()


def wire_json(value: Any, *, sort_keys: bool = False) -> bytes:
    """Compact UTF-8 JSON, byte-compatible with the Worker's JSON.stringify for these payloads.

    Lone surrogates are escaped exactly as JSON.stringify escapes them.
    """
    text = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=sort_keys, allow_nan=False
    )
    return text.encode("utf-8", errors="backslashreplace")


def scaled_integer(value: float, scale: int, *, ceil: bool = False) -> int:
    """Exact non-negative decimal value as an integer count of 10**-scale units.

    The shortest round-trip decimal (Python repr, JavaScript toExponential) is the operator's
    configured number, so 2.01 dollars is exactly 2,010,000 microdollars. Remainders below
    one unit round down for allowances and up for tariffs.
    """
    if not math.isfinite(value) or value < 0:
        raise ValueError("amounts must be finite and non-negative")
    scaled = Decimal(repr(float(value))).scaleb(scale)
    result = int(scaled.to_integral_value(rounding=ROUND_CEILING if ceil else ROUND_FLOOR))
    if result > MAX_SAFE_INTEGER:
        raise ValueError("amount exceeds exact ledger integer representation")
    return result


def setting(name: str) -> str | None:
    """An operator setting; empty or whitespace-only values are unset in both runtimes."""
    value = os.environ.get(name, "").strip()
    return value or None


def integer_setting(name: str) -> int | None:
    value = setting(name)
    if value is not None and not INTEGER.fullmatch(value):
        raise ValueError(f"{name} must be a non-negative integer")
    return None if value is None else int(value)


def decimal_setting(name: str) -> float | None:
    value = setting(name)
    if value is not None and not DECIMAL.fullmatch(value):
        raise ValueError(f"{name} must be a non-negative decimal")
    return None if value is None else float(value)


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    max_output: int | None = None
    reasoning_effort: str | None = None
    timeout_seconds: float = 25
    meta_budget_usd: float = 0
    openai_budget_usd: float = 0
    openai_rates: tuple[float, float] | None = None
    anthropic_budget_usd: float = 0
    anthropic_rates: tuple[float, float] | None = None
    anthropic_version: str = "2026-10-21"
    openrouter_budget_usd: float = 0
    openrouter_rates: tuple[float, float] | None = None
    openrouter_provider: str | None = None
    generation: dict[str, Any] = field(default_factory=dict)
    caller_token_limit: int | None = None

    @classmethod
    def from_env(cls, provider: str) -> ProviderConfig:
        """Read only the selected provider's settings, in the same order as the Worker."""
        prefix = "HERMA_CONVERSATION_" + provider.upper()
        model = setting(prefix + "_MODEL") or {
            "meta": "muse-spark-1.3",
            "ollama": "muse-spark-open",
        }.get(provider, "")
        refuse_contributor_model(model)
        try:
            output = integer_setting(prefix + "_MAX_OUTPUT")
            if output is None:
                output = integer_setting("HERMA_CONVERSATION_MAX_OUTPUT")
            if output is None:
                raise HermaError(
                    503,
                    "output_allowance_required",
                    "Output allowance required",
                    "Configure HERMA_CONVERSATION_<PROVIDER>_MAX_OUTPUT for this server exception; worker proxy output is not capped.",
                )
            paid = provider in {"meta", "openai", "anthropic", "openrouter"}
            budget = (
                decimal_setting(f"HERMA_{provider.upper()}_BUDGET_USD") if paid else None
            ) or 0
            rates = None
            if provider in {"openai", "anthropic", "openrouter"}:
                input_rate = decimal_setting(prefix + "_INPUT_USD_PER_MILLION")
                output_rate = decimal_setting(prefix + "_OUTPUT_USD_PER_MILLION")
                if input_rate is not None and output_rate is not None:
                    rates = (input_rate, output_rate)
            config = cls(
                provider=provider,
                model=model,
                max_output=output,
                reasoning_effort=setting(prefix + "_REASONING")
                or (
                    setting("HERMA_CONVERSATION_REASONING")
                    if provider not in {"ollama", "anthropic"}
                    else None
                ),
                meta_budget_usd=budget if provider == "meta" else 0,
                openai_budget_usd=budget if provider == "openai" else 0,
                openai_rates=rates if provider == "openai" else None,
                anthropic_budget_usd=budget if provider == "anthropic" else 0,
                anthropic_rates=rates if provider == "anthropic" else None,
                anthropic_version=setting("HERMA_CONVERSATION_ANTHROPIC_VERSION") or "2026-10-21",
                openrouter_budget_usd=budget if provider == "openrouter" else 0,
                openrouter_rates=rates if provider == "openrouter" else None,
                openrouter_provider=setting("HERMA_CONVERSATION_OPENROUTER_PROVIDER"),
                generation=strict_json(setting(prefix + "_GENERATION") or "{}"),
                caller_token_limit=integer_setting("HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR"),
            )
            config.validate()
            return config
        except (ValueError, RecursionError) as exc:
            raise HermaError(
                503,
                "invalid_provider_configuration",
                "Invalid provider configuration",
                "Configure the selected provider model, generation settings, tariff and allowance.",
            ) from exc

    def validate(self) -> None:
        refuse_contributor_model(self.model)
        if self.provider not in {"meta", "ollama", "openai", "anthropic", "openrouter"}:
            raise ValueError("unsupported provider")
        if not self.model or self.model == "*" or len(self.model) > 100:
            raise ValueError("configure an explicit provider model")
        if self.provider == "meta" and self.model not in META_RATES:
            raise ValueError("model needs a configured standard-mode price ceiling")
        if self.max_output is None:
            raise HermaError(
                503,
                "output_allowance_required",
                "Output allowance required",
                "Configure HERMA_CONVERSATION_<PROVIDER>_MAX_OUTPUT for this server exception; worker proxy output is not capped.",
            )
        if (
            type(self.max_output) is not int
            or not 0 < self.max_output <= MAX_SAFE_INTEGER
            or not 1 <= self.timeout_seconds <= 60
        ):
            raise ValueError("invalid output or timeout limit")
        if self.provider == "meta" and (
            not math.isfinite(self.meta_budget_usd) or not self.meta_budget_usd > 0
        ):
            raise ValueError("Meta requires an explicit positive operator budget")
        if self.reasoning_effort is not None and (
            not isinstance(self.reasoning_effort, str)
            or not self.reasoning_effort
            or len(self.reasoning_effort) > 40
        ):
            raise ValueError("invalid reasoning effort")
        if self.caller_token_limit is not None and (
            type(self.caller_token_limit) is not int
            or not 1 <= self.caller_token_limit <= MAX_SAFE_INTEGER
        ):
            raise ValueError("invalid caller token allowance")
        if self.provider == "openai" and (
            not math.isfinite(self.openai_budget_usd)
            or self.openai_budget_usd <= 0
            or self.openai_rates is None
            or any(not math.isfinite(rate) or rate < 0 for rate in self.openai_rates)
        ):
            raise ValueError("OpenAI requires an explicit model tariff and operator budget")
        if self.provider == "anthropic" and (
            not math.isfinite(self.anthropic_budget_usd)
            or self.anthropic_budget_usd <= 0
            or self.anthropic_rates is None
            or any(not math.isfinite(rate) or rate < 0 for rate in self.anthropic_rates)
            or self.anthropic_version not in {"2023-06-01", "2026-10-21"}
        ):
            raise ValueError(
                "Anthropic requires an explicit model tariff, operator budget and supported API version"
            )
        if self.provider == "openrouter" and (
            not math.isfinite(self.openrouter_budget_usd)
            or self.openrouter_budget_usd <= 0
            or self.openrouter_rates is None
            or any(not math.isfinite(rate) or rate < 0 for rate in self.openrouter_rates)
            or not self.openrouter_provider
            or len(self.openrouter_provider) > 100
            or "/" not in self.model
            or self.model.startswith("openrouter/")
            or "@preset" in self.model.lower()
            or "online" in self.model.lower().split(":")[1:]
        ):
            raise ValueError(
                "OpenRouter requires a fixed model, underlying provider, tariff and allowance"
            )
        if not isinstance(self.generation, dict) or set(self.generation) & {
            "model",
            "input",
            "messages",
            "instructions",
            "system",
            "tools",
            "stream",
            "store",
            "background",
            "conversation",
            "previous_response_id",
            "parallel_tool_calls",
            "max_tokens",
            "max_completion_tokens",
            "max_output_tokens",
            "models",
            "provider",
            "route",
            "plugins",
            "preset",
            "presets",
            "web_search_options",
            "mcp_servers",
            "container",
            "server_tools",
        }:
            raise ValueError(
                "generation settings cannot override the conversation contract or output allowance"
            )
        if (
            set(self.generation) & {"prompt", "prompt_id", "best_of", "speed", "inference_geo"}
            or (
                "n" in self.generation
                and (
                    self.provider not in {"meta", "openrouter"}
                    # JSON 1 and 1.0 are one number in the Worker; booleans are not numbers.
                    or type(self.generation["n"]) not in {int, float}
                    or self.generation["n"] != 1
                )
            )
            or (
                "service_tier" in self.generation
                and (
                    self.provider not in {"openai", "anthropic"}
                    or self.generation["service_tier"]
                    != ("default" if self.provider == "openai" else "standard_only")
                )
            )
        ):
            raise HermaError(
                503,
                "unsupported_generation_configuration",
                "Unsupported generation configuration",
                "Typed proposals support one output, locally scoped prompt content, and standard service tiers. Remove stored prompt/best_of/speed/inference_geo settings, use n=1 only for chat-completions providers, and use OpenAI default or Anthropic standard_only service tiers.",
            )
        if self.provider == "ollama" and (
            not isinstance(self.generation.get("options", {}), dict)
            or "num_predict" in self.generation.get("options", {})
        ):
            raise ValueError("use the explicit output allowance for Ollama num_predict")
        if self.provider == "openai" and not isinstance(self.generation.get("reasoning", {}), dict):
            raise ValueError("OpenAI reasoning settings must be an object")
        if self.provider == "anthropic" and self.reasoning_effort is not None:
            raise ValueError("use native Anthropic thinking/output_config in generation settings")
        encode(self.generation)

    @property
    def url(self) -> str:
        return {
            "meta": "https://api.meta.ai/v1/chat/completions",
            "ollama": "https://ollama.com/api/chat",
            "openai": "https://api.openai.com/v1/responses",
            "anthropic": "https://api.anthropic.com/v1/messages",
            "openrouter": "https://openrouter.ai/api/v1/chat/completions",
        }[self.provider]

    @property
    def budget_usd(self) -> float:
        return (
            self.openrouter_budget_usd
            if self.provider == "openrouter"
            else self.anthropic_budget_usd
            if self.provider == "anthropic"
            else self.openai_budget_usd
            if self.provider == "openai"
            else self.meta_budget_usd
            if self.provider == "meta"
            else 0
        )

    @property
    def budget_microusd(self) -> int:
        """The cumulative operator allowance in exact integer microdollars."""
        return scaled_integer(self.budget_usd, 6)

    def build_request(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> dict[str, Any]:
        self.validate()
        body: dict[str, Any] = {**self.generation, "model": self.model, "stream": False}
        if self.provider == "anthropic":
            body.update(
                system="\n".join(
                    message["content"] for message in messages if message["role"] == "system"
                ),
                messages=[message for message in messages if message["role"] != "system"],
                tools=[
                    {
                        "name": tool["function"]["name"],
                        "description": tool["function"]["description"],
                        "input_schema": tool["function"]["parameters"],
                    }
                    for tool in tools
                ],
                max_tokens=self.max_output,
                service_tier="standard_only",
            )
        elif self.provider == "openai":
            body.update(
                input=messages,
                tools=[{"type": "function", **tool["function"], "strict": False} for tool in tools],
                store=False,
                background=False,
                parallel_tool_calls=False,
                max_output_tokens=self.max_output,
                service_tier="default",
            )
            if self.reasoning_effort is not None:
                body["reasoning"] = {**body.get("reasoning", {}), "effort": self.reasoning_effort}
        else:
            body.update(messages=messages, tools=tools)
            if self.provider in {"meta", "openrouter"}:
                body.update(max_tokens=self.max_output, parallel_tool_calls=False)
                if self.provider == "openrouter":
                    body["provider"] = {
                        "only": [self.openrouter_provider],
                        "order": [self.openrouter_provider],
                        "allow_fallbacks": False,
                        "require_parameters": True,
                        "data_collection": "deny",
                    }
                if self.reasoning_effort is not None:
                    body["reasoning_effort"] = self.reasoning_effort
            else:
                body["options"] = {**body.get("options", {}), "num_predict": self.max_output}
        return body

    def reservation(self, body: dict[str, Any]) -> tuple[int, int]:
        self.validate()
        assert self.max_output is not None
        # Measure the exact bytes sent, which match the Worker's UTF-8 JSON.stringify size.
        size = len(wire_json(body))
        if size > MAX_REQUEST_BYTES:
            raise HermaError(
                413,
                "context_too_large",
                "Context too large",
                "Select fewer contracts or a smaller conversation context.",
            )
        # UTF-8 bytes are a conservative input-token ceiling; allow protocol overhead.
        input_ceiling = size + 4096
        rates = (
            META_RATES.get(self.model)
            if self.provider == "meta"
            else self.openai_rates
            if self.provider == "openai"
            else self.anthropic_rates
            if self.provider == "anthropic"
            else self.openrouter_rates
            if self.provider == "openrouter"
            else None
        )
        dollars = 0
        if rates:
            # Tariffs in picodollars per token keep the whole ceiling in exact integers.
            picodollars = input_ceiling * scaled_integer(
                rates[0], 6, ceil=True
            ) + self.max_output * scaled_integer(rates[1], 6, ceil=True)
            dollars = -(-picodollars // 1_000_000)
        tokens = input_ceiling + self.max_output
        if tokens > MAX_SAFE_INTEGER or dollars > MAX_SAFE_INTEGER:
            raise ValueError("allowance exceeds exact ledger integer representation")
        return tokens, dollars


class ProviderFailure(Exception):
    """Contains stable codes and bounded categories, never raw provider errors."""

    def __init__(
        self,
        code: str,
        *,
        outcome: str = "unknown",
        retry_after_seconds: float | None = None,
        http_status: int | None = None,
        diagnostics: dict[str, Any] | None = None,
        retry_guidance_source: str | None = None,
    ) -> None:
        super().__init__(code)
        self.outcome = outcome
        self.retry_after_seconds = retry_after_seconds
        self.http_status = http_status
        self.diagnostics = diagnostics
        self.retry_guidance_source = retry_guidance_source


def provider_credential(provider: str) -> str:
    """Check dispatch readiness without reserving allowance or changing offline preparation."""
    key = os.environ.get(
        {
            "meta": "META_API_KEY",
            "ollama": "OLLAMA_API_KEY",
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
        }[provider],
        "",
    )
    if not key.strip():
        raise ProviderFailure("provider_not_configured", outcome="not_sent")
    return key


async def request_model(
    config: ProviderConfig,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    config.validate()
    config.reservation(body)
    if operator_policy(config.provider)[0]:
        raise ProviderFailure("provider_operator_disabled", outcome="not_sent")
    key = provider_credential(config.provider)
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if config.provider == "anthropic":
        headers = {
            "x-api-key": key,
            "anthropic-version": config.anthropic_version,
            "Content-Type": "application/json",
        }
    # Do not decompress untrusted error bodies while collecting diagnostics.
    headers["Accept-Encoding"] = "identity"
    rejected: ProviderFailure | None = None
    try:
        async with (
            asyncio.timeout(config.timeout_seconds),
            httpx.AsyncClient(
                timeout=config.timeout_seconds, follow_redirects=False, transport=transport
            ) as client,
            client.stream(
                "POST",
                config.url,
                content=wire_json(body),
                headers=headers,
            ) as response,
        ):
            if response.status_code != 200:
                retry_seconds, retry_source = retry_guidance(response.headers, time.time())
                accepted = 200 <= response.status_code < 300
                code = (
                    "provider_outcome_uncertain"
                    if accepted
                    else "provider_rate_limited"
                    if response.status_code == 429
                    else "provider_unauthorized"
                    if response.status_code in {401, 403}
                    else "provider_unavailable"
                    if response.status_code >= 500
                    else "provider_rejected"
                )
                rejected = ProviderFailure(
                    code,
                    outcome="unknown"
                    if accepted or response.status_code >= 500 or response.status_code == 408
                    else "rejected",
                    retry_after_seconds=retry_seconds,
                    retry_guidance_source=retry_source,
                    http_status=response.status_code,
                    diagnostics=normalize_provider_error(b"", body_state="unavailable"),
                )
                if response.headers.get("content-encoding", "identity").lower() == "identity":
                    error_raw = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=4096):
                        if len(error_raw) + len(chunk) > ERROR_BODY_BYTES:
                            rejected.diagnostics = normalize_provider_error(
                                b"", body_state="oversized"
                            )
                            break
                        error_raw.extend(chunk)
                    else:
                        rejected.diagnostics = normalize_provider_error(bytes(error_raw))
                raise rejected
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ProviderFailure("provider_response_too_large")
        try:
            # Same strict profile as the Worker: duplicate fields cannot pick a reply.
            parsed = strict_json(raw.decode("utf-8"))
        except (ValueError, RecursionError) as exc:
            raise ProviderFailure("provider_invalid_response") from exc
        if not isinstance(parsed, dict):
            raise ProviderFailure("provider_invalid_response")
        if config.provider == "openai" and parsed.get("status") in ("queued", "in_progress"):
            raise ProviderFailure("provider_outcome_uncertain", http_status=200)
        return parsed
    except (
        httpx.HTTPError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        TimeoutError,
        RecursionError,
    ) as exc:
        if rejected is not None:
            raise rejected from exc
        raise ProviderFailure("provider_unavailable") from exc
    except Exception:
        # Optional diagnostics must not erase an already observed HTTP rejection.
        # External cancellation still propagates because it is not an Exception.
        if rejected is not None:
            raise rejected from None
        raise


def usage_for(provider: str, reply: dict[str, Any]) -> dict[str, Any]:
    data = reply.get("usage", {}) if provider != "ollama" else reply
    fields = (
        ("prompt_tokens", "completion_tokens")
        if provider in {"meta", "openrouter"}
        else ("input_tokens", "output_tokens")
        if provider in {"openai", "anthropic", "jev"}
        else ("prompt_eval_count", "eval_count")
    )
    return {
        name: data.get(field)
        if isinstance(data, dict) and type(data.get(field)) is int and data[field] >= 0
        else None
        for name, field in zip(("input_tokens", "output_tokens"), fields, strict=True)
    }
