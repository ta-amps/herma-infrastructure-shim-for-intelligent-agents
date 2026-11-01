"""Tests for multi-protocol payload augmentation, deduplication, edge lockdown, and HTTP endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from herma.api.app import create_app, seed_examples_if_present
from herma.schemas import MicromodelTrigger, Provision, SemanticTrigger, TriggerSpec
from herma.store import ProvisionStore


def test_preview_and_dry_run_never_call_configured_trigger_providers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    async def post(_client: httpx.AsyncClient, url: str, **_kwargs: Any) -> httpx.Response:
        calls.append(url)
        return httpx.Response(503, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setenv("HERMA_DB", str(tmp_path / "offline.db"))
    monkeypatch.setenv("HERMA_MICROMODEL_URL", "https://example.com/classify")
    monkeypatch.setenv("HERMA_EMBEDDINGS_URL", "https://example.com/embeddings")
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    store = ProvisionStore(tmp_path / "offline.db")
    store.put_provision(
        Provision(
            prov_id="PROV-OFFLINE-HTTP",
            title="Offline HTTP",
            summary="Example two-tier preview fixture.",
            inject_text="Use this example guidance.",
            triggers=TriggerSpec(
                mode="all",
                semantic=SemanticTrigger(exemplars=["example request"]),
                micromodel=MicromodelTrigger(
                    intent_question="Should this example rule apply?",
                    fallback_keywords=["example"],
                ),
            ),
        )
    )
    token, _ = store.issue_key(label="EXAMPLE offline", harness_kind="opencode", scopes=["route"])
    with TestClient(create_app()) as client:
        preview = client.post("/api/preview", json={"prompt": "example request"})
        assert preview.status_code == 200
        assert preview.json()["persisted"] is False
        assert preview.json()["matches"][0]["matched_tiers"] == ["semantic", "micromodel"]
        dry_run = client.post(
            "/v1/dry-run",
            headers={"X-Herma-Key": token, "X-Herma-Harness": "opencode"},
            json={
                "wire_format": "chat_completions",
                "payload": {
                    "model": "muse-spark-1.3",
                    "messages": [{"role": "user", "content": "example request"}],
                },
            },
        )
        assert dry_run.status_code == 200
        assert dry_run.json()["matches"][0]["matched_tiers"] == ["semantic", "micromodel"]
    assert calls == []


def test_http_edge_lockdown_and_dry_run_across_wire_formats(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "api.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.setenv("HERMA_EDGE_SECRET", "edge-lock-test")

    store = ProvisionStore(db_file)
    seed_examples_if_present(store)
    token, _ = store.issue_key(
        label="ci-harness",
        harness_kind="opencode",
        scopes=["route", "configure"],
    )

    client = TestClient(create_app())

    # Health is edge-exempt:
    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    assert r_health.json()["configurable_harnesses_only"] is True

    # Non-health without x-edge-auth is 403:
    r_blocked = client.get("/")
    assert r_blocked.status_code == 403

    edge_hdr = {"x-edge-auth": "edge-lock-test"}
    r_home = client.get("/", headers=edge_hdr)
    assert r_home.status_code == 200
    assert "Programmable AI Request Middleware" in r_home.text

    # Personal-assistant product names do not override a valid scoped key:
    r_consumer = client.post(
        "/v1/dry-run",
        headers={
            **edge_hdr,
            "X-Herma-Key": token,
            "User-Agent": "Muse-Personal-Assistant/1.0",
        },
        json={
            "wire_format": "chat_completions",
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "fencing"}],
            },
        },
    )
    assert r_consumer.status_code == 200

    # Valid configurable coding harness dry-run across chat_completions, responses, and messages:
    harness_hdr = {
        **edge_hdr,
        "X-Herma-Key": token,
        "X-Herma-Harness": "opencode",
    }
    r_chat = client.post(
        "/v1/dry-run",
        headers=harness_hdr,
        json={
            "wire_format": "chat_completions",
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "Check Tessera fencing tokens"}],
            },
        },
    )
    assert r_chat.status_code == 200
    data_chat = r_chat.json()
    assert "PROV-TESSERA-FENCING@v1" in data_chat["receipt"]["provisions_fired"]
    assert "https://tessera.ta-amps.workers.dev/llms.txt" in data_chat["receipt"]["uris_injected"]
    sys_msg = data_chat["augmented_payload"]["messages"][0]["content"]
    assert "[HERMA PROVISION: PROV-TESSERA-FENCING@v1" in sys_msg

    # Turn-2 deduplication skips re-injecting PROV-TESSERA-FENCING:
    turn2_msgs = [
        *data_chat["augmented_payload"]["messages"],
        {"role": "assistant", "content": "Done."},
        {"role": "user", "content": "Check Tessera fencing again."},
    ]
    r_turn2 = client.post(
        "/v1/dry-run",
        headers=harness_hdr,
        json={
            "wire_format": "chat_completions",
            "payload": {"model": "muse-spark-1.3", "messages": turn2_msgs},
        },
    )
    assert r_turn2.status_code == 200
    assert "PROV-TESSERA-FENCING" in r_turn2.json()["receipt"]["deduped_skipped"]

    # Meta /v1/responses envelope injection:
    r_resp = client.post(
        "/v1/dry-run",
        headers=harness_hdr,
        json={
            "wire_format": "responses",
            "payload": {
                "model": "muse-spark-1.3",
                "input": "Update statute card checks in exploitation_evidence/lanes/checks.py",
            },
        },
    )
    assert r_resp.status_code == 200
    assert "PROV-RISK-REVIEW-NON-ACCUSATORY@v1" in r_resp.json()["receipt"]["provisions_fired"]
    assert "HERMA PROVISION" in r_resp.json()["augmented_payload"]["instructions"]

    # Anthropic /v1/messages envelope injection:
    r_anth = client.post(
        "/v1/dry-run",
        headers=harness_hdr,
        json={
            "wire_format": "messages",
            "payload": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 512,
                "messages": [
                    {"role": "user", "content": "Verify EDGE_SECRET in deploy/cloudflare/worker.js"}
                ],
            },
        },
    )
    assert r_anth.status_code == 200
    assert "PROV-EDGE-ORIGIN-LOCKDOWN@v1" in r_anth.json()["receipt"]["provisions_fired"]
    assert "HERMA PROVISION" in r_anth.json()["augmented_payload"]["system"]

    # Contributor model refused over HTTP:
    r_contrib = client.post(
        "/v1/dry-run",
        headers=harness_hdr,
        json={
            "wire_format": "responses",
            "payload": {"model": "muse-spark-1.3-contributor", "input": "hi"},
        },
    )
    assert r_contrib.status_code == 403
    assert r_contrib.json()["code"] == "contributor_tier_refused"
