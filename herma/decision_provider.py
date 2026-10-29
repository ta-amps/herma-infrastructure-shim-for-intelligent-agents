"""Pure Jev wire adapter for authorized workers; no transport or server fallback."""

from __future__ import annotations

import hashlib
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from herma.conversation_provider import encode, usage_for
from herma.errors import HermaError
from herma.harness_gate import HarnessPrincipal, refuse_contributor_model

JEV_URL = "https://api.typesafe.ai/v1/systemone"


class NoulQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["noul"]
    instructions: str = Field(min_length=1)


class ChoiceQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["choice"]
    instructions: str = Field(min_length=1)
    criteria: dict[str, str] = Field(min_length=1)


class ScoreQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["score"]
    instructions: str = Field(min_length=1)
    criteria: list[str] = Field(min_length=2, max_length=10)


def prepare_jev_request(
    *,
    principal: HarnessPrincipal,
    caller_scope: str,
    model: str,
    state: Any,
    questions: dict[str, Any],
    verb_ref: str,
    request_id: str,
    input_refs: list[str],
) -> dict[str, Any]:
    """Prepare native typed decisions; the owning worker enforces its lease and effects."""
    if principal.caller_scope != caller_scope or "route" not in principal.scopes:
        raise HermaError(
            403,
            "caller_scope_mismatch",
            "Worker scope required",
            "Use the authenticated worker's own scope.",
        )
    refuse_contributor_model(model)
    if not model.startswith("jev-") or not verb_ref or not request_id or not input_refs:
        raise ValueError("name an explicit Jev model, owning verb, request and input nouns")
    if not questions:
        raise ValueError("at least one typed decision question is required")
    adapter = TypeAdapter(NoulQuestion | ChoiceQuestion | ScoreQuestion)
    parsed = {
        name: adapter.validate_python(question).model_dump() for name, question in questions.items()
    }
    body = {"model": model, "state": state, "questions": parsed}
    raw = encode(body)
    if len(raw) > 32768:
        raise ValueError("worker decision payload exceeds the transport profile")
    attempt_id = hashlib.sha256(
        encode({"scope": caller_scope, "verb": verb_ref, "request": request_id})
    ).hexdigest()
    return {
        "url": JEV_URL,
        "method": "POST",
        "credential_env": "TYPESAFE_API_KEY",
        "body": body,
        "attempt": {
            "attempt_id": attempt_id,
            "caller_scope": caller_scope,
            "parent_verb_ref": verb_ref,
            "request_id": request_id,
            "input_refs": input_refs,
            "provider": "jev",
            "model": model,
            "payer": "worker",
            "execution_origin": "worker_direct",
            "status": "prepared",
            "request_sha256": hashlib.sha256(raw).hexdigest(),
            "provider_calls_observed": 0,
            "usage": {"input_tokens": None, "output_tokens": None},
            "action": "prepare_native_decision_request",
            "action_model": None,
            "action_model_reason": "deterministic_wire_preparation",
        },
    }


def parse_jev_response(prepared: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    """Validate worker-reported native answers without pretending to verify transport."""

    def probability(value: Any) -> bool:
        return type(value) in {float, int} and math.isfinite(value) and 0 <= value <= 1

    questions = prepared["body"]["questions"]
    answers = response.get("answers")
    if not isinstance(answers, dict) or set(answers) != set(questions):
        raise ValueError("Jev must answer the requested question identifiers")
    for name, question in questions.items():
        answer = answers[name]
        kind = question["type"]
        if not isinstance(answer, dict) or answer.get("type") != kind:
            raise ValueError("Jev answer type does not match the question")
        if kind == "noul":
            if not probability(answer.get("noul")):
                raise ValueError("invalid noul probability")
        else:
            criteria = question["criteria"]
            labels = (
                set(criteria)
                if kind == "choice"
                else {str(index) for index in range(len(criteria))}
            )
            probs = answer.get("probabilities")
            if (
                not isinstance(probs, dict)
                or set(probs) != labels
                or not all(probability(value) for value in probs.values())
                or not probability(answer.get("confidence"))
            ):
                raise ValueError("invalid decision probability distribution")
            if kind == "choice" and answer.get("choice") not in labels:
                raise ValueError("choice is not in the requested criteria")
            if not math.isclose(sum(probs.values()), 1, abs_tol=1e-6):
                raise ValueError("decision probabilities must sum to one")
            if kind == "choice" and probs[answer["choice"]] + 1e-6 < max(probs.values()):
                raise ValueError("choice must maximize the decision probability")
            if kind == "score" and (
                type(answer.get("score")) not in {float, int}
                or not math.isfinite(answer["score"])
                or not 0 <= answer["score"] <= len(criteria) - 1
            ):
                raise ValueError("score is outside the requested rubric")
            if kind == "score":
                if answer.get("legend") != {
                    str(index): label for index, label in enumerate(criteria)
                }:
                    raise ValueError("score legend does not match the requested rubric")
                mean = sum(int(level) * value for level, value in probs.items())
                if not math.isclose(answer["score"], mean, abs_tol=1e-6):
                    raise ValueError("score must equal the probability-weighted level mean")
    return {
        **prepared["attempt"],
        "status": "response_validated",
        "answers": answers,
        "reported_model": response.get("model") if isinstance(response.get("model"), str) else None,
        "usage": usage_for("jev", response),
        "cost_usd": None,
        "evidence_source": "worker_reported_response",
        "transport_independently_verified": False,
        "response_sha256": hashlib.sha256(encode(response)).hexdigest(),
        "action": "validate_native_decision_response",
        "action_model": None,
        "action_model_reason": "deterministic_schema_validation",
    }
