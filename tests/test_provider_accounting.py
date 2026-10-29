"""Known skips do not spend allowance; nonfinal provider outcomes keep reservations."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_conversation import contract, seed, tool_reply, turn
from test_provider_plan import planned_turn, prepared

from herma.conversation import ConversationEngine
from herma.conversation_contracts import tools_for
from herma.conversation_provider import ProviderConfig, request_model
from herma.errors import HermaError
from herma.store import ProvisionStore

KEYS = {
    "meta": "META_API_KEY",
    "ollama": "OLLAMA_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def provider_config(provider: str, **patch: Any) -> ProviderConfig:
    return ProviderConfig(
        **{
            "provider": provider,
            "model": {"meta": "muse-spark-1.3", "ollama": "muse-spark-open"}.get(
                provider, "synthetic/model"
            ),
            "max_output": 16384,
            "openai_budget_usd": 2,
            "openai_rates": (1, 3),
            "anthropic_budget_usd": 2,
            "anthropic_rates": (1, 3),
            "openrouter_budget_usd": 2,
            "openrouter_rates": (1, 3),
            "openrouter_provider": "synthetic-host",
            **patch,
        }
    )


@pytest.mark.parametrize("provider", KEYS)
def test_missing_selected_key_skips_before_reserving_but_offline_preparation_works(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, provider: str
) -> None:
    for variable in KEYS.values():
        monkeypatch.setenv(variable, "synthetic-other-provider-key")
    monkeypatch.delenv(KEYS[provider])
    config = provider_config(provider)
    body = config.build_request([], tools_for([contract()]))
    assert config.max_output is not None
    assert config.reservation(body)[0] > config.max_output
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("a missing selected credential must stop before dispatch")

    engine = ConversationEngine(store, call=forbidden)
    result = asyncio.run(engine.turn("key:alice", turn(provider=provider), config))
    attempt = result["attempts"][0]
    assert result["error_code"] == "provider_not_configured"
    assert result["reserved_tokens"] == attempt["reserved_tokens"] == 0
    assert attempt["reservation_status"] == "not_reserved" and attempt["outcome"] == "not_sent"
    assert not any(
        action["action"] == "provider_request" for action in result["server_exception"]["actions"]
    )
    assert asyncio.run(engine.turn("key:alice", turn(provider=provider), config)) == result
    with engine.state.connect() as conn:
        assert (
            conn.execute(
                "SELECT COALESCE(SUM(reserved_microusd),0) FROM work_provider_budget"
            ).fetchone()[0]
            == 0
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM work_provider_budget WHERE provider!='coordination'"
            ).fetchone()[0]
            == 0
        )
        assert conn.execute("SELECT SUM(reserved_tokens) FROM work_budgets").fetchone()[0] == 0


def test_missing_key_does_not_consume_the_exact_allowance_needed_for_permitted_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    monkeypatch.delenv("META_API_KEY")
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        assert request.url.host == "ollama.com"
        return httpx.Response(
            200, json=tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}})
        )

    async def call(config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
        return await request_model(config, body, transport=httpx.MockTransport(handler))

    probe_store = ProvisionStore(tmp_path / "probe.db")
    seed(probe_store, "key:alice")
    probe = asyncio.run(ConversationEngine(probe_store, call=call).turn("key:alice", turn()))
    limit = probe["reserved_tokens"]
    requests.clear()
    monkeypatch.setenv("HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR", str(limit))
    engine = ConversationEngine(store, call=call)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    assert requests == ["https://ollama.com/api/chat"]
    assert result["proposal"]["status"] == "ready"
    assert result["reserved_tokens"] == limit
    assert result["attempts"][0]["reserved_tokens"] == 0
    assert result["attempts"][0]["reservation_status"] == "not_reserved"
    with engine.state.connect() as conn:
        assert conn.execute("SELECT SUM(reserved_tokens) FROM work_budgets").fetchone()[0] == limit
        assert [
            row[0]
            for row in conn.execute(
                "SELECT provider FROM work_provider_budget WHERE provider!='coordination'"
            )
        ] == ["ollama"]


@pytest.mark.parametrize("status", [201, 202, 204, 206])
@pytest.mark.parametrize("uncertain", [False, True])
def test_nonfinal_success_preserves_unknown_outcome_and_requires_uncertain_grant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int, uncertain: bool
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=uncertain)
    monkeypatch.setenv("HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "true")
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.host)
        if request.url.host == "api.meta.ai":
            return httpx.Response(
                status,
                content=b"" if status == 204 else b'{"status":"queued","id":"private-job"}',
                headers={"Location": "https://example.com/private-job", "Retry-After": "60"},
            )
        assert request.url.host == "ollama.com"
        return httpx.Response(
            200, json=tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}})
        )

    async def call(config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
        return await request_model(config, body, transport=httpx.MockTransport(handler))

    engine = ConversationEngine(store, call=call)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    assert requests == (["api.meta.ai", "ollama.com"] if uncertain else ["api.meta.ai"])
    attempt = result["attempts"][0]
    assert attempt["upstream_http_status"] == status
    assert attempt["outcome"] == "unknown" and attempt["reservation_status"] == "reserved"
    assert attempt["error_code"] == "provider_outcome_uncertain"
    assert attempt["usage"] == {"input_tokens": None, "output_tokens": None}
    assert attempt["reserved_usd"] > 0 and attempt["reserved_tokens"] > 0
    assert attempt["provider_health"]["requires_uncertain_authorization"] is True
    assert "private-job" not in json.dumps(result)
    assert asyncio.run(engine.turn("key:alice", planned_turn())) == result
    assert len(requests) == (2 if uncertain else 1)
    assert engine.state.snapshot("key:bob", "conversation-one")["attempts"] == []


def test_nonfinal_failover_plan_cannot_grant_itself_operator_uncertainty_permission(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=True)
    monkeypatch.setenv("HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "false")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("both uncertainty grants are required before a plan may dispatch")

    with pytest.raises(HermaError) as denied:
        asyncio.run(ConversationEngine(store, call=forbidden).turn("key:alice", planned_turn()))
    assert denied.value.code == "provider_plan_not_authorized"


@pytest.mark.parametrize("status", ["queued", "in_progress"])
def test_openai_nonterminal_body_keeps_health_uncertain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-provider-key")
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"status": status, "output": [], "id": "private-job"})

    async def call(config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
        return await request_model(config, body, transport=httpx.MockTransport(handler))

    engine = ConversationEngine(store, call=call)
    config = provider_config("openai")
    result = asyncio.run(engine.turn("key:alice", turn(provider="openai"), config))
    assert result["error_code"] == "provider_outcome_uncertain"
    attempt = result["attempts"][0]
    assert attempt["outcome"] == "unknown" and attempt["upstream_http_status"] == 200
    assert attempt["reserved_usd"] > 0
    assert attempt["provider_health"]["requires_uncertain_authorization"] is True
    assert asyncio.run(engine.turn("key:alice", turn(provider="openai"), config)) == result
    assert len(requests) == 1
    assert "private-job" not in json.dumps(result)


@pytest.mark.parametrize(
    ("provider", "generation"),
    [
        ("openrouter", {"n": 3}),
        ("meta", {"n": 2}),
        ("openrouter", {"n": True}),
        ("openrouter", {"n": "1"}),
        ("openai", {"n": 1}),
        ("openrouter", {"best_of": 3}),
        ("openai", {"service_tier": "priority"}),
        ("openai", {"service_tier": "auto"}),
        ("openai", {"service_tier": "flex"}),
        ("openai", {"service_tier": None}),
        ("anthropic", {"service_tier": "auto"}),
        ("openrouter", {"service_tier": "default"}),
        ("openai", {"prompt": {"id": "pmpt_synthetic", "version": "1"}}),
        ("openrouter", {"prompt_id": "pmpt_synthetic"}),
        ("anthropic", {"speed": "fast"}),
        ("anthropic", {"inference_geo": "us"}),
    ],
)
def test_unpriced_or_opaque_generation_is_rejected_before_allowance(
    tmp_path: Path, provider: str, generation: dict[str, Any]
) -> None:
    config = provider_config(provider, generation=generation)
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("unsupported accounting must not invoke a provider")

    engine = ConversationEngine(store, call=forbidden)
    with pytest.raises(HermaError) as denied:
        asyncio.run(engine.turn("key:alice", turn(provider=provider), config))
    assert denied.value.code == "unsupported_generation_configuration"
    with engine.state.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM work_provider_budget").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM work_budgets").fetchone()[0] == 0


@pytest.mark.parametrize("provider", ["openai", "anthropic", "openrouter"])
def test_supported_generation_preserves_native_output_and_standard_tier(provider: str) -> None:
    generation = {"temperature": 0.4, **({"n": 1} if provider == "openrouter" else {})}
    config = provider_config(provider, max_output=300000, generation=generation)
    body = config.build_request([], tools_for([contract()]))
    assert body["temperature"] == 0.4
    assert body["max_output_tokens" if provider == "openai" else "max_tokens"] == 300000
    assert config.reservation(body)[0] > 300000
    if provider == "openrouter":
        assert body["n"] == 1 and "service_tier" not in body
    else:
        assert body["service_tier"] == ("default" if provider == "openai" else "standard_only")


def test_known_caller_budget_denial_has_zero_reserved_attempt_tokens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    monkeypatch.setenv("HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR", "1")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("caller budget denial cannot dispatch")

    result = asyncio.run(
        ConversationEngine(store, call=forbidden).turn("key:alice", planned_turn())
    )
    attempt = result["attempts"][0]
    assert result["error_code"] == "conversation_budget_exhausted"
    assert len(result["attempts"]) == 1
    assert attempt["reservation_status"] == "not_reserved"
    assert result["reserved_tokens"] == attempt["reserved_tokens"] == 0
    assert attempt["reservation_ceiling_tokens"] > 1
