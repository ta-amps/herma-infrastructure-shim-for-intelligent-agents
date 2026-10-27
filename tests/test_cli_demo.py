"""The CI demo verifies the supported client policy and its real provision pipeline."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from herma.cli import _run_demo


def test_offline_demo_accepts_scoped_assistants_and_preserves_guards(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HERMA_DB", str(tmp_path / "demo.db"))
    for name in ("HERMA_MICROMODEL_URL", "HERMA_MICROMODEL_MODEL", "HERMA_MICROMODEL_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    async def no_network(*_args: object, **_kwargs: object) -> httpx.Response:
        raise AssertionError("The offline CI demo must not call a model or external HTTP service")

    monkeypatch.setattr(httpx.AsyncClient, "send", no_network)
    summary = asyncio.run(_run_demo())
    assert summary["ok"] is True
    assert summary["personal_assistant_allowed"] is True
    assert summary["personal_assistant_configure_refused"] is True
    assert summary["uncredentialed_assistant_refused"] is True
    assert summary["contributor_tier_refused"] is True
    assert summary["synced_count"] == len(summary["tessera_published"]) > 0
    assert "noun:tessera.nouns/fenced_submit" in summary["tier1_shimmed_context_refs"]
    assert len(summary["personal_assistant_receipt"]) == 64
    assert summary["live_ollama_excerpt"] is None
    assert "consumer_assistant_refused" not in summary
    assert "hmk_" not in json.dumps(summary)
