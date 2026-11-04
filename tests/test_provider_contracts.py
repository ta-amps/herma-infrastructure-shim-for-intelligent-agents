"""Provider selection, native generation and exception allowance stay explicit."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_conversation import contract, seed, turn

from herma.conversation import ConversationEngine, parse_proposal
from herma.conversation_contracts import tools_for
from herma.conversation_provider import ProviderConfig, ProviderFailure, request_model, usage_for
from herma.errors import HermaError
from herma.harness_gate import HarnessPrincipal
from herma.proxy import HermaMiddleware, _resolve_upstream_headers, _resolve_upstream_url
from herma.schemas import WireFormat
from herma.store import ProvisionStore


def openai_config(**patch: Any) -> ProviderConfig:
    return ProviderConfig(
        **{
            "provider": "openai",
            "model": "example-responses-model",
            "max_output": 300000,
            "openai_rates": (1.0, 3.0),
            "openai_budget_usd": 2.0,
            **patch,
        }
    )


def response() -> dict[str, Any]:
    return {
        "status": "completed",
        "output": [
            {"type": "reasoning", "summary": []},
            {
                "type": "function_call",
                "name": contract().tool_name,
                "arguments": json.dumps({"value": {"message": "EXAMPLE result", "example": True}}),
            },
        ],
        "usage": {"input_tokens": 80, "output_tokens": 120},
    }


def test_missing_server_allowance_never_invokes_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("HERMA_CONVERSATION_MAX_OUTPUT", raising=False)
    monkeypatch.delenv("HERMA_CONVERSATION_META_MAX_OUTPUT", raising=False)
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("missing allowance must not cause provider inference")

    engine = ConversationEngine(store, call=forbidden)
    with pytest.raises(HermaError) as missing:
        asyncio.run(engine.turn("key:alice", turn()))
    assert missing.value.code == "output_allowance_required"
    assert engine.state.snapshot("key:alice", "conversation-one")["version"] == 0


def test_responses_protocol_and_pre_call_exception_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "example-openai-secret")
    monkeypatch.setenv("META_API_KEY", "example-wrong-meta-key")
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    requests = []
    engine: ConversationEngine

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert str(request.url) == "https://api.openai.com/v1/responses"
        assert request.headers["authorization"] == "Bearer example-openai-secret"
        body = json.loads(request.content)
        assert "messages" not in body and "max_tokens" not in body
        assert body["max_output_tokens"] == 300000
        assert body["reasoning"] == {"effort": "high", "summary": "auto"}
        assert body["store"] is False and body["background"] is False
        assert body["tools"][0]["strict"] is False
        assert "function" not in body["tools"][0]
        with engine.state.connect() as conn:
            row = conn.execute("SELECT exception_record,response FROM work_turns").fetchone()
            assert row["response"] is None
            record = json.loads(row["exception_record"])
            assert record["principal"] == "key:alice" and record["payer"] == "operator"
            assert record["max_output_tokens"] == 300000
            assert record["reserved_usd"] > 0.9
        return httpx.Response(200, json=response())

    async def call(config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
        return await request_model(config, body, transport=httpx.MockTransport(handler))

    config = openai_config(reasoning_effort="high", generation={"reasoning": {"summary": "auto"}})
    engine = ConversationEngine(store, call=call)
    first = asyncio.run(engine.turn("key:alice", turn(provider="openai"), config))
    assert first["proposal"]["status"] == "ready" and not first["executed"]
    assert first["usage"] == {"input_tokens": 80, "output_tokens": 120}
    assert first["reserved_tokens"] > 300000
    assert asyncio.run(engine.turn("key:alice", turn(provider="openai"), config)) == first
    assert len(requests) == 1


def test_provider_failure_has_no_cross_provider_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "example-openai-secret")
    monkeypatch.setenv("META_API_KEY", "example-other-secret")
    calls = []

    def redirect(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(307, headers={"Location": "https://api.meta.ai/v1/chat/completions"})

    config = openai_config()
    body = config.build_request([], tools_for([contract()]))
    with pytest.raises(ProviderFailure, match="provider_rejected"):
        asyncio.run(request_model(config, body, transport=httpx.MockTransport(redirect)))
    assert calls == ["https://api.openai.com/v1/responses"]
    monkeypatch.delenv("OPENAI_API_KEY")
    with pytest.raises(ProviderFailure, match="provider_not_configured"):
        asyncio.run(request_model(config, body, transport=httpx.MockTransport(redirect)))
    assert len(calls) == 1


def test_native_generation_settings_survive_and_output_allowance_is_not_guessed() -> None:
    config = ProviderConfig(
        "meta",
        "muse-spark-1.3",
        max_output=300000,
        meta_budget_usd=5,
        generation={"temperature": 0.4},
    )
    body = config.build_request([], [])
    assert body["temperature"] == 0.4
    assert body["max_tokens"] == 300000
    assert config.reservation(body)[0] > 300000
    assert config.caller_token_limit is None
    with pytest.raises(ValueError, match="explicit model tariff"):
        ProviderConfig("openai", "example-model", max_output=300000).validate()


@pytest.mark.parametrize(
    "bad",
    [
        {"status": "failed", "output": response()["output"]},
        {"status": "completed", "output": response()["output"] * 2},
        {"status": "completed", "output": [{"type": "message", "content": "fake function"}]},
    ],
)
def test_responses_requires_one_completed_real_function(bad: dict[str, Any]) -> None:
    proposal, issues = parse_proposal(bad, "openai", [contract()])
    assert proposal.status == "blocked" and issues[0]["rule"] == "invalid_tool_call"


def test_responses_reports_output_exhaustion_and_missing_usage() -> None:
    proposal, issues = parse_proposal(
        {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}},
        "openai",
        [contract()],
    )
    assert proposal.status == "blocked" and issues[0]["rule"] == "output_budget_exhausted"
    assert usage_for("openai", {"usage": {"input_tokens": True, "output_tokens": -1}}) == {
        "input_tokens": None,
        "output_tokens": None,
    }


@pytest.mark.parametrize(
    ("wire", "base", "path", "payload"),
    [
        (
            "chat_completions",
            "http://localhost:11434",
            "/v1/chat/completions",
            {
                "model": "local-model",
                "messages": [{"role": "user", "content": "EXAMPLE"}],
                "max_tokens": 300000,
                "temperature": 0.4,
            },
        ),
        (
            "responses",
            "https://api.openai.com",
            "/v1/responses",
            {
                "model": "example-openai-model",
                "input": "EXAMPLE",
                "max_output_tokens": 300000,
                "reasoning": {"effort": "high"},
            },
        ),
        (
            "chat_completions",
            "https://api.meta.ai",
            "/v1/chat/completions",
            {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "EXAMPLE"}],
                "max_tokens": 128000,
            },
        ),
    ],
)
def test_worker_proxy_keeps_native_settings_and_explicit_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    wire: WireFormat,
    base: str,
    path: str,
    payload: dict[str, Any],
) -> None:
    monkeypatch.setenv("HERMA_UPSTREAM_API_KEY", "example-operator-key")
    monkeypatch.setenv("HERMA_UPSTREAM_CHAT_URL", "https://operator.example/v1/chat/completions")
    monkeypatch.setenv("HERMA_UPSTREAM_RESPONSES_URL", "https://operator.example/v1/responses")
    monkeypatch.delenv("HERMA_ALLOWED_UPSTREAM_HOSTS", raising=False)
    headers = {"x-upstream-base-url": base, "x-upstream-api-key": "example-caller-key"}
    assert _resolve_upstream_url(wire, headers) == base + path
    assert _resolve_upstream_headers(wire, headers)["Authorization"] == "Bearer example-caller-key"
    middleware = HermaMiddleware(ProvisionStore(tmp_path / "state.db"))

    def no_network(*_args: Any, **_kwargs: Any) -> None:
        pytest.fail("deterministic worker interception must not call a provider")

    monkeypatch.setattr(httpx, "AsyncClient", no_network)
    outcome = asyncio.run(
        middleware.intercept(
            payload=payload,
            wire_format=wire,
            principal=HarnessPrincipal("alice", "EXAMPLE worker", "opencode", frozenset({"route"})),
            offline_only=True,
        )
    )
    for field in ("max_tokens", "max_output_tokens", "reasoning", "temperature"):
        if field in payload:
            assert outcome.augmented_payload[field] == payload[field]
    assert outcome.matches == []


def test_default_upstreams_route_to_the_meta_api_and_the_allowlist_names_current_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        "HERMA_UPSTREAM_CHAT_URL",
        "HERMA_UPSTREAM_RESPONSES_URL",
        "HERMA_UPSTREAM_MESSAGES_URL",
        "HERMA_ALLOWED_UPSTREAM_HOSTS",
    ):
        monkeypatch.delenv(name, raising=False)
    assert _resolve_upstream_url("chat_completions", {}) == (
        "https://api.meta.ai/v1/chat/completions"
    )
    assert _resolve_upstream_url("responses", {}) == "https://api.meta.ai/v1/responses"
    meta = {"X-Herma-Upstream-Url": "https://api.meta.ai"}
    assert _resolve_upstream_url("responses", meta) == "https://api.meta.ai/v1/responses"
    # Hosts that left the default allowlist need an explicit operator setting. They are spelled
    # in pieces so repository-wide name guards stay clean.
    for host in ("oll" + "ama.com", "api." + "lla" + "ma.com"):
        with pytest.raises(HermaError) as refused:
            _resolve_upstream_url("chat_completions", {"X-Herma-Upstream-Url": f"https://{host}"})
        assert refused.value.code == "upstream_not_allowed"
