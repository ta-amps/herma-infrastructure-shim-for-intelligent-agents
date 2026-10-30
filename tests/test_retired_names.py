"""Herma never serves or seeds a retired pack name (MUST-FOLLOW item 9, owner, October 29).

The owner retired three pack names for good. This file keeps only SHA-256 digests of the lowercased
names, so it never spells them. A name matches case-insensitively anywhere inside a run of ASCII
letters, which catches ids, URLs, store names, plurals and run-together words. Ordinary English words
for the physics of motion contain one of the names; those whole words are exempt, also by digest.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_herma import _run_worker_node_script

from herma.api.app import create_app, seed_examples_if_present
from herma.store import ProvisionStore

ROOT = Path(__file__).resolve().parents[1]

# Name length -> digests of the retired names with that length.
RETIRED_SHA256: dict[int, frozenset[str]] = {
    6: frozenset(
        {
            "d488476689bd8ff0424956c989ae7508815f2821f9524dfd3ea5aea931911978",  # video and motion pack
            "4322a6b237d4d0f47990bad6edf90913cd88d2a1a6a9698a756b73e4dfd69329",  # code composition pack
        }
    ),
    # exploitation evidence pack
    7: frozenset({"9410a442dd664c9234966c5ecc0ff595431749474bc67b7e2ce5ccaaed7793ec"}),
}
# Four forms of the ordinary physics word for motion, which contains the video pack's retired name.
ORDINARY_SHA256 = frozenset(
    {
        "bd3375a33867984854635a0b0bc2671f4fc465274761e797b56f6086687f831f",
        "fa3d2e3ced4f964b292429ab88ed36dd870e47f02e6b6b54ab81156fe268a3cd",
        "2f411b7151f7eb67f4b0b0d5f3e89238e2574802062494daaf121acfb62fdc6f",
        "0ab0071d59747a2dac89abd4dc875c6829c64d142d5b0de4043fcacd0fd148fa",
    }
)
LETTER_RUN = re.compile(r"[A-Za-z]+")

WORKER_ROUTES = """
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-retired-names" };
const base = "https://herma.ta-amps.workers.dev";
const call = async (path, init = {}) => {
  const res = await worker.fetch(new Request(base + path, init), env);
  return [path, res.status, await res.text()];
};
const post = (path, body, headers = {}) =>
  call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const out = [];
for (const path of ["/", "/console", "/connect", "/connect.json", "/healthz", "/llms.txt", "/llms-full.txt",
  "/.well-known/agent-card.json", "/robots.txt", "/preview.js", "/favicon.svg", "/api/conversation-schema",
  "/agent-start.js", "/agent-start.css", "/agent-start.json"]) out.push(await call(path));
out.push(await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }));
out.push(await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call",
  params: { name: "list_builtin_provisions", arguments: {} } }));
out.push(await post("/api/preview", { prompt: "Check statute card US-ROSCA-8403 and the lease fence",
  workspace_paths: ["exploitation_evidence/checks.py"] }));
const key = await (await worker.fetch(new Request(base + "/v1/admin/keys", { method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-retired-names" },
  body: JSON.stringify({ label: "names", harness_kind: "opencode", scopes: ["route", "configure"] }) }), env)).json();
const auth = { headers: { "x-herma-key": key.key, "x-herma-harness": "opencode" } };
out.push(await call("/v1/context", auth));
out.push(await call("/v1/provisions?include_context=true", auth));
console.log(JSON.stringify({ out }));
"""


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def retired_name_offsets(
    text: str,
    retired: dict[int, frozenset[str]] = RETIRED_SHA256,
    ordinary: frozenset[str] = ORDINARY_SHA256,
) -> list[int]:
    """Start offsets of the letter runs that hold a retired name. Reports positions, never the name."""
    offsets = []
    for run in LETTER_RUN.finditer(text):
        word = run.group(0).lower()
        hit = any(
            _digest(word[i : i + size]) in digests
            for size, digests in retired.items()
            for i in range(len(word) - size + 1)
        )
        if hit and _digest(word) not in ordinary:
            offsets.append(run.start())
    return offsets


def found_in(sources: list[tuple[str, str]]) -> list[str]:
    """Where each retired name is: source and offset only."""
    return [f"{where} at {at}" for where, text in sources for at in retired_name_offsets(text)]


def test_the_detector_matches_any_case_inside_words_and_spares_ordinary_words() -> None:
    sample = {6: frozenset({_digest("zyxwvu")})}
    text = "noun:Zyxwvu.recipe https://zyxwvu.example/ ZYXWVUpack zyxwvus zyx wvu"
    assert retired_name_offsets(text, sample, frozenset()) == [5, 27, 43, 54]
    assert retired_name_offsets("zyxwvutics", sample, frozenset({_digest("zyxwvutics")})) == []
    assert retired_name_offsets("noun:tessera.lease_fence surface:eranos") == []


def test_served_text_names_no_retired_pack(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = tmp_path / "served.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    store = ProvisionStore(db_file)
    seed_examples_if_present(store)
    raw_key, _ = store.issue_key(
        label="names", harness_kind="opencode", scopes=["route", "configure"]
    )
    keyed = {"X-Herma-Key": raw_key, "X-Herma-Harness": "opencode"}
    served: list[tuple[str, str]] = []
    with TestClient(create_app()) as client:
        for path in [
            "/",
            "/console",
            "/connect",
            "/connect.json",
            "/healthz",
            "/llms.txt",
            "/llms-full.txt",
            "/.well-known/agent-card.json",
            "/robots.txt",
            "/preview.js",
            "/favicon.svg",
            "/api/conversation-schema",
        ]:
            response = client.get(path)
            assert response.status_code == 200, path
            served.append((f"python GET {path}", response.text))
        for name, body in [
            ("tools/list", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            (
                "list_builtin_provisions",
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": "list_builtin_provisions", "arguments": {}},
                },
            ),
        ]:
            response = client.post("/mcp", json=body)
            assert response.status_code == 200, name
            served.append((f"python MCP {name}", response.text))
        preview = client.post(
            "/api/preview",
            json={
                "prompt": "Check statute card US-ROSCA-8403 and the lease fence",
                "workspace_paths": ["exploitation_evidence/checks.py"],
            },
        )
        assert preview.status_code == 200 and preview.json()["matches"]
        served.append(("python POST /api/preview", preview.text))
        for path in ["/v1/context", "/v1/provisions?include_context=true"]:
            response = client.get(path, headers=keyed)
            assert response.status_code == 200, path
            served.append((f"python GET {path}", response.text))

    worker: dict[str, Any] = _run_worker_node_script(WORKER_ROUTES)
    for path, status, text in worker["out"]:
        assert status == 200, path
        served.append((f"worker {path}", text))
    bodies = {path: text for path, _, text in worker["out"]}
    starters = json.loads(bodies["/v1/provisions?include_context=true"])
    assert starters["provisions"] and starters["context_entries"]
    assert found_in(served) == []


def test_seed_data_and_runtime_sources_name_no_retired_pack() -> None:
    paths = [
        *sorted((ROOT / "examples").rglob("*.json")),
        *sorted((ROOT / "herma").rglob("*.py")),
        *sorted(p for p in (ROOT / "deploy" / "cloudflare").iterdir() if p.is_file()),
    ]
    sources = [(p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")) for p in paths]
    assert any(name == "deploy/cloudflare/d1-herma.sql" for name, _ in sources)
    assert any(name.startswith("examples/provisions/context/") for name, _ in sources)
    assert found_in(sources) == []
