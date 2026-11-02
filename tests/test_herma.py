"""Tests for multi-caller isolation, CAS, governance lens, entity memory, insights, preview, and MCP parity."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from tessera.store import Store as TesseraStore

from herma.api.app import create_app, seed_examples_if_present
from herma.errors import (
    BuiltinProtectedError,
    ContextConflictError,
    ContributorTierRefusedError,
    HermaError,
)
from herma.memory import extract_entities
from herma.schemas import (
    ContextEntry,
    InjectionReceipt,
    KeywordTrigger,
    MicromodelTrigger,
    Provision,
    ProvisionURI,
    TriggerSpec,
)
from herma.store import ProvisionStore
from herma.triggers.micromodel import evaluate_micromodel_trigger

REPO_ROOT = Path(__file__).resolve().parents[1]
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")

NODE_SQLITE_D1_PRELUDE = """
import { DatabaseSync } from "node:sqlite";
const { default: worker } = await import(process.env.WORKER_URL);

class SqliteStmt {
  constructor(sqlite, sql, args = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new SqliteStmt(this.sqlite, this.sql, args);
  }
  async run() {
    const stmt = this.sqlite.prepare(this.sql);
    const res = stmt.run(...this.args);
    return { success: true, meta: { changes: Number(res.changes ?? 0) } };
  }
  async first() {
    const stmt = this.sqlite.prepare(this.sql);
    const row = stmt.get(...this.args);
    return row ? { ...row } : null;
  }
  async all() {
    const stmt = this.sqlite.prepare(this.sql);
    const rows = stmt.all(...this.args);
    return { results: rows.map((r) => ({ ...r })) };
  }
}

class SqliteD1 {
  constructor(initialSql = "") {
    this.sqlite = new DatabaseSync(":memory:");
    if (initialSql) this.sqlite.exec(initialSql);
  }
  prepare(sql) {
    return new SqliteStmt(this.sqlite, sql);
  }
  async batch(stmts) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
  hasTable(name) {
    const row = this.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    return Boolean(row);
  }
}
"""


def _run_worker_node_script(body_js: str) -> dict[str, Any]:
    worker_url = (REPO_ROOT / "deploy" / "cloudflare" / "worker.js").as_uri()
    proc = subprocess.run(
        [
            "node",
            "--no-warnings",
            "--input-type=module",
            "-e",
            NODE_SQLITE_D1_PRELUDE + "\n" + body_js,
        ],
        cwd=REPO_ROOT,
        env={**os.environ, "WORKER_URL": worker_url},
        capture_output=True,
        text=True,
        check=True,
    )
    return dict(json.loads(proc.stdout.strip()))


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

    # ContextEntry validates schemes and populates ISO timestamp + version:
    entry = ContextEntry(
        entry_id="noun:eranos.kit_boundary",
        kind="noun",
        title="Eranos Human-Only Kit Boundary",
        summary="Marks crisis safety planning and survivor intake as strictly human_only.",
        schema_or_body={"human_only": ["crisis_intake", "outbound_send"]},
        source_uri="https://eranos.ta-amps.workers.dev",
    )
    assert entry.updated_at
    assert entry.version == 1
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
            "model": "muse-spark-1.3",
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
    assert legacy_rcpt.project_tag == "default"
    assert legacy_rcpt.entities_tracked == 0


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
    assert [e.entry_id for e in resolved] == ["noun:local.keep"]
    # Local records without canonical governance cannot cross the fabric import boundary.

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

    def governed_fixture(request: httpx.Request) -> httpx.Response:
        response = _http_handler(request)
        if response.status_code != 200 or "application/json" not in response.headers.get(
            "content-type", ""
        ):
            return response
        body = response.json()
        if "value" in body:
            body = {
                "namespace": "main",
                "producer_surface": "surface:tessera",
                "visibility_scope": "public_commons",
                "allowed_surfaces": [],
                "target_cohorts": ["all"],
                "tags": ["status:verified"],
                **body,
            }
        return httpx.Response(response.status_code, json=body)

    transport = httpx.MockTransport(governed_fixture)
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
                "model": "muse-spark-1.3",
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
            "model": "muse-spark-1.3",
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

    # 2. /v1/responses (Responses API with seeded PROV-DIRECT-NOUN-VERB-SCHEMA + context_refs)
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
    assert (
        "Canonical Herma + Tessera Contract -- Tasks and Task Objects" in resp_body["output_text"]
    )
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

    assert upstream_calls == 0

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
    out = _run_worker_node_script(
        """
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-test-secret" };

const kResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-test-secret" },
  body: JSON.stringify({ label: "cf-test", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env);
const kJson = await kResp.json();
const hdrs = { "content-type": "application/json", "x-herma-key": kJson.key, "x-herma-harness": "opencode" };

const badMethod = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", { method: "GET", headers: hdrs }), env);
if (badMethod.status !== 405) throw new Error("Expected 405, got " + badMethod.status);

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

const dryResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({
    wire_format: "chat_completions",
    payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "Check Tessera fencing tokens" }] },
  }),
}), env);
const dryJson = await dryResp.json();

const dChat = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/chat/completions", {
  method: "POST",
  headers: hdrs,
  body: JSON.stringify({ model: "muse-spark-1.3", messages: [{ role: "user", content: "Show canonical noun/verb schema" }] }),
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
  createdContextTable: db.hasTable("context_entries"),
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
    )
    assert out["createdContextTable"] is True
    assert out["nounsCount"] >= 2
    assert "noun:tessera.lease_fence" in out["shimmedRefs"]
    assert "verb:tessera.claim" in out["shimmedRefs"]
    assert out["hasContextBlock"] is True
    assert out["chatDirectHdr"] == "true"
    assert HEX64_RE.match(out["chatReceiptSha"])
    assert out["chatBody"]["object"] == "chat.completion"
    assert out["chatBody"]["usage"]["total_tokens"] == 0
    assert (
        "Canonical Herma + Tessera Contract -- Tasks and Task Objects"
        in out["respBody"]["output_text"]
    )
    assert out["respBody"]["output"][0]["content"][0]["text"] == out["respBody"]["output_text"]
    assert out["msgBody"]["content"][0]["type"] == "text"
    assert (
        "Canonical Herma + Tessera Contract -- Tasks and Task Objects"
        in out["msgBody"]["content"][0]["text"]
    )
    assert out["homeHasFraming"] is True


