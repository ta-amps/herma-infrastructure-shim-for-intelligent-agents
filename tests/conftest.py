"""Synthetic operator grants for managed conversation tests; no provider is ever contacted."""

from __future__ import annotations

import json
from typing import Any

import pytest

# Every synthetic provider/model a test turn may select. Grants name exact choices.
SYNTHETIC_CHOICES: list[dict[str, Any]] = [
    {"provider": "meta", "model": "muse-spark-1.3"},
    {"provider": "meta", "model": "muse-wonder-1.0"},
    {"provider": "ollama", "model": "muse-spark-open"},
    {"provider": "openai", "model": "synthetic-responses-model"},
    {"provider": "openai", "model": "synthetic/model"},
    {"provider": "anthropic", "model": "synthetic-claude"},
    {"provider": "anthropic", "model": "synthetic-claude-model"},
    {"provider": "anthropic", "model": "synthetic/model"},
    {"provider": "openrouter", "model": "synthetic/model", "routing_provider": "synthetic-host"},
]


def grant(
    monkeypatch: pytest.MonkeyPatch,
    *scopes: str,
    choices: list[dict[str, Any]] | None = None,
    uncertain: bool = False,
) -> None:
    """Replace the operator grants with one exact grant per named caller scope."""
    monkeypatch.setenv(
        "HERMA_CONVERSATION_PROVIDER_GRANTS",
        json.dumps(
            [
                {
                    "caller_scope": scope,
                    "providers": SYNTHETIC_CHOICES if choices is None else choices,
                    "allow_uncertain_failover": uncertain,
                }
                for scope in scopes
            ]
        ),
    )


@pytest.fixture(autouse=True)
def synthetic_operator_grants(monkeypatch: pytest.MonkeyPatch) -> None:
    """The default test deployment grants two synthetic callers; others start ungranted."""
    grant(monkeypatch, "key:alice", "key:bob")
