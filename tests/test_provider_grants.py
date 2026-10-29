"""Operator spending grants name exact callers, and one upstream model is one identity."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from conftest import SYNTHETIC_CHOICES, grant
from test_conversation import seed, tool_reply, turn
from test_provider_plan import PLAN_CHOICES, plan_entry, planned_turn, prepared

from herma.conversation import ConversationEngine
from herma.conversation_provider import ProviderConfig, ProviderFailure
from herma.errors import HermaError
from herma.harness_gate import is_contributor_model
from herma.provider_plan import operator_grants, upstream_identity
from herma.store import ProvisionStore

READY = {"value": {"message": "SYNTHETIC", "synthetic": True}}
GPT = {"provider": "openai", "model": "synthetic-gpt"}
ROUTED_GPT = {
    "provider": "openrouter",
    "model": "openai/synthetic-gpt",
    "routing_provider": "openai",
}
OTHER = {"provider": "openrouter", "model": "synthetic/other", "routing_provider": "synthetic-host"}


@pytest.fixture(autouse=True)
def synthetic_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("META", "OLLAMA", "OPENAI", "ANTHROPIC", "OPENROUTER"):
        monkeypatch.setenv(name + "_API_KEY", "synthetic-provider-key")


def openai(model: str = "synthetic-gpt") -> ProviderConfig:
    return ProviderConfig(
        "openai", model, max_output=1000, openai_budget_usd=5, openai_rates=(1, 3)
    )


def openrouter(model: str, routing: str) -> ProviderConfig:
    return ProviderConfig(
        "openrouter",
        model,
        max_output=1000,
        openrouter_budget_usd=5,
        openrouter_rates=(1, 3),
        openrouter_provider=routing,
    )


def ollama(model: str = "muse-spark-open") -> ProviderConfig:
    return ProviderConfig("ollama", model, max_output=1000)


def plan_turn(provider: str, **patch: Any) -> Any:
    refs = ["work.observation", "plan.providers"]
    return turn(provider=provider, context_refs=refs, provider_plan_ref="plan.providers", **patch)


def refused(engine: ConversationEngine, scope: str, value: Any, config: Any = None) -> str:
    with pytest.raises(HermaError) as denied:
        asyncio.run(engine.turn(scope, value, config))
    return denied.value.code


def test_direct_turns_need_the_callers_own_exact_grant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ProvisionStore(tmp_path / "state.db")
    for scope in ("key:alice", "key:bob"):
        seed(store, scope)
    calls = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        calls.append(config.model)
        return tool_reply(READY)

    engine = ConversationEngine(store, call=call)
    grant(monkeypatch, "key:alice", choices=[{"provider": "ollama", "model": "muse-spark-open"}])
    # Route scope alone is not a purchase grant, and another caller's grant does not transfer.
    assert refused(engine, "key:bob", turn(), ollama()) == "provider_grant_required"
    # An explicit configuration cannot widen the grant to another model or provider.
    assert refused(engine, "key:alice", turn(), ollama("other-model")) == "provider_grant_required"
    assert (
        refused(engine, "key:alice", turn(provider="openai"), openai()) == "provider_grant_required"
    )
    assert calls == []
    assert engine.state.snapshot("key:bob", "conversation-one")["version"] == 0
    assert engine.state.snapshot("key:alice", "conversation-one")["version"] == 0
    result = asyncio.run(engine.turn("key:alice", turn(), ollama()))
    assert result["proposal"]["status"] == "ready" and calls == ["muse-spark-open"]
    assert result["server_exception"]["operator_grant"]["caller_scope"] == "key:alice"


def test_openrouter_grant_pins_the_underlying_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("an ungranted gateway route must not dispatch")

    grant(monkeypatch, "key:alice", choices=[OTHER])
    engine = ConversationEngine(store, call=forbidden)
    config = openrouter("synthetic/other", "another-host")
    assert refused(engine, "key:alice", turn(provider="openrouter"), config) == (
        "provider_grant_required"
    )


@pytest.mark.parametrize(
    ("setting", "value"),
    [
        ("HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST", json.dumps(PLAN_CHOICES)),
        ("HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "true"),
        ("HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "false"),
    ],
)
def test_legacy_deployment_wide_grants_fail_closed_and_loudly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, setting: str, value: str
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=True)
    monkeypatch.setenv(setting, value)

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("a refused configuration must not dispatch")

    engine = ConversationEngine(store, call=forbidden)
    assert refused(engine, "key:alice", planned_turn()) == "invalid_provider_configuration"
    assert refused(engine, "key:alice", turn()) == "invalid_provider_configuration"


@pytest.mark.parametrize(
    "grants",
    [
        [{"caller_scope": "*", "providers": PLAN_CHOICES}],
        [{"caller_scope": "key:", "providers": PLAN_CHOICES}],
        [{"caller_scope": "key:alice", "providers": PLAN_CHOICES}] * 2,
        [{"caller_scope": "key:alice", "providers": []}],
        [{"caller_scope": "key:alice", "providers": PLAN_CHOICES[:1] * 2}],
        [{"caller_scope": "key:alice", "providers": [{"provider": "openrouter", "model": "a/b"}]}],
        [
            {
                "caller_scope": "key:alice",
                "providers": [
                    {"provider": "meta", "model": "muse-spark-1.3", "routing_provider": "x"}
                ],
            }
        ],
        [{"caller_scope": "key:alice", "providers": PLAN_CHOICES, "allow_uncertain_failover": 1}],
        [{"caller_scope": "key:alice", "providers": PLAN_CHOICES, "budget_usd": 5}],
        {"caller_scope": "key:alice", "providers": PLAN_CHOICES},
    ],
)
def test_grants_name_one_exact_caller_and_explicit_routes(
    monkeypatch: pytest.MonkeyPatch, grants: Any
) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_PROVIDER_GRANTS", json.dumps(grants))
    with pytest.raises(HermaError) as invalid:
        operator_grants()
    assert invalid.value.code == "invalid_provider_configuration"


def test_grant_text_is_parsed_strictly_and_empty_means_no_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = json.dumps({"caller_scope": "key:alice", "providers": PLAN_CHOICES})
    monkeypatch.setenv(
        "HERMA_CONVERSATION_PROVIDER_GRANTS", '[{"caller_scope":"key:bob",' + raw[1:] + "]"
    )
    with pytest.raises(HermaError) as duplicate:
        operator_grants()
    assert duplicate.value.code == "invalid_provider_configuration"
    for empty in ("", "  "):
        monkeypatch.setenv("HERMA_CONVERSATION_PROVIDER_GRANTS", empty)
        assert operator_grants() == {}


def test_uncertain_failover_needs_this_callers_grant_and_records_the_charged_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=True)
    called = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        called.append(config.provider)
        if config.provider == "meta":
            raise ProviderFailure("provider_unavailable")
        return tool_reply(READY)

    engine = ConversationEngine(store, call=call)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    first, second = result["attempts"]
    assert called == ["meta", "ollama"]
    # The ambiguous, possibly charged attempt stays recorded and keeps its reservation.
    assert first["outcome"] == "unknown" and first["reservation_status"] == "reserved"
    assert first["reserved_usd"] > 0 and first["follows_uncertain_attempt_id"] is None
    assert second["follows_uncertain_attempt_id"] == first["attempt_id"]
    assert result["server_exception"]["uncertain_failover"] == {
        "plan_opt_in": True,
        "operator_grant": True,
        "allowed": True,
    }
    assert result["reserved_usd"] == pytest.approx(first["reserved_usd"])


def test_uncertainty_grant_defaults_off_and_a_plan_cannot_supply_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    called = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        called.append(config.provider)
        raise ProviderFailure("provider_unavailable")

    result = asyncio.run(ConversationEngine(store, call=call).turn("key:alice", planned_turn()))
    assert called == ["meta"] and result["error_code"] == "provider_unavailable"
    assert result["server_exception"]["uncertain_failover"]["allowed"] is False
    assert result["attempts"][0]["reservation_status"] == "reserved"
    # The grant flag must sit in the operator's grant for this caller, not in a plan.
    store.upsert_context_entry(plan_entry(uncertain=True), caller_scope="key:alice", is_admin=False)
    second = planned_turn(conversation_id="conversation-two")
    assert refused(ConversationEngine(store, call=call), "key:alice", second) == (
        "provider_plan_not_authorized"
    )


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (("openai", "gpt-x"), ("openrouter", "openai/gpt-x")),
        (("openai", "GPT-4o-2024-08-06"), ("openrouter", "openai/gpt-4o:nitro")),
        (("openai", "synthetic-gpt"), ("openrouter", "OpenAI/synthetic_gpt:free")),
        (
            ("anthropic", "claude-sonnet-4-5-20250929"),
            ("openrouter", "anthropic/claude-sonnet-4.5"),
        ),
        (("anthropic", "claude-3-5-sonnet-latest"), ("openrouter", "anthropic/claude-3.5-sonnet")),
        (("meta", "muse-spark-1.3"), ("openrouter", "meta-llama/muse-spark-1.3")),
    ],
)
def test_direct_and_gateway_routes_share_one_upstream_identity(
    first: tuple[str, str], second: tuple[str, str]
) -> None:
    assert upstream_identity(*first) == upstream_identity(*second)


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (("openai", "gpt-x"), ("anthropic", "gpt-x")),
        (("openai", "gpt-x"), ("openrouter", "openai/gpt-y")),
        # Open weights served by an independent host keep that host as their vendor.
        (("ollama", "gpt-oss:120b"), ("openrouter", "openai/gpt-oss-120b")),
    ],
)
def test_distinct_upstream_models_stay_distinct(
    first: tuple[str, str], second: tuple[str, str]
) -> None:
    assert upstream_identity(*first) != upstream_identity(*second)


def test_plans_refuse_a_second_credential_for_the_same_upstream_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    entry = plan_entry()
    assert isinstance(entry.schema_or_body, dict)
    entry.schema_or_body["provider_plan"]["providers"] = [GPT, ROUTED_GPT]
    store.upsert_context_entry(entry, caller_scope="key:alice", is_admin=False)
    # Even when the operator grants both routes, one plan may use only one of them.
    grant(monkeypatch, "key:alice", choices=[GPT, ROUTED_GPT])

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("a plan repeating an upstream model must not dispatch")

    engine = ConversationEngine(store, call=forbidden)
    value = plan_turn("openai")
    assert refused(engine, "key:alice", value) == "provider_plan_not_authorized"


def test_rate_limit_holds_the_upstream_model_against_other_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000000.0]
    monkeypatch.setattr("herma.conversation_state.time.time", lambda: clock[0])
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    grant(monkeypatch, "key:alice", choices=[GPT, ROUTED_GPT, OTHER, *SYNTHETIC_CHOICES])
    calls = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        calls.append((config.provider, config.model))
        if config.provider == "openai":
            raise ProviderFailure(
                "provider_rate_limited", outcome="rejected", retry_after_seconds=60, http_status=429
            )
        return tool_reply(READY, provider="meta")

    engine = ConversationEngine(store, call=call)

    def ask(name: str, provider: str, config: ProviderConfig) -> dict[str, Any]:
        value = turn(conversation_id="conversation-" + name, provider=provider)
        return asyncio.run(engine.turn("key:alice", value, config))

    limited = ask("direct", "openai", openai())
    assert limited["error_code"] == "provider_rate_limited" and len(calls) == 1
    gateway = ask("gateway", "openrouter", openrouter("openai/synthetic-gpt", "openai"))
    attempt = gateway["attempts"][0]
    assert gateway["error_code"] == "provider_identity_cooldown" and len(calls) == 1
    assert attempt["reservation_status"] == "denied" and attempt["reserved_tokens"] == 0
    assert attempt["upstream_identity"] == "openai/synthetic-gpt"
    assert attempt["provider_health"]["scope"] == "upstream_model_identity"
    assert attempt["provider_health"]["available_after"] == clock[0] + 60
    assert not any(
        action["action"] == "provider_request" for action in gateway["server_exception"]["actions"]
    )
    # The same route keeps its own shared health; a different model is unaffected.
    assert ask("same", "openai", openai())["error_code"] == "provider_backpressure"
    other = ask("other", "openrouter", openrouter("synthetic/other", "synthetic-host"))
    assert other["proposal"]["status"] == "ready"
    clock[0] += 61
    later = ask("later", "openrouter", openrouter("openai/synthetic-gpt", "openai"))
    assert later["proposal"]["status"] == "ready"
    assert calls[-2:] == [("openrouter", "synthetic/other"), ("openrouter", "openai/synthetic-gpt")]


def test_identity_cooldown_skip_lets_an_explicit_plan_continue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    monkeypatch.setenv("HERMA_CONVERSATION_OPENAI_MODEL", "synthetic-gpt")
    monkeypatch.setenv("HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION", "1")
    monkeypatch.setenv("HERMA_CONVERSATION_OPENAI_OUTPUT_USD_PER_MILLION", "3")
    monkeypatch.setenv("HERMA_OPENAI_BUDGET_USD", "5")
    entry = plan_entry()
    assert isinstance(entry.schema_or_body, dict)
    entry.schema_or_body["provider_plan"]["providers"] = [GPT, PLAN_CHOICES[1]]
    store.upsert_context_entry(entry, caller_scope="key:alice", is_admin=False)
    grant(monkeypatch, "key:alice", choices=[GPT, PLAN_CHOICES[1]])
    with ConversationEngine(store).state.connect() as conn:
        conn.execute(
            "INSERT INTO work_provider_identity VALUES (?,?,?,?)",
            ("openai/synthetic-gpt", 2**40, "rate_limited", "openrouter"),
        )
    called = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        called.append(config.provider)
        return tool_reply(READY)

    result = asyncio.run(
        ConversationEngine(store, call=call).turn("key:alice", plan_turn("openai"))
    )
    assert called == ["ollama"] and result["proposal"]["status"] == "ready"
    assert result["attempts"][0]["error_code"] == "provider_identity_cooldown"


@pytest.mark.parametrize(
    "model",
    [
        "contributor",
        "muse-spark-1.3-contributor",
        "synthetic/contributor",
        "synthetic:contributor",
        "Muse-CONTRIBUTOR-preview",
    ],
)
def test_contributor_models_are_refused_in_plans_grants_and_configuration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, model: str
) -> None:
    assert is_contributor_model(model)
    store = prepared(tmp_path, monkeypatch)
    entry = plan_entry()
    assert isinstance(entry.schema_or_body, dict)
    entry.schema_or_body["provider_plan"]["providers"][1] = {"provider": "ollama", "model": model}
    store.upsert_context_entry(entry, caller_scope="key:alice", is_admin=False)

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("contributor models must never dispatch")

    engine = ConversationEngine(store, call=forbidden)
    # Otherwise valid and granted inputs, so the refusal is the contributor rule itself.
    assert refused(engine, "key:alice", planned_turn()) == "contributor_tier_refused"
    assert engine.state.snapshot("key:alice", "conversation-one")["version"] == 0
    grant(monkeypatch, "key:alice", choices=[*PLAN_CHOICES, {"provider": "ollama", "model": model}])
    assert refused(engine, "key:alice", turn()) == "contributor_tier_refused"
    grant(monkeypatch, "key:alice")
    monkeypatch.setenv("HERMA_CONVERSATION_OLLAMA_MODEL", model)
    monkeypatch.delenv("HERMA_CONVERSATION_MAX_OUTPUT")
    # The contributor refusal precedes even a missing output allowance, as in the Worker.
    assert refused(engine, "key:alice", turn()) == "contributor_tier_refused"


@pytest.mark.parametrize("model", ["muse-spark-1.3", "synthetic/model", "contrib-utor"])
def test_standard_model_names_are_not_contributor_models(model: str) -> None:
    assert not is_contributor_model(model)