@pytest.mark.anyio
async def test_herma_handshake_endpoint_and_peer_sync(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_upstream = tmp_path / "upstream.db"
    monkeypatch.setenv("HERMA_DB", str(db_upstream))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    upstream_store = ProvisionStore(db_upstream)
    seed_examples_if_present(upstream_store)
    raw_key, _ = upstream_store.issue_key(
        label="peer-sync",
        harness_kind="opencode",
        scopes=["route", "configure"],
    )
    app = create_app()
    with TestClient(app) as tc:
        r_consumer = tc.post(
            "/v1/handshake",
            headers={
                "X-Herma-Key": raw_key,
                "X-Herma-Harness": "opencode",
                "User-Agent": "Muse-Personal-Assistant/1.0",
            },
            json={"protocol_version": "1.0", "surface_id": "eranos"},
        )
        assert r_consumer.status_code == 200

        r_hs = tc.post(
            "/v1/handshake",
            headers={
                "X-Herma-Key": raw_key,
                "X-Herma-Harness": "opencode",
                "X-Surface-Id": "eranos",
            },
            json={
                "protocol_version": "1.0",
                "surface_id": "eranos",
                "requested_max_chars": 900_000,
            },
        )
        assert r_hs.status_code == 200
        assert r_hs.headers["x-surface-id"] == "eranos"
        assert HEX64_RE.match(r_hs.headers["x-handshake-id"])
        hs_json = r_hs.json()
        assert hs_json["backend"] == "herma"
        assert hs_json["clamped_max_chars"] == 16_000
        assert hs_json["transactional_db_exempt_from_middleware"] is True
        assert hs_json["active_provisions"] >= 1

        r_mismatch = tc.post(
            "/v1/handshake",
            headers={
                "X-Herma-Key": raw_key,
                "X-Herma-Harness": "opencode",
                "X-Surface-Id": "agora",
            },
            json={"protocol_version": "1.0", "surface_id": "eranos"},
        )
        assert r_mismatch.status_code == 400

        r_prov = tc.get(
            "/v1/provisions?include_context=true",
            headers={"X-Herma-Key": raw_key, "X-Herma-Harness": "opencode"},
        )
        assert r_prov.status_code == 200
        prov_bundle = r_prov.json()
        assert len(prov_bundle["provisions"]) >= 1
        assert len(prov_bundle["context_entries"]) >= 1

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
            surface_id="eranos",
            handshake_path="/v1/handshake",
            provisions_path="/v1/provisions?include_context=true",
        )
        assert synced == []
        assert downstream.list_context_entries() == []

    cf = _run_worker_node_script(
        """
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-hs" };
const kr = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-hs" },
  body: JSON.stringify({ label: "hs", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env);
const kj = await kr.json();
const hr = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/handshake", {
  method: "POST",
  headers: { "content-type": "application/json", "x-herma-key": kj.key, "x-herma-harness": "opencode", "x-surface-id": "agora" },
  body: JSON.stringify({ protocol_version: "1.0", surface_id: "agora", requested_max_chars: 999999 }),
}), env);
console.log(JSON.stringify({ status: hr.status, surfHdr: hr.headers.get("x-surface-id"), body: await hr.json() }));
"""
    )
    assert cf["status"] == 200
    assert cf["surfHdr"] == "agora"
    assert cf["body"]["clamped_max_chars"] == 16_000
    assert cf["body"]["backend"] == "herma"


