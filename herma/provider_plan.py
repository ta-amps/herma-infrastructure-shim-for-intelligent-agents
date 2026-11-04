"""Explicit provider-plan nouns and per-caller operator grants; selection adds no work authority."""

from __future__ import annotations

import os
import re
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from herma.conversation_contracts import ConversationTurn
from herma.conversation_schema import strict_json
from herma.errors import HermaError
from herma.harness_gate import refuse_contributor_model
from herma.schemas import ContextEntry

if TYPE_CHECKING:
    from herma.conversation_provider import ProviderConfig

GRANTS_SETTING = "HERMA_CONVERSATION_PROVIDER_GRANTS"
# Deployment-wide grants let any caller spend on the operator's behalf; they are refused.
LEGACY_GRANT_SETTINGS = (
    "HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST",
    "HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER",
)
CALLER_SCOPE = re.compile(r"key:[A-Za-z0-9_.:-]{1,120}")
MAX_GRANTS = 1000
MAX_GRANT_CHOICES = 16
# OpenRouter author slugs that name the same vendor as a direct provider, when the slug differs
# from the provider name. Meta's models use the author slug `meta`, which already folds to `meta`.
VENDOR_ALIASES: dict[str, str] = {}


def upstream_identity(provider: str, model: str) -> str:
    """Canonical `vendor/model` shared by direct and gateway routes to one upstream model.

    OpenRouter names the vendor as the author prefix (`openai/gpt-x` is OpenAI's `gpt-x`,
    whichever host serves it) and adds variant suffixes such as `:free`. Separators, dated
    snapshots and `-latest` aliases are folded. The rules deliberately over-match: treating
    two models as one identity only prevents failover between them, never adds spending.
    """
    value = model.strip().lower()
    if provider == "openrouter":
        author, _, name = value.partition("/")
        vendor = VENDOR_ALIASES.get(author, author)
        name = name.split(":", 1)[0]
    else:
        vendor, name = provider, value
    name = re.sub(r"[._]", "-", name)
    name = re.sub(r"-(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{8}|latest)$", "", name)
    return f"{vendor}/{name}"


def refuse_contributor_choices(choices: object) -> None:
    """Refuse contributor models before any other check of a choice list, as the Worker does."""
    if isinstance(choices, list):
        for choice in choices:
            if isinstance(choice, dict) and isinstance(choice.get("model"), str):
                refuse_contributor_model(choice["model"])


