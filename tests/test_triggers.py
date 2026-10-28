"""Tests for Tier-1 (keyword/regex/path/tool), Tier-2 (semantic), and Tier-3 (micromodel) triggers."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from herma.errors import ContributorTierRefusedError
from herma.schemas import (
    KeywordTrigger,
    MicromodelTrigger,
    Provision,
    ProvisionURI,
    SemanticTrigger,
    StoredProvision,
    TriggerSpec,
)
from herma.triggers.engine import TriggerContext, evaluate_provisions
from herma.triggers.keyword import evaluate_keyword_trigger
from herma.triggers.micromodel import evaluate_micromodel_trigger
from herma.triggers.semantic import evaluate_semantic_trigger


def _wrap(prov: Provision, version: int = 1) -> StoredProvision:
    return StoredProvision(
        provision=prov,
        version=version,
        content_sha256="a" * 64,
        source_store="test",
        updated_at=1000.0,
    )


def test_tier1_keyword_regex_path_and_tool_triggers() -> None:
    spec = KeywordTrigger(
        any_keywords=["fencing"],
        regex_patterns=[r"\bput_records?\b"],
        path_globs=["src/tessera/*.py"],
        tool_names=["claim"],
    )
    ok_kw, why_kw, _ = evaluate_keyword_trigger(spec, "Verify lease fencing token", [], [])
    assert ok_kw
    assert any("keyword:any" in r for r in why_kw)

    ok_path, why_path, _ = evaluate_keyword_trigger(
        spec, "Refactor module", ["src/tessera/_tasks.py"], []
    )
    assert ok_path
    assert any("keyword:path" in r for r in why_path)

    ok_tool, why_tool, _ = evaluate_keyword_trigger(spec, "Pick work", [], ["claim", "submit"])
    assert ok_tool
    assert any("keyword:tool" in r for r in why_tool)

    ok_none, _, _ = evaluate_keyword_trigger(spec, "Unrelated css color tweak", ["web/app.css"], [])
    assert not ok_none


@pytest.mark.anyio
async def test_tier2_semantic_paraphrase_without_literal_id() -> None:
    spec = SemanticTrigger(
        exemplars=[
            "prevent two concurrent background workers in a swarm from double-processing the same backlog item"
        ],
        concepts=["queue", "lease", "fencing", "duplicate"],
        threshold=0.24,
    )
    matched, reasons, score = await evaluate_semantic_trigger(
        spec,
        "How do we stop duplicate execution when multiple concurrent swarm workers pull from one shared queue?",
    )
    assert matched
    assert score >= 0.24
    assert any("semantic:cosine" in r for r in reasons)

    unmatched, _, low_score = await evaluate_semantic_trigger(
        spec,
        "Adjust typography kerning and pastel button border radius in stylesheet",
    )
    assert not unmatched
    assert low_score < 0.24


@pytest.mark.anyio
async def test_tier3_micromodel_classifier_and_contributor_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = MicromodelTrigger(
        intent_question="Is this request designing a crisis helpline or shelter intake workflow?",
        positive_labels=["apply", "yes"],
        min_confidence=0.65,
        fallback_keywords=["shelter", "helpline"],
    )

    # 1. Offline calibrated fallback when HERMA_MICROMODEL_URL is unset:
    monkeypatch.delenv("HERMA_MICROMODEL_URL", raising=False)
    ok_fb, why_fb, conf_fb = await evaluate_micromodel_trigger(
        spec, "Build an intake checklist for our night shelter helpline volunteers."
    )
    assert ok_fb
    assert conf_fb >= 0.65
    assert any("micromodel:fallback" in r for r in why_fb)

    # 2. Contributor-tier micromodel is deterministically refused:
    monkeypatch.setenv("HERMA_MICROMODEL_URL", "http://127.0.0.1:9/v1/chat/completions")
    monkeypatch.setenv("HERMA_MICROMODEL_MODEL", "muse-spark-1.3-contributor")
    with pytest.raises(ContributorTierRefusedError):
        await evaluate_micromodel_trigger(spec, "Any prompt")


@pytest.mark.anyio
async def test_engine_short_circuits_micromodel_when_keyword_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    async def _boom(*_args: Any, **_kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        raise AssertionError(
            "Micromodel should not be called when Tier-1 already matched in 'any' mode"
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", _boom)
    monkeypatch.setenv("HERMA_MICROMODEL_URL", "http://127.0.0.1:9/v1/chat/completions")
    monkeypatch.setenv("HERMA_MICROMODEL_MODEL", "muse-spark-open")

    prov = Provision(
        prov_id="PROV-SHORT-CIRCUIT",
        title="Short-circuit check",
        summary="Verifies Tier-1 hit avoids unnecessary Tier-3 micromodel call.",
        inject_text="Always verify monotonic lease fences before submitting results.",
        uris=[ProvisionURI(uri="https://tessera.ta-amps.workers.dev/llms.txt", label="Spec")],
        triggers=TriggerSpec(
            mode="any",
            keyword=KeywordTrigger(any_keywords=["fencing"]),
            micromodel=MicromodelTrigger(intent_question="Does this touch fencing?"),
        ),
    )
    hits = await evaluate_provisions([_wrap(prov)], TriggerContext(text="Check fencing logic"))
    assert len(hits) == 1
    assert hits[0][1].matched_tiers == ["keyword"]
    assert calls == 0
    assert json.loads(prov.model_dump_json())["prov_id"] == "PROV-SHORT-CIRCUIT"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("decision", "expected"),
    [
        ({"apply": True, "confidence": 0.9}, True),
        ({"apply": True, "confidence": 1}, True),
        ({"apply": True, "confidence": 0.2}, False),
        ({"apply": False, "confidence": 0.9, "label": "apply"}, False),
        *[
            ({"apply": value, "confidence": 0.9}, False)
            for value in ("false", "true", 0, 1, None, [], {})
        ],
        *[
            ({"apply": True, "confidence": value}, False)
            for value in ("0.9", True, False, None, -1, 2, float("nan"), float("inf"))
        ],
        ({"confidence": 0.9, "label": "apply"}, False),
        ({"apply": True}, False),
        ({"apply": True, "confidence": 0.9, "label": ["apply"]}, False),
        ({"apply": True, "confidence": 0.9, "reason": {}}, False),
        ([], False),
        (None, False),
    ],
)
async def test_micromodel_requires_typed_decision(
    monkeypatch: pytest.MonkeyPatch, decision: object, expected: bool
) -> None:
    calls = 0

    async def post(_client: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert '"apply": true|false' in kwargs["json"]["messages"][0]["content"]
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(decision)}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setenv("HERMA_MICROMODEL_URL", "https://example.com/classify")
    monkeypatch.setenv("HERMA_MICROMODEL_MODEL", "muse-spark-open")
    spec = MicromodelTrigger(
        intent_question="Should this synthetic rule apply?", fallback_keywords=["synthetic"]
    )
    matched, reasons, _ = await evaluate_micromodel_trigger(spec, "synthetic request")
    assert matched is expected
    assert calls == 1
    assert not any("fallback" in reason for reason in reasons)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "envelope",
    [
        {"choices": [None]},
        {"choices": []},
        {"choices": [{"message": {"content": {"apply": True, "confidence": 1}}}]},
        {"choices": [{"message": {"content": "not JSON"}}]},
        {"choices": [{"message": {"content": 'prefix {"apply":true,"confidence":1}'}}]},
        [],
        None,
    ],
)
async def test_malformed_model_reply_does_not_activate_fallback(
    monkeypatch: pytest.MonkeyPatch, envelope: object
) -> None:
    async def post(_client: httpx.AsyncClient, url: str, **_kwargs: Any) -> httpx.Response:
        return httpx.Response(200, json=envelope, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setenv("HERMA_MICROMODEL_URL", "https://example.com/classify")
    spec = MicromodelTrigger(
        intent_question="Should this synthetic rule apply?", fallback_keywords=["synthetic"]
    )
    assert await evaluate_micromodel_trigger(spec, "synthetic request") == (False, [], 0.0)


@pytest.mark.anyio
async def test_offline_engine_blocks_all_provider_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def post(_client: httpx.AsyncClient, url: str, **_kwargs: Any) -> httpx.Response:
        calls.append(url)
        return httpx.Response(503, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setenv("HERMA_MICROMODEL_URL", "https://example.com/classify")
    monkeypatch.setenv("HERMA_EMBEDDINGS_URL", "https://example.com/embeddings")
    semantic = SemanticTrigger(exemplars=["synthetic request"])
    micro = MicromodelTrigger(
        intent_question="Should this synthetic rule apply?", fallback_keywords=["synthetic"]
    )
    stored = _wrap(
        Provision(
            prov_id="PROV-OFFLINE-BOUNDARY",
            title="Offline boundary",
            summary="Synthetic network-free trigger check.",
            inject_text="Use this synthetic guidance.",
            triggers=TriggerSpec(mode="all", semantic=semantic, micromodel=micro),
        )
    )
    hits = await evaluate_provisions(
        [stored], TriggerContext("synthetic request"), offline_only=True
    )
    assert len(hits) == 1
    assert hits[0][1].matched_tiers == ["semantic", "micromodel"]
    assert any("semantic:cosine" in reason for reason in hits[0][1].reasons)
    assert any("micromodel:fallback" in reason for reason in hits[0][1].reasons)
    assert (await evaluate_semantic_trigger(semantic, "synthetic request", offline_only=True))[0]
    assert calls == []

    # Configured online mode still attempts both providers and can use the allowed fallback.
    hits = await evaluate_provisions([stored], TriggerContext("synthetic request"))
    assert len(hits) == 1
    assert calls == ["https://example.com/embeddings", "https://example.com/classify"]