def test_multi_caller_non_poisoning_builtin_lock_admin_keys_and_cas_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. Verify legacy single-PK SQLite migration to composite caller_scope PKs:
    legacy_db = tmp_path / "legacy_upgrade.db"
    with sqlite3.connect(legacy_db) as raw_conn:
        raw_conn.executescript(
            """
            CREATE TABLE provisions (
                prov_id TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                content_sha256 TEXT NOT NULL,
                source_store TEXT NOT NULL,
                body_json TEXT NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE context_entries (
                entry_id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                body_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO context_entries VALUES (
                'noun:legacy.item', 'noun', 'Legacy Noun', 'Upgraded safely to system_builtin.', '{}', '2026-10-27T00:00:00Z'
            );
            """
        )
    migrated_store = ProvisionStore(legacy_db)
    assert migrated_store.has_builtin_context_entry("noun:legacy.item") is True
    with pytest.raises(BuiltinProtectedError):
        migrated_store.upsert_context_entry(
            ContextEntry(
                entry_id="noun:legacy.item",
                kind="noun",
                title="Tamper",
                summary="Must be blocked for non-admin caller.",
            ),
            caller_scope="key:attacker",
            is_admin=False,
        )

    # 2. Verify Python FastAPI multi-caller non-poisoning, builtin 403, admin-key 403, and atomic CAS 409:
    db_file = tmp_path / "isolation.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.setenv("BOOTSTRAP_SECRET", "boot-admin-secret")
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)

    store = ProvisionStore(db_file)
    seed_examples_if_present(store)
    client = TestClient(create_app())

    # Mint Key A and Key B via admin secret:
    r_ka = client.post(
        "/v1/admin/keys",
        headers={"X-Bootstrap-Secret": "boot-admin-secret"},
        json={"label": "caller-a", "harness_kind": "opencode", "scopes": ["route", "configure"]},
    )
    r_kb = client.post(
        "/v1/admin/keys",
        headers={"X-Bootstrap-Secret": "boot-admin-secret"},
        json={"label": "caller-b", "harness_kind": "claude-code", "scopes": ["route", "configure"]},
    )
    assert r_ka.status_code == 201 and r_kb.status_code == 201
    key_a = r_ka.json()["key"]
    key_b = r_kb.json()["key"]
    hdr_a = {"X-Herma-Key": key_a, "X-Herma-Harness": "opencode"}
    hdr_b = {"X-Herma-Key": key_b, "X-Herma-Harness": "claude-code"}

    # Ordinary configure keys CANNOT mint or list /v1/admin/keys (403 admin_required):
    r_escalate_get = client.get("/v1/admin/keys", headers=hdr_a)
    r_escalate_post = client.post(
        "/v1/admin/keys",
        headers=hdr_a,
        json={"label": "rogue", "harness_kind": "opencode", "scopes": ["route", "configure"]},
    )
    assert r_escalate_get.status_code == 403
    assert r_escalate_get.json()["code"] == "admin_required"
    assert r_escalate_post.status_code == 403
    assert r_escalate_post.json()["code"] == "admin_required"

    # Non-admin attempts to overwrite or delete system_builtin provisions/contexts -> 403 builtin_protected:
    r_builtin_put = client.put(
        "/v1/provisions/PROV-TESSERA-FENCING",
        headers=hdr_a,
        json={
            "prov_id": "PROV-TESSERA-FENCING",
            "title": "Hijack Builtin",
            "summary": "Attempted hijack of builtin guardrail.",
            "action": "respond_directly",
            "direct_response": "HIJACKED",
            "triggers": {"mode": "any", "keyword": {"any_keywords": ["fencing"]}},
        },
    )
    assert r_builtin_put.status_code == 403
    assert r_builtin_put.json()["code"] == "builtin_protected"

    r_builtin_del = client.delete("/v1/provisions/PROV-TESSERA-FENCING", headers=hdr_a)
    assert r_builtin_del.status_code == 403
    assert r_builtin_del.json()["code"] == "builtin_protected"

    r_builtin_ctx = client.post(
        "/v1/context",
        headers=hdr_a,
        json={
            "entry_id": "noun:tessera.lease_fence",
            "kind": "noun",
            "title": "Hijacked Fence",
            "summary": "Attempted hijack of builtin context entry.",
        },
    )
    assert r_builtin_ctx.status_code == 403
    assert r_builtin_ctx.json()["code"] == "builtin_protected"

    # Deleting a non-existent custom provision returns 404:
    assert client.delete("/v1/provisions/PROV-MISSING-XYZ", headers=hdr_a).status_code == 404

    # Caller A installs a high-priority custom respond_directly rule + private context entry with atomic CAS:
    r_ctx_a1 = client.post(
        "/v1/context?check_cas=true",
        headers=hdr_a,
        json={
            "entry_id": "noun:caller_a.private_secret",
            "kind": "noun",
            "title": "Caller A Secret Contract",
            "summary": "Must never leak to Caller B or public overview.",
        },
    )
    assert r_ctx_a1.status_code == 200
    assert r_ctx_a1.json()["entry"]["version"] == 1

    # Atomic CAS conflict on duplicate create (expected_version=None with check_cas=true):
    r_ctx_conflict = client.post(
        "/v1/context?check_cas=true",
        headers=hdr_a,
        json={
            "entry_id": "noun:caller_a.private_secret",
            "kind": "noun",
            "title": "Duplicate Create",
            "summary": "Should return 409 version_conflict.",
        },
    )
    assert r_ctx_conflict.status_code == 409
    assert r_ctx_conflict.json()["code"] == "version_conflict"

    # Atomic CAS update with expected_version=1 succeeds -> version 2:
    r_ctx_a2 = client.post(
        "/v1/context?expected_version=1",
        headers=hdr_a,
        json={
            "entry_id": "noun:caller_a.private_secret",
            "kind": "noun",
            "title": "Caller A Secret Contract v2",
            "summary": "Updated atomically via expected_version=1.",
        },
    )
    assert r_ctx_a2.status_code == 200
    assert r_ctx_a2.json()["entry"]["version"] == 2

    poison_prov = {
        "prov_id": "PROV-CALLER-A-POISON",
        "title": "Caller A Private Direct Rule",
        "summary": "Short-circuits 'deploy production' only for Caller A.",
        "priority": 999,
        "action": "respond_directly",
        "direct_response": "CALLER_A_ONLY_INTERCEPT",
        "context_refs": ["noun:caller_a.private_secret"],
        "dedupe_mode": "every_turn",
        "triggers": {"mode": "any", "keyword": {"any_keywords": ["deploy production"]}},
    }
    r_prov_a1 = client.put(
        "/v1/provisions/PROV-CALLER-A-POISON?check_cas=true",
        headers=hdr_a,
        json=poison_prov,
    )
    assert r_prov_a1.status_code == 200 and r_prov_a1.json()["version"] == 1
    assert (
        client.put(
            "/v1/provisions/PROV-CALLER-A-POISON?expected_version=99",
            headers=hdr_a,
            json=poison_prov,
        ).status_code
        == 409
    )

    # Caller A triggers its custom rule:
    r_dry_a = client.post(
        "/v1/dry-run",
        headers=hdr_a,
        json={
            "wire_format": "chat_completions",
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "Please deploy production now"}],
            },
        },
    )
    assert r_dry_a.status_code == 200
    assert r_dry_a.json()["responded_directly"] is True
    assert "CALLER_A_ONLY_INTERCEPT" in r_dry_a.json()["direct_response_text"]
    assert "noun:caller_a.private_secret" in r_dry_a.json()["shimmed_context_refs"]

    # Caller B sends the EXACT SAME prompt -> ZERO poisoning from Caller A!
    r_dry_b = client.post(
        "/v1/dry-run",
        headers=hdr_b,
        json={
            "wire_format": "chat_completions",
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "Please deploy production now"}],
            },
        },
    )
    assert r_dry_b.status_code == 200
    assert r_dry_b.json()["responded_directly"] is False
    assert r_dry_b.json()["matches"] == []

    # Caller B cannot see Caller A's provisions, context entries, or receipts:
    b_prov_ids = {
        sp["provision"]["prov_id"]
        for sp in client.get("/v1/provisions", headers=hdr_b).json()["provisions"]
    }
    assert "PROV-CALLER-A-POISON" not in b_prov_ids
    b_ctx_ids = {e["entry_id"] for e in client.get("/v1/context", headers=hdr_b).json()["entries"]}
    assert "noun:caller_a.private_secret" not in b_ctx_ids
    b_rcpts = client.get("/v1/receipts", headers=hdr_b).json()["receipts"]
    assert len(b_rcpts) == 1
    assert all("PROV-CALLER-A-POISON@v1" not in r["provisions_fired"] for r in b_rcpts)

    # Public `/` and `POST /api/preview` NEVER leak Caller A's rule, context entry, or receipt:
    home_html = client.get("/").text
    assert "PROV-CALLER-A-POISON" not in home_html
    assert "noun:caller_a.private_secret" not in home_html
    assert "CALLER_A_ONLY_INTERCEPT" not in home_html
    r_pub_preview = client.post("/api/preview", json={"prompt": "Please deploy production now"})
    assert r_pub_preview.status_code == 200
    assert r_pub_preview.json()["matches"] == []

    # 3. Verify identical guarantees on Cloudflare Worker + SQLite D1 (including legacy table migration):
    cf = _run_worker_node_script(
        """
const legacySql = `
  CREATE TABLE provisions (prov_id TEXT PRIMARY KEY, version INTEGER NOT NULL, content_sha256 TEXT NOT NULL, source_store TEXT NOT NULL, body_json TEXT NOT NULL, updated_at REAL NOT NULL);
  CREATE TABLE context_entries (entry_id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body_json TEXT NOT NULL, updated_at TEXT NOT NULL);
  INSERT INTO context_entries VALUES ('noun:legacy.d1', 'noun', 'Legacy D1', 'Migrated to system_builtin.', '{}', '2026-10-27T00:00:00Z');
`;
const db = new SqliteD1(legacySql);
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "cf-boot-secret" };

const ka = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "cf-boot-secret" },
  body: JSON.stringify({ label: "a", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env)).json();
const kb = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "cf-boot-secret" },
  body: JSON.stringify({ label: "b", harness_kind: "claude-code", scopes: ["route", "configure"] }),
}), env)).json();

const ha = { "content-type": "application/json", "x-herma-key": ka.key, "x-herma-harness": "opencode" };
const hb = { "content-type": "application/json", "x-herma-key": kb.key, "x-herma-harness": "claude-code" };

const escGet = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", { headers: ha }), env);
const escPost = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST", headers: ha, body: JSON.stringify({ label: "x", harness_kind: "opencode" }),
}), env);

const builtinPut = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions/PROV-TESSERA-FENCING", {
  method: "PUT", headers: ha, body: JSON.stringify({
    prov_id: "PROV-TESSERA-FENCING", title: "Hijack", summary: "Hijack builtin.", action: "respond_directly", direct_response: "BAD",
    triggers: { mode: "any", keyword: { any_keywords: ["fencing"] } },
  }),
}), env);
const builtinDel = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions/PROV-TESSERA-FENCING", { method: "DELETE", headers: ha }), env);
const legacyCtxOverwrite = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/context", {
  method: "POST", headers: ha, body: JSON.stringify({ entry_id: "noun:legacy.d1", kind: "noun", title: "Tamper", summary: "Tamper migrated builtin." }),
}), env);
const missingDel = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions/PROV-NO-SUCH", { method: "DELETE", headers: ha }), env);

const c1 = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/context?check_cas=true", {
  method: "POST", headers: ha, body: JSON.stringify({ entry_id: "noun:cf.secret_a", kind: "noun", title: "Secret A", summary: "Caller A private noun." }),
}), env);
const cConflict = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/context?check_cas=true", {
  method: "POST", headers: ha, body: JSON.stringify({ entry_id: "noun:cf.secret_a", kind: "noun", title: "Secret A", summary: "Conflict." }),
}), env);
const c2 = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/context?expected_version=1", {
  method: "POST", headers: ha, body: JSON.stringify({ entry_id: "noun:cf.secret_a", kind: "noun", title: "Secret A v2", summary: "Updated v2." }),
}), env);

const pBody = {
  prov_id: "PROV-CF-POISON-A", title: "CF Caller A Rule", summary: "Private to Caller A.", priority: 999,
  action: "respond_directly", direct_response: "CF_A_PRIVATE", context_refs: ["noun:cf.secret_a"], dedupe_mode: "every_turn",
  triggers: { mode: "any", keyword: { any_keywords: ["deploy production"] } },
};
const p1 = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions/PROV-CF-POISON-A?check_cas=true", {
  method: "PUT", headers: ha, body: JSON.stringify(pBody),
}), env);
const pConflict = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions/PROV-CF-POISON-A?expected_version=9", {
  method: "PUT", headers: ha, body: JSON.stringify(pBody),
}), env);

const dryA = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: ha, body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "deploy production" }] } }),
}), env)).json();
const dryB = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: hb, body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "deploy production" }] } }),
}), env)).json();
const homeTxt = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/"), env)).text();

console.log(JSON.stringify({
  escGet: escGet.status,
  escPost: escPost.status,
  builtinPut: builtinPut.status,
  builtinDel: builtinDel.status,
  legacyCtxOverwrite: legacyCtxOverwrite.status,
  missingDel: missingDel.status,
  c1Ver: (await c1.json()).entry.version,
  cConflict: cConflict.status,
  c2Ver: (await c2.json()).entry.version,
  p1Ver: (await p1.json()).version,
  pConflict: pConflict.status,
  dryADirect: dryA.responded_directly,
  dryBDirect: dryB.responded_directly,
  dryBMatches: dryB.matches.length,
  homeLeaked: homeTxt.includes("PROV-CF-POISON-A") || homeTxt.includes("noun:cf.secret_a"),
}));
"""
    )
    assert cf["escGet"] == 403 and cf["escPost"] == 403
    assert cf["builtinPut"] == 403 and cf["builtinDel"] == 403
    assert cf["legacyCtxOverwrite"] == 403
    assert cf["missingDel"] == 404
    assert cf["c1Ver"] == 1 and cf["cConflict"] == 409 and cf["c2Ver"] == 2
    assert cf["p1Ver"] == 1 and cf["pConflict"] == 409
    assert cf["dryADirect"] is True
    assert cf["dryBDirect"] is False and cf["dryBMatches"] == 0
    assert cf["homeLeaked"] is False

    # Also verify store-level ContextConflictError directly:
    with pytest.raises(ContextConflictError):
        store.upsert_context_entry(
            ContextEntry(
                entry_id="noun:caller_a.private_secret",
                kind="noun",
                title="Stale Write",
                summary="Must raise ContextConflictError on stale expected_version.",
            ),
            caller_scope=f"key:{r_ka.json()['key_id']}",
            expected_version=1,
            check_cas=True,
        )


