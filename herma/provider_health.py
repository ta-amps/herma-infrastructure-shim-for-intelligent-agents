"""Deterministic operator availability inside the existing provider allowance lifecycle."""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any

from herma.errors import HermaError

PROVIDERS = {"meta", "ollama", "openai", "anthropic", "openrouter"}
PROBE_LEASE_SECONDS = 120


def provider_for_host(host: str | None) -> str | None:
    return {
        "api.meta.ai": "meta",
        "ollama.com": "ollama",
        "api.openai.com": "openai",
        "api.anthropic.com": "anthropic",
        "openrouter.ai": "openrouter",
    }.get((host or "").lower())


def operator_policy(provider: str) -> tuple[bool, str]:
    try:
        disabled = json.loads(os.environ.get("HERMA_CONVERSATION_DISABLED_PROVIDERS", "[]"))
        account = os.environ.get(f"HERMA_CONVERSATION_{provider.upper()}_ACCOUNT_SCOPE", "operator")
        if (
            not isinstance(disabled, list)
            or any(not isinstance(p, str) or p not in PROVIDERS for p in disabled)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", account)
        ):
            raise ValueError("invalid operator availability policy")
        return provider in disabled, account
    except ValueError as exc:
        raise HermaError(
            503,
            "invalid_provider_configuration",
            "Invalid provider availability",
            "Configure a provider-name JSON list and an opaque account scope.",
        ) from exc


def retry_guidance(headers: Any, now: float) -> tuple[float | None, str | None]:
    def valid(value: float) -> bool:
        return math.isfinite(value) and 0 <= value <= 2**53 - 1 - now

    raw = headers.get("retry-after", "")
    if isinstance(raw, str) and len(raw) <= 128 and raw:
        try:
            value = float(raw)
        except ValueError:
            try:
                value = max(0, parsedate_to_datetime(raw).timestamp() - now)
            except (ValueError, TypeError, OverflowError):
                value = float("nan")
        if valid(value):
            return value, "retry_after"
    resets = []
    for name in ("requests", "tokens", "project-tokens"):
        raw = headers.get("x-ratelimit-reset-" + name, "")
        if (
            isinstance(raw, str)
            and len(raw) <= 128
            and re.fullmatch(r"(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+", raw)
        ):
            value = sum(
                float(number) * {"ms": 0.001, "s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
                for number, unit in re.findall(r"(\d+(?:\.\d+)?)(ms|s|m|h|d)", raw)
            )
            if valid(value):
                resets.append(value)
    for name in ("requests", "tokens", "input-tokens", "output-tokens"):
        raw = headers.get("anthropic-ratelimit-" + name + "-reset", "")
        if isinstance(raw, str) and len(raw) <= 128 and raw:
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                value = max(0, parsed.timestamp() - now) if parsed.tzinfo else float("nan")
                if valid(value):
                    resets.append(value)
            except (ValueError, OverflowError):
                pass
    return (max(resets), "provider_reset") if resets else (None, None)


def fresh_health() -> dict[str, Any]:
    return {
        "generation": 0,
        "failures": 0,
        "available_after": 0,
        "reason": None,
        "uncertain": False,
        "probe_id": None,
        "probe_until": 0,
    }


def cooldown_seconds(failures: int, reason: str | None) -> int:
    initial = 300 if reason in {"credit_or_quota_exhausted", "payment_required"} else 30
    return int(min(3600, initial * 2 ** min(max(failures - 1, 0), 7)))


def health_view(state: dict[str, Any], *, probe: bool = False) -> dict[str, Any]:
    return {
        "state": "recovery_probe" if probe else "limited" if state["failures"] else "healthy",
        "reason": state["reason"],
        "available_after": max(state["available_after"], state["probe_until"]),
        "requires_uncertain_authorization": state["uncertain"],
        "scope": "operator_provider_account",
    }


def admit_health(
    states: dict[str, dict[str, Any]],
    attempt: str,
    now: float,
    *,
    allow_probe: bool,
    allow_uncertain: bool,
) -> dict[str, Any]:
    """Mutate only supplied state; the caller commits admission and allowance atomically."""
    for state in states.values():
        if state["probe_id"] and state["probe_until"] <= now:
            state.update(
                generation=state["generation"] + 1,
                failures=state["failures"] + 1,
                uncertain=True,
                probe_id=None,
                probe_until=0,
                reason="provider_probe_outcome_uncertain",
            )
            state["available_after"] = now + cooldown_seconds(state["failures"], state["reason"])
        code = None
        if state["probe_id"]:
            code = "provider_recovery_probe_inflight"
        elif state["failures"] and state["available_after"] > now:
            code = "provider_backpressure"
        elif state["failures"] and not allow_probe:
            code = "provider_recovery_probe_required"
        elif state["failures"] and state["uncertain"] and not allow_uncertain:
            code = "provider_outcome_reconciliation_required"
        if code:
            return {"ok": False, "code": code, "health": health_view(state)}
    ticket = {key: state["generation"] for key, state in states.items()}
    probe = False
    for state in states.values():
        if state["failures"]:
            state.update(probe_id=attempt, probe_until=now + PROBE_LEASE_SECONDS)
            probe = True
    limiting = max(states.values(), key=lambda state: state["failures"])
    return {"ok": True, "ticket": ticket, "health": health_view(limiting, probe=probe)}


def settle_health(
    states: dict[str, dict[str, Any]],
    ticket: dict[str, int],
    attempt: str,
    model: str,
    now: float,
    *,
    outcome: str,
    error_code: str | None,
    reason: str | None,
    retry_seconds: float | None,
    http_status: int | None = None,
) -> dict[str, Any]:
    limited = (
        "credit_or_quota_exhausted"
        if reason == "credit_or_quota_exhausted"
        else "payment_required"
        if http_status == 402 or reason == "payment_required"
        else "rate_limited"
        if error_code == "provider_rate_limited" or reason == "rate_limited"
        else "provider_unavailable"
        if error_code == "provider_unavailable" or outcome == "unknown"
        else None
    )
    target = "*" if limited in {"credit_or_quota_exhausted", "payment_required"} else model
    for key, state in states.items():
        same = state["generation"] == ticket.get(key)
        owns_probe = state["probe_id"] == attempt
        if limited and key == target:
            failures = state["failures"] + 1 if same or owns_probe else max(1, state["failures"])
            delay = (
                retry_seconds
                if retry_seconds is not None and retry_seconds > 0
                else cooldown_seconds(failures, limited)
            )
            state.update(
                generation=state["generation"] + 1,
                failures=failures,
                available_after=max(state["available_after"], now + delay),
                reason=limited,
                uncertain=state["uncertain"] or outcome == "unknown",
                probe_id=None if owns_probe else state["probe_id"],
                probe_until=0 if owns_probe else state["probe_until"],
            )
        elif owns_probe and outcome == "completed":
            if same:
                generation = state["generation"] + 1
                state.update(fresh_health(), generation=generation)
            else:
                # End this lease, but retain any newer observation of a limit.
                state.update(probe_id=None, probe_until=0)
        elif owns_probe:
            state.update(
                generation=state["generation"] + 1,
                failures=state["failures"] + 1,
                probe_id=None,
                probe_until=0,
                uncertain=state["uncertain"] or outcome == "unknown",
            )
            state["available_after"] = max(
                state["available_after"], now + cooldown_seconds(state["failures"], state["reason"])
            )
    return health_view(
        max(states.values(), key=lambda state: (state["failures"] > 0, state["available_after"]))
    )
