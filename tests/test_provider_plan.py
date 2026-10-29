"""Explicit private plans may advance providers without losing charged attempts."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import grant
from test_conversation import contract, seed, tool_reply, turn

from herma.conversation import ConversationEngine, parse_proposal
from herma.conversation_contracts import tools_for
from herma.conversation_provider import ProviderConfig, ProviderFailure, request_model
from herma.errors import HermaError
from herma.schemas import ContextEntry
from herma.store import ProvisionStore

PLAN_CHOICES: list[dict[str, Any]] = [
    {"provider": "meta", "model": "muse-spark-1.3"},
    {"provider": "ollama", "model": "muse-spark-open"},
]


def plan_entry(scope: str = "key:alice", *, uncertain: bool = False) -> ContextEntry:
    return ContextEntry(
        entry_id="plan.providers",
        kind="noun",
        title="Provider plan",
        summary="SYNTHETIC private provider plan",
        schema_or_body={
            "provider_plan": {
                "caller_scope": scope,
                "purpose": "caller_requested_typed_proposal",
                "payer": "operator",
                "context_refs": ["work.observation"],
                "allow_failover": True,
                "allow_uncertain_outcome": uncertain,
                "providers": [dict(choice) for choice in PLAN_CHOICES],
            }
        },
    )


def prepared(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, uncertain: bool = False
) -> ProvisionStore:
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    entry = plan_entry(uncertain=uncertain)
    store.upsert_context_entry(entry, caller_scope="key:alice", is_admin=False)
    monkeypatch.setenv("HERMA_CONVERSATION_MAX_OUTPUT", "16384")
    monkeypatch.setenv("META_API_KEY", "synthetic-provider-key")
    monkeypatch.setenv("OLLAMA_API_KEY", "synthetic-provider-key")
    # Alice's own operator grant names exactly the plan's choices; Bob holds no grant.
    grant(monkeypatch, "key:alice", choices=PLAN_CHOICES, uncertain=uncertain)
    return store


def planned_turn(**patch: Any) -> Any:
    return turn(
        provider="meta",
        context_refs=["work.observation", "plan.providers"],
        provider_plan_ref="plan.providers",
        **patch,
    )


def test_rotation_persists_attempt_before_advancing_and_keeps_health_private(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    called = []
    engine: ConversationEngine

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        called.append(config.provider)
        record = engine.state.snapshot("key:alice", "conversation-one")["attempts"]
        assert record[-1]["status"] == "in_flight"
        if config.provider == "meta":
            raise ProviderFailure(
                "provider_rate_limited", outcome="rejected", retry_after_seconds=60, http_status=429
            )
        assert record[0]["outcome"] == "rejected"
        assert record[0]["usage"]["output_tokens"] is None
        assert record[0]["reservation_status"] == "reserved"
        return tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}})

    engine = ConversationEngine(store, call=call)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    assert called == ["meta", "ollama"]
    assert result["proposal"]["status"] == "ready"
    assert result["reserved_usd"] > 0
    assert asyncio.run(engine.turn("key:alice", planned_turn())) == result
    assert called == ["meta", "ollama"]
    assert engine.state.snapshot("key:bob", "conversation-one")["attempts"] == []
    assert engine.state.cooldown("key:bob", "meta", "muse-spark-1.3") == 0
    assert all(
        action["model"] is None
        for action in result["server_exception"]["actions"]
        if action["action"] != "provider_request"
    )


@pytest.mark.parametrize("uncertain", [False, True])
def test_unknown_outcome_only_advances_under_both_explicit_grants(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, uncertain: bool
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=uncertain)
    called = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        called.append(config.provider)
        if config.provider == "meta":
            raise ProviderFailure("provider_unavailable")
        return tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}})

    engine = ConversationEngine(store, call=call)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    assert called == (["meta", "ollama"] if uncertain else ["meta"])
    assert result["attempts"][0]["outcome"] == "unknown"
    assert result["attempts"][0]["reserved_usd"] > 0
    if not uncertain:
        assert result["error_code"] == "provider_unavailable"


def test_plan_scope_data_payer_model_and_operator_grant_are_required(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=True)

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("unauthorized plan cannot dispatch")

    engine = ConversationEngine(store, call=forbidden)
    # Bob owns no plan; Alice's plan asks for uncertain failover her grant does not carry.
    grant(monkeypatch, "key:alice", "key:bob", choices=PLAN_CHOICES)
    for scope in ("key:bob", "key:alice"):
        with pytest.raises(HermaError) as denied:
            asyncio.run(engine.turn(scope, planned_turn()))
        assert denied.value.code == "provider_plan_not_authorized"
    # Another caller's uncertainty grant cannot lend Alice permission to pay twice.
    monkeypatch.setenv(
        "HERMA_CONVERSATION_PROVIDER_GRANTS",
        json.dumps(
            [
                {"caller_scope": "key:alice", "providers": PLAN_CHOICES},
                {
                    "caller_scope": "key:bob",
                    "providers": PLAN_CHOICES,
                    "allow_uncertain_failover": True,
                },
            ]
        ),
    )
    with pytest.raises(HermaError) as borrowed:
        asyncio.run(engine.turn("key:alice", planned_turn()))
    assert borrowed.value.code == "provider_plan_not_authorized"
    grant(monkeypatch, "key:alice", choices=[{"provider": "meta", "model": "different-model"}])
    with pytest.raises(HermaError, match="within your operator provider grant"):
        asyncio.run(engine.turn("key:alice", planned_turn()))
    assert engine.state.snapshot("key:alice", "conversation-one")["attempts"] == []


def test_config_missing_can_advance_without_claiming_a_model_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    monkeypatch.setenv("HERMA_CONVERSATION_META_MAX_OUTPUT", "")
    called = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        called.append(config.provider)
        return tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}})

    result = asyncio.run(ConversationEngine(store, call=call).turn("key:alice", planned_turn()))
    assert called == ["ollama"]
    assert result["attempts"][0]["outcome"] == "not_sent"
    assert result["attempts"][0]["reservation_status"] == "not_reserved"


def test_failed_coordination_never_rotates_into_a_paid_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=True)

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("failed coordination must never dispatch a provider")

    engine = ConversationEngine(store, call=forbidden)

    def failed_reservation(**_kwargs: Any) -> None:
        raise HermaError(
            503, "storage_or_coordination_unavailable", "Unavailable", "SYNTHETIC storage failure"
        )

    monkeypatch.setattr(engine.state, "reserve_attempt", failed_reservation)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    assert result["error_code"] == "storage_or_coordination_unavailable"
    assert len(result["attempts"]) == 1 and result["attempts"][0]["outcome"] == "not_sent"
    assert not any(
        action["action"] == "provider_request" for action in result["server_exception"]["actions"]
    )


def test_anthropic_native_protocol_and_credential_are_distinct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "synthetic-anthropic-key")
    config = ProviderConfig(
        "anthropic",
        "synthetic-claude-model",
        max_output=128000,
        anthropic_budget_usd=5,
        anthropic_rates=(3, 15),
        generation={"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}},
    )
    reply = {
        "type": "message",
        "stop_reason": "tool_use",
        "content": [
            {
                "type": "tool_use",
                "name": contract().tool_name,
                "input": {"value": {"message": "SYNTHETIC", "synthetic": True}},
            }
        ],
        "usage": {"input_tokens": 100, "output_tokens": 20},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.anthropic.com/v1/messages"
        assert request.headers["x-api-key"] == "synthetic-anthropic-key"
        assert request.headers["anthropic-version"] == "2026-10-21"
        assert "authorization" not in request.headers
        body = json.loads(request.content)
        assert body["max_tokens"] == 128000 and body["system"] == "SYNTHETIC system"
        assert body["messages"] == [{"role": "user", "content": "SYNTHETIC input"}]
        assert body["tools"][0]["input_schema"] == contract().input_schema
        assert body["thinking"] == {"type": "adaptive"}
        return httpx.Response(200, json=reply)

    body = config.build_request(
        [
            {"role": "system", "content": "SYNTHETIC system"},
            {"role": "user", "content": "SYNTHETIC input"},
        ],
        tools_for([contract()]),
    )
    result = asyncio.run(request_model(config, body, transport=httpx.MockTransport(handler)))
    proposal, _issues = parse_proposal(result, "anthropic", [contract()])
    assert proposal.status == "ready" and proposal.executed is False


def test_exact_token_allowance_has_no_hidden_coordination_charge(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OLLAMA_API_KEY", "synthetic-provider-key")

    async def call(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        return tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}})

    config = ProviderConfig("ollama", "muse-spark-open", max_output=16384)
    probe_store = ProvisionStore(tmp_path / "probe.db")
    seed(probe_store, "key:alice")
    probe = asyncio.run(
        ConversationEngine(probe_store, call=call).turn("key:alice", turn(), config)
    )
    limit = probe["reserved_tokens"]
    store = ProvisionStore(tmp_path / "bounded.db")
    seed(store, "key:alice")
    engine = ConversationEngine(store, call=call)
    result = asyncio.run(
        engine.turn("key:alice", turn(), replace(config, caller_token_limit=limit))
    )
    assert result["proposal"]["status"] == "ready"
    with engine.state.connect() as conn:
        assert (
            conn.execute("SELECT SUM(reserved_tokens) FROM work_budgets").fetchone()[0]
            == result["reserved_tokens"]
            == limit
        )


def test_openrouter_fixed_route_preserves_native_settings_and_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-router-key")
    config = ProviderConfig(
        "openrouter",
        "synthetic/model",
        max_output=128000,
        openrouter_budget_usd=5,
        openrouter_rates=(1, 3),
        openrouter_provider="synthetic-host",
        generation={"temperature": 0.4},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer synthetic-router-key"
        body = json.loads(request.content)
        assert body["max_tokens"] == 128000 and body["temperature"] == 0.4
        assert body["provider"] == {
            "only": ["synthetic-host"],
            "order": ["synthetic-host"],
            "allow_fallbacks": False,
            "require_parameters": True,
            "data_collection": "deny",
        }
        return httpx.Response(
            200, json=tool_reply({"value": {"message": "SYNTHETIC", "synthetic": True}}, "meta")
        )

    reply = asyncio.run(
        request_model(
            config,
            config.build_request([], tools_for([contract()])),
            transport=httpx.MockTransport(handler),
        )
    )
    assert parse_proposal(reply, "openrouter", [contract()])[0].status == "ready"
    for model in (
        "openrouter/auto",
        "@preset/synthetic-review",
        "synthetic/model@preset/synthetic-review",
        "synthetic/model:online",
        "synthetic/model:free:online",
    ):
        with pytest.raises(ValueError, match="OpenRouter requires"):
            replace(config, model=model).validate()
    for generation in (
        {"provider": {"allow_fallbacks": True}},
        {"models": ["other/model"]},
        {"preset": "@preset/review"},
        {"plugins": [{"id": "web"}]},
    ):
        with pytest.raises(ValueError, match="generation settings"):
            replace(config, generation=generation).build_request([], [])