@pytest.mark.anyio
async def test_governance_lens_blob_sha256_integrity_and_contributor_offline_refusal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. Offline contributor model refusal (runs BEFORE offline fallback!):
    monkeypatch.delenv("HERMA_MICROMODEL_URL", raising=False)
    monkeypatch.setenv("HERMA_MICROMODEL_MODEL", "contributor")
    mm_spec = MicromodelTrigger(
        intent_question="Is this an NGO helpline request?",
        fallback_keywords=["helpline"],
    )
    with pytest.raises(ContributorTierRefusedError):
        await evaluate_micromodel_trigger(mm_spec, "Design a shelter helpline workflow")
    monkeypatch.setenv("HERMA_MICROMODEL_MODEL", "muse-spark-contributor")
    with pytest.raises(ContributorTierRefusedError):
        await evaluate_micromodel_trigger(mm_spec, "Design a shelter helpline workflow")
    monkeypatch.delenv("HERMA_MICROMODEL_MODEL", raising=False)

    # 2. Invalid blob_sha & corrupted blob SHA-256 mismatch refused during Tessera HTTP sync:
    valid_bytes = b"Verified immutable blob payload for Herma governance lens."
    valid_sha = hashlib.sha256(valid_bytes).hexdigest()
    tampered_bytes = b"TAMPERED BYTES THAT DO NOT MATCH EXPECTED SHA256"

    bad_sha_prov = Provision(
        prov_id="PROV-BAD-BLOB-SHA",
        title="Invalid Blob Digest",
        summary="Carries malformed blob digest.",
        inject_text="Never accept non-hex64 blob digests.",
        uris=[ProvisionURI(uri="tessera://blobs/not-a-valid-sha256", label="Bad", kind="doc")],
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["badblob"])),
    )
    corrupt_blob_prov = Provision(
        prov_id="PROV-CORRUPT-BLOB",
        title="Corrupt Blob Payload",
        summary="Carries valid sha256 whose server bytes were tampered.",
        inject_text="Verify sha256(bytes) == blob_sha before shimming.",
        uris=[ProvisionURI(uri=f"tessera://blobs/{valid_sha}", label="Tampered", kind="doc")],
        triggers=TriggerSpec(keyword=KeywordTrigger(any_keywords=["corruptblob"])),
    )

    mode = {"case": "bad_sha"}

    def _gov_handler(request: httpx.Request) -> httpx.Response:
        p = request.url.path
        if p == "/v1/stores/herma.provisions.context/records/index":
            return httpx.Response(
                200, json={"value": {"entry_ids": ["noun:quarantined", "noun:verified_ok"]}}
            )
        if p == "/v1/stores/herma.provisions.context/records/noun:quarantined":
            return httpx.Response(
                200,
                json={
                    "tags": ["status:quarantined", "status:verified"],
                    "visibility_scope": "public_commons",
                    "value": {
                        "entry_id": "noun:quarantined",
                        "kind": "noun",
                        "title": "Quarantined Noun",
                        "summary": "Must never be ingested by Herma.",
                    },
                },
            )
        if p == "/v1/stores/herma.provisions.context/records/noun:verified_ok":
            return httpx.Response(
                200,
                json={
                    "tags": ["status:verified"],
                    "producer_surface": "surface:eranos",
                    "visibility_scope": "allowlist_surfaces",
                    "allowed_surfaces": ["surface:herma"],
                    "value": {
                        "entry_id": "noun:verified_ok",
                        "kind": "noun",
                        "title": "Verified Cross-Surface Noun",
                        "summary": "Explicitly verified and allowlisted for surface:herma.",
                    },
                },
            )
        if p == "/v1/stores/herma.provisions/records/index":
            if mode["case"] == "bad_sha":
                return httpx.Response(200, json={"value": {"prov_ids": ["PROV-BAD-BLOB-SHA"]}})
            if mode["case"] == "corrupt_blob":
                return httpx.Response(200, json={"value": {"prov_ids": ["PROV-CORRUPT-BLOB"]}})
            return httpx.Response(
                200,
                json={
                    "value": {
                        "prov_ids": [
                            "PROV-QUARANTINED",
                            "PROV-UNVERIFIED-EXT",
                            "PROV-WRONG-SURFACE",
                            "PROV-VERIFIED-COHORT",
                            "PROV-VERIFIED-PUBLIC",
                        ]
                    }
                },
            )
        if p == "/v1/stores/herma.provisions/records/PROV-BAD-BLOB-SHA":
            return httpx.Response(200, json={"value": bad_sha_prov.model_dump(mode="json")})
        if p == "/v1/stores/herma.provisions/records/PROV-CORRUPT-BLOB":
            return httpx.Response(200, json={"value": corrupt_blob_prov.model_dump(mode="json")})
        if p == f"/v1/blobs/{valid_sha}":
            return httpx.Response(
                200,
                content=tampered_bytes if mode["case"] == "corrupt_blob" else valid_bytes,
            )
        if p == "/v1/stores/herma.provisions/records/PROV-QUARANTINED":
            return httpx.Response(
                200,
                json={
                    "tags": ["status:quarantined"],
                    "visibility_scope": "public_commons",
                    "value": {
                        "prov_id": "PROV-QUARANTINED",
                        "title": "Quarantined Rule",
                        "summary": "Blocked by Layer-1 governance lens.",
                        "inject_text": "Should never enter Herma store.",
                        "triggers": {"mode": "any", "keyword": {"any_keywords": ["quarantined"]}},
                    },
                },
            )
        if p == "/v1/stores/herma.provisions/records/PROV-UNVERIFIED-EXT":
            return httpx.Response(
                200,
                json={
                    "producer_surface": "surface:agora",
                    "visibility_scope": "public_commons",
                    "tags": [],
                    "value": {
                        "prov_id": "PROV-UNVERIFIED-EXT",
                        "title": "Unverified Cross-Surface Rule",
                        "summary": "Missing status:verified from third-party surface.",
                        "inject_text": "Should be skipped until verified.",
                        "triggers": {"mode": "any", "keyword": {"any_keywords": ["unverified"]}},
                    },
                },
            )
        if p == "/v1/stores/herma.provisions/records/PROV-WRONG-SURFACE":
            return httpx.Response(
                200,
                json={
                    "producer_surface": "surface:eranos",
                    "visibility_scope": "surface_only",
                    "tags": ["status:verified"],
                    "value": {
                        "prov_id": "PROV-WRONG-SURFACE",
                        "title": "Eranos Surface-Only Rule",
                        "summary": "Restricted to surface:eranos.",
                        "inject_text": "Should not cross into surface:herma.",
                        "triggers": {"mode": "any", "keyword": {"any_keywords": ["wrongsurf"]}},
                    },
                },
            )
        if p == "/v1/stores/herma.provisions/records/PROV-VERIFIED-COHORT":
            return httpx.Response(
                200,
                json={
                    "producer_surface": "surface:eranos",
                    "visibility_scope": "allowlist_surfaces",
                    "allowed_surfaces": ["surface:herma"],
                    "target_cohorts": ["cohort:ngo-helpline"],
                    "tags": ["status:verified"],
                    "value": {
                        "prov_id": "PROV-VERIFIED-COHORT",
                        "title": "Verified Helpline Cohort Rule",
                        "summary": "Fires only when X-Herma-Cohort matches ngo-helpline.",
                        "inject_text": "Enforce helpline safety plan review for ngo-helpline cohort.",
                        "triggers": {"mode": "any", "keyword": {"any_keywords": ["safety plan"]}},
                    },
                },
            )
        if p == "/v1/stores/herma.provisions/records/PROV-VERIFIED-PUBLIC":
            return httpx.Response(
                200,
                json={
                    "producer_surface": "surface:agora",
                    "visibility_scope": "public_commons",
                    "tags": ["status:verified"],
                    "value": {
                        "prov_id": "PROV-VERIFIED-PUBLIC",
                        "title": "Verified Public Commons Rule",
                        "summary": "Verified public_commons rule with content-addressed blob.",
                        "inject_text": "Tie indicators to verified statutory cards.",
                        "uris": [
                            {
                                "uri": f"tessera://blobs/{valid_sha}",
                                "label": "Verified Blob",
                                "kind": "doc",
                            }
                        ],
                        "triggers": {"mode": "any", "keyword": {"any_keywords": ["statutory"]}},
                    },
                },
            )
        return httpx.Response(404)

    def governed_fixture(request: httpx.Request) -> httpx.Response:
        response = _gov_handler(request)
        if response.status_code != 200 or "application/json" not in response.headers.get(
            "content-type", ""
        ):
            return response
        body = response.json()
        if "value" in body:
            body = {
                "namespace": "main",
                "producer_surface": "surface:tessera",
                "visibility_scope": "public_commons",
                "allowed_surfaces": [],
                "target_cohorts": ["all"],
                "tags": ["status:verified"],
                **body,
            }
        return httpx.Response(response.status_code, json=body)

    transport = httpx.MockTransport(governed_fixture)
    orig_init = httpx.AsyncClient.__init__

    def _patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = transport
        orig_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    gov_db = tmp_path / "gov.db"
    monkeypatch.setenv("HERMA_DB", str(gov_db))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    gov_store = ProvisionStore(gov_db)
    raw_key, key_info = gov_store.issue_key(
        label="gov-caller", harness_kind="opencode", scopes=["route", "configure"]
    )
    caller_scope = f"key:{key_info.key_id}"

    with pytest.raises(HermaError) as exc_bad_sha:
        await gov_store.sync_from_tessera_http(
            "https://tessera.ta-amps.workers.dev", "tok", caller_scope=caller_scope, is_admin=False
        )
    assert exc_bad_sha.value.status_code == 400
    assert exc_bad_sha.value.code == "invalid_blob_sha"

    mode["case"] = "corrupt_blob"
    synced_blob = await gov_store.sync_from_tessera_http(
        "https://tessera.ta-amps.workers.dev", "tok", caller_scope=caller_scope, is_admin=False
    )
    assert synced_blob[0].provision.uris[0].inline_excerpt == ""
    # A digest is not permission to read raw bytes; the integrity utility still rejects corruption.
    from herma.store import verify_blob_bytes

    with pytest.raises(HermaError) as exc_corrupt:
        verify_blob_bytes(valid_sha, tampered_bytes)
    assert exc_corrupt.value.code == "blob_integrity_mismatch"

    # Sync with default cohort -> only PROV-VERIFIED-PUBLIC passes; then sync with cohort=ngo-helpline -> PROV-VERIFIED-COHORT also passes:
    mode["case"] = "governed"
    synced_default = await gov_store.sync_from_tessera_http(
        "https://tessera.ta-amps.workers.dev",
        "tok",
        caller_scope=caller_scope,
        harness_kind="opencode",
        cohort="",
        is_admin=False,
    )
    assert [s.provision.prov_id for s in synced_default] == ["PROV-VERIFIED-PUBLIC"]
    assert synced_default[0].provision.uris[0].inline_excerpt == ""
    ctx_ids = [
        e.entry_id
        for e in gov_store.list_context_entries(caller_scope=caller_scope, include_builtin=False)
    ]
    assert ctx_ids == ["noun:verified_ok"]

    synced_cohort = await gov_store.sync_from_tessera_http(
        "https://tessera.ta-amps.workers.dev",
        "tok",
        caller_scope=caller_scope,
        harness_kind="opencode",
        cohort="ngo-helpline",
        is_admin=False,
    )
    assert {s.provision.prov_id for s in synced_cohort} == {
        "PROV-VERIFIED-PUBLIC",
        "PROV-VERIFIED-COHORT",
    }

    # Verify request-time X-Herma-Cohort filtering in FastAPI:
    tc = TestClient(create_app())
    hdrs = {"X-Herma-Key": raw_key, "X-Herma-Harness": "opencode"}
    r_no_cohort = tc.post(
        "/v1/dry-run",
        headers=hdrs,
        json={
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "Draft a safety plan checklist"}],
            }
        },
    )
    assert r_no_cohort.status_code == 200
    assert [m["prov_id"] for m in r_no_cohort.json()["matches"]] == []

    r_with_cohort = tc.post(
        "/v1/dry-run",
        headers={**hdrs, "X-Herma-Cohort": "ngo-helpline"},
        json={
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [{"role": "user", "content": "Draft a safety plan checklist"}],
            }
        },
    )
    assert r_with_cohort.status_code == 200
    assert [m["prov_id"] for m in r_with_cohort.json()["matches"]] == ["PROV-VERIFIED-COHORT"]

    # 3. Verify Cloudflare Worker parity for offline contributor refusal, blob SHA-256 mismatch, and governance lens:
    cf = _run_worker_node_script(
        """
const db = new SqliteD1();
const validBytes = new TextEncoder().encode("Verified Edge Blob");
const validSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", validBytes)), (b) => b.toString(16).padStart(2, "0")).join("");

const mockTessera = {
  async fetch(urlStr) {
    const u = new URL(urlStr);
    if (u.pathname.endsWith(".context/records/index")) return new Response("not found", { status: 404 });
    if (u.pathname === "/v1/stores/badsha/records") {
      return Response.json({ records: [{ namespace:"main",producer_surface:"surface:tessera",visibility_scope:"public_commons",allowed_surfaces:[],target_cohorts:["all"],tags:["status:verified"], key: "P1", value: {
        prov_id: "PROV-CF-BADSHA", title: "Bad SHA", summary: "Bad sha.", inject_text: "Invalid sha test.",
        uris: [{ uri: "tessera://blobs/xyz", label: "Bad", kind: "doc" }],
        triggers: { mode: "any", keyword: { any_keywords: ["x"] } },
      } }] });
    }
    if (u.pathname === "/v1/stores/tampered/records") {
      return Response.json({ records: [{ namespace:"main",producer_surface:"surface:tessera",visibility_scope:"public_commons",allowed_surfaces:[],target_cohorts:["all"],tags:["status:verified"], key: "P2", value: {
        prov_id: "PROV-CF-TAMPER", title: "Tamper", summary: "Tampered bytes.", inject_text: "Tampered blob test.",
        uris: [{ uri: "tessera://blobs/" + validSha, label: "Tamper", kind: "doc" }],
        triggers: { mode: "any", keyword: { any_keywords: ["x"] } },
      } }] });
    }
    if (u.pathname === "/v1/blobs/" + validSha) {
      return new Response("WRONG BYTES", { status: 200 });
    }
    if (u.pathname === "/v1/stores/gov/records") {
      return Response.json({ records: [
        { namespace:"main",producer_surface:"surface:tessera",allowed_surfaces:[],target_cohorts:["all"], key: "Q", tags: ["status:quarantined"], visibility_scope: "public_commons", value: {
          prov_id: "PROV-CF-QUAR", title: "Quarantined", summary: "Blocked.", inject_text: "Never ingest.",
          triggers: { mode: "any", keyword: { any_keywords: ["quar"] } },
        } },
        { namespace:"main", key: "C", tags: ["status:verified"], producer_surface: "surface:eranos", visibility_scope: "allowlist_surfaces",
           allowed_surfaces: ["surface:herma"], target_cohorts: ["cohort:ngo-helpline"], value: {
          prov_id: "PROV-CF-COHORT", title: "Cohort", summary: "Allowed for ngo-helpline.", inject_text: "Helpline cohort rule.",
          triggers: { mode: "any", keyword: { any_keywords: ["safety plan"] } },
        } },
      ] });
    }
    return new Response("not found", { status: 404 });
  }
};

const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "b", TESSERA: mockTessera };
const k = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST", headers: { "content-type": "application/json", "x-bootstrap-secret": "b" },
  body: JSON.stringify({ label: "cf", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env)).json();
const h = { "content-type": "application/json", "x-herma-key": k.key, "x-herma-harness": "opencode" };

const contribEnv = { ...env, HERMA_MICROMODEL_MODEL: "contributor" };
const contribResp = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: h,
  body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "Design shelter intake" }] } }),
}), contribEnv);

const rBadSha = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/sync/tessera", {
  method: "POST", headers: h, body: JSON.stringify({ base_url: "https://tessera.ta-amps.workers.dev", bearer_token: "t", namespace: "badsha" }),
}), env);
const rTamper = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/sync/tessera", {
  method: "POST", headers: h, body: JSON.stringify({ base_url: "https://tessera.ta-amps.workers.dev", bearer_token: "t", namespace: "tampered" }),
}), env);
const rGov = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/sync/tessera", {
  method: "POST", headers: { ...h, "x-herma-cohort": "ngo-helpline" },
  body: JSON.stringify({ base_url: "https://tessera.ta-amps.workers.dev", bearer_token: "t", namespace: "gov" }),
}), env)).json();

const dryNoCohort = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: h,
  body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "safety plan" }] } }),
}), env)).json();
const dryCohort = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: { ...h, "x-herma-cohort": "ngo-helpline" },
  body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "safety plan" }] } }),
}), env)).json();

console.log(JSON.stringify({
  contribStatus: contribResp.status,
  badShaStatus: rBadSha.status,
  tamperStatus: rTamper.status,
  syncedGov: rGov.synced,
  noCohortMatches: dryNoCohort.matches.map((m) => m.prov_id),
  cohortMatches: dryCohort.matches.map((m) => m.prov_id),
}));
"""
    )
    assert cf["contribStatus"] == 403
    assert cf["badShaStatus"] == 400
    assert cf["tamperStatus"] == 200  # raw blobs are not inlined without their own governance
    assert cf["syncedGov"] == ["PROV-CF-COHORT"]
    assert cf["noCohortMatches"] == []
    assert cf["cohortMatches"] == ["PROV-CF-COHORT"]


