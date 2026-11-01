"""Example operator grants for managed conversation tests; no provider is ever contacted."""

from __future__ import annotations

import json
from typing import Any

import pytest

# Every example provider/model a test turn may select. Grants name exact choices.
EXAMPLE_CHOICES: list[dict[str, Any]] = [
    {"provider": "meta", "model": "muse-spark-1.3"},
    {"provider": "meta", "model": "muse-wonder-1.0"},
    {"provider": "openai", "model": "example-responses-model"},
    {"provider": "openai", "model": "example/model"},
    {"provider": "anthropic", "model": "example-claude"},
    {"provider": "anthropic", "model": "example-claude-model"},
    {"provider": "anthropic", "model": "example/model"},
    {"provider": "openrouter", "model": "example/model", "routing_provider": "example-host"},
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
                    "providers": EXAMPLE_CHOICES if choices is None else choices,
                    "allow_uncertain_failover": uncertain,
                }
                for scope in scopes
            ]
        ),
    )


@pytest.fixture(autouse=True)
def example_operator_grants(monkeypatch: pytest.MonkeyPatch) -> None:
    """The default test deployment grants two example callers; others start ungranted."""
    grant(monkeypatch, "key:alice", "key:bob")
