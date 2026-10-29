"""Configurable-harness access gate: authenticates scoped agent and personal-assistant clients."""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import get_args

from herma.errors import (
    ContributorTierRefusedError,
    HarnessRequiredError,
    HarnessScopeError,
    HermaError,
)
from herma.schemas import PROJECT_TAG_PATTERN, HarnessKind, HarnessScope

ALLOWED_HARNESS_KINDS: frozenset[str] = frozenset(get_args(HarnessKind))
KEY_PREFIX = "hmk_"
PROJECT_TAG_RE = re.compile(PROJECT_TAG_PATTERN)


@dataclass(frozen=True)
class HarnessPrincipal:
    """Verified caller identity bound to a configurable coding harness."""

    key_id: str
    label: str
    harness_kind: HarnessKind
    scopes: frozenset[HarnessScope]
    is_admin: bool = False

    @property
    def caller_scope(self) -> str:
        return f"key:{self.key_id}"


def hash_secret(raw_secret: str) -> str:
    return hashlib.sha256(raw_secret.encode("utf-8")).hexdigest()


def parse_bearer_or_header(headers: Mapping[str, str]) -> tuple[str, str]:
    """Extract (key_id, raw_secret) from X-Herma-Key or Authorization: Bearer hmk_<id>.<secret>."""
    lower = {k.lower(): v for k, v in headers.items()}
    raw = lower.get("x-herma-key", "").strip()
    if not raw:
        auth = lower.get("authorization", "").strip()
        if auth.lower().startswith("bearer "):
            candidate = auth[7:].strip()
            if candidate.startswith(KEY_PREFIX):
                raw = candidate
    if not raw.startswith(KEY_PREFIX) or "." not in raw:
        raise HarnessRequiredError(
            "Missing valid Herma harness key (hmk_<id>.<secret>). Only configurable agentic coding "
            "harnesses may route through or configure Herma."
        )
    body = raw[len(KEY_PREFIX) :]
    key_id, sep, secret = body.partition(".")
    if not sep or not key_id or len(secret) < 8:
        raise HarnessRequiredError("Malformed Herma harness key.")
    return key_id, secret


def enforce_not_consumer_assistant(headers: Mapping[str, str]) -> str | None:
    """Require stateless credentials; client product names do not confer or remove privileges."""
    lower = {k.lower(): v for k, v in headers.items()}
    if lower.get("sec-fetch-mode", "").strip().lower() == "navigate":
        raise HarnessRequiredError(
            "Browser navigation requests cannot invoke Herma middleware endpoints."
        )
    if "cookie" in lower and not lower.get("x-edge-auth"):
        raise HarnessRequiredError(
            "Cookie-bearing browser sessions are refused; use a stateless coding harness credential."
        )
    declared = lower.get("x-herma-harness", "").strip().lower()
    if declared and declared not in ALLOWED_HARNESS_KINDS:
        allowed = ", ".join(sorted(ALLOWED_HARNESS_KINDS))
        raise HarnessRequiredError(
            f"Unsupported X-Herma-Harness {declared!r}; expected one of: {allowed}."
        )
    return declared or None


def verify_secret_constant_time(expected_sha256: str, supplied_secret: str) -> bool:
    actual = hash_secret(supplied_secret)
    return hmac.compare_digest(expected_sha256.encode("ascii"), actual.encode("ascii"))


def verify_token_constant_time(expected_token: str, supplied_token: str) -> bool:
    if not expected_token or not supplied_token:
        return False
    return hmac.compare_digest(expected_token.encode("utf-8"), supplied_token.encode("utf-8"))


def require_scope(
    principal: HarnessPrincipal,
    required: HarnessScope,
    headers: Mapping[str, str],
) -> None:
    """Enforce scope; 'configure' additionally requires explicit X-Herma-Harness attestation."""
    declared = enforce_not_consumer_assistant(headers)
    if required not in principal.scopes:
        raise HarnessScopeError(f"Harness key {principal.key_id!r} lacks {required!r} scope.")
    if required == "configure":
        if not declared:
            raise HarnessRequiredError(
                "Configuring provisions requires an explicit X-Herma-Harness header from a "
                "configurable coding harness (muse-code, opencode, claude-code, codex, swarm-worker, "
                "personal-assistant, or custom-harness)."
            )
        if declared != principal.harness_kind:
            raise HarnessRequiredError(
                f"X-Herma-Harness {declared!r} does not match key harness binding {principal.harness_kind!r}."
            )


def parse_project_tag(
    headers: Mapping[str, str],
    query_tag: str | None = None,
    *,
    default: str = "default",
) -> str:
    """Resolve and validate X-Herma-Project or ?project_tag= for caller-scoped entity memory."""
    lower = {k.lower(): v for k, v in headers.items()}
    raw = (query_tag if query_tag is not None else lower.get("x-herma-project", "")).strip()
    if not raw:
        return default
    if not PROJECT_TAG_RE.fullmatch(raw):
        raise HermaError(
            400,
            "invalid_project_tag",
            "Invalid Project Tag",
            f"Project tag {raw!r} must match {PROJECT_TAG_PATTERN}.",
        )
    return raw


def parse_cohort_header(headers: Mapping[str, str]) -> str:
    """Extract optional X-Herma-Cohort header for Layer-1 Governance Lens cohort filtering."""
    lower = {k.lower(): v for k, v in headers.items()}
    return lower.get("x-herma-cohort", "").strip()


def is_contributor_model(model: str) -> bool:
    """One classifier shared with the Worker: any case-insensitive `contributor` in the ID.

    Separators vary by protocol (`-contributor`, `/contributor`, `:contributor`), so the
    check deliberately over-matches rather than trusting one naming convention.
    """
    return "contributor" in model.lower()


def refuse_contributor_model(model: str) -> None:
    """Enforce Standard-mode-only upstream LLM execution."""
    if is_contributor_model(model):
        raise ContributorTierRefusedError(model)