def test_deterministic_entity_memory_retry_outcomes_and_candidate_insights_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. Pure deterministic regex entity extraction unit check across all 5 kinds:
    sample_text = (
        "Inspect src/tessera/_tasks.py and `herma.store.ProvisionStore` plus submit_task() "
        "against tessera://stores/custom.nouns/order_book and statute card US-ROSCA-8403 "
        "after ValueError: stale fencing token on submit."
    )
    extracted = extract_entities(sample_text)
    by_kind = {e.kind: e.value for e in extracted}
    assert by_kind["file_path"] == "src/tessera/_tasks.py"
    assert "code_symbol" in by_kind
    assert by_kind["tessera_uri"] == "tessera://stores/custom.nouns/order_book"
    assert by_kind["statute_card_id"] == "US-ROSCA-8403"
    assert by_kind["error_signature"].startswith("ValueError: stale fencing token")

    # 2. End-to-end working_entities, automatic retry_error attribution, POST /v1/outcomes, and GET /v1/insights in Python:
    db_file = tmp_path / "memory_insights.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    store = ProvisionStore(db_file)
    seed_examples_if_present(store)
    key_a, _ = store.issue_key(
        label="mem-a", harness_kind="opencode", scopes=["route", "configure"]
    )
    key_b, _ = store.issue_key(label="mem-b", harness_kind="opencode", scopes=["route"])
    hdr_a = {"X-Herma-Key": key_a, "X-Herma-Harness": "opencode", "X-Herma-Project": "proj-alpha"}
    hdr_b = {"X-Herma-Key": key_b, "X-Herma-Harness": "opencode", "X-Herma-Project": "proj-alpha"}

    client = TestClient(create_app())

    # Turn 1: matches PROV-TESSERA-FENCING and tracks hot URI + statute card:
    r_t1 = client.post(
        "/v1/dry-run",
        headers=hdr_a,
        json={
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Update src/tessera/_tasks.py fencing with `put_record()` using "
                            "tessera://stores/custom.nouns/order_book and US-ROSCA-8403"
                        ),
                    }
                ],
            }
        },
    )
    assert r_t1.status_code == 200
    assert int(r_t1.headers["x-herma-entities-tracked"]) >= 4
    rcpt_1 = r_t1.json()["receipt"]["receipt_id"]

    # Turn 2: immediate follow-up turn with error_signature -> upgrades Turn 1's PROV-TESSERA-FENCING to retry_error!
    r_t2 = client.post(
        "/v1/dry-run",
        headers=hdr_a,
        json={
            "payload": {
                "model": "muse-spark-1.3",
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Got ValueError: stale fencing token on submit\n"
                            "Context: tessera://stores/custom.nouns/order_book and US-ROSCA-8403"
                        ),
                    }
                ],
            }
        },
    )
    assert r_t2.status_code == 200

    # Turn 3: repeat error_signature + direct-response turn so tokens_saved_est > 0 and error hit_count >= 2:
    r_t3 = client.post(
        "/v1/chat/completions",
        headers=hdr_a,
        json={
            "model": "muse-spark-1.3",
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Show canonical noun/verb schema after ValueError: stale fencing token on submit"
                    ),
                }
            ],
        },
    )
    assert r_t3.status_code == 200
    assert r_t3.headers["x-herma-direct-response"] == "true"

    # Explicit POST /v1/outcomes (and verify Caller B cannot report outcomes against Caller A's receipt_id):
    assert (
        client.post(
            "/v1/outcomes",
            headers=hdr_b,
            json={"receipt_id": rcpt_1, "outcome": "overridden"},
        ).status_code
        == 404
    )
    r_out = client.post(
        "/v1/outcomes",
        headers=hdr_a,
        json={"receipt_id": rcpt_1, "prov_id": "PROV-TESSERA-FENCING", "outcome": "retry_error"},
    )
    assert r_out.status_code == 200 and r_out.json()["count"] == 1

    # GET /v1/memory returns hot entities for Caller A only (Caller B sees 0):
    mem_a = client.get("/v1/memory?project_tag=proj-alpha", headers=hdr_a).json()
    mem_b = client.get("/v1/memory?project_tag=proj-alpha", headers=hdr_b).json()
    assert mem_a["count"] >= 5
    assert mem_b["count"] == 0

    # GET /v1/insights synthesizes valid reviewable candidate_provisions WITHOUT mutating active provisions:
    provs_before = len(client.get("/v1/provisions", headers=hdr_a).json()["provisions"])
    ins = client.get("/v1/insights?project_tag=proj-alpha", headers=hdr_a).json()
    provs_after = len(client.get("/v1/provisions", headers=hdr_a).json()["provisions"])
    assert provs_before == provs_after

    fencing_tel = next(t for t in ins["rule_telemetry"] if t["prov_id"] == "PROV-TESSERA-FENCING")
    direct_tel = next(
        t for t in ins["rule_telemetry"] if t["prov_id"] == "PROV-DIRECT-NOUN-VERB-SCHEMA"
    )
    assert fencing_tel["retry_error_count"] >= 1
    assert fencing_tel["retry_error_rate"] > 0.0
    assert direct_tel["tokens_saved_est"] > 0

    cand_list = [Provision.model_validate(c) for c in ins["candidate_provisions"]]
    cand_prefixes = {c.prov_id.split("-")[2] for c in cand_list}
    assert {"ERR", "URI", "CARD"} <= cand_prefixes

    # 3. Verify Cloudflare Worker parity for /v1/memory, /v1/outcomes, automatic retry_error, and /v1/insights:
    cf = _run_worker_node_script(
        """
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "b" };
const ka = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST", headers: { "content-type": "application/json", "x-bootstrap-secret": "b" },
  body: JSON.stringify({ label: "a", harness_kind: "opencode", scopes: ["route", "configure"] }),
}), env)).json();
const kb = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/admin/keys", {
  method: "POST", headers: { "content-type": "application/json", "x-bootstrap-secret": "b" },
  body: JSON.stringify({ label: "b", harness_kind: "opencode", scopes: ["route"] }),
}), env)).json();
const ha = { "content-type": "application/json", "x-herma-key": ka.key, "x-herma-harness": "opencode", "x-herma-project": "p1" };
const hb = { "content-type": "application/json", "x-herma-key": kb.key, "x-herma-harness": "opencode", "x-herma-project": "p1" };

const t1 = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: ha,
  body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "Check fencing in src/tessera/_tasks.py with tessera://stores/custom.nouns/order_book and US-ROSCA-8403" }] } }),
}), env)).json();
await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/dry-run", {
  method: "POST", headers: ha,
  body: JSON.stringify({ payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: "ValueError: stale fencing token\\nContext: tessera://stores/custom.nouns/order_book and US-ROSCA-8403" }] } }),
}), env);
await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/chat/completions", {
  method: "POST", headers: ha,
  body: JSON.stringify({ model: "muse-spark-1.3", messages: [{ role: "user", content: "canonical noun/verb schema after ValueError: stale fencing token" }] }),
}), env);

const crossOut = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/outcomes", {
  method: "POST", headers: hb, body: JSON.stringify({ receipt_id: t1.receipt.receipt_id, outcome: "ignored" }),
}), env);
const memA = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/memory?project_tag=p1", { headers: ha }), env)).json();
const memB = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/memory?project_tag=p1", { headers: hb }), env)).json();
const provBefore = (await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions", { headers: ha }), env)).json()).provisions.length;
const ins = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/insights?project_tag=p1", { headers: ha }), env)).json();
const provAfter = (await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/v1/provisions", { headers: ha }), env)).json()).provisions.length;

console.log(JSON.stringify({
  crossOutStatus: crossOut.status,
  memACount: memA.count,
  memBCount: memB.count,
  provBefore,
  provAfter,
  telemetry: ins.rule_telemetry,
  candIds: ins.candidate_provisions.map((c) => c.prov_id),
}));
"""
    )
    assert cf["crossOutStatus"] == 404
    assert cf["memACount"] >= 5 and cf["memBCount"] == 0
    assert cf["provBefore"] == cf["provAfter"]
    cf_fencing = next(t for t in cf["telemetry"] if t["prov_id"] == "PROV-TESSERA-FENCING")
    assert cf_fencing["retry_error_count"] >= 1
    assert len(cf["candIds"]) >= 3


