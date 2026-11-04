"""Provider error evidence is bounded, private and never a raw response echo."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_conversation import seed, turn
from test_provider_contracts import openai_config

from herma.conversation import ConversationEngine
from herma.conversation_provider import ProviderConfig, ProviderFailure, request_model
from herma.provider_diagnostics import ERROR_BODY_BYTES, normalize_provider_error
from herma.store import ProvisionStore


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (
            {"code": "unsupported_parameter", "param": "parallel_tool_calls"},
            "unsupported_parameter",
        ),
        ({"message": "parallel_tool_calls is not supported"}, "unsupported_parameter"),
        (
            {"message": "max_tokens must be at most the model maximum"},
            "output_allowance_not_supported",
        ),
        ({"code": "model_not_found"}, "model_unavailable"),
        ({"message": "Model requested does not exist"}, "model_unavailable"),
        (
            {"message": "No endpoints found that support the requested parameters"},
            "no_eligible_provider_endpoint",
        ),
        ({"code": "insufficient_quota"}, "credit_or_quota_exhausted"),
        ({"code": 402}, "payment_required"),
        (
            {"type": "invalid_request_error", "message": "Your credit balance is too low"},
            "credit_or_quota_exhausted",
        ),
        (
            {"type": "rate_limit_error", "message": "Workspace spend cap reached"},
            "credit_or_quota_exhausted",
        ),
        ({"type": "authentication_error"}, "authentication_failed"),
        ({"type": "permission_error"}, "permission_denied"),
        (
            {"code": "context_length_exceeded", "message": "max_tokens exceeds context length"},
            "context_too_large",
        ),
        ({"type": "rate_limit_error"}, "rate_limited"),
        ({"type": "overloaded_error"}, "provider_service_unavailable"),
        ({"message": "Unrecognized provider explanation"}, "unknown"),
    ],
)
def test_fixed_provider_reported_categories(error: dict[str, Any], reason: str) -> None:
    result = normalize_provider_error(json.dumps({"error": error}).encode())
    assert result["source"] == "provider_reported"
    assert result["reason"] == reason
    assert result["body_state"] == "parsed"


@pytest.mark.parametrize(
    ("raw", "state"),
    [
        (b"", "empty"),
        (b"not json", "malformed"),
        (b"\xff", "malformed"),
        (b"[]", "unrecognized"),
        (b'{"error":null}', "unrecognized"),
        (b"x" * (ERROR_BODY_BYTES + 1), "oversized"),
    ],
)
def test_unknown_bodies_do_not_invent_a_cause(raw: bytes, state: str) -> None:
    assert normalize_provider_error(raw) == {
        "source": "provider_reported",
        "body_state": state,
        "type": None,
        "code": None,
        "parameter": None,
        "reason": "unknown",
    }


def test_arbitrary_error_fields_and_sensitive_echoes_never_escape() -> None:
    private = "sk-" + "example" * 8
    for value in (private, {"nested": private}, [private], True, 987654321):
        raw = json.dumps(
            {
                "error": {
                    "type": value,
                    "code": value,
                    "param": value,
                    "message": f"Prompt: {private}; account acct_example_private; request req_example_private",
                    "metadata": {"raw": private},
                },
                "request_id": private,
            }
        ).encode()
        result = normalize_provider_error(raw)
        assert result == {
            "source": "provider_reported",
            "body_state": "parsed",
            "type": None,
            "code": None,
            "parameter": None,
            "reason": "unknown",
        }
    assert normalize_provider_error(b"", body_state=private)["body_state"] == "unavailable"
    result = normalize_provider_error(
        json.dumps({"error": {"code": 404, "message": "No endpoints found " + private}}).encode()
    )
    assert result["code"] == 404 and result["reason"] == "no_eligible_provider_endpoint"
    assert private not in json.dumps(result)
    # A bare error string (no nested object) can be classified without retaining it.
    assert normalize_provider_error(b'{"error":"model not found"}')["reason"] == "model_unavailable"


@pytest.mark.parametrize(
    ("status", "code", "outcome"),
    [
        (400, "provider_rejected", "rejected"),
        (429, "provider_rate_limited", "rejected"),
        (503, "provider_unavailable", "unknown"),
    ],
)
def test_error_receipt_keeps_reservation_and_replay_without_raw_echo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int, code: str, outcome: str
) -> None:
    private = "sk-" + "example" * 8
    monkeypatch.setenv("OPENAI_API_KEY", private)
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["authorization"] == "Bearer " + private
        return httpx.Response(
            status,
            headers={"Retry-After": "17", "X-Request-ID": "req_example_private"},
            json={
                "error": {
                    "type": "invalid_request_error",
                    "code": "unsupported_parameter",
                    "param": "parallel_tool_calls",
                    "message": private + " acct_example_private " + str(request.content),
                },
                "account_id": "acct_example_private",
            },
        )

    async def call(config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
        return await request_model(config, body, transport=httpx.MockTransport(handler))

    engine = ConversationEngine(store, call=call)
    config = openai_config()
    input_turn = turn(provider="openai")
    result = asyncio.run(engine.turn("key:alice", input_turn, config))
    attempt = result["attempts"][0]
    assert result["error_code"] == code
    assert attempt["upstream_http_status"] == status and attempt["outcome"] == outcome
    assert attempt["provider_diagnostics"] == {
        "source": "provider_reported",
        "body_state": "parsed",
        "type": "invalid_request_error",
        "code": "unsupported_parameter",
        "parameter": "parallel_tool_calls",
        "reason": "unsupported_parameter",
    }
    assert attempt["usage"] == {"input_tokens": None, "output_tokens": None}
    assert attempt["reserved_usd"] > 0 and attempt["reservation_status"] == "reserved"
    assert asyncio.run(engine.turn("key:alice", input_turn, config)) == result
    assert calls == 1
    assert engine.state.snapshot("key:bob", "conversation-one")["attempts"] == []
    encoded = json.dumps(result) + json.dumps(
        engine.state.snapshot("key:alice", "conversation-one")
    )
    assert all(
        value not in encoded for value in (private, "acct_example_private", "req_example_private")
    )
    if status in {429, 503}:
        assert attempt["available_after"] > 0


class ErrorStream(httpx.AsyncByteStream):
    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.closed = False
        self.chunks_read = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        if self.mode == "unavailable":
            raise httpx.ReadTimeout("EXAMPLE sensitive transport explanation")
        if self.mode == "stream_error":
            raise RuntimeError("EXAMPLE sensitive stream explanation")
        if self.mode == "cancelled":
            raise asyncio.CancelledError()
        for _ in range(20):
            self.chunks_read += 1
            yield b"x" * 4096

    async def aclose(self) -> None:
        self.closed = True


@pytest.mark.parametrize("mode", ["unavailable", "oversized", "encoded", "stream_error"])
def test_error_read_failure_keeps_known_status_and_stops_bounded_read(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "example-key")
    stream = ErrorStream(mode)
    response = httpx.Response(
        429,
        stream=stream,
        headers={
            "Retry-After": "19",
            **({"Content-Encoding": "gzip"} if mode == "encoded" else {}),
        },
    )
    with pytest.raises(ProviderFailure) as caught:
        asyncio.run(
            request_model(openai_config(), {}, transport=httpx.MockTransport(lambda _: response))
        )
    failure = caught.value
    assert str(failure) == "provider_rate_limited" and failure.outcome == "rejected"
    assert failure.http_status == 429 and failure.retry_after_seconds == 19
    assert failure.diagnostics is not None
    assert failure.diagnostics["body_state"] == (
        "unavailable" if mode in {"encoded", "stream_error"} else mode
    )
    assert failure.diagnostics["reason"] == "unknown"
    assert stream.chunks_read <= ERROR_BODY_BYTES // 4096 + 1
    assert stream.closed


def test_external_cancellation_is_not_hidden_by_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "example-key")
    stream = ErrorStream("cancelled")
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            request_model(
                openai_config(),
                {},
                transport=httpx.MockTransport(lambda _: httpx.Response(429, stream=stream)),
            )
        )
    assert stream.closed
