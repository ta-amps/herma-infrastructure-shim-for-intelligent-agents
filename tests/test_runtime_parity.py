"""Python and the Worker make identical spending, identity and parsing decisions."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from test_conversation import contract, seed, tool_reply, turn
from test_decision_provider import prepared as jev_request

from herma.api.app import create_app
from herma.conversation_contracts import tools_for
from herma.conversation_provider import (
    ProviderConfig,
    ProviderFailure,
    request_model,
    scaled_integer,
    wire_json,
)
from herma.conversation_schema import strict_json
from herma.conversation_state import ConversationState
from herma.decision_provider import parse_jev_response
from herma.errors import HermaError
from herma.harness_gate import is_contributor_model
from herma.provider_health import operator_policy
from herma.provider_plan import operator_grants, upstream_identity
from herma.schemas import KeywordTrigger, Provision, StoredProvision, TriggerSpec
from herma.store import (
    TRUSTED_PRODUCER_SURFACES,
    ProvisionStore,
    passes_governance_lens,
    provision_passes_lens,
)

ROOT = Path(__file__).resolve().parents[1]
NODE = """
import { createHash } from 'node:crypto';
import * as c from './deploy/cloudflare/conversation.js';
import { isContributorModel, passesGovernanceLens, provisionPassesLens, TRUSTED_PRODUCER_SURFACES } from './deploy/cloudflare/herma_engine.js';
import { operatorPolicy } from './deploy/cloudflare/provider_health.js';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const outcome = run => { try { return run(); } catch (error) { return { error: error.code ?? error.message }; } };
const input = JSON.parse(raw), result = {};
result.identity = input.identity.map(([provider, model]) => c.upstreamIdentity(provider, model));
result.contributor = input.contributor.map(isContributorModel);
result.scaled = input.scaled.map(([value, scale, ceil]) => c.scaledInteger(value, scale, ceil));
result.configs = input.configs.map(([provider, env]) => outcome(() => {
  const x = c.providerConfig(env, provider);
  return { model: x.model, max_output: x.max_output, reasoning_effort: x.reasoning_effort, caller_token_limit: x.caller_token_limit, budget_microusd: x.budget_microusd, anthropic_version: x.anthropic_version, openrouter_provider: x.openrouter_provider, generation: x.generation };
}));
result.grants = input.grants.map(env => outcome(() => [...c.operatorGrants(env).values()].map(g => [g.caller_scope, g.providers.length, g.allow_uncertain_failover])));
result.policies = input.policies.map(([provider, env]) => outcome(() => operatorPolicy(env, provider)));
result.sizes = input.sizes.map(body => [c.bytes(body), createHash('sha256').update(JSON.stringify(body)).digest('hex')]);
result.strict = input.strict.map(text => outcome(() => c.strictJson(text)));
result.lens = input.lens.map(item => passesGovernanceLens(item));
result.trusted = [...TRUSTED_PRODUCER_SURFACES].sort();
result.stored_lens = input.stored_lens.map(([store, tags, cohort]) =>
  provisionPassesLens({ source_store: store, provision: { metadata_tags: tags } }, { harnessKind: "opencode", cohort }));