def test_public_preview_svg_brand_chrome_discovery_and_stateless_mcp_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "discovery.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.setenv("HERMA_EDGE_SECRET", "edge-secret-test")
    edge_hdr = {"x-edge-auth": "edge-secret-test"}

    store = ProvisionStore(db_file)
    seed_examples_if_present(store)
    client = TestClient(create_app())

    # 1. /healthz is edge-exempt for container health probes, while / requires x-edge-auth when HERMA_EDGE_SECRET is set:
    r_hz = client.get("/healthz")
    assert r_hz.status_code == 200 and r_hz.json()["ok"] is True
    assert client.get("/").status_code == 403

    # 2. Brand SVG chrome, responsive .table-wrap, and preview inspector on / and /connect:
    home_html = client.get("/", headers=edge_hdr).text
    connect_html = client.get("/connect", headers=edge_hdr).text
    for page_html in (home_html, connect_html):
        assert '<a class="wordmark" href="/">' in page_html
        assert '<header class="site-header">' in page_html
        assert "<nav" in page_html
        assert '<footer class="site-footer">' in page_html
    assert 'class="table-wrap"' in home_html
    assert 'id="herma-preview-prompt"' in home_html
    assert '<script src="/preview.js" defer></script>' in home_html

    # 3. Static discovery & asset routes:
    assert (
        client.get("/favicon.svg", headers=edge_hdr)
        .headers["content-type"]
        .startswith("image/svg+xml")
    )
    assert (
        client.get("/preview.js", headers=edge_hdr)
        .headers["content-type"]
        .startswith("application/javascript")
    )
    assert "Disallow: /v1/" in client.get("/robots.txt", headers=edge_hdr).text
    assert "# Herma" in client.get("/llms.txt", headers=edge_hdr).text
    assert "PROV-TESSERA-FENCING" in client.get("/llms-full.txt", headers=edge_hdr).text
    card = client.get("/.well-known/agent-card.json", headers=edge_hdr).json()
    assert card["name"] == "Herma"
    assert card["endpoints"]["mcp"].endswith("/mcp")

    # 4. Read-only POST /api/preview (persisted=False, 0 DB side effects):
    assert client.post("/api/preview", headers=edge_hdr, json={"prompt": "   "}).status_code == 422
    r_prev = client.post(
        "/api/preview",
        headers=edge_hdr,
        json={
            "prompt": "Update src/tessera/_tasks.py fencing with US-ROSCA-8403",
            "workspace_paths": ["src/tessera/_tasks.py"],
        },
    )
    assert r_prev.status_code == 200
    prev_json = r_prev.json()
    assert prev_json["persisted"] is False
    assert prev_json["scope_evaluated"] == "system_builtin"
    assert any(m["prov_id"] == "PROV-TESSERA-FENCING" for m in prev_json["matches"])
    assert any(e["kind"] == "statute_card_id" for e in prev_json["entities"])
    assert store.public_aggregate_counts()["total_intercepted_requests"] == 0

    # 5. Stateless JSON-RPC 2.0 POST /mcp:
    r_init = client.post(
        "/mcp",
        headers=edge_hdr,
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    )
    assert r_init.status_code == 200
    assert r_init.json()["result"]["serverInfo"]["name"] == "herma"

    r_notif = client.post(
        "/mcp",
        headers=edge_hdr,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    assert r_notif.status_code == 202

    r_tools = client.post(
        "/mcp",
        headers=edge_hdr,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    )
    assert {t["name"] for t in r_tools.json()["result"]["tools"]} == {
        "list_builtin_provisions",
        "preview_shim",
        "extract_entities",
    }

    r_call = client.post(
        "/mcp",
        headers=edge_hdr,
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "preview_shim",
                "arguments": {"prompt": "Show canonical noun/verb schema"},
            },
        },
    )
    assert r_call.json()["result"]["structuredContent"]["responded_directly"] is True
    assert store.public_aggregate_counts()["total_intercepted_requests"] == 0

    # 6. Cloudflare Worker parity for /favicon.svg, /healthz, /robots.txt, /llms.txt, /.well-known/agent-card.json, /api/preview, and /mcp:
    cf = _run_worker_node_script(
        """
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db };

const fav = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/favicon.svg"), env);
const hz = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/healthz"), env);
const rob = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/robots.txt"), env);
const llms = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/llms.txt"), env);
const llmsFull = await worker.fetch(new Request("https://herma.ta-amps.workers.dev/llms-full.txt"), env);
const card = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/.well-known/agent-card.json"), env)).json();
const homeHtml = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/"), env)).text();

const prev = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/api/preview", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "Check src/tessera/_tasks.py fencing and US-ROSCA-8403" }),
}), env)).json();
const riskPrev = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/api/preview", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "Check statute card US-ROSCA-8403 after ValueError: stale fencing token in exploitation_evidence/checks.py", workspace_paths: ["exploitation_evidence/checks.py"] }),
}), env)).json();
const riskMatch = riskPrev.matches.find((m) => m.prov_id === "PROV-RISK-REVIEW-NON-ACCUSATORY");
const llmsFullText = await llmsFull.text();

const mcpInit = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/mcp", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
}), env)).json();
const mcpList = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/mcp", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
}), env)).json();
const mcpCall = await (await worker.fetch(new Request("https://herma.ta-amps.workers.dev/mcp", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "extract_entities", arguments: { text: "Fix src/herma/store.py after ValueError: conflict" } } }),
}), env)).json();

const rcptCnt = db.sqlite.prepare("SELECT COUNT(*) AS n FROM injection_receipts").get().n;
console.log(JSON.stringify({
  favOk: fav.status === 200 && fav.headers.get("content-type").includes("image/svg+xml"),
  hzOk: hz.status === 200,
  robOk: rob.status === 200,
  llmsOk: llms.status === 200 && llmsFull.status === 200,
  cardName: card.name,
  hasSvgHeader: homeHtml.includes('class="wordmark"') && homeHtml.includes('class="table-wrap"'),
  prevPersisted: prev.persisted,
  prevMatches: prev.matches.length,
  riskReasons: riskMatch ? riskMatch.reasons : null,
  starterIds: [...llmsFullText.matchAll(/^- `(PROV-[A-Z0-9-]+)`/gm)].map((m) => m[1]).sort(),
  mcpServer: mcpInit.result.serverInfo.name,
  mcpTools: mcpList.result.tools.map((t) => t.name),
  mcpExtracted: mcpCall.result.structuredContent.count,
  rcptCnt: Number(rcptCnt),
}));
"""
    )
    assert cf["favOk"] is True
    assert cf["hzOk"] is True
    assert cf["robOk"] is True
    assert cf["llmsOk"] is True
    assert cf["cardName"] == "Herma"
    assert cf["hasSvgHeader"] is True
    assert cf["prevPersisted"] is False and cf["prevMatches"] >= 1
    # The console's statute preset fires the plain-named starter through its path trigger, and
    # the Worker's starter provisions mirror the Python example provisions one for one.
    assert cf["riskReasons"] is not None
    assert any(reason.startswith("keyword:path(") for reason in cf["riskReasons"])
    example_ids = sorted(
        json.loads(path.read_text(encoding="utf-8"))["prov_id"]
        for path in (REPO_ROOT / "examples" / "provisions").glob("*.json")
    )
    assert cf["starterIds"] == example_ids
    assert cf["mcpServer"] == "herma"
    assert set(cf["mcpTools"]) == {"list_builtin_provisions", "preview_shim", "extract_entities"}
    assert cf["mcpExtracted"] >= 2
    assert cf["rcptCnt"] == 0

    # 7. Typography guardrail: zero em-dashes (\u2014) anywhere in tracked repo files:
    skip_dirs = {
        ".git",
        ".venv",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "node_modules",
        ".wrangler",
    }
    offenders: list[str] = []
    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file() or (set(path.relative_to(REPO_ROOT).parts) & skip_dirs):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if "\u2014" in content:
            offenders.append(str(path.relative_to(REPO_ROOT)))
    assert offenders == [], f"Found forbidden em-dash in: {offenders}"
