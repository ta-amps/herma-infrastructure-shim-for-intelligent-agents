"""Tests for atomic noun/verb context database, context_refs shimming, and direct responses."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from tessera.store import Store as TesseraStore

from herma.api.app import create_app, seed_examples_if_present
from herma.schemas import (
    ContextEntry,
    InjectionReceipt,
    KeywordTrigger,
    Provision,
    TriggerSpec,
)
from herma.store import ProvisionStore

REPO_ROOT = Path(__file__).resolve().parents[1]
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


def test_provision_and_context_entry_schema_validation() -> None:
    # Backwards-compatible defaults on Provision:
    shim_prov = Provision(
        prov_id="PROV-DEFAULT-SHIM",
        title="Default Shim Action",
        summary="Backwards-compatible defaults keep action='shim_context'.",
        inject_text="Always verify compare-and-set expected_version on writes.",
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["expected_version"])),
    )
    assert shim_prov.action == "shim_context"
    assert shim_prov.direct_response is None
    assert shim_prov.context_refs == []

    # action='respond_directly' requires non-empty direct_response:
    with pytest.raises(ValidationError):
        Provision(
            prov_id="PROV-BAD-DIRECT",
            title="Missing Direct Text",
            summary="Should fail validation when direct_response is empty.",
            action="respond_directly",
            direct_response="   ",
            triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["schema"])),
        )

    direct_prov = Provision(
        prov_id="PROV-OK-DIRECT",
        title="Deterministic Direct Reply",
        summary="Answers canonical lookup without calling upstream LLM.",
        action="respond_directly",
        direct_response="Use `uv run make check` before committing.",
        context_refs=["noun:tessera.fencing", "verb:tessera.claim", "noun:tessera.fencing"],
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["check recipe"])),
    )
    assert direct_prov.context_refs == ["noun:tessera.fencing", "verb:tessera.claim"]

    # ContextEntry validates schemes and populates ISO timestamp:
    entry = ContextEntry(
        entry_id="noun:eranos.kit_boundary",
        kind="noun",
        title="Eranos Human-Only Kit Boundary",
        summary="Marks crisis safety planning and survivor intake as strictly human_only.",
        schema_or_body={"human_only": ["crisis_intake", "outbound_send"]},
        source_uri="https://eranos.ta-amps.workers.dev",
    )
    assert entry.updated_at
    with pytest.raises(ValidationError):
        ContextEntry(
            entry_id="noun:bad.uri",
            kind="noun",
            title="Bad URI Scheme",
            summary="Rejects non-allowlisted URI scheme.",
            source_uri="ftp://example.org/file",
        )

    # Backwards-compatible defaults on InjectionReceipt:
    legacy_rcpt = InjectionReceipt.model_validate(
        {
            "receipt_id": "rcpt_legacy",
            "receipt_sha256": "a" * 64,
            "harness_kind": "opencode",
            "key_id": "k1",
            "wire_format": "chat_completions",
            "model": "muse-spark-open",
            "provisions_fired": ["PROV-DEFAULT-SHIM@v1"],
            "tiers_matched": ["keyword"],
            "uris_injected": [],
            "injected_chars": 42,
            "deduped_skipped": [],
            "created_at": 1700000000.0,
        }
    )
    assert legacy_rcpt.responded_directly is False
    assert legacy_rcpt.direct_response_text is None
    assert legacy_rcpt.shimmed_context_refs == []


@pytest.mark.anyio
async def test_store_context_entries_and_tessera_noun_verb_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ProvisionStore(tmp_path / "herma.db")
    store.upsert_context_entry(
        ContextEntry(
            entry_id="noun:local.keep",
            kind="noun",
            title="Local Only Noun",
            summary="Remains available from context_entries when absent from Tessera.",
            schema_or_body={"field": "value"},
        )
    )
    store.upsert_context_entry(
        ContextEntry(
            entry_id="verb:local.exec",
            kind="verb",
            title="Local Verb",
            summary="Executes bounded local check.",
        )
    )
    assert [e.entry_id for e in store.list_context_entries(kind="noun")] == ["noun:local.keep"]
    assert [e.entry_id for e in store.list_context_entries(prefix="verb:")] == ["verb:local.exec"]
    assert [
        e.entry_id
        for e in store.get_context_entries(["verb:local.exec", "missing:id", "noun:local.keep"])
    ] == ["verb:local.exec", "noun:local.keep"]

    # 1. Resolve noun:<store>/<key> and verb:<store>/<key> from a local TesseraStore:
    t_store = TesseraStore(tmp_path / "tessera.db")
    t_store.put_record(
        "tessera.nouns",
        "fencing",
        {
            "title": "Tessera Fencing Noun",
            "summary": "Monotonic integer token attached to active task leases.",
            "schema_or_body": {"fence": "int"},
        },
        expected_version=None,
    )
    t_store.put_record(
        "tessera.verbs",
        "claim",
        {
            "title": "Tessera Claim Verb",
            "summary": "Claims highest-priority ready tile and increments fence.",
            "schema_or_body": {"returns": ["task_id", "fence"]},
        },
        expected_version=None,
    )
    prov = Provision(
        prov_id="PROV-TESSERA-REFS",
        title="Tessera Noun/Verb Ref Sync",
        summary="Resolves context_refs from Tessera noun/verb stores.",
        context_refs=[
            "noun:tessera.nouns/fencing",
            "verb:tessera.verbs/claim",
            "noun:local.keep",
        ],
        inject_text="Use atomic fencing nouns and claim verbs on shared queues.",
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["fencing"])),
    )
    t_store.put_record(
        "herma.provisions",
        prov.prov_id,
        prov.model_dump(mode="json"),
        expected_version=None,
    )
    t_store.put_record(
        "herma.provisions",
        "index",
        {"prov_ids": [prov.prov_id]},
        expected_version=None,
    )

    store.sync_from_tessera_store(t_store)
    resolved = store.get_context_entries(
        ["noun:tessera.nouns/fencing", "verb:tessera.verbs/claim", "noun:local.keep"]
    )
    assert [e.entry_id for e in resolved] == [
        "noun:tessera.nouns/fencing",
        "verb:tessera.verbs/claim",
        "noun:local.keep",
    ]
    assert resolved[0].source_uri == "tessera://stores/tessera.nouns/fencing"
    assert resolved[1].kind == "verb"

    # 2. Resolve noun:<store>/<key> and verb:<store>/<key> over HTTP via sync_from_tessera_http:
    def _http_handler(request: httpx.Request) -> httpx.Response:
        p = request.url.path
        if p == "/v1/stores/herma.provisions.context/records/index":
            return httpx.Response(404)
        if p == "/v1/stores/herma.provisions/records/index":
            return httpx.Response(200, json={"value": {"prov_ids": [prov.prov_id]}})
        if p == f"/v1/stores/herma.provisions/records/{prov.prov_id}":
            return httpx.Response(200, json={"value": prov.model_dump(mode="json")})
        if p == "/v1/stores/tessera.nouns/records/fencing":
            return httpx.Response(
                200,
                json={
                    "value": {
                        "title": "HTTP Fencing Noun",
                        "summary": "Synced over HTTP from Tessera noun store.",
                        "schema_or_body": {"fence": "int"},
                    }
                },
            )
        if p == "/v1/stores/tessera.verbs/records/claim":
            return httpx.Response(
                200,
                json={
                    "value": {
                        "title": "HTTP Claim Verb",
                        "summary": "Synced over HTTP from Tessera verb store.",
                        "schema_or_body": {"verb": "claim"},
                    }
                },
            )
        return httpx.Response(404)

    transport = httpx.MockTransport(_http_handler)
    orig_init = httpx.AsyncClient.__init__

    def _patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = transport
        orig_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    http_store = ProvisionStore(tmp_path / "http_sync.db")
    synced_http = await http_store.sync_from_tessera_http(
        "https://tessera.ta-amps.workers.dev", "bearer-test"
    )
    assert len(synced_http) == 1
    http_entries = http_store.get_context_entries(
        ["noun:tessera.nouns/fencing", "verb:tessera.verbs/claim"]
    )
    assert [e.title for e in http_entries] == ["HTTP Fencing Noun", "HTTP Claim Verb"]


def test_api_context_database_and_noun_verb_shimming(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "context_api.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)

    store = ProvisionStore(db_file)
    cfg_key, _ = store.issue_key(
        label="cfg-opencode",
        harness_kind="opencode",
        scopes=["route", "configure"],
    )
    route_only_key, _ = store.issue_key(
        label="route-only",
        harness_kind="opencode",
        scopes=["route"],
    )

    client = TestClient(create_app())
    cfg_headers = {"X-Herma-Key": cfg_key, "X-Herma-Harness": "opencode"}

    # GET on write-only endpoints returns 405:
    assert client.get("/v1/dry-run", headers=cfg_headers).status_code == 405
    assert client.get("/v1/chat/completions", headers=cfg_headers).status_code == 405
    assert client.get("/v1/sync/tessera", headers=cfg_headers).status_code == 405

    # Route-only key cannot access GET/POST /v1/context (configure scope required):
    r_denied = client.post(
        "/v1/context",
        headers={"X-Herma-Key": route_only_key, "X-Herma-Harness": "opencode"},
        json={
            "entry_id": "noun:denied",
            "kind": "noun",
            "title": "Denied",
            "summary": "Route-only keys cannot mutate context database.",
        },
    )
    assert r_denied.status_code == 403

    # Populate single + batch noun/verb/detail entries via POST /v1/context:
    r_single = client.post(
        "/v1/context",
        headers=cfg_headers,
        json={
            "entry_id": "noun:eranos.kit_boundary",
            "kind": "noun",
            "title": "Eranos NGO Kit Boundary",
            "summary": "Enforces human_only crisis decisions and drafter != reviewer.",
            "schema_or_body": {"human_only": True, "independent_review": True},
            "source_uri": "https://eranos.ta-amps.workers.dev",
        },
    )
    assert r_single.status_code == 200
    assert r_single.json()["entry"]["entry_id"] == "noun:eranos.kit_boundary"

    r_batch = client.post(
        "/v1/context",
        headers=cfg_headers,
        json={
            "entries": [
                {
                    "entry_id": "verb:tessera.claim",
                    "kind": "verb",
                    "title": "Tessera Claim Verb",
                    "summary": "Atomically leases ready work item with monotonic fence.",
                    "schema_or_body": {"inputs": ["queue", "worker_id"]},
                    "source_uri": "mcp://tessera/tools/claim",
                },
                {
                    "entry_id": "detail:tessera.lease_ttl",
                    "kind": "detail",
                    "title": "Lease Heartbeat Window",
                    "summary": "Workers heartbeat before lease_seconds expires.",
                    "schema_or_body": "Default lease_seconds=60; renew at 50% TTL.",
                },
            ]
        },
    )
    assert r_batch.status_code == 200
    assert r_batch.json()["count"] == 2

    # Query GET /v1/context with kind & prefix filters:
    r_list_nouns = client.get("/v1/context?kind=noun", headers=cfg_headers)
    assert r_list_nouns.status_code == 200
    assert [e["entry_id"] for e in r_list_nouns.json()["entries"]] == ["noun:eranos.kit_boundary"]

    r_list_verbs = client.get("/v1/context?prefix=verb:", headers=cfg_headers)
    assert r_list_verbs.status_code == 200
    assert [e["entry_id"] for e in r_list_verbs.json()["entries"]] == ["verb:tessera.claim"]

    # Configure a provision referencing those context_refs and verify [NOUN/VERB CONTEXT] shimming:
    r_put = client.put(
        "/v1/provisions/PROV-CONTEXT-SHIM",
        headers=cfg_headers,
        json={
            "prov_id": "PROV-CONTEXT-SHIM",
            "title": "Shim Atomic Noun & Verb Context",
            "summary": "Attaches matched noun/verb context entries into system prompt.",
            "action": "shim_context",
            "context_refs": ["noun:eranos.kit_boundary", "verb:tessera.claim"],
            "inject_text": "Respect kit autonomy boundaries when claiming volunteer review tasks.",
            "triggers": {"mode": "any", "keyword": {"any_keywords": ["volunteer kit claim"]}},
        },
    )
    assert r_put.status_code == 200

    r_dry = client.post(
        "/v1/dry-run",
        headers=cfg_headers,
        json={
            "wire_format": "chat_completions",
            "payload": {
                "model": "muse-spark-open",
                "messages": [{"role": "user", "content": "Implement volunteer kit claim handler"}],
            },
        },
    )
    assert r_dry.status_code == 200
    dry_body = r_dry.json()
    assert dry_body["responded_directly"] is False
    assert dry_body["shimmed_context_refs"] == ["noun:eranos.kit_boundary", "verb:tessera.claim"]
    assert dry_body["receipt"]["shimmed_context_refs"] == [
        "noun:eranos.kit_boundary",
        "verb:tessera.claim",
    ]
    shimmed_sys = dry_body["augmented_payload"]["messages"][0]["content"]
    assert "[NOUN/VERB CONTEXT]" in shimmed_sys
    assert "[NOUN] noun:eranos.kit_boundary" in shimmed_sys
    assert "[VERB] verb:tessera.claim" in shimmed_sys


def test_direct_response_short_circuits_upstream_across_all_protocols(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "direct_api.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)

    upstream_calls = 0

    async def _forbid_upstream(*_args: Any, **_kwargs: Any) -> Any:
        nonlocal upstream_calls
        upstream_calls += 1
        raise AssertionError("Upstream LLM transport must NOT be called for respond_directly!")

    monkeypatch.setattr(httpx.AsyncClient, "post", _forbid_upstream)
    monkeypatch.setattr(httpx.AsyncClient, "send", _forbid_upstream)

    store = ProvisionStore(db_file)
    seed_examples_if_present(store)
    token, _ = store.issue_key(
        label="direct-tester",
        harness_kind="claude-code",
        scopes=["route", "configure"],
    )
    headers = {"X-Herma-Key": token, "X-Herma-Harness": "claude-code"}
    client = TestClient(create_app())

    # Add a deterministic zero-ref direct rule + verify the seeded context-ref direct rule:
    r_put = client.put(
        "/v1/provisions/PROV-DIRECT-CHECK-CMD",
        headers=headers,
        json={
            "prov_id": "PROV-DIRECT-CHECK-CMD",
            "title": "Canonical Verification Command",
            "summary": "Answers verification recipe directly without upstream LLM tokens.",
            "priority": 400,
            "action": "respond_directly",
            "direct_response": "Run `make check && make demo` before committing.",
            "dedupe_mode": "every_turn",
            "triggers": {
                "mode": "any",
                "keyword": {"any_keywords": ["/herma-verify-cmd"]},
            },
        },
    )
    assert r_put.status_code == 200

    # 1. /v1/chat/completions (OpenAI chat.completion)
    r_chat = client.post(
        "/v1/chat/completions",
        headers=headers,
        json={
            "model": "muse-spark-open",
            "messages": [{"role": "user", "content": "What is /herma-verify-cmd?"}],
        },
    )
    assert r_chat.status_code == 200
    assert r_chat.headers["x-herma-direct-response"] == "true"
    assert HEX64_RE.match(r_chat.headers["x-herma-receipt-sha256"])
    chat_body = r_chat.json()
    assert chat_body["object"] == "chat.completion"
    assert (
        chat_body["choices"][0]["message"]["content"]
        == "Run `make check && make demo` before committing."
    )
    assert chat_body["usage"] == {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    # 2. /v1/responses (Responses API with seeded PROV-DIRECT-NOUN-VERB-SCHEMA + context_refs!)
    r_resp = client.post(
        "/v1/responses",
        headers=headers,
        json={
            "model": "muse-spark-1.3",
            "input": "Show the canonical noun/verb schema",
        },
    )
    assert r_resp.status_code == 200
    assert r_resp.headers["x-herma-direct-response"] == "true"
    assert HEX64_RE.match(r_resp.headers["x-herma-receipt-sha256"])
    resp_body = r_resp.json()
    assert "Canonical Herma + Tessera Noun/Verb Contract" in resp_body["output_text"]
    assert "[NOUN] noun:tessera.lease_fence" in resp_body["output_text"]
    assert "[VERB] verb:tessera.claim" in resp_body["output_text"]
    assert resp_body["output"][0]["content"][0]["text"] == resp_body["output_text"]

    # 3. /v1/messages (Anthropic Messages API)
    r_msg = client.post(
        "/v1/messages",
        headers=headers,
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 256,
            "messages": [{"role": "user", "content": "Please run /herma-verify-cmd"}],
        },
    )
    assert r_msg.status_code == 200
    assert r_msg.headers["x-herma-direct-response"] == "true"
    assert HEX64_RE.match(r_msg.headers["x-herma-receipt-sha256"])
    msg_body = r_msg.json()
    assert msg_body["type"] == "message"
    assert msg_body["content"] == [
        {"type": "text", "text": "Run `make check && make demo` before committing."}
    ]

    # Upstream LLM transport was NEVER invoked:
    assert upstream_calls == 0

    # All 3 SHA-256 receipts were recorded in SQLite:
    r_rcpts = client.get("/v1/receipts?limit=10", headers=headers)
    assert r_rcpts.status_code == 200
    rcpts = r_rcpts.json()["receipts"]
    assert len(rcpts) == 3
    assert all(r["responded_directly"] is True for r in rcpts)
    recorded_shas = {r["receipt_sha256"] for r in rcpts}
    assert r_chat.headers["x-herma-receipt-sha256"] in recorded_shas
    assert r_resp.headers["x-herma-receipt-sha256"] in recorded_shas
    assert r_msg.headers["x-herma-receipt-sha256"] in recorded_shas


def test_cloudflare_worker_context_shim_and_direct_response_parity() -> None:
    worker_url = (REPO_ROOT / "deploy" / "cloudflare" / "worker.js").as_uri()
    script = """
