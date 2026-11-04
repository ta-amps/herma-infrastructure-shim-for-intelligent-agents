"""Jev is a typed worker decision protocol, not a generative fallback."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from herma.decision_provider import parse_jev_response, prepare_jev_request
from herma.errors import HermaError
from herma.harness_gate import HarnessPrincipal


def prepared() -> dict[str, Any]:
    return prepare_jev_request(
        principal=HarnessPrincipal("alice", "EXAMPLE", "opencode", frozenset({"route"})),
        caller_scope="key:alice",
        model="jev-latest",
        state={"example": True},
        questions={
            "ready": {"type": "noul", "instructions": "The supplied state contains example=true."}
        },
        verb_ref="verb:example-review",
        request_id="example-request",
        input_refs=["noun:example-input@1"],
    )


def test_jev_adapter_is_pure_native_and_attributed(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args: Any, **_kwargs: Any) -> None:
        pytest.fail("wire adapters must not contact providers or activate work")

    monkeypatch.setattr(httpx, "AsyncClient", forbidden)
    request = prepared()
    assert request["url"] == "https://api.typesafe.ai/v1/systemone"
    assert request["credential_env"] == "TYPESAFE_API_KEY"
    assert "messages" not in request["body"] and "max_tokens" not in request["body"]
    assert request["attempt"]["provider_calls_observed"] == 0
    result = parse_jev_response(
        request,
        {
            "model": "jev-1.13.0",
            "answers": {"ready": {"type": "noul", "noul": 0.99}},
            "usage": {"input_tokens": 8, "output_tokens": 3},
        },
    )
    assert result["model"] == "jev-latest" and result["reported_model"] == "jev-1.13.0"
    assert result["usage"] == {"input_tokens": 8, "output_tokens": 3}
    assert result["action_model"] is None and not result["transport_independently_verified"]


@pytest.mark.parametrize("probability", ["0.99", True, float("nan"), -1, 2])
def test_jev_rejects_invalid_native_answers(probability: Any) -> None:
    with pytest.raises(ValueError, match="probability"):
        parse_jev_response(
            prepared(), {"answers": {"ready": {"type": "noul", "noul": probability}}}
        )


def test_jev_scope_cannot_be_changed() -> None:
    with pytest.raises(HermaError):
        prepare_jev_request(
            principal=HarnessPrincipal("alice", "EXAMPLE", "opencode", frozenset({"route"})),
            caller_scope="key:bob",
            model="jev-latest",
            state={},
            questions={},
            verb_ref="verb:one",
            request_id="request-one",
            input_refs=["noun:one"],
        )


def test_jev_choice_and_score_preserve_consistent_distributions() -> None:
    request = prepared()
    request["body"]["questions"] = {
        "team": {"type": "choice", "criteria": {"a": "First", "b": "Second"}},
        "severity": {"type": "score", "criteria": ["Low", "High"]},
    }
    response = {
        "answers": {
            "team": {
                "type": "choice",
                "choice": "a",
                "probabilities": {"a": 0.7, "b": 0.3},
                "confidence": 0.8,
            },
            "severity": {
                "type": "score",
                "score": 0.75,
                "probabilities": {"0": 0.25, "1": 0.75},
                "confidence": 0.6,
                "legend": {"0": "Low", "1": "High"},
            },
        }
    }
    assert parse_jev_response(request, response)["status"] == "response_validated"
    response["answers"]["team"]["probabilities"] = {"a": 0, "b": 0}
    with pytest.raises(ValueError, match="sum to one"):
        parse_jev_response(request, response)
    response["answers"]["team"]["probabilities"] = {"a": 0.1, "b": 0.9}
    with pytest.raises(ValueError, match="maximize"):
        parse_jev_response(request, response)
    response["answers"]["team"]["choice"] = "b"
    response["answers"]["severity"]["score"] = 1
    with pytest.raises(ValueError, match="weighted"):
        parse_jev_response(request, response)
    response["answers"]["severity"]["score"] = 0.75
    response["answers"]["severity"]["legend"] = {"0": "Changed", "1": "High"}
    with pytest.raises(ValueError, match="legend"):
        parse_jev_response(request, response)
