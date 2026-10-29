"""Bounded provider calls with fixed credential destinations and explicit tool schemas."""

from __future__ import annotations

import asyncio
import json
import math
import os
import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
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
    max_output: int | None = None
    reasoning_effort: str | None = None
    timeout_seconds: float = 25
    meta_budget_usd: float = 5
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
        try:
            prefix = "HERMA_CONVERSATION_" + provider.upper()
            model = os.environ.get(
                prefix + "_MODEL",
                {"meta": "muse-spark-1.3", "ollama": "muse-spark-open"}.get(provider, ""),
            )
            output = os.environ.get(
                prefix + "_MAX_OUTPUT", os.environ.get("HERMA_CONVERSATION_MAX_OUTPUT")
            )
            token_limit = os.environ.get("HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR")
            input_rate = os.environ.get(prefix + "_INPUT_USD_PER_MILLION")
            output_rate = os.environ.get(prefix + "_OUTPUT_USD_PER_MILLION")
            config = cls(
                provider=provider,
                model=model,
                max_output=int(output) if output else None,
                reasoning_effort=os.environ.get(
                    prefix + "_REASONING",
                    os.environ.get("HERMA_CONVERSATION_REASONING")
                    if provider not in {"ollama", "anthropic"}
                    else None,
                ),
                meta_budget_usd=float(os.environ.get("HERMA_META_BUDGET_USD", "5")),
                openai_budget_usd=float(os.environ.get("HERMA_OPENAI_BUDGET_USD", "0")),
                openai_rates=(float(input_rate), float(output_rate))
                if provider == "openai" and input_rate and output_rate
                else None,
                anthropic_budget_usd=float(os.environ.get("HERMA_ANTHROPIC_BUDGET_USD", "0")),
                anthropic_rates=(float(input_rate), float(output_rate))
                if provider == "anthropic" and input_rate and output_rate
                else None,
                anthropic_version=os.environ.get(
                    "HERMA_CONVERSATION_ANTHROPIC_VERSION", "2026-10-21"
                ),
                openrouter_budget_usd=float(os.environ.get("HERMA_OPENROUTER_BUDGET_USD", "0")),
                openrouter_rates=(float(input_rate), float(output_rate))
                if provider == "openrouter" and input_rate and output_rate
                else None,
                openrouter_provider=os.environ.get("HERMA_CONVERSATION_OPENROUTER_PROVIDER"),
                generation=json.loads(os.environ.get(prefix + "_GENERATION", "{}")),
                caller_token_limit=int(token_limit) if token_limit else None,
            )
            config.validate()
            return config
        except ValueError as exc:
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
        if not self.model or len(self.model) > 100:
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
            or not 0 < self.max_output <= 2**53 - 1
            or not 1 <= self.timeout_seconds <= 60
        ):
            raise ValueError("invalid output or timeout limit")
        if not math.isfinite(self.meta_budget_usd) or not self.meta_budget_usd > 0:
            raise ValueError("invalid operator budget")
        if self.reasoning_effort is not None and (
            not isinstance(self.reasoning_effort, str)
            or not self.reasoning_effort
            or len(self.reasoning_effort) > 40
        ):
            raise ValueError("invalid reasoning effort")
        if self.caller_token_limit is not None and (
            type(self.caller_token_limit) is not int or self.caller_token_limit < 1
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
            )
        elif self.provider == "openai":
            body.update(
                input=messages,
                tools=[{"type": "function", **tool["function"], "strict": False} for tool in tools],
                store=False,
                background=False,
                parallel_tool_calls=False,
                max_output_tokens=self.max_output,
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
        dollars = math.ceil(input_ceiling * rates[0] + self.max_output * rates[1]) if rates else 0
        tokens = input_ceiling + self.max_output
        if tokens > 2**53 - 1 or dollars > 2**53 - 1:
            raise ValueError("allowance exceeds exact ledger integer representation")
        return tokens, dollars


class ProviderFailure(Exception):
    """Contains only a stable safe code, never a provider response or credential."""

    def __init__(
        self,
        code: str,
        *,
        outcome: str = "unknown",
        retry_after_seconds: float | None = None,
        http_status: int | None = None,
    ) -> None:
        super().__init__(code)
        self.outcome = outcome
        self.retry_after_seconds = retry_after_seconds
        self.http_status = http_status


async def request_model(
    config: ProviderConfig,
    body: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    config.validate()
    config.reservation(body)
    key = os.environ.get(
        {
            "meta": "META_API_KEY",
            "ollama": "OLLAMA_API_KEY",
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
        }[config.provider],
        "",
    )
    if not key:
        raise ProviderFailure("provider_not_configured", outcome="not_sent")
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if config.provider == "anthropic":
        headers = {
            "x-api-key": key,
            "anthropic-version": config.anthropic_version,
            "Content-Type": "application/json",
        }
    try:
        async with (
            asyncio.timeout(config.timeout_seconds),
            httpx.AsyncClient(
                timeout=config.timeout_seconds, follow_redirects=False, transport=transport
            ) as client,
            client.stream(
                "POST",
                config.url,
                content=encode(body),
                headers=headers,
            ) as response,
        ):
            if response.status_code != 200:
                retry = response.headers.get("retry-after", "")
                retry_seconds = None
                if retry:
                    try:
                        parsed_retry = float(retry)
                    except ValueError:
                        try:
                            parsed_retry = max(
                                0, parsedate_to_datetime(retry).timestamp() - time.time()
                            )
                        except (TypeError, ValueError, OverflowError):
                            parsed_retry = float("nan")
                    if math.isfinite(parsed_retry) and parsed_retry >= 0:
                        retry_seconds = parsed_retry
                code = (
                    "provider_rate_limited"
                    if response.status_code == 429
                    else "provider_unauthorized"
                    if response.status_code in {401, 403}
                    else "provider_unavailable"
                    if response.status_code >= 500
                    else "provider_rejected"
                )
                raise ProviderFailure(
                    code,
                    outcome="unknown"
                    if response.status_code >= 500 or response.status_code == 408
                    else "rejected",
                    retry_after_seconds=retry_seconds,
                    http_status=response.status_code,
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
    except (
        httpx.HTTPError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        TimeoutError,
        RecursionError,
    ) as exc:
        raise ProviderFailure("provider_unavailable") from exc


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