const { default: worker } = await import(process.env.WORKER_URL);

class MockStmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql.trim();
    this.args = args;
  }
  bind(...args) {
    return new MockStmt(this.db, this.sql, args);
  }
  async run() {
    this.db.exec(this.sql, this.args);
    return { success: true };
  }
  async first() {
    const rows = this.db.query(this.sql, this.args);
    return rows[0] ?? null;
  }
  async all() {
    return { results: this.db.query(this.sql, this.args) };
  }
}

class MockD1 {
  constructor() {
    this.provisions = new Map();
    this.context_entries = new Map();
    this.harness_keys = new Map();
    this.injection_receipts = [];
    this.createdContextTable = false;
  }
  prepare(sql) {
    return new MockStmt(this, sql);
  }
  async batch(stmts) {
    for (const s of stmts) await s.run();
    return [];
  }
  exec(sql, args) {
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS context_entries")) {
      this.createdContextTable = true;
      return;
    }
    if (sql.includes("INTO context_entries")) {
      const [entry_id, kind, title, summary, body_json, updated_at] = args;
      if (sql.includes("INSERT OR IGNORE") && this.context_entries.has(entry_id)) return;
      this.context_entries.set(entry_id, { entry_id, kind, title, summary, body_json, updated_at });
      return;
    }
    if (sql.includes("INTO provisions")) {
      if (sql.includes("INSERT OR IGNORE")) {
        const [prov_id, content_sha256, body_json, updated_at] = args;
        if (!this.provisions.has(prov_id)) {
          this.provisions.set(prov_id, { prov_id, version: 1, content_sha256, source_store: "examples", body_json, updated_at });
        }
      } else {
        const [prov_id, version, content_sha256, source_store, body_json, updated_at] = args;
        this.provisions.set(prov_id, { prov_id, version, content_sha256, source_store, body_json, updated_at });
      }
      return;
    }
    if (sql.startsWith("UPDATE provisions SET content_sha256")) {
      const [content_sha256, body_json, updated_at] = args;
      const cur = this.provisions.get("PROV-TESSERA-FENCING");
      if (cur) this.provisions.set("PROV-TESSERA-FENCING", { ...cur, content_sha256, body_json, updated_at });
      return;
    }
    if (sql.includes("INTO harness_keys")) {
      const [key_id, label, harness_kind, scopes_json, secret_sha256, created_at] = args;
      this.harness_keys.set(key_id, { key_id, label, harness_kind, scopes_json, secret_sha256, created_at, revoked_at: null });
      return;
    }
    if (sql.includes("INTO injection_receipts")) {
      const [receipt_id, receipt_sha256, conversation_id, harness_kind, protocol, model, matched_provisions, injected_uris, body_json, created_at] = args;
      this.injection_receipts.push({ receipt_id, receipt_sha256, conversation_id, harness_kind, protocol, model, matched_provisions, injected_uris, body_json, created_at });
      return;
    }
  }
  query(sql, args) {
    if (sql.includes("COUNT(*) AS n FROM context_entries")) return [{ n: this.context_entries.size }];
    if (sql.includes("COUNT(*) AS n FROM provisions")) return [{ n: this.provisions.size }];
    if (sql.includes("FROM harness_keys WHERE key_id = ?")) {
      const k = this.harness_keys.get(args[0]);
      return k ? [k] : [];
    }
    if (sql.includes("FROM provisions WHERE prov_id = 'PROV-TESSERA-FENCING'")) {
      const p = this.provisions.get("PROV-TESSERA-FENCING");
      return p ? [p] : [];
    }
    if (sql.includes("FROM provisions WHERE prov_id = ?")) {
      const p = this.provisions.get(args[0]);
      return p ? [p] : [];
    }
    if (sql.includes("FROM provisions")) return [...this.provisions.values()];
    if (sql.includes("FROM context_entries WHERE entry_id IN")) {
      return args.map((id) => this.context_entries.get(id)).filter(Boolean);
    }
    if (sql.includes("FROM context_entries WHERE kind = ?")) {
      return [...this.context_entries.values()].filter((e) => e.kind === args[0]);
    }
    if (sql.includes("FROM context_entries")) return [...this.context_entries.values()];
    if (sql.includes("FROM injection_receipts")) return [...this.injection_receipts].reverse().slice(0, args[0] || 25);
    return [];
  }
}

