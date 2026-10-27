"""Strict Pydantic schemas for provisions, context entries, 3-tier triggers, keys, and receipts."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROV_ID_PATTERN = r"^PROV-[A-Z0-9][A-Z0-9-]{1,46}$"
ALLOWED_URI_SCHEMES = ("https://", "tessera://", "mcp://", "urn:")
HarnessKind = Literal[
    "muse-code",
    "opencode",
    "claude-code",
    "codex",
    "swarm-worker",
    "custom-harness",
]
HarnessScope = Literal["route", "configure"]
TriggerTier = Literal["keyword", "semantic", "micromodel"]
WireFormat = Literal["chat_completions", "responses", "messages", "dry_run"]
ProvisionAction = Literal["shim_context", "respond_directly"]
ContextEntryKind = Literal["noun", "verb", "detail"]


class ProvisionURI(BaseModel):
    """Authoritative URI pointer attached when a provision triggers."""

    model_config = ConfigDict(extra="forbid")

    uri: str = Field(min_length=6, max_length=512)
    label: str = Field(min_length=2, max_length=140)
    kind: Literal["doc", "schema", "mcp_resource", "statute_card", "store_record"] = "doc"
    inline_excerpt: str = Field(default="", max_length=800)

    @field_validator("uri")
    @classmethod
    def _validate_uri_scheme(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed.startswith(ALLOWED_URI_SCHEMES):
            allowed = ", ".join(ALLOWED_URI_SCHEMES)
            raise ValueError(f"URI {trimmed!r} must start with one of: {allowed}")
        return trimmed


class ContextEntry(BaseModel):
    """Atomic noun, verb, or detail entry stored in Herma's user-configured context database."""

    model_config = ConfigDict(extra="forbid")

    entry_id: str = Field(min_length=2, max_length=160)
    kind: ContextEntryKind
    title: str = Field(min_length=2, max_length=160)
    summary: str = Field(min_length=4, max_length=600)
    schema_or_body: dict[str, Any] | str = ""
    source_uri: str | None = None
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

    @field_validator("entry_id")
    @classmethod
    def _validate_entry_id(cls, value: str) -> str:
        trimmed = value.strip()
        if len(trimmed) < 2:
            raise ValueError("entry_id must contain at least 2 non-whitespace characters.")
        return trimmed

    @field_validator("source_uri")
    @classmethod
    def _validate_source_uri(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            return None
        if not trimmed.startswith(ALLOWED_URI_SCHEMES):
            allowed = ", ".join(ALLOWED_URI_SCHEMES)
            raise ValueError(f"source_uri {trimmed!r} must start with one of: {allowed}")
        return trimmed


class KeywordTrigger(BaseModel):
    """Tier-1 deterministic trigger (~0 ms): keywords, regexes, file globs, and tool names."""

    model_config = ConfigDict(extra="forbid")

    any_keywords: list[str] = Field(default_factory=list)
    all_keywords: list[str] = Field(default_factory=list)
    regex_patterns: list[str] = Field(default_factory=list)
    path_globs: list[str] = Field(default_factory=list)
    tool_names: list[str] = Field(default_factory=list)
    case_sensitive: bool = False

    @field_validator("regex_patterns")
    @classmethod
    def _compile_regexes(cls, patterns: list[str]) -> list[str]:
        for pat in patterns:
            if len(pat) > 240:
                raise ValueError("Regex pattern exceeds 240 characters.")
            re.compile(pat)
        return patterns

    @model_validator(mode="after")
    def _non_empty(self) -> KeywordTrigger:
        if not (
            self.any_keywords
            or self.all_keywords
            or self.regex_patterns
            or self.path_globs
            or self.tool_names
        ):
            raise ValueError(
                "KeywordTrigger requires at least one keyword, regex, path_glob, or tool_name."
            )
        return self


class SemanticTrigger(BaseModel):
    """Tier-2 semantic similarity trigger (~1-5 ms): exemplar phrases and concept clusters."""

    model_config = ConfigDict(extra="forbid")

    exemplars: list[str] = Field(min_length=1)
    concepts: list[str] = Field(default_factory=list)
    threshold: float = Field(default=0.26, ge=0.05, le=0.99)


class MicromodelTrigger(BaseModel):
    """Tier-3 micromodel router trigger: lightweight classifier prompt with offline fallback."""

    model_config = ConfigDict(extra="forbid")

    intent_question: str = Field(min_length=8, max_length=400)
    positive_labels: list[str] = Field(default_factory=lambda: ["apply", "yes", "true"])
    min_confidence: float = Field(default=0.60, ge=0.1, le=1.0)
    fallback_keywords: list[str] = Field(default_factory=list)


class TriggerSpec(BaseModel):
    """Composable 3-tier trigger specification for a provision."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["any", "all"] = "any"
    keyword: KeywordTrigger | None = None
    semantic: SemanticTrigger | None = None
    micromodel: MicromodelTrigger | None = None

    @model_validator(mode="after")
    def _require_one_tier(self) -> TriggerSpec:
        if self.keyword is None and self.semantic is None and self.micromodel is None:
            raise ValueError(
                "TriggerSpec requires at least one of keyword, semantic, or micromodel."
            )
        return self


class Provision(BaseModel):
    """Versioned rule/provision record that shims context or responds directly before LLM execution."""

    model_config = ConfigDict(extra="forbid")

    prov_id: str = Field(pattern=PROV_ID_PATTERN)
    title: str = Field(min_length=3, max_length=140)
    summary: str = Field(min_length=6, max_length=400)
    priority: int = Field(default=100, ge=1, le=1000)
    enabled: bool = True
    action: ProvisionAction = "shim_context"
    direct_response: str | None = Field(default=None, max_length=12000)
    context_refs: list[str] = Field(default_factory=list)
    inject_position: Literal["system_prefix", "system_suffix", "developer_context"] = (
        "system_suffix"
    )
    dedupe_mode: Literal["once_per_conversation", "every_turn"] = "once_per_conversation"
    max_chars: int = Field(default=2400, ge=120, le=16000)
    inject_text: str = Field(default="", max_length=12000)
    uris: list[ProvisionURI] = Field(default_factory=list)
    metadata_tags: dict[str, str] = Field(default_factory=dict)
    triggers: TriggerSpec

    @field_validator("context_refs")
    @classmethod
    def _validate_context_refs(cls, refs: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in refs:
            ref = raw.strip()
            if len(ref) < 2 or len(ref) > 160:
                raise ValueError("Each context_refs entry must be between 2 and 160 characters.")
            if ref not in cleaned:
                cleaned.append(ref)
        return cleaned

    @model_validator(mode="after")
    def _validate_action_fields(self) -> Provision:
        if self.action == "respond_directly":
            if self.direct_response is None or not self.direct_response.strip():
                raise ValueError(
                    "Provision with action='respond_directly' requires a non-empty direct_response."
                )
        elif len(self.inject_text.strip()) < 10:
            raise ValueError(
                "Provision with action='shim_context' requires inject_text of at least 10 characters."
            )
        return self


class StoredProvision(BaseModel):
    """Provision wrapped with compare-and-set version and SHA-256 content hash."""

    model_config = ConfigDict(extra="forbid")

    provision: Provision
    version: int = Field(ge=1)
    content_sha256: str = Field(min_length=64, max_length=64)
    source_store: str = "local"
    updated_at: float


class TriggerMatch(BaseModel):
    """Detailed explanation of why a provision fired on an outbound request."""

    model_config = ConfigDict(extra="forbid")

    prov_id: str
    version: int
    priority: int
    matched_tiers: list[TriggerTier]
    reasons: list[str]
    score: float


class HarnessKeyInfo(BaseModel):
    """Public metadata for an issued configurable-harness credential (never contains the secret)."""

    model_config = ConfigDict(extra="forbid")

    key_id: str
    label: str
    harness_kind: HarnessKind
    scopes: list[HarnessScope]
    created_at: float
    revoked_at: float | None = None


class InjectionReceipt(BaseModel):
    """Cryptographic audit receipt for a single shimmed or directly answered LLM request."""

    model_config = ConfigDict(extra="forbid")

    receipt_id: str
    receipt_sha256: str
    harness_kind: HarnessKind
    key_id: str
    wire_format: WireFormat
    model: str
    provisions_fired: list[str]
    tiers_matched: list[TriggerTier]
    uris_injected: list[str]
    injected_chars: int
    deduped_skipped: list[str]
    responded_directly: bool = False
    direct_response_text: str | None = None
    shimmed_context_refs: list[str] = Field(default_factory=list)
    created_at: float


class DryRunRequest(BaseModel):
    """Harness dry-run request to inspect trigger matches and augmented payload without calling an LLM."""

    model_config = ConfigDict(extra="forbid")

    wire_format: Literal["chat_completions", "responses", "messages"] = "chat_completions"
    payload: dict[str, Any]
    workspace_paths: list[str] = Field(default_factory=list)


class DryRunResponse(BaseModel):
    """Structured dry-run result showing augmented payload, matches, shimmed refs, and direct response."""

    model_config = ConfigDict(extra="forbid")

    augmented_payload: dict[str, Any]
    matches: list[TriggerMatch]
    receipt: InjectionReceipt
    responded_directly: bool = False
    direct_response_text: str | None = None
    shimmed_context_refs: list[str] = Field(default_factory=list)
