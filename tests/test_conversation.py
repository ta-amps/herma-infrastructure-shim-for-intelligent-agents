"""Typed proposals, caller isolation, budget fencing and real HTTP provider contracts."""

from __future__ import annotations

import asyncio
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from herma.api.app import create_app
from herma.conversation import ConversationEngine, parse_proposal
from herma.conversation_contracts import ConversationTurn, WorkContract
from herma.conversation_provider import ProviderConfig, ProviderFailure, request_model
from herma.conversation_state import ConversationState
from herma.errors import ContributorTierRefusedError, HermaError
from herma.schemas import ContextEntry
from herma.store import ProvisionStore

CONTRACT = {
    "operation_id": "record_observation",
    "category_id": "noun.eval_run",
    "description": "Record one SYNTHETIC capability observation.",
    "input_schema": {
        "type": "object",
        "properties": {
            "value": {
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                    "synthetic": {"type": "boolean", "const": True},
                },
                "required": ["message", "synthetic"],
                "additionalProperties": False,
            }
        },
        "required": ["value"],
        "additionalProperties": False,
    },
}


@pytest.fixture(autouse=True)
def explicit_test_allowance(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_MAX_OUTPUT", "16384")


def contract() -> WorkContract:
    return WorkContract.model_validate(copy.deepcopy(CONTRACT))


def tool_reply(arguments: Any, provider: str = "ollama", name: str | None = None) -> dict[str, Any]:
    message = {
        "tool_calls": [{"function": {"name": name or contract().tool_name, "arguments": arguments}}]
    }
    return (
        {"message": message}
        if provider == "ollama"
        else {"choices": [{"message": message, "finish_reason": "tool_calls"}]}
    )


def seed(store: ProvisionStore, scope: str) -> None:
    store.upsert_context_entry(
        ContextEntry(
            entry_id="work.observation",
            kind="noun",
            title="Observation",
            summary="SYNTHETIC capability observation",
            schema_or_body={"work_contract": CONTRACT},
        ),
        caller_scope=scope,
        is_admin=False,
    )


def turn(**kwargs: Any) -> ConversationTurn:
    return ConversationTurn.model_validate(
        {
            "conversation_id": "conversation-one",
            "request_id": "request-one",
            "expected_version": 0,
            "message": "Record SYNTHETIC hello with synthetic=true.",
            "context_refs": ["work.observation"],
            **kwargs,
        }
    )


@pytest.mark.parametrize(
    "bad",
    [
        '{"message":"SYNTHETIC hello","synthetic":true}',
        {"message": "SYNTHETIC hello", "synthetic": "true"},
        {"message": 4, "synthetic": True},
        {"synthetic": True},
    ],
)
def test_never_coerces_incorrect_payload_types(bad: Any) -> None:
    proposal, issues = parse_proposal(tool_reply({"value": bad}), "ollama", [contract()])
    assert proposal.status == "clarify" and proposal.arguments is None
    assert issues and not proposal.executed


@pytest.mark.parametrize(
    "reply",
    [
        {},
        {"message": []},
        {"message": {"content": "<atem:function_calls>fake</atem:function_calls>"}},
        tool_reply({}, name="mint_admin_key"),
        tool_reply('{"value":{},"value":{}}'),
        tool_reply({"value": {"message": float("nan"), "synthetic": True}}),
    ],
)
def test_malformed_or_invented_tool_calls_are_blocked(reply: dict[str, Any]) -> None:
    proposal, _ = parse_proposal(reply, "ollama", [contract()])
    assert proposal.status == "blocked" and not proposal.executed


@pytest.mark.parametrize("choice", [None, [], "invalid", 17])
def test_malformed_meta_choice_is_a_blocked_receipt(choice: Any) -> None:
    proposal, issues = parse_proposal({"choices": [choice]}, "meta", [contract()])
    assert proposal.status == "blocked" and issues[0]["rule"] == "invalid_tool_call"


@pytest.mark.parametrize(
    "patch",
    [
        {"category_id": "noun.imaginary"},
        {"input_schema": {"type": "object", "$ref": "https://example.com/remote"}},
        {"input_schema": {"type": "object", "properties": {"value": {}}}},
        {"input_schema": {"type": "object", "properties": "invalid"}},
    ],
)
def test_contracts_require_explicit_local_schemas_and_canonical_categories(
    patch: dict[str, Any],
) -> None:
    with pytest.raises(ValidationError):
        WorkContract.model_validate({**CONTRACT, **patch})


def test_replay_is_idempotent_and_state_is_caller_scoped(tmp_path: Path) -> None:
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")
    calls = 0

    async def call(config: ProviderConfig, body: dict[str, Any]) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        assert config.url == "https://ollama.com/api/chat"
        assert body["tools"][0]["function"]["parameters"]["properties"]["value"]["type"] == "object"
        return tool_reply({"value": {"message": "SYNTHETIC hello", "synthetic": True}})

    engine = ConversationEngine(store, call=call)
    first = asyncio.run(engine.turn("key:alice", turn()))
    assert first["proposal"]["status"] == "ready" and first["executed"] is False
    assert asyncio.run(engine.turn("key:alice", turn())) == first
    # A retry must not reconstruct a newer, possibly oversized context or call the provider.
    with engine.state.connect() as conn:
        conn.execute(
            "UPDATE work_conversations SET history=? WHERE scope=?",
            (json.dumps([{"role": "user", "content": "x" * 40000}]), "key:alice"),
        )
    assert asyncio.run(engine.turn("key:alice", turn())) == first
    assert calls == 1
    assert engine.state.snapshot("key:bob", "conversation-one")["history"] == []
    with pytest.raises(HermaError, match="caller-visible"):
        asyncio.run(engine.turn("key:bob", turn()))
    with pytest.raises(HermaError) as changed:
        asyncio.run(engine.turn("key:alice", turn(message="Different")))
    assert changed.value.code == "request_id_conflict"
    assert calls == 1


def test_twenty_racing_turns_reserve_only_once(tmp_path: Path) -> None:
    state = ConversationState(tmp_path / "state.db")

    def reserve(index: int) -> str:
        try:
            state.reserve(
                scope="key:alice",
                conversation="work",
                request=str(index),
                expected=0,
                fingerprint=str(index),
                contract_hash="contract",
                tokens=10,
            )
            return "winner"
        except HermaError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(reserve, range(20)))
    assert results.count("winner") == 1
    assert results.count("version_conflict") == 19
    with state.connect() as conn:
        assert conn.execute("SELECT turns FROM work_budgets").fetchone()[0] == 1


