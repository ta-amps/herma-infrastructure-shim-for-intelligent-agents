"""Bounded provider-reported error categories, never raw messages or identifiers."""

from __future__ import annotations

import json
from typing import Any

ERROR_BODY_BYTES = 16384
ERROR_TYPES = frozenset(
    {
        "invalid_request_error",
        "authentication_error",
        "permission_error",
        "billing_error",
        "not_found_error",
        "conflict_error",
        "request_too_large",
        "rate_limit_error",
        "api_error",
        "timeout_error",
        "overloaded_error",
        "server_error",
        "insufficient_quota",
    }
)
ERROR_CODES = frozenset(
    {
        "invalid_api_key",
        "insufficient_quota",
        "billing_hard_limit_reached",
        "credits_exhausted",
        "model_not_found",
        "invalid_model",
        "unsupported_parameter",
        "unsupported_value",
        "invalid_parameter",
        "context_length_exceeded",
        "rate_limit_exceeded",
        "invalid_request_error",
        "server_error",
    }
)
ERROR_PARAMETERS = frozenset(
    {
        "model",
        "tools",
        "tool_choice",
        "parallel_tool_calls",
        "max_tokens",
        "max_completion_tokens",
        "max_output_tokens",
        "temperature",
        "top_p",
        "top_k",
        "reasoning",
        "reasoning_effort",
        "thinking",
        "output_config",
        "provider",
    }
)
HTTP_ERROR_CODES = frozenset(
    {400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529}
)


def normalize_provider_error(raw: bytes, *, body_state: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "source": "provider_reported",
        "body_state": "parsed",
        "type": None,
        "code": None,
        "parameter": None,
        "reason": "unknown",
    }
    if body_state is not None:
        result["body_state"] = (
            body_state if body_state in ("oversized", "unavailable") else "unavailable"
        )
        return result
    if len(raw) > ERROR_BODY_BYTES:
        result["body_state"] = "oversized"
        return result
    if not raw:
        result["body_state"] = "empty"
        return result
    try:
        parsed = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        result["body_state"] = "malformed"
        return result
    if not isinstance(parsed, dict):
        result["body_state"] = "unrecognized"
        return result
    error = parsed.get("error", parsed)
    if isinstance(error, str):
        message, error = error, {}
    elif isinstance(error, dict):
        message = error.get("message", "")
    else:
        result["body_state"] = "unrecognized"
        return result
    kind, code, parameter = error.get("type"), error.get("code"), error.get("param")
    result["type"] = kind if isinstance(kind, str) and kind in ERROR_TYPES else None
    result["code"] = (
        code
        if (isinstance(code, str) and code in ERROR_CODES)
        or (type(code) is int and code in HTTP_ERROR_CODES)
        else None
    )
    result["parameter"] = (
        parameter if isinstance(parameter, str) and parameter in ERROR_PARAMETERS else None
    )
    message = message.lower() if isinstance(message, str) else ""
    credit = (
        "credit balance",
        "insufficient credit",
        "insufficient quota",
        "current quota",
        "spend limit",
        "spend cap",
        "payment required",
    )
    if (
        code in ("insufficient_quota", "billing_hard_limit_reached", "credits_exhausted")
        or kind in ("billing_error", "insufficient_quota")
        or any(text in message for text in credit)
    ):
        result["reason"] = "credit_or_quota_exhausted"
    elif kind == "authentication_error" or code == "invalid_api_key":
        result["reason"] = "authentication_failed"
    elif kind == "permission_error":
        result["reason"] = "permission_denied"
    elif code == "context_length_exceeded":
        result["reason"] = "context_too_large"
    elif (
        "no endpoints found" in message
        or "no eligible provider" in message
        or "no available provider" in message
    ):
        result["reason"] = "no_eligible_provider_endpoint"
    elif code in ("model_not_found", "invalid_model") or (
        "model" in message
        and any(text in message for text in ("not found", "does not exist", "not available"))
    ):
        result["reason"] = "model_unavailable"
    elif (
        code == "unsupported_parameter"
        or "unsupported parameter" in message
        or (
            any(name in message for name in ERROR_PARAMETERS)
            and any(
                text in message for text in ("not supported", "does not support", "unsupported")
            )
        )
    ):
        result["reason"] = "unsupported_parameter"
    elif any(
        name in message for name in ("max_tokens", "max_output_tokens", "max_completion_tokens")
    ) and any(
        text in message
        for text in ("maximum", "exceed", "at most", "must be", "too large", "too high")
    ):
        result["reason"] = "output_allowance_not_supported"
    elif kind == "rate_limit_error" or code == "rate_limit_exceeded":
        result["reason"] = "rate_limited"
    elif (
        kind in ("api_error", "server_error", "timeout_error", "overloaded_error")
        or code == "server_error"
    ):
        result["reason"] = "provider_service_unavailable"
    return result