const db = new MockD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-test-secret" };

// 1. Issue configure+route key:
const kResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-test-secret" },
  body: JSON.stringify({ label: "cf-test", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env);
const kJson = await kResp.json();
const hdrs = { "content-type": "application/json", "x-herma-key": kJson.key, "x-herma-harness": "opencode" };

// 2. GET on write-only endpoint returns 405:
const badMethod = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", { method: "GET", headers: hdrs }), env);
if (badMethod.status !== 405) throw new Error("Expected 405, got " + badMethod.status);

// 3. POST /v1/context & GET /v1/context:
const cPost = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/context", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({
    entry_id: "noun:custom.contract",
    kind: "noun",
    title: "Custom Contract Noun",
    summary: "Stored in D1 context_entries.",
    schema_or_body: { version: 1 },
  }),
}), env);
if (cPost.status !== 200) throw new Error("POST /v1/context failed: " + cPost.status);
const cGet = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/context?kind=noun", { method: "GET", headers: hdrs }), env);
const cGetJson = await cGet.json();

// 4. Dry-run context_refs shimming:
const dryResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({
    wire_format: "chat_completions",
    payload: { model: "muse-spark-open", messages: [{ role: "user", content: "Check Tessera fencing tokens" }] },
  }),
}), env);
const dryJson = await dryResp.json();