def test_global_cost_and_per_caller_budgets_reserve_before_model_calls(tmp_path: Path) -> None:
    state = ConversationState(tmp_path / "state.db")
    values = {
        "conversation": "work",
        "request": "one",
        "expected": 0,
        "fingerprint": "x",
        "contract_hash": "contract",
        "tokens": 10,
        "provider": "meta",
        "reserve_microusd": 4,
        "budget_microusd": 6,
    }
    state.reserve(scope="key:alice", **values)
    with pytest.raises(HermaError) as exceeded:
        state.reserve(scope="key:bob", **values)
    assert exceeded.value.code == "provider_budget_exhausted"
    assert state.snapshot("key:bob", "work")["version"] == 0
    with pytest.raises(HermaError) as caller:
        state.reserve(
            scope="key:alice",
            conversation="another",
            request="x",
            expected=0,
            fingerprint="x",
            contract_hash="contract",
            tokens=10,
            token_limit=15,
        )
    assert caller.value.status_code == 429


def test_provider_failure_finishes_turn_without_leaking_provider_body(tmp_path: Path) -> None:
    store = ProvisionStore(tmp_path / "state.db")
    seed(store, "key:alice")

    async def unavailable(_config: ProviderConfig, _body: dict[str, Any]) -> dict[str, Any]:
        raise ProviderFailure("provider_unavailable")

    engine = ConversationEngine(store, call=unavailable)
    result = asyncio.run(engine.turn("key:alice", turn()))
    assert result["error_code"] == "provider_unavailable"
    assert result["usage"] == {"input_tokens": None, "output_tokens": None}
    assert engine.state.snapshot("key:alice", "conversation-one")["active"] is None


def test_provider_redirect_cannot_exfiltrate_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("META_API_KEY", "synthetic-provider-credential")
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert request.headers["authorization"] == "Bearer synthetic-provider-credential"
        return httpx.Response(
            302,
            headers={"location": "https://example.com/collect"},
            text="credential should never appear",
        )

    with pytest.raises(ProviderFailure, match="provider_rejected"):
        asyncio.run(
            request_model(
                ProviderConfig("meta", "muse-spark-1.3", max_output=16384),
                {},
                transport=httpx.MockTransport(handler),
            )
        )
    assert calls == ["https://api.meta.ai/v1/chat/completions"]


def test_standard_mode_and_output_budget_detection() -> None:
    with pytest.raises(ContributorTierRefusedError):
        ProviderConfig("meta", "muse-spark-1.3-contributor").validate()
    proposal, issues = parse_proposal(
        {"choices": [{"finish_reason": "length", "message": {}}]}, "meta", [contract()]
    )
    assert proposal.status == "blocked" and issues[0]["rule"] == "output_budget_exhausted"


def test_api_requires_route_key_and_opt_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HERMA_DB", str(tmp_path / "api.db"))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    monkeypatch.delenv("HERMA_CONVERSATION_ENABLED", raising=False)
    store = ProvisionStore(tmp_path / "api.db")
    key, info = store.issue_key(label="conversation", harness_kind="opencode", scopes=["route"])
    seed(store, "key:" + info.key_id)
    client = TestClient(create_app())
    assert client.post("/v1/conversations/turn", json=turn().model_dump()).status_code == 403
    response = client.post(
        "/v1/conversations/turn", headers={"X-Herma-Key": key}, json=turn().model_dump()
    )
    assert response.status_code == 503 and response.json()["code"] == "conversation_disabled"
    assert key not in json.dumps(response.json())
