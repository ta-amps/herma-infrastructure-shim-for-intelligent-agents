"""Starters synced from Tessera fire for routed callers only when they carry fabric_governance.

Herma's live starters were synced on 2026-10-27, before the Layer-1 lens began reading governance from
`metadata_tags.fabric_governance`. They carry only the older flat tags, so the lens drops every one of them
from routed requests. This pins the contract a data fix relies on, through the real Worker and its routed
dry run.
"""

from __future__ import annotations

from test_herma import _run_worker_node_script

WORKER = r"""
const { canonicalJson, sha256Hex } = await import(process.env.WORKER_URL.replace(/worker\.js$/, "herma_engine.js"));
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db, BOOTSTRAP_SECRET: "boot-starters" };
const base = "https://herma.ta-amps.workers.dev";
await worker.fetch(new Request(base + "/healthz"), env);
const key = await (await worker.fetch(new Request(base + "/v1/admin/keys", { method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": "boot-starters" },
  body: JSON.stringify({ label: "starters", harness_kind: "opencode", scopes: ["route", "configure"] }) }), env)).json();
// The flat tags the older sync stored, exactly as the live PROV-TESSERA-FENCING row holds them.
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
    payload: { model: "muse-spark-open", messages: [{ role: "user", content: prompt }] } }) }), env)).json())
  .receipt.provisions_fired.map((p) => p.split("@")[0]);
const out = { seeded: await fired() };
await storeAs(legacy);
out.legacy = await fired();
await storeAs({ ...legacy, fabric_governance: governance });
out.governed = await fired();
console.log(JSON.stringify(out));
"""


def test_synced_starters_fire_for_routed_callers_only_with_their_governance() -> None:
    out = _run_worker_node_script(WORKER)
    assert "PROV-TESSERA-FENCING" in out["seeded"]
    # The live shape: the lens drops it from routed requests.
    assert "PROV-TESSERA-FENCING" not in out["legacy"]
    # The same row with its governance restored fires again.
    assert "PROV-TESSERA-FENCING" in out["governed"]