// 5. Direct response across chat_completions, responses, and messages (with NO UPSTREAM_LLM_URL configured!):
const dChat = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/chat/completions", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({ model: "muse-spark-open", messages: [{ role: "user", content: "Show canonical noun/verb schema" }] }),
}), env);
const dResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/responses", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({ model: "muse-spark-1.3", input: "/herma-schema" }),
}), env);
const dMsg = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/messages", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 128, messages: [{ role: "user", content: "herma direct schema" }] }),
}), env);

const homeResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/"), env);
const homeHtml = await homeResp.text();

console.log(JSON.stringify({
  createdContextTable: db.createdContextTable,
  nounsCount: cGetJson.count,
  shimmedRefs: dryJson.shimmed_context_refs,
  hasContextBlock: dryJson.augmented_payload.messages[0].content.includes("[NOUN/VERB CONTEXT]"),
  chatDirectHdr: dChat.headers.get("x-herma-direct-response"),
  chatReceiptSha: dChat.headers.get("x-herma-receipt-sha256"),
  chatBody: await dChat.json(),
  respBody: await dResp.json(),
  msgBody: await dMsg.json(),
  homeHasFraming: homeHtml.includes("context-shimming AI middleware for configurable coding harnesses"),
}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        env={**os.environ, "WORKER_URL": worker_url},
        capture_output=True,
        text=True,
        check=True,
    )
    out = json.loads(proc.stdout.strip())
    assert out["createdContextTable"] is True
    assert out["nounsCount"] >= 2
    assert "noun:tessera.lease_fence" in out["shimmedRefs"]
    assert "verb:tessera.claim" in out["shimmedRefs"]
    assert out["hasContextBlock"] is True
    assert out["chatDirectHdr"] == "true"
    assert HEX64_RE.match(out["chatReceiptSha"])
    assert out["chatBody"]["object"] == "chat.completion"
    assert out["chatBody"]["usage"]["total_tokens"] == 0
    assert "Canonical Herma + Tessera Noun/Verb Contract" in out["respBody"]["output_text"]
    assert out["respBody"]["output"][0]["content"][0]["text"] == out["respBody"]["output_text"]
    assert out["msgBody"]["content"][0]["type"] == "text"
    assert "Canonical Herma + Tessera Noun/Verb Contract" in out["msgBody"]["content"][0]["text"]
    assert out["homeHasFraming"] is True


@pytest.mark.anyio
async def test_herma_handshake_endpoint_and_peer_sync(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_upstream = tmp_path / "upstream.db"
    monkeypatch.setenv("HERMA_DB", str(db_upstream))
    upstream_store = ProvisionStore(db_upstream)
    seed_examples_if_present(upstream_store)
    raw_key, _ = upstream_store.issue_key(
        label="peer-sync",
        harness_kind="opencode",
        scopes=["route", "configure"],
    )
    app = create_app()
    with TestClient(app) as tc:
        # Consumer assistant refused on /v1/handshake
        r_consumer = tc.post(
            "/v1/handshake",
            headers={
                "X-Herma-Key": raw_key,
                "X-Herma-Harness": "opencode",
                "User-Agent": "Muse-Personal-Assistant/1.0",
            },
            json={"protocol_version": "1.0", "surface_id": "kothar"},
        )
        assert r_consumer.status_code == 403

        # Parameter clamping & surface_id header echo
        r_hs = tc.post(
            "/v1/handshake",
            headers={
                "X-Herma-Key": raw_key,
                "X-Herma-Harness": "opencode",
                "X-Surface-Id": "kothar",
            },
            json={
                "protocol_version": "1.0",
                "surface_id": "kothar",
                "requested_max_chars": 900_000,
            },
        )
        assert r_hs.status_code == 200
        assert r_hs.headers["x-surface-id"] == "kothar"
        assert HEX64_RE.match(r_hs.headers["x-handshake-id"])
        hs_json = r_hs.json()
        assert hs_json["backend"] == "herma"
        assert hs_json["clamped_max_chars"] == 16_000
        assert hs_json["transactional_db_exempt_from_middleware"] is True
        assert hs_json["active_provisions"] >= 1

        # Mismatched X-Surface-Id header vs body rejected with 400
        r_mismatch = tc.post(
            "/v1/handshake",
            headers={
                "X-Herma-Key": raw_key,
                "X-Herma-Harness": "opencode",
                "X-Surface-Id": "shamash",
            },
            json={"protocol_version": "1.0", "surface_id": "kothar"},
        )
        assert r_mismatch.status_code == 400

        # GET /v1/provisions?include_context=true returns StoredProvision + context_entries
        r_prov = tc.get(
            "/v1/provisions?include_context=true",
            headers={"X-Herma-Key": raw_key, "X-Herma-Harness": "opencode"},
        )
        assert r_prov.status_code == 200
        prov_bundle = r_prov.json()
        assert len(prov_bundle["provisions"]) >= 1
        assert len(prov_bundle["context_entries"]) >= 1

        # Peer Herma sync_from_remote_handshake unwraps StoredProvision & loads context_entries
        def _peer_handler(req: httpx.Request) -> httpx.Response:
            fwd_hdrs = {k: v for k, v in req.headers.items() if k.lower() != "host"}
            fwd_hdrs["X-Herma-Harness"] = "opencode"
            if req.method == "POST":
                resp = tc.post(
                    req.url.path,
                    headers=fwd_hdrs,
                    content=req.content,
                )
            else:
                q = f"?{req.url.query.decode()}" if req.url.query else ""
                resp = tc.get(f"{req.url.path}{q}", headers=fwd_hdrs)
            return httpx.Response(resp.status_code, json=resp.json(), headers=dict(resp.headers))

        transport = httpx.MockTransport(_peer_handler)
        orig_init = httpx.AsyncClient.__init__

        def _patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
            kwargs["transport"] = transport
            orig_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

        downstream = ProvisionStore(tmp_path / "downstream.db")
        synced = await downstream.sync_from_remote_handshake(
            "https://herma-peer.example.test",
            token=raw_key,
            surface_id="kothar",
            handshake_path="/v1/handshake",
            provisions_path="/v1/provisions?include_context=true",
        )
        assert len(synced) >= 1
        assert len(downstream.list_context_entries()) >= 1

    # Also verify Cloudflare Worker POST /v1/handshake in Node
    worker_url = (REPO_ROOT / "deploy" / "cloudflare" / "worker.js").as_uri()
    node_script = """
const { default: worker } = await import(process.env.WORKER_URL);
class S {
  constructor(db, sql, a=[]) { this.db=db; this.sql=sql.trim(); this.a=a; }
  bind(...a) { return new S(this.db, this.sql, a); }
  async run() { this.db.exec(this.sql, this.a); return { success: true }; }
  async first() { return this.db.q(this.sql, this.a)[0] ?? null; }
  async all() { return { results: this.db.q(this.sql, this.a) }; }
}
class D {
  constructor() { this.k=new Map(); this.p=new Map(); this.c=new Map(); }
  prepare(s) { return new S(this, s); }
  async batch(xs) { for (const x of xs) await x.run(); return []; }
  exec(s, a) {
    if (s.includes("INTO harness_keys")) this.k.set(a[0], { key_id:a[0], label:a[1], harness_kind:a[2], scopes_json:a[3], secret_sha256:a[4], created_at:a[5], revoked_at:null });
    if (s.includes("INTO provisions")) this.p.set(a[0], { prov_id:a[0], version:1, content_sha256:a[1], source_store:"ex", body_json:a[2], updated_at:a[3] });
    if (s.includes("INTO context_entries")) this.c.set(a[0], { entry_id:a[0], kind:a[1], title:a[2], summary:a[3], body_json:a[4], updated_at:a[5] });
  }
  q(s, a) {
    if (s.includes("COUNT(*) AS n FROM context_entries")) return [{ n: this.c.size }];
    if (s.includes("COUNT(*) AS n FROM provisions")) return [{ n: this.p.size }];
    if (s.includes("FROM harness_keys WHERE key_id = ?")) return this.k.has(a[0]) ? [this.k.get(a[0])] : [];
    if (s.includes("FROM provisions")) return [...this.p.values()];
    if (s.includes("FROM context_entries")) return [...this.c.values()];
    return [];
  }
}
const db = new D();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-hs" };
const kr = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-hs" },
  body: JSON.stringify({ label: "hs", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env);
const kj = await kr.json();
const hr = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/handshake", {
  method: "POST",
  headers: { "content-type": "application/json", "x-herma-key": kj.key, "x-herma-harness": "opencode", "x-surface-id": "kinema" },
  body: JSON.stringify({ protocol_version: "1.0", surface_id: "kinema", requested_max_chars: 999999 }),
}), env);
console.log(JSON.stringify({ status: hr.status, surfHdr: hr.headers.get("x-surface-id"), body: await hr.json() }));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        cwd=REPO_ROOT,
        env={**os.environ, "WORKER_URL": worker_url},
        capture_output=True,
        text=True,
        check=True,
    )
    cf = json.loads(proc.stdout.strip())
    assert cf["status"] == 200
    assert cf["surfHdr"] == "kinema"
    assert cf["body"]["clamped_max_chars"] == 16_000
    assert cf["body"]["backend"] == "herma"
