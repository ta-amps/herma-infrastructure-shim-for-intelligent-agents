"""Starters synced from Tessera fire for routed callers only when they carry fabric_governance,
and natural-language Task/Task-Object, Harness Feed, and LoRA-as-Memory starters match identically
across Python and the Cloudflare Worker.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_herma import _run_worker_node_script

from herma.api.app import create_app
from herma.schemas import ContextEntry, Provision, StoredProvision
from herma.store import provision_passes_lens

ROOT = Path(__file__).resolve().parents[1]

WORKER = r"""
const { canonicalJson, sha256Hex } = await import(process.env.WORKER_URL.replace(/worker\.js$/, "herma_engine.js"));
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-starters" };
const base = "https://herma.ta-amps.workers.dev";
await worker.fetch(new Request(base + "/healthz"), env);
const key = await (await worker.fetch(new Request(base + "/v1/admin/keys", { method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-starters" },
  body: JSON.stringify({ label: "starters", harness_kind: "opencode", scopes: ["route", "configure"] }) }), env)).json();
// The flat tags the older sync stored, exactly as the pre-governance PROV-TESSERA-FENCING row held them.
const legacy = { allowed_surfaces: "surface:herma,surface:tessera", domain: "swarm-fabric",
  producer_surface: "surface:herma", status: "status:verified", surface: "tessera" };
const governance = JSON.stringify({ namespace: "main", producer_surface: "surface:herma", visibility_scope: "public_commons",
  allowed_surfaces: ["surface:herma", "surface:tessera"], target_cohorts: ["all"], tags: ["status:verified"] });
const storeAs = async (tags) => {
  const sql = "SELECT body_json FROM provisions WHERE caller_scope = 'system_builtin' AND prov_id = 'PROV-TESSERA-FENCING'";
  const body = canonicalJson({ ...JSON.parse(db.sqlite.prepare(sql).get().body_json), metadata_tags: tags });
  db.sqlite.prepare("UPDATE provisions SET body_json = ?, content_sha256 = ?, version = version + 1, source_store = " +
    "'tessera_cloud:herma.provisions' WHERE caller_scope = 'system_builtin' AND prov_id = 'PROV-TESSERA-FENCING'")
    .run(body, await sha256Hex(body));
};
const prompt = "Update src/tessera/_tasks.py lease fencing before put_record";
const fired = async () => (await (await worker.fetch(new Request(base + "/v1/dry-run", { method: "POST",
  headers: { "content-type": "application/json", "x-herma-key": key.key, "x-herma-harness": "opencode" },
  body: JSON.stringify({ wire_format: "chat_completions",
    payload: { model: "muse-spark-1.3", messages: [{ role: "user", content: prompt }] } }) }), env)).json())
  .receipt.provisions_fired.map((p) => p.split("@")[0]);
const out = { seeded: await fired() };
await storeAs(legacy);
out.legacy = await fired();
await storeAs({ ...legacy, fabric_governance: governance });
out.governed = await fired();
console.log(JSON.stringify(out));
"""

WORKER_PARITY = r"""
const {
  DEFAULT_CONTEXT_ENTRIES,
  DEFAULT_PROVISIONS,
  provisionPassesLens,
} = await import(process.env.WORKER_URL.replace(/worker\.js$/, "herma_engine.js"));
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-parity" };
const base = "https://herma.ta-amps.workers.dev";
await worker.fetch(new Request(base + "/healthz"), env);
const homeHtml = await (await worker.fetch(new Request(base + "/"), env)).text();

const preview = async (prompt) => {
  const resp = await worker.fetch(new Request(base + "/api/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, wire_format: "chat_completions" }),
  }), env);
  return await resp.json();
};

const queries = [
  "What are tasks and task objects?",
  "task and task-object schema",
  "tasks and task objects",
  "canonical noun and verb schema",
  "noun-verb schema",
  "Show the canonical noun/verb schema",
  "herma direct schema",
  "/herma-schema",
  "agent harness feeds",
  "Compare HarnessTax across Harness Square, OpenCode, Pi, and Muse Code",
  "When should we use prompt shimming vs LoRA as parametric memory on Muse Glimmer?",
];
const previews = {};
for (const q of queries) {
  const data = await preview(q);
  previews[q] = {
    matched: (data.matches || []).map((m) => m.prov_id),
    responded_directly: Boolean(data.responded_directly),
    direct_response_text: data.direct_response_text || null,
    shimmed_refs: data.shimmed_context_refs || [],
    system_text: (data.augmented_payload?.messages || []).find((m) => m.role === "system")?.content || "",
  };
}

