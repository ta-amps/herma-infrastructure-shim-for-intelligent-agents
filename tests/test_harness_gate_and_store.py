"""Tests for configurable-harness access gate, CAS store, Tessera sync, and remote handshake sync."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from tessera.store import Store as TesseraStore

from herma.errors import (
    HarnessRequiredError,
    HarnessScopeError,
    ProvisionConflictError,
)
from herma.harness_gate import enforce_not_consumer_assistant, require_scope
from herma.schemas import KeywordTrigger, Provision, ProvisionURI, TriggerSpec
from herma.store import ProvisionStore


def _sample_provision(prov_id: str = "PROV-SAMPLE-01", max_chars: int = 2000) -> Provision:
    return Provision(
        prov_id=prov_id,
        title="Sample Atomic Provision",
        summary="Ensures deterministic CAS updates and authoritative URI injection.",
        max_chars=max_chars,
        inject_text="Pass expected_version on every shared state write.",
        uris=[
            ProvisionURI(
                uri="https://tessera.ta-amps.workers.dev/llms.txt",
                label="Tessera Protocol",
                kind="doc",
            )
        ],
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["expected_version"])),
    )


def test_consumer_assistant_and_browser_navigation_refused(tmp_path: Path) -> None:
    store = ProvisionStore(tmp_path / "herma.db")
    raw_key, _ = store.issue_key(
        label="laptop",
        harness_kind="muse-code",
        scopes=["route", "configure"],
    )
    principal = store.authenticate_headers({"X-Herma-Key": raw_key})

    with pytest.raises(HarnessRequiredError):
        enforce_not_consumer_assistant({"User-Agent": "Muse-Personal-Assistant/2.0"})

    with pytest.raises(HarnessRequiredError):
        enforce_not_consumer_assistant({"X-Herma-Harness": "muse-personal-assistant"})

    with pytest.raises(HarnessRequiredError):
        enforce_not_consumer_assistant({"Sec-Fetch-Mode": "navigate"})

    with pytest.raises(HarnessRequiredError):
        enforce_not_consumer_assistant({"Cookie": "session=abc"})

    # Configure requires explicit matching X-Herma-Harness header:
    with pytest.raises(HarnessRequiredError):
        require_scope(principal, "configure", {"X-Herma-Key": raw_key})

    with pytest.raises(HarnessRequiredError):
        require_scope(
            principal,
            "configure",
            {"X-Herma-Key": raw_key, "X-Herma-Harness": "opencode"},
        )

    require_scope(
        principal,
        "configure",
        {"X-Herma-Key": raw_key, "X-Herma-Harness": "muse-code"},
    )


def test_route_only_key_cannot_configure(tmp_path: Path) -> None:
    store = ProvisionStore(tmp_path / "herma.db")
    route_key, _ = store.issue_key(
        label="worker-01",
        harness_kind="swarm-worker",
        scopes=["route"],
    )
    principal = store.authenticate_headers({"X-Herma-Key": route_key})
    with pytest.raises(HarnessScopeError):
        require_scope(
            principal,
            "configure",
            {"X-Herma-Key": route_key, "X-Herma-Harness": "swarm-worker"},
        )


def test_cas_conflict_and_tessera_blob_sync(tmp_path: Path) -> None:
    h_store = ProvisionStore(tmp_path / "herma.db")
    prov = _sample_provision()
    v1 = h_store.put_provision(prov, expected_version=None, check_cas=True)
    assert v1.version == 1

    with pytest.raises(ProvisionConflictError):
        h_store.put_provision(prov, expected_version=None, check_cas=True)

    v2 = h_store.put_provision(prov, expected_version=1, check_cas=True)
    assert v2.version == 2

    # Publish into Tessera with a content-addressed blob URI and sync into a fresh Herma store:
    t_store = TesseraStore(tmp_path / "tessera.db")
    blob_sha = t_store.put_blob(b"Authoritative excerpt resolved from content-addressed blob.")
    with_blob = prov.model_copy(
        update={
            "uris": [
                *prov.uris,
                ProvisionURI(
                    uri=f"tessera://blobs/{blob_sha}",
                    label="Blob Reference",
                    kind="store_record",
                ),
            ]
        }
    )
    h_store.put_provision(with_blob, check_cas=False)
    published = h_store.publish_to_tessera_store(t_store)
    assert published == ["PROV-SAMPLE-01"]

    fresh = ProvisionStore(tmp_path / "fresh.db")
    synced = fresh.sync_from_tessera_store(t_store)
    assert len(synced) == 1
    blob_uri = synced[0].provision.uris[1]
    assert "Authoritative excerpt resolved" in blob_uri.inline_excerpt


@pytest.mark.anyio
async def test_remote_handshake_clamps_max_chars(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen_headers: list[dict[str, str]] = []
    prov_dict = _sample_provision(max_chars=5000).model_dump(mode="json")

    def _handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(dict(request.headers))
        if request.url.path == "/v1/handshake":
            return httpx.Response(200, json={"protocol_version": "1.0", "clamped_max_chars": 900})
        if request.url.path == "/v1/provisions":
            return httpx.Response(200, json={"provisions": [prov_dict]})
        return httpx.Response(404)

    transport = httpx.MockTransport(_handler)
    orig_init = httpx.AsyncClient.__init__

    def _patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = transport
        orig_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    store = ProvisionStore(tmp_path / "remote.db")
    synced = await store.sync_from_remote_handshake(
        "https://provisions.example.org",
        surface_header="X-Surface-Id",
        surface_id="herma-edge",
    )
    assert len(synced) == 1
    assert synced[0].provision.max_chars == 900
    assert seen_headers[0].get("x-surface-id") == "herma-edge"
