"""Shared operator limits admit one funded, explicitly authorized recovery probe."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from conftest import grant
from test_conversation import seed, tool_reply, turn
from test_provider_plan import plan_entry

from herma.conversation import ConversationEngine
from herma.conversation_provider import ProviderConfig, ProviderFailure
from herma.errors import HermaError
from herma.provider_health import admit_health, fresh_health, retry_guidance, settle_health
from herma.proxy import _resolve_upstream_headers
from herma.store import ProvisionStore


def prepare_plan(
    store: ProvisionStore,
    scope: str,
    *,
    probe: bool = False,
    uncertain: bool = False,
    model: str = "muse-spark-1.3",
) -> Any:
    seed(store, scope)
    entry = plan_entry(scope, uncertain=uncertain)
    assert isinstance(entry.schema_or_body, dict)
    entry.schema_or_body["provider_plan"].update(
        providers=[{"provider": "meta", "model": model}], allow_recovery_probe=probe
    )
    store.upsert_context_entry(entry, caller_scope=scope, is_admin=False)
    return turn(
        provider="meta",
        context_refs=["work.observation", "plan.providers"],
        provider_plan_ref="plan.providers",
    )


HEALTH_SCOPES = (
    "key:first",
    "key:second",
    "key:paused",
    "key:later",
    "key:no-probe",
    *(f"key:probe-{index}" for index in range(20)),
    *(f"key:{name}" for name in ("a", "b", "p", "q")),
)


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_MAX_OUTPUT", "16384")
    monkeypatch.setenv("HERMA_META_BUDGET_USD", "5")
    monkeypatch.setenv("META_API_KEY", "example-provider-key")
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", "[]")
    # Each principal holds its own exact grant; uncertainty still needs a plan opt-in too.
    grant(
        monkeypatch,
        *HEALTH_SCOPES,
        choices=[
            {"provider": "meta", "model": model} for model in ("muse-spark-1.3", "muse-wonder-1.0")
        ],
        uncertain=True,
    )


def test_operator_pause_retains_keys_and_does_not_change_byo_proxy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", '["anthropic","openrouter"]')
    monkeypatch.setenv("ANTHROPIC_API_KEY", "example-retained-key")
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("operator pause must prevent model dispatch")

    config = ProviderConfig(
        "anthropic",
        "example-claude",
        max_output=1000,
        anthropic_rates=(1, 3),
        anthropic_budget_usd=1,
    )
    result = asyncio.run(
        ConversationEngine(store, call=forbidden).turn(
            "key:alice", turn(provider="anthropic"), config
        )
    )
    assert result["error_code"] == "provider_operator_disabled"
    assert result["attempts"][0]["outcome"] == "not_sent"
    assert result["attempts"][0]["provider_health"]["requires_operator_enable"] is True
    assert result["reserved_tokens"] == 0
    assert (
        _resolve_upstream_headers(
            "messages",
            {
                "x-upstream-api-key": "example-worker-key",
                "x-upstream-base-url": "https://api.anthropic.com",
            },
        )["x-api-key"]
        == "example-worker-key"
    )
    assert __import__("os").environ["ANTHROPIC_API_KEY"] == "example-retained-key"


@pytest.mark.parametrize(
    ("wire", "variable", "url", "header"),
    [
        (
            "messages",
            "HERMA_UPSTREAM_MESSAGES_URL",
            "https://api.anthropic.com/v1/messages",
            "x-api-key",
        ),
        (
            "chat_completions",
            "HERMA_UPSTREAM_CHAT_URL",
            "https://openrouter.ai/api/v1/chat/completions",
            "Authorization",
        ),
    ],
)
def test_operator_proxy_fallback_is_paused_but_caller_key_precedence_is_unchanged(
    monkeypatch: pytest.MonkeyPatch, wire: Any, variable: str, url: str, header: str
) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", '["anthropic","openrouter"]')
    monkeypatch.setenv(variable, url)
    monkeypatch.setenv("HERMA_UPSTREAM_API_KEY", "example-operator-key")
    with pytest.raises(HermaError) as paused:
        _resolve_upstream_headers(wire, {})
    assert paused.value.code == "provider_operator_disabled"
    expected = "example-worker-key" if header == "x-api-key" else "Bearer example-worker-key"
    assert (
        _resolve_upstream_headers(wire, {"X-Upstream-Api-Key": "example-worker-key"})[header]
        == expected
    )
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", "malformed operator setting")
    assert (
        _resolve_upstream_headers(wire, {"X-Upstream-Api-Key": "example-worker-key"})[header]
        == expected
    )


def test_proxy_pause_uses_exact_known_hosts_and_preserves_operator_origin_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", '["anthropic"]')
    monkeypatch.setenv("HERMA_UPSTREAM_API_KEY", "example-operator-key")
    monkeypatch.setenv(
        "HERMA_UPSTREAM_MESSAGES_URL", "https://api.anthropic.com.example.example/v1/messages"
    )
    assert _resolve_upstream_headers("messages", {})["x-api-key"] == "example-operator-key"
    with pytest.raises(HermaError) as mismatch:
        _resolve_upstream_headers("messages", {"X-Upstream-Base-Url": "https://api.anthropic.com"})
    assert mismatch.value.code == "upstream_credential_origin_mismatch"


def test_credit_limit_is_shared_across_principals_and_models_and_survives_operator_toggle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    store = ProvisionStore(tmp_path / "state.db")
    calls = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        calls.append(config.model)
        raise ProviderFailure(
            "provider_rejected",
            outcome="rejected",
            http_status=400,
            diagnostics={"reason": "credit_or_quota_exhausted"},
        )

    engine = ConversationEngine(store, call=call)
    first = asyncio.run(engine.turn("key:first", prepare_plan(store, "key:first")))
    first_reserved = first["reserved_usd"]
    assert first["attempts"][0]["provider_health"]["reason"] == "credit_or_quota_exhausted"
    monkeypatch.setenv("HERMA_CONVERSATION_META_MODEL", "muse-wonder-1.0")
    second = asyncio.run(
        engine.turn("key:second", prepare_plan(store, "key:second", model="muse-wonder-1.0"))
    )
    assert second["error_code"] == "provider_backpressure"
    assert second["reserved_tokens"] == 0 and calls == ["muse-spark-1.3"]
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", '["meta"]')
    paused = asyncio.run(
        engine.turn(
            "key:paused", prepare_plan(store, "key:paused", probe=True, model="muse-wonder-1.0")
        )
    )
    assert paused["error_code"] == "provider_operator_disabled"
    monkeypatch.setenv("HERMA_CONVERSATION_DISABLED_PROVIDERS", "[]")
    still_limited = asyncio.run(
        engine.turn("key:later", prepare_plan(store, "key:later", model="muse-wonder-1.0"))
    )
    assert still_limited["error_code"] == "provider_backpressure"
    with engine.state.connect() as conn:
        assert conn.execute(
            "SELECT reserved_microusd FROM work_provider_budget WHERE provider='meta'"
        ).fetchone()[0] == int(first_reserved * 1000000)
    assert (
        engine.state.snapshot("key:second", "conversation-one")["attempts"][0][
            "upstream_http_status"
        ]
        is None
    )


def test_concurrent_principals_get_only_one_explicit_recovery_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    clock = [1000000.0]
    monkeypatch.setattr("herma.conversation_state.time.time", lambda: clock[0])
    store = ProvisionStore(tmp_path / "state.db")
    calls = []

    async def scenario() -> None:
        entered, release = asyncio.Event(), asyncio.Event()

        async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
            calls.append(config.provider)
            if len(calls) == 1:
                raise ProviderFailure(
                    "provider_rate_limited", outcome="rejected", retry_after_seconds=5
                )
            entered.set()
            await release.wait()
            return tool_reply({"value": {"message": "EXAMPLE", "example": True}}, provider="meta")

        engine = ConversationEngine(store, call=call)
        await engine.turn("key:first", prepare_plan(store, "key:first"))
        clock[0] += 6
        denied = await engine.turn("key:no-probe", prepare_plan(store, "key:no-probe"))
        assert denied["error_code"] == "provider_recovery_probe_required" and len(calls) == 1
        inputs = [prepare_plan(store, f"key:probe-{i}", probe=True) for i in range(20)]
        tasks = [
            asyncio.create_task(engine.turn(f"key:probe-{i}", value))
            for i, value in enumerate(inputs)
        ]
        await entered.wait()
        await asyncio.sleep(0)
        assert len(calls) == 2
        release.set()
        results = await asyncio.gather(*tasks)
        assert sum(r["proposal"]["status"] == "ready" for r in results) == 1
        assert sum(r["error_code"] == "provider_recovery_probe_inflight" for r in results) == 19
        assert all(r["reserved_tokens"] == 0 for r in results if r["error_code"])
        assert len(calls) == 2

    asyncio.run(scenario())


def test_probe_expiry_is_persisted_on_denial_and_requires_uncertain_grant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    clock = [1000000.0]
    monkeypatch.setattr("herma.conversation_state.time.time", lambda: clock[0])
    store = ProvisionStore(tmp_path / "state.db")

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("expired probe must not silently redispatch")

    engine = ConversationEngine(store, call=forbidden)
    state = {
        **fresh_health(),
        "generation": 1,
        "failures": 1,
        "reason": "rate_limited",
        "probe_id": "lost-probe",
        "probe_until": clock[0] - 1,
    }
    with engine.state.connect() as conn:
        engine.state._write_health(conn, "operator", "meta", {"muse-spark-1.3": state})
    first = asyncio.run(engine.turn("key:first", prepare_plan(store, "key:first", probe=True)))
    assert first["error_code"] == "provider_backpressure"
    with engine.state.connect() as conn:
        saved = engine.state._health_states(conn, "operator", "meta", "muse-spark-1.3")[
            "muse-spark-1.3"
        ]
    assert saved["uncertain"] and saved["probe_id"] is None
    clock[0] = saved["available_after"] + 1
    second = asyncio.run(engine.turn("key:second", prepare_plan(store, "key:second", probe=True)))
    assert second["error_code"] == "provider_outcome_reconciliation_required"


def test_stale_success_cannot_clear_new_limits_and_repeated_unknown_probe_stays_limited() -> None:
    states = {"*": fresh_health(), "model": fresh_health()}
    first = admit_health(states, "a", 1000, allow_probe=False, allow_uncertain=False)
    second = admit_health(states, "b", 1000, allow_probe=False, allow_uncertain=False)
    settle_health(
        states,
        first["ticket"],
        "a",
        "model",
        1000,
        outcome="rejected",
        error_code="provider_rate_limited",
        reason=None,
        retry_seconds=None,
    )
    settle_health(
        states,
        second["ticket"],
        "b",
        "model",
        1001,
        outcome="completed",
        error_code=None,
        reason=None,
        retry_seconds=None,
    )
    assert states["model"]["failures"] == 1
    probe = admit_health(states, "c", 1031, allow_probe=True, allow_uncertain=False)
    settle_health(
        states,
        probe["ticket"],
        "c",
        "model",
        1032,
        outcome="unknown",
        error_code="provider_unavailable",
        reason=None,
        retry_seconds=None,
    )
    assert states["model"]["available_after"] == 1092
    assert states["model"]["uncertain"]
    assert (
        admit_health(states, "d", 1093, allow_probe=True, allow_uncertain=False)["code"]
        == "provider_outcome_reconciliation_required"
    )
    assert admit_health(states, "e", 1093, allow_probe=True, allow_uncertain=True)["ok"]


def test_late_failure_keeps_active_probe_and_probe_completion_keeps_newer_limit() -> None:
    states = {"*": fresh_health(), "model": fresh_health()}
    a = admit_health(states, "a", 1000, allow_probe=True, allow_uncertain=False)
    b = admit_health(states, "b", 1000, allow_probe=True, allow_uncertain=False)
    settle_health(
        states,
        a["ticket"],
        "a",
        "model",
        1000,
        outcome="rejected",
        error_code="provider_rate_limited",
        reason=None,
        retry_seconds=1,
    )
    probe = admit_health(states, "p", 1001, allow_probe=True, allow_uncertain=False)
    settle_health(
        states,
        b["ticket"],
        "b",
        "model",
        1002,
        outcome="rejected",
        error_code="provider_rate_limited",
        reason=None,
        retry_seconds=1,
    )
    assert states["model"]["probe_id"] == "p"
    assert (
        admit_health(states, "q", 1003, allow_probe=True, allow_uncertain=False)["code"]
        == "provider_recovery_probe_inflight"
    )
    settle_health(
        states,
        probe["ticket"],
        "p",
        "model",
        1004,
        outcome="completed",
        error_code=None,
        reason=None,
        retry_seconds=None,
    )
    assert states["model"]["probe_id"] is None
    assert states["model"]["failures"] == 1 and states["model"]["available_after"] == 1003


def test_late_failure_cannot_admit_a_second_probe_through_durable_turns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    clock = [1000.0]
    monkeypatch.setattr("herma.conversation_state.time.time", lambda: clock[0])
    store = ProvisionStore(tmp_path / "state.db")
    for name in ("a", "b", "p", "q"):
        seed(store, "key:" + name)

    async def scenario() -> None:
        entered = {name: asyncio.Event() for name in ("a", "b", "p")}
        release = {name: asyncio.Event() for name in entered}

        async def call(_config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
            name = body["messages"][-1]["content"]
            assert name in entered, "a second concurrent probe reached transport"
            entered[name].set()
            await release[name].wait()
            if name in {"a", "b"}:
                raise ProviderFailure(
                    "provider_rate_limited", outcome="rejected", retry_after_seconds=1
                )
            return tool_reply({"value": {"message": "EXAMPLE", "example": True}}, provider="meta")

        engine = ConversationEngine(store, call=call)

        async def invoke(name: str) -> dict[str, Any]:
            return await engine.turn("key:" + name, turn(provider="meta", message=name))

        a, b = asyncio.create_task(invoke("a")), asyncio.create_task(invoke("b"))
        await entered["a"].wait()
        await entered["b"].wait()
        release["a"].set()
        await a
        clock[0] = 1001
        probe = asyncio.create_task(invoke("p"))
        await entered["p"].wait()
        clock[0] = 1002
        release["b"].set()
        await b
        clock[0] = 1003
        assert (await invoke("q"))["error_code"] == "provider_recovery_probe_inflight"
        clock[0] = 1004
        release["p"].set()
        result = await probe
        assert result["proposal"]["status"] == "ready"
        assert result["attempts"][0]["provider_health"]["state"] == "limited"
        with engine.state.connect() as conn:
            saved = engine.state._health_states(conn, "operator", "meta", "muse-spark-1.3")[
                "muse-spark-1.3"
            ]
        assert saved["probe_id"] is None and saved["failures"] == 1

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("headers", "seconds", "source"),
    [
        ({"retry-after": "7"}, 7, "retry_after"),
        ({"retry-after": "Thu, 01 Jan 1970 00:16:50 GMT"}, 10, "retry_after"),
        (
            {"x-ratelimit-reset-requests": "1s", "x-ratelimit-reset-tokens": "2m250ms"},
            120.25,
            "provider_reset",
        ),
        ({"anthropic-ratelimit-requests-reset": "1970-01-01T00:17:00Z"}, 20, "provider_reset"),
        ({"retry-after": "NaN", "x-ratelimit-reset-tokens": "arbitrary private text"}, None, None),
    ],
)
def test_retry_and_reset_guidance_are_normalized_without_raw_headers(
    headers: dict[str, str], seconds: float | None, source: str | None
) -> None:
    assert retry_guidance(headers, 1000) == (seconds, source)