class ProviderChoice(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    provider: Literal["meta", "openai", "anthropic", "openrouter"]
    model: str = Field(min_length=1, max_length=100)
    routing_provider: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def explicit_route(self) -> ProviderChoice:
        refuse_contributor_model(self.model)
        if self.model.strip() in {"", "*"}:
            raise ValueError("name an explicit provider model")
        if (self.provider == "openrouter") != (self.routing_provider is not None):
            raise ValueError("only OpenRouter choices name, and must name, an underlying provider")
        return self

    @property
    def identity(self) -> str:
        return upstream_identity(self.provider, self.model)


class ProviderPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    caller_scope: str
    purpose: Literal["caller_requested_typed_proposal"]
    payer: Literal["operator"]
    context_refs: list[str] = Field(min_length=1, max_length=12)
    providers: list[ProviderChoice] = Field(min_length=1)
    allow_failover: Literal[True]
    allow_uncertain_outcome: bool = False
    allow_recovery_probe: bool = True

    @model_validator(mode="after")
    def finite_distinct_routes(self) -> ProviderPlan:
        if len({item.provider for item in self.providers}) != len(self.providers):
            raise ValueError("each provider may be attempted once per turn")
        if len({item.identity for item in self.providers}) != len(self.providers):
            # A second credential for the same upstream model would rotate keys around a limit.
            raise ValueError("each upstream model identity may be attempted once per turn")
        return self


class ProviderGrant(BaseModel):
    """The operator's explicit purchase grant for one authenticated caller."""

    model_config = ConfigDict(extra="forbid", strict=True)
    caller_scope: str
    providers: list[ProviderChoice] = Field(min_length=1, max_length=MAX_GRANT_CHOICES)
    allow_uncertain_failover: bool = False

    @model_validator(mode="after")
    def exact_caller_and_choices(self) -> ProviderGrant:
        if not CALLER_SCOPE.fullmatch(self.caller_scope):
            raise ValueError("a grant names one exact authenticated caller scope")
        keys = [(item.provider, item.model, item.routing_provider) for item in self.providers]
        if len(set(keys)) != len(keys):
            raise ValueError("duplicate granted provider choice")
        return self

    def permits(self, choice: ProviderChoice) -> bool:
        return choice in self.providers


def operator_grants() -> dict[str, ProviderGrant]:
    """Parse the operator's caller-scoped grants; absent or empty means no caller is granted."""
    try:
        for name in LEGACY_GRANT_SETTINGS:
            if os.environ.get(name, "").strip():
                raise ValueError(f"{name} is deployment-wide and no longer supported")
        items = strict_json(os.environ.get(GRANTS_SETTING, "").strip() or "[]")
        if not isinstance(items, list) or len(items) > MAX_GRANTS:
            raise ValueError("grants must be a bounded JSON list")
        grants: dict[str, ProviderGrant] = {}
        for item in items:
            refuse_contributor_choices(item.get("providers") if isinstance(item, dict) else None)
            grant = ProviderGrant.model_validate(item)
            if grant.caller_scope in grants:
                raise ValueError("each caller scope may have one grant")
            grants[grant.caller_scope] = grant
        return grants
    except (ValueError, TypeError, RecursionError) as exc:
        raise HermaError(
            503,
            "invalid_provider_configuration",
            "Invalid provider grants",
            "Configure HERMA_CONVERSATION_PROVIDER_GRANTS as a JSON list of exact caller-scoped "
            "provider/model grants. Deployment-wide allowlists and uncertainty flags are refused.",
        ) from exc


def choice_for(config: ProviderConfig) -> ProviderChoice:
    return ProviderChoice(
        provider=config.provider,  # type: ignore[arg-type]
        model=config.model,
        routing_provider=config.openrouter_provider if config.provider == "openrouter" else None,
    )


def grant_required() -> HermaError:
    return HermaError(
        403,
        "provider_grant_required",
        "Provider grant required",
        "The operator has not granted this caller the selected provider and model for "
        "operator-funded server inference.",
    )


def require_direct_grant(grant: ProviderGrant | None, choice: ProviderChoice) -> None:
    if grant is None or not grant.permits(choice):
        raise grant_required()


def load_provider_plan(
    scope: str, turn: ConversationTurn, entry: ContextEntry, grant: ProviderGrant | None
) -> ProviderPlan:
    try:
        if entry.kind != "noun" or not isinstance(entry.schema_or_body, dict):
            raise ValueError("plan must be a noun")
        raw = entry.schema_or_body["provider_plan"]
        refuse_contributor_choices(raw.get("providers") if isinstance(raw, dict) else None)
        plan = ProviderPlan.model_validate(raw)
        if (
            grant is None
            or plan.caller_scope != scope
            or not all(grant.permits(item) for item in plan.providers)
        ):
            raise ValueError("provider plan is not authorized")
        if (
            plan.providers[0].provider != turn.provider
            or turn.provider_plan_ref not in turn.context_refs
        ):
            raise ValueError("turn must explicitly select the plan and first provider")
        if set(plan.context_refs) != set(turn.context_refs) - {turn.provider_plan_ref}:
            raise ValueError("input references exceed the provider plan")
        if plan.allow_uncertain_outcome and not grant.allow_uncertain_failover:
            raise ValueError("uncertain outcome failover lacks this caller's operator grant")
        return plan
    except (ValueError, KeyError, TypeError) as exc:
        raise HermaError(
            403,
            "provider_plan_not_authorized",
            "Provider plan denied",
            "Choose a caller-owned provider plan within your operator provider grant, data references and payer.",
        ) from exc