console.log(JSON.stringify(result));
"""

IDENTITY = [
    ("openai", "gpt-x"),
    ("openrouter", "openai/gpt-x"),
    ("openai", "GPT-4o-2024-08-06"),
    ("openrouter", "openai/gpt-4o:nitro"),
    ("anthropic", "claude-sonnet-4-5-20250929"),
    ("openrouter", "anthropic/claude-sonnet-4.5"),
    ("openrouter", "meta-llama/llama-4-maverick:free"),
    ("meta", "muse-spark-1.3"),
    ("ollama", "gpt-oss:120b"),
    ("openrouter", "noslash"),
    ("openai", "  Spaced_Name.v2-latest "),
]
CONTRIBUTOR = [
    "contributor",
    "muse-spark-1.3-contributor",
    "synthetic/contributor",
    "synthetic:contributor",
    "MUSE-Contributor",
    "contrib-utor",
    "muse-spark-1.3",
]
SCALED = [
    (2.01, 6, False),
    (0.1, 6, False),
    (1e-7, 6, False),
    (1e-7, 6, True),
    (123.456789, 6, False),
    (1.25, 6, True),
    (0.0000015, 12, True),
    (5, 6, False),
    (0, 6, False),
    (1e20, 6, False),
]
BASE = {"HERMA_CONVERSATION_MAX_OUTPUT": "16384"}
OPENAI = {
    **BASE,
    "HERMA_CONVERSATION_OPENAI_MODEL": "synthetic-gpt",
    "HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION": "0.1",
    "HERMA_CONVERSATION_OPENAI_OUTPUT_USD_PER_MILLION": "0.3",
    "HERMA_OPENAI_BUDGET_USD": "2.01",
}
ANTHROPIC = {
    **BASE,
    "HERMA_CONVERSATION_ANTHROPIC_MODEL": "synthetic-claude",
    "HERMA_CONVERSATION_ANTHROPIC_INPUT_USD_PER_MILLION": "1",
    "HERMA_CONVERSATION_ANTHROPIC_OUTPUT_USD_PER_MILLION": "3",
    "HERMA_ANTHROPIC_BUDGET_USD": "1",
}
ROUTER = {
    **BASE,
    "HERMA_CONVERSATION_OPENROUTER_MODEL": "synthetic/model",
    "HERMA_CONVERSATION_OPENROUTER_PROVIDER": "synthetic-host",
    "HERMA_CONVERSATION_OPENROUTER_INPUT_USD_PER_MILLION": "1",
    "HERMA_CONVERSATION_OPENROUTER_OUTPUT_USD_PER_MILLION": "3",
    "HERMA_OPENROUTER_BUDGET_USD": "1",
}
META = {**BASE, "HERMA_META_BUDGET_USD": "2.01"}
CONFIGS: list[tuple[str, dict[str, str]]] = [
    ("ollama", {}),
    ("ollama", BASE),
    ("ollama", {**BASE, "HERMA_CONVERSATION_OLLAMA_MODEL": " "}),
    ("ollama", {"HERMA_CONVERSATION_OLLAMA_MAX_OUTPUT": "", "HERMA_CONVERSATION_MAX_OUTPUT": "7"}),
    ("ollama", {"HERMA_CONVERSATION_OLLAMA_MAX_OUTPUT": "x", "HERMA_CONVERSATION_MAX_OUTPUT": "7"}),
    ("ollama", {"HERMA_CONVERSATION_MAX_OUTPUT": "1e3"}),
    ("ollama", {"HERMA_CONVERSATION_MAX_OUTPUT": "0"}),
    ("ollama", {"HERMA_CONVERSATION_MAX_OUTPUT": "9007199254740992"}),
    ("ollama", {**BASE, "HERMA_CONVERSATION_OLLAMA_GENERATION": ""}),
    ("ollama", {**BASE, "HERMA_CONVERSATION_OLLAMA_GENERATION": '{"a":1,"a":2}'}),
    ("ollama", {**BASE, "HERMA_CONVERSATION_OLLAMA_GENERATION": "[]"}),
    (
        "ollama",
        {**BASE, "HERMA_CONVERSATION_OLLAMA_GENERATION": '{"n":2,"options":{"num_predict":1}}'},
    ),
    ("ollama", {**BASE, "HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR": " "}),
    ("ollama", {**BASE, "HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR": "99999999999999999999"}),
    ("ollama", {**BASE, "HERMA_CONVERSATION_REASONING": "high"}),
    ("meta", BASE),
    ("meta", META),
    ("meta", {**BASE, "HERMA_META_BUDGET_USD": ""}),
    ("meta", {**BASE, "HERMA_META_BUDGET_USD": "-1"}),
    ("meta", {**META, "HERMA_OPENAI_BUDGET_USD": "not a number"}),
    ("meta", {**META, "HERMA_CONVERSATION_REASONING": "high"}),
    ("meta", {**META, "HERMA_CONVERSATION_META_GENERATION": '{"n":1.0}'}),
    ("meta", {"HERMA_CONVERSATION_META_MODEL": "muse-spark-1.3-contributor"}),
    ("meta", {**META, "HERMA_CONVERSATION_META_MODEL": "unpriced-model"}),
    ("openai", OPENAI),
    ("openai", {**OPENAI, "HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION": ""}),
    ("openai", {**OPENAI, "HERMA_CONVERSATION_OPENAI_GENERATION": '{"n":1}'}),
    ("openai", {**OPENAI, "HERMA_CONVERSATION_OPENAI_GENERATION": '{"reasoning":"x"}'}),
    ("anthropic", ANTHROPIC),
    ("anthropic", {**ANTHROPIC, "HERMA_CONVERSATION_ANTHROPIC_VERSION": " "}),
    ("anthropic", {**ANTHROPIC, "HERMA_CONVERSATION_ANTHROPIC_VERSION": "2020-01-01"}),
    ("anthropic", {**ANTHROPIC, "HERMA_CONVERSATION_ANTHROPIC_REASONING": "high"}),
    (
        "anthropic",
        {
            **ANTHROPIC,
            "HERMA_CONVERSATION_ANTHROPIC_REASONING": "high",
            "HERMA_CONVERSATION_ANTHROPIC_GENERATION": '{"service_tier":"priority"}',
        },
    ),
    ("openrouter", ROUTER),
    ("openrouter", {**ROUTER, "HERMA_CONVERSATION_OPENROUTER_PROVIDER": ""}),
    ("openrouter", {**ROUTER, "HERMA_CONVERSATION_OPENROUTER_MODEL": "synthetic/model:online"}),
]
CHOICES = [{"provider": "ollama", "model": "muse-spark-open"}]
GRANTS: list[dict[str, str]] = [
    {},
    {"HERMA_CONVERSATION_PROVIDER_GRANTS": " "},
    {
        "HERMA_CONVERSATION_PROVIDER_GRANTS": json.dumps(
            [
                {"caller_scope": "key:a", "providers": CHOICES},
                {"caller_scope": "key:b", "providers": CHOICES, "allow_uncertain_failover": True},
            ]
        )
    },
    {
        "HERMA_CONVERSATION_PROVIDER_GRANTS": json.dumps(
            [{"caller_scope": "*", "providers": CHOICES}]
        )
    },
    {"HERMA_CONVERSATION_PROVIDER_GRANTS": '[{"caller_scope":"key:a","caller_scope":"key:b"}]'},
    {
        "HERMA_CONVERSATION_PROVIDER_GRANTS": json.dumps(
            [{"caller_scope": "*", "providers": [{"provider": "meta", "model": "x-contributor"}]}]
        )
    },
    {
        "HERMA_CONVERSATION_PROVIDER_GRANTS": json.dumps(
            [{"caller_scope": "key:a", "providers": [{"provider": "openrouter", "model": "a/b"}]}]
        )
    },
    {"HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST": json.dumps(CHOICES)},
    {"HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER": "false"},
    {"HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER": "  "},
]
POLICIES: list[tuple[str, dict[str, str]]] = [
    ("meta", {}),
    ("meta", {"HERMA_CONVERSATION_DISABLED_PROVIDERS": "  "}),
    ("meta", {"HERMA_CONVERSATION_DISABLED_PROVIDERS": '["meta"]'}),
    ("meta", {"HERMA_CONVERSATION_META_ACCOUNT_SCOPE": " "}),
    ("meta", {"HERMA_CONVERSATION_META_ACCOUNT_SCOPE": "second-account"}),
]
SIZES: list[Any] = [
    {"model": "m", "messages": [{"role": "user", "content": "plain ASCII"}]},
    {"messages": [{"role": "user", "content": "multi-byte 日本語 émoji 🙂"}]},
    {"messages": [{"role": "user", "content": 'controls \x00\x1f\n\t"\\ and \u2028'}]},
    {"messages": [{"role": "user", "content": "lone \ud800 surrogate"}], "temperature": 0.4},
]
STRICT = ['{"a":1}', '{"a":1,"a":2}', '{"a":{"b":1,"b":2}}', '{"a":NaN}', "[1,2]", "{"]
CURRENT_SURFACES = ["surface:tessera", "surface:eranos", "surface:herma", "surface:agora"]
PRODUCERS: list[Any] = [
    *CURRENT_SURFACES,
    "surface:frontier",
    "surface:Herma",
    "herma",
    "surface:",
    "",
    None,
    ["surface:herma"],
]
LENS = [
    {
        "namespace": "herma.provisions",
        "producer_surface": producer,
        "visibility_scope": "public_commons",
        "allowed_surfaces": [],
        "target_cohorts": ["all"],
        "tags": ["status:verified"],
    }
    for producer in PRODUCERS
]
# Flat tags as the pre-2026-10-27 sync stored them, the shape of Herma's six live starters.
LEGACY_TAGS = {
    "allowed_surfaces": "surface:herma,surface:tessera",
    "domain": "swarm-fabric",
    "producer_surface": "surface:herma",
    "status": "status:verified",
}
SYNCED = "tessera_cloud:herma.provisions"


def fabric(**changes: Any) -> str:
    governance: dict[str, Any] = {
        "namespace": "main",
        "producer_surface": "surface:herma",
        "visibility_scope": "public_commons",
        "allowed_surfaces": ["surface:herma", "surface:tessera"],
        "target_cohorts": ["all"],
        "tags": ["status:verified"],
    }
    return json.dumps({**governance, **changes})


STORED_LENS: list[tuple[str, dict[str, str], str, bool]] = [
    ("system_builtin", {}, "", True),
    ("harness:opencode", {}, "", True),
    (SYNCED, LEGACY_TAGS, "", False),
    (SYNCED, {**LEGACY_TAGS, "fabric_governance": fabric()}, "", True),
    (SYNCED, {"fabric_governance": fabric(producer_surface="surface:frontier")}, "", False),
    (SYNCED, {"fabric_governance": fabric(target_cohorts=["cohort:ngo-helpline"])}, "", False),
    (
        SYNCED,
        {"fabric_governance": fabric(target_cohorts=["cohort:ngo-helpline"])},
        "ngo-helpline",
        True,
    ),
    (SYNCED, {"fabric_governance": fabric(tags=["status:quarantined"])}, "", False),
    (SYNCED, {"fabric_governance": "{not json"}, "", False),
]


def python_outcome(run: Any) -> Any:
    try:
        return run()
    except HermaError as exc:
        return {"error": exc.code}


def python_config(provider: str, env: dict[str, str]) -> Any:
    def run() -> dict[str, Any]:
        config = ProviderConfig.from_env(provider)
        return {
            "model": config.model,
            "max_output": config.max_output,
            "reasoning_effort": config.reasoning_effort,
            "caller_token_limit": config.caller_token_limit,
            "budget_microusd": config.budget_microusd,
            "anthropic_version": config.anthropic_version,
            "openrouter_provider": config.openrouter_provider,
            "generation": config.generation,
        }

    return python_outcome(run)


@pytest.fixture
def worker() -> dict[str, Any]:
    payload = {
        "identity": IDENTITY,
        "contributor": CONTRIBUTOR,
        "scaled": SCALED,
        "configs": CONFIGS,
        "grants": GRANTS,
        "policies": POLICIES,
        "sizes": SIZES,
        "strict": STRICT,
        "lens": LENS,
        "stored_lens": [[store, tags, cohort] for store, tags, cohort, _ in STORED_LENS],
    }
    result = subprocess.run(
        ["node", "--no-warnings", "--input-type=module", "-e", NODE],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
        cwd=ROOT,
    )
    return dict(json.loads(result.stdout))


@pytest.fixture
def clean_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in list(os.environ):
        if name.startswith("HERMA_"):
            monkeypatch.delenv(name)


def test_governance_lens_trusts_the_same_producer_surfaces(worker: dict[str, Any]) -> None:
    """Only the current surfaces may produce imported records; a retired surface grants nothing."""
    assert worker["trusted"] == sorted(TRUSTED_PRODUCER_SURFACES) == sorted(CURRENT_SURFACES)
    assert worker["lens"] == [passes_governance_lens(item) for item in LENS]
    assert [p for p, ok in zip(PRODUCERS, worker["lens"], strict=True) if ok] == CURRENT_SURFACES


def stored_case(source_store: str, tags: dict[str, str]) -> StoredProvision:
    provision = Provision(
        prov_id="PROV-LENS-CASE",
        title="Lens case",
        summary="One stored row for the Layer-1 lens.",
        inject_text="Synthetic text for a lens check.",
        metadata_tags=tags,
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["lens"])),
    )
    return StoredProvision(
        provision=provision,
        version=1,
        content_sha256="0" * 64,
        source_store=source_store,
        updated_at=0.0,
    )


def test_stored_provisions_pass_the_lens_the_same_way(worker: dict[str, Any]) -> None:
    """Synced rows fire only with fabric_governance; the flat tags of the pre-lens sync never do."""
    python = [
        provision_passes_lens(stored_case(store, tags), harness_kind="opencode", cohort=cohort)
        for store, tags, cohort, _ in STORED_LENS
    ]
    assert worker["stored_lens"] == python == [expected for *_, expected in STORED_LENS]


def test_identity_contributor_and_exact_amounts_match_the_worker(worker: dict[str, Any]) -> None:
    assert worker["identity"] == [upstream_identity(*item) for item in IDENTITY]
    assert worker["identity"][0] == worker["identity"][1] == "openai/gpt-x"
    assert worker["contributor"] == [is_contributor_model(model) for model in CONTRIBUTOR]
    expected = []
    for value, scale, ceil in SCALED:
        try:
            expected.append(scaled_integer(value, scale, ceil=ceil))
        except ValueError:
            expected.append(None)  # JSON has no NaN; the Worker reports an inexact amount as NaN
    assert worker["scaled"] == expected
    assert worker["scaled"][0] == 2010000


def test_configuration_outcomes_match_for_empty_and_strict_settings(
    worker: dict[str, Any], monkeypatch: pytest.MonkeyPatch, clean_settings: None
) -> None:
    python = []
    for provider, env in CONFIGS:
        with monkeypatch.context() as scoped:
            for name, value in env.items():
                scoped.setenv(name, value)
            python.append(python_config(provider, env))
    for case, mine, theirs in zip(CONFIGS, python, worker["configs"], strict=True):
        assert mine == theirs, case
    by_case = dict(zip(range(len(CONFIGS)), python, strict=True))
    assert by_case[1]["model"] == "muse-spark-open" and by_case[3]["max_output"] == 7
    assert by_case[15] == {"error": "invalid_provider_configuration"}  # no implicit Meta budget
    assert by_case[16]["budget_microusd"] == 2010000
    assert by_case[22] == {"error": "contributor_tier_refused"}


def test_grant_and_policy_parsing_match(
    worker: dict[str, Any], monkeypatch: pytest.MonkeyPatch, clean_settings: None
) -> None:
    for env, theirs in zip(GRANTS, worker["grants"], strict=True):
        with monkeypatch.context() as scoped:
            for name, value in env.items():
                scoped.setenv(name, value)
            mine = python_outcome(
                lambda: [
                    [grant.caller_scope, len(grant.providers), grant.allow_uncertain_failover]
                    for grant in operator_grants().values()
                ]
            )
        assert mine == theirs, env
    for (provider, env), theirs in zip(POLICIES, worker["policies"], strict=True):
        with monkeypatch.context() as scoped:
            for name, value in env.items():
                scoped.setenv(name, value)
            disabled, account = operator_policy(provider)
        assert {"disabled": disabled, "account": account} == theirs, env


def test_request_bytes_and_strict_json_match(worker: dict[str, Any]) -> None:
    for body, (size, digest) in zip(SIZES, worker["sizes"], strict=True):
        sent = wire_json(body)
        assert len(sent) == size and hashlib.sha256(sent).hexdigest() == digest
    for text, theirs in zip(STRICT, worker["strict"], strict=True):
        try:
            mine: Any = strict_json(text)
        except ValueError:
            mine = None
        if isinstance(theirs, dict) and "error" in theirs:
            assert mine is None, text
        else:
            assert mine == theirs, text


READY = {"value": {"message": "SYNTHETIC", "synthetic": True}}


def test_exact_decimal_budget_admits_a_reservation_at_the_limit(tmp_path: Path) -> None:
    assert int(2.01 * 1000000) == 2009999  # the float conversion the ledger no longer uses
    config = ProviderConfig(
        "openai", "synthetic-gpt", max_output=1, openai_budget_usd=2.01, openai_rates=(1, 3)
    )
    assert config.budget_microusd == scaled_integer(2.01, 6) == 2010000
    state = ConversationState(tmp_path / "state.db")
    record: dict[str, Any] = {"attempts": []}

    def reserve(request: str, cost: int) -> dict[str, Any]:
        state.reserve(
            scope="key:alice",
            conversation=request,
            request=request,
            expected=0,
            fingerprint=request,
            contract_hash="contract",
            tokens=0,
            provider="coordination",
        )
        attempt = {"attempt_id": request, "model": "synthetic-gpt", "upstream_identity": "x"}
        record["attempts"] = [attempt]
        return state.reserve_attempt(
            scope="key:alice",
            conversation=request,
            request=request,
            version=1,
            record=record,
            tokens=1,
            provider="openai",
            cost=cost,
            budget=config.budget_microusd,
            token_limit=None,
        )

    assert reserve("exact-limit-1", 2010000)["ok"]
    with pytest.raises(HermaError) as exhausted:
        reserve("exact-limit-2", 1)
    assert exhausted.value.code == "provider_budget_exhausted"


def test_reservation_ceiling_is_exact_integer_picodollar_arithmetic() -> None:
    config = ProviderConfig(
        "openai", "synthetic-gpt", max_output=3, openai_budget_usd=1, openai_rates=(0.1, 0.3)
    )
    body = config.build_request([{"role": "user", "content": "日本語"}], [])
    tokens, microusd = config.reservation(body)
    size = len(wire_json(body))
    assert tokens == size + 4096 + 3
    # 0.1 and 0.3 dollars per million tokens are 100,000 and 300,000 picodollars per token.
    assert microusd == -(-((size + 4096) * 100000 + 3 * 300000) // 1000000)


def test_wire_bytes_are_the_bytes_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("META_API_KEY", "synthetic-provider-key")
    config = ProviderConfig("meta", "muse-spark-1.3", max_output=16, meta_budget_usd=1)
    body = config.build_request([{"role": "user", "content": "multi-byte 日本語 🙂"}], [])
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.content)
        return httpx.Response(200, json=tool_reply(READY, "meta"))

    asyncio.run(request_model(config, body, transport=httpx.MockTransport(handler)))
    assert sent == [wire_json(body)] and "日本語".encode() in sent[0]


@pytest.mark.parametrize(
    "raw",
    [
        b'{"choices":[{"message":{}}],"choices":[{"message":{}}]}',
        b'{"choices":[{"message":{"tool_calls":[],"tool_calls":[]}}]}',
        b"\xff\xfe not utf-8",
        b"[not json",
    ],
)
def test_duplicate_or_undecodable_replies_are_unknown_outcomes(
    monkeypatch: pytest.MonkeyPatch, raw: bytes
) -> None:
    monkeypatch.setenv("META_API_KEY", "synthetic-provider-key")
    config = ProviderConfig("meta", "muse-spark-1.3", max_output=16, meta_budget_usd=1)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=raw)

    body = config.build_request([], tools_for([contract()]))
    with pytest.raises(ProviderFailure) as invalid:
        asyncio.run(request_model(config, body, transport=httpx.MockTransport(handler)))
    # The provider may have charged for a reply it returned; the outcome is unknown.
    assert str(invalid.value) == "provider_invalid_response"
    assert invalid.value.outcome == "unknown"


def test_http_turn_with_duplicate_fields_is_refused_before_inference(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HERMA_DB", str(tmp_path / "api.db"))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    monkeypatch.setenv("HERMA_CONVERSATION_ENABLED", "true")
    store = ProvisionStore(tmp_path / "api.db")
    key, info = store.issue_key(label="conversation", harness_kind="opencode", scopes=["route"])
    seed(store, "key:" + info.key_id)
    raw = json.dumps(turn().model_dump())
    duplicate = raw[:-1] + ',"message":"SYNTHETIC replacement"}'

    def forbidden(*_args: Any, **_kwargs: Any) -> None:
        pytest.fail("a refused body must not reach a provider")

    monkeypatch.setattr(httpx, "AsyncClient", forbidden)
    response = TestClient(create_app()).post(
        "/v1/conversations/turn",
        headers={"X-Herma-Key": key, "Content-Type": "application/json"},
        content=duplicate,
    )
    assert response.status_code == 400 and response.json()["code"] == "invalid_json"


@pytest.mark.parametrize("choice", [["a"], {"a": 1}, None, 1])
def test_jev_rejects_a_non_string_choice_as_invalid_evidence(choice: Any) -> None:
    request = jev_request()
    request["body"]["questions"] = {"team": {"type": "choice", "criteria": {"a": "A", "b": "B"}}}
    answer = {
        "type": "choice",
        "choice": choice,
        "probabilities": {"a": 1, "b": 0},
        "confidence": 1,
    }
    with pytest.raises(ValueError, match="criteria"):
        parse_jev_response(request, {"answers": {"team": answer}})


def test_meta_needs_an_explicit_budget_like_every_paid_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HERMA_CONVERSATION_MAX_OUTPUT", "16384")
    monkeypatch.delenv("HERMA_META_BUDGET_USD", raising=False)
    with pytest.raises(HermaError) as missing:
        ProviderConfig.from_env("meta")
    assert missing.value.code == "invalid_provider_configuration"
    monkeypatch.setenv("HERMA_META_BUDGET_USD", "5")
    assert ProviderConfig.from_env("meta").budget_microusd == 5000000