const key = await (await worker.fetch(new Request(base + "/v1/admin/keys", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-parity" },
  body: JSON.stringify({ label: "parity", harness_kind: "muse-code", scopes: ["route"] }),
}), env)).json();
const contribResp = await worker.fetch(new Request(base + "/v1/dry-run", {
  method: "POST",
  headers: { "content-type": "application/json", "x-herma-key": key.key, "x-herma-harness": "muse-code" },
  body: JSON.stringify({
    wire_format: "chat_completions",
    payload: { model: "muse-spark-1.3-contributor", messages: [{ role: "user", content: "What are tasks and task objects?" }] },
  }),
}), env);

const lensBuiltin = DEFAULT_PROVISIONS.every((p) =>
  provisionPassesLens({ source_store: "system_builtin", provision: p }, { harnessKind: "muse-code", cohort: "" })
);
const lensSynced = DEFAULT_PROVISIONS.every((p) =>
  provisionPassesLens({ source_store: "tessera_cloud:herma.provisions", provision: p }, { harnessKind: "muse-code", cohort: "" })
);

console.log(JSON.stringify({
  prov_ids: DEFAULT_PROVISIONS.map((p) => p.prov_id).sort(),
  entry_ids: DEFAULT_CONTEXT_ENTRIES.map((e) => e.entry_id).sort(),
  lensBuiltin,
  lensSynced,
  hasMetaTable: homeHtml.includes("Which Meta Models Do What") && homeHtml.includes("Muse Glimmer 30B, fine-tuned by ta-amps"),
  contribStatus: contribResp.status,
  contribCode: (await contribResp.json()).code,
  previews,
}));
"""


def test_synced_starters_fire_for_routed_callers_only_with_their_governance() -> None:
    out = _run_worker_node_script(WORKER)
    assert "PROV-TESSERA-FENCING" in out["seeded"]
    # The legacy flat-tag shape without fabric_governance is dropped from routed requests.
    assert "PROV-TESSERA-FENCING" not in out["legacy"]
    # The same row with its governance restored fires again.
    assert "PROV-TESSERA-FENCING" in out["governed"]


def test_all_builtin_starters_and_natural_language_queries_match_across_python_and_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    prov_files = sorted((ROOT / "examples" / "provisions").glob("PROV-*.json"))
    py_provs = [
        Provision.model_validate_json(path.read_text(encoding="utf-8")) for path in prov_files
    ]
    raw_ctx = json.loads(
        (
            ROOT / "examples" / "provisions" / "context" / "CONTEXT-TESSERA-NOUNS-VERBS.json"
        ).read_text(encoding="utf-8")
    )
    py_entries = [ContextEntry.model_validate(item) for item in raw_ctx["entries"]]

    for prov in py_provs:
        assert "fabric_governance" in prov.metadata_tags
        for store_kind in ("system_builtin", "tessera_cloud:herma.provisions"):
            stored = StoredProvision(
                provision=prov,
                version=1,
                content_sha256="0" * 64,
                source_store=store_kind,
                updated_at=0.0,
            )
            assert provision_passes_lens(stored, harness_kind="muse-code", cohort=""), (
                prov.prov_id,
                store_kind,
            )

    monkeypatch.setenv("HERMA_DB", str(tmp_path / "parity.db"))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    app = create_app()
    client = TestClient(app)

    home_html = client.get("/").text
    assert "Which Meta Models Do What" in home_html
    assert "Muse Glimmer 30B, fine-tuned by ta-amps" in home_html
    assert "Muse Wonder 1.0" in home_html and "Muse Spark 1.3" in home_html
    assert "context-shimming AI middleware for configurable coding harnesses" in home_html

    worker_out = _run_worker_node_script(WORKER_PARITY)
    assert worker_out["lensBuiltin"] is True
    assert worker_out["lensSynced"] is True
    assert worker_out["hasMetaTable"] is True
    assert worker_out["contribStatus"] == 403
    assert worker_out["contribCode"] == "contributor_tier_refused"
    assert sorted(p.prov_id for p in py_provs) == worker_out["prov_ids"]
    assert sorted(e.entry_id for e in py_entries) == worker_out["entry_ids"]
    assert "PROV-HARNESS-FEEDS-GUIDE" in worker_out["prov_ids"]
    assert "PROV-LORA-MEMORY-ROUTING" in worker_out["prov_ids"]

    direct_queries = [
        "What are tasks and task objects?",
        "task and task-object schema",
        "tasks and task objects",
        "canonical noun and verb schema",
        "noun-verb schema",
        "Show the canonical noun/verb schema",
        "herma direct schema",
        "/herma-schema",
    ]
    for q in direct_queries:
        py_data = client.post(
            "/api/preview", json={"prompt": q, "wire_format": "chat_completions"}
        ).json()
        wk_data = worker_out["previews"][q]
        py_ids = [m["prov_id"] for m in py_data["matches"]]
        assert py_ids == wk_data["matched"], q
        assert "PROV-DIRECT-NOUN-VERB-SCHEMA" in py_ids, q
        assert py_data["responded_directly"] is True and wk_data["responded_directly"] is True, q
        for text in (py_data["direct_response_text"], wk_data["direct_response_text"]):
            assert "Canonical Herma + Tessera Contract -- Tasks and Task Objects" in text
            assert "Task Objects are every reusable tool" in text
            assert "Tasks are independently schedulable units of work" in text

    for feed_q in (
        "agent harness feeds",
        "Compare HarnessTax across Harness Square, OpenCode, Pi, and Muse Code",
    ):
        py_feed = client.post(
            "/api/preview", json={"prompt": feed_q, "wire_format": "chat_completions"}
        ).json()
        wk_feed = worker_out["previews"][feed_q]
        assert [m["prov_id"] for m in py_feed["matches"]] == wk_feed["matched"]
        assert "PROV-HARNESS-FEEDS-GUIDE" in wk_feed["matched"]
        assert py_feed["responded_directly"] is False and wk_feed["responded_directly"] is False
        assert "noun:harness.feed" in py_feed["shimmed_context_refs"]
        assert py_feed["shimmed_context_refs"] == wk_feed["shimmed_refs"]
        assert "HarnessTax" in wk_feed["system_text"]

    lora_q = "When should we use prompt shimming vs LoRA as parametric memory on Muse Glimmer?"
    py_lora = client.post(
        "/api/preview", json={"prompt": lora_q, "wire_format": "chat_completions"}
    ).json()
    wk_lora = worker_out["previews"][lora_q]
    assert [m["prov_id"] for m in py_lora["matches"]] == wk_lora["matched"]
    assert "PROV-LORA-MEMORY-ROUTING" in wk_lora["matched"]
    assert py_lora["responded_directly"] is False and wk_lora["responded_directly"] is False
    assert "detail:herma.lora_vs_shim" in py_lora["shimmed_context_refs"]
    assert py_lora["shimmed_context_refs"] == wk_lora["shimmed_refs"]
    assert "Muse Glimmer 4-bit QLoRA" in wk_lora["system_text"]
    assert "Muse Wonder 1.0" in wk_lora["system_text"]

    # Artifact sanity checks (reproducible training/eval/Dockerfile present & valid JSON)
    spec = json.loads(
        (ROOT / "training" / "shim-router-lora-spec.json").read_text(encoding="utf-8")
    )
    summary = json.loads((ROOT / "eval" / "shim_lift_summary.json").read_text(encoding="utf-8"))
    assert spec["status"] == "reproducible_spec"
    assert spec["data_governance"]["allow_contributor_tier_outputs"] is False
    benchmark = summary["tool_call_and_schema_benchmarks"][0]
    assert benchmark["model"].startswith("Muse-Glimmer")
    assert benchmark["promoted_qlora_pct"] == 99.3
    assert (ROOT / "eval" / "herma-shim-lift.svg").is_file()
    assert (ROOT / "Dockerfile").is_file()
