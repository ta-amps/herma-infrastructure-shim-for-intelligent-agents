"""Explicit provider-plan nouns; deterministic selection grants no new work authority."""

from __future__ import annotations

import json
import os
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from herma.conversation_contracts import ConversationTurn
from herma.errors import HermaError
from herma.harness_gate import refuse_contributor_model
from herma.schemas import ContextEntry


class ProviderChoice(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    provider: Literal["meta", "ollama", "openai", "anthropic", "openrouter"]
    model: str = Field(min_length=1, max_length=100)
    routing_provider: str | None = Field(default=None, min_length=1, max_length=100)


class ProviderPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    caller_scope: str
    purpose: Literal["caller_requested_typed_proposal"]
    payer: Literal["operator"]
    context_refs: list[str] = Field(min_length=1, max_length=12)
    providers: list[ProviderChoice] = Field(min_length=1)
    allow_failover: Literal[True]
    allow_uncertain_outcome: bool = False

    @model_validator(mode="after")
    def unique_providers(self) -> ProviderPlan:
        if len({item.provider for item in self.providers}) != len(self.providers):
            raise ValueError("each provider may be attempted once per turn")
        for item in self.providers:
            refuse_contributor_model(item.model)
            if item.provider == "openrouter" and not item.routing_provider:
                raise ValueError("OpenRouter plans must name the permitted underlying provider")
        return self


def load_provider_plan(scope: str, turn: ConversationTurn, entry: ContextEntry) -> ProviderPlan:
    try:
        if entry.kind != "noun" or not isinstance(entry.schema_or_body, dict):
            raise ValueError("plan must be a noun")
        plan = ProviderPlan.model_validate(entry.schema_or_body["provider_plan"])
        allowed = [
            ProviderChoice.model_validate(item)
            for item in json.loads(
                os.environ.get("HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST", "[]")
            )
        ]
        if plan.caller_scope != scope or not all(item in allowed for item in plan.providers):
            raise ValueError("provider plan is not authorized")
        if (
            plan.providers[0].provider != turn.provider
            or turn.provider_plan_ref not in turn.context_refs
        ):
            raise ValueError("turn must explicitly select the plan and first provider")
        if set(plan.context_refs) != set(turn.context_refs) - {turn.provider_plan_ref}:
            raise ValueError("input references exceed the provider plan")
        if (
            plan.allow_uncertain_outcome
            and os.environ.get("HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "").lower() != "true"
        ):
            raise ValueError("uncertain outcome failover lacks operator allowance")
        return plan
    except (ValueError, KeyError, TypeError) as exc:
        raise HermaError(
            403,
            "provider_plan_not_authorized",
            "Provider plan denied",
            "Choose a caller-owned provider plan matching the operator provider/model allowlist, data references and payer.",
        ) from exc
