"""Real SQLite failures stop paid rotation, seal the turn and keep evidence for reconciliation."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from test_conversation import tool_reply
from test_provider_plan import planned_turn, prepared

from herma.conversation import ConversationEngine
from herma.conversation_provider import ProviderConfig
from herma.conversation_state import ConversationState
from herma.errors import HermaError

READY = {"value": {"message": "SYNTHETIC", "synthetic": True}}


def locked(state: ConversationState, method: str) -> Callable[..., Any]:
    """Run one state method while another connection holds the SQLite write lock."""
    original = getattr(state, method)
    state.busy_timeout = 0.05

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        blocker = sqlite3.connect(state.path, timeout=1)
        blocker.execute("BEGIN EXCLUSIVE")
        try:
            return original(*args, **kwargs)
        finally:
            blocker.rollback()
            blocker.close()

    return wrapper


def test_real_sqlite_lock_during_reservation_seals_the_turn_without_dispatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch, uncertain=True)
    calls = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        calls.append(config.provider)
        return tool_reply(READY, config.provider)

    engine = ConversationEngine(store, call=call)
    real = engine.state.reserve_attempt
    monkeypatch.setattr(engine.state, "reserve_attempt", locked(engine.state, "reserve_attempt"))
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    attempt = result["attempts"][0]
    # Even with an uncertainty grant, failed coordination never rotates into a paid call.
    assert calls == [] and len(result["attempts"]) == 1
    assert result["error_code"] == "storage_or_coordination_unavailable"
    assert attempt["outcome"] == "not_sent" and attempt["status"] == "skipped"
    assert attempt["reservation_status"] == "unknown"
    assert not any(
        action["action"] == "provider_request" for action in result["server_exception"]["actions"]
    )
    # The turn is sealed, replays exactly, and the conversation is not left active.
    assert engine.state.snapshot("key:alice", "conversation-one")["active"] is None
    assert asyncio.run(engine.turn("key:alice", planned_turn())) == result
    monkeypatch.setattr(engine.state, "reserve_attempt", real)
    after = asyncio.run(
        engine.turn("key:alice", planned_turn(expected_version=1, request_id="request-two"))
    )
    assert after["proposal"]["status"] == "ready" and calls == ["meta"]


def test_real_sqlite_lock_before_dispatch_drops_the_unsent_request_action(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)

    async def forbidden(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        pytest.fail("an unpersisted in-flight attempt must not dispatch")

    engine = ConversationEngine(store, call=forbidden)
    update = engine.state.update_attempts
    seen = []

    def second_write_fails(*args: Any, **kwargs: Any) -> None:
        seen.append(args[-1]["attempts"][-1]["status"])
        if seen[-1] == "in_flight":
            locked(engine.state, "update_attempts")(*args, **kwargs)
        else:
            update(*args, **kwargs)

    monkeypatch.setattr(engine.state, "update_attempts", second_write_fails)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    attempt = result["attempts"][0]
    assert result["error_code"] == "storage_or_coordination_unavailable"
    # The reservation committed before the failed write, so it stays held, not refunded.
    assert attempt["reservation_status"] == "reserved" and attempt["outcome"] == "not_sent"
    assert result["reserved_tokens"] > 0 and len(result["attempts"]) == 1
    assert not any(
        action["action"] == "provider_request" for action in result["server_exception"]["actions"]
    )


def test_health_settlement_failure_keeps_the_completed_result_and_stops(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        return tool_reply(READY, config.provider)

    engine = ConversationEngine(store, call=call)
    settle = locked(engine.state, "settle_provider_health")
    monkeypatch.setattr(engine.state, "settle_provider_health", settle)
    result = asyncio.run(engine.turn("key:alice", planned_turn()))
    attempt = result["attempts"][0]
    assert result["proposal"]["status"] == "ready" and attempt["outcome"] == "completed"
    assert attempt["health_settlement"] == "storage_or_coordination_unavailable"
    assert engine.state.snapshot("key:alice", "conversation-one")["active"] is None


def test_storage_failure_at_commit_reports_503_and_keeps_attempts_for_reconciliation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared(tmp_path, monkeypatch)
    calls = []

    async def call(config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        calls.append(config.provider)
        return tool_reply(READY, config.provider)

    engine = ConversationEngine(store, call=call)
    monkeypatch.setattr(engine.state, "finish", locked(engine.state, "finish"))
    with pytest.raises(HermaError) as unavailable:
        asyncio.run(engine.turn("key:alice", planned_turn()))
    assert unavailable.value.status_code == 503
    assert unavailable.value.code == "storage_or_coordination_unavailable"
    snapshot = engine.state.snapshot("key:alice", "conversation-one")
    assert snapshot["active"] == "request-one" and snapshot["attempts"][0]["outcome"] == "completed"
    with pytest.raises(HermaError) as pending:
        asyncio.run(engine.turn("key:alice", planned_turn()))
    assert pending.value.code == "request_in_progress" and calls == ["meta"]
