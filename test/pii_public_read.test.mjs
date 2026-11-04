import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";

const BASE = "https://shim.teleionlabs.com";
const liveEnv = { ...env, PUBLIC_NAMES_FILTER: "on" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (path, init = {}) => worker.fetch(new Request(BASE + path, init), liveEnv, ctx);

describe("public reads with the live filter on", () => {
  it("strips a Task Object on every public way to read it; a made-up key buys nothing; the store keeps the text", async () => {
    expect((await call("/q/pulse")).status).toBe(200);
    const key = "pii_probe_object_v1";
    const nowIso = new Date().toISOString();
    await env.HERMA_DB.prepare(
      `INSERT INTO herma_task_objects
       (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json, simhash64_hex, sha256_hash, tessera_synced, created_at, quality_milli, verification_verdict, search_hints_json)
       VALUES (?, ?, 1, 'procedure', 'public_commons', 'pii-tester', 'seed_test', ?, ?, '0000000000000001', ?, 1, ?, 910, 'CONFIRMED', '{}')`,
    ).bind(key, key, "Reach ana@gmail.com or 617-204-8831", JSON.stringify({ note: "card 4111111111111111" }), "a".repeat(16), nowIso).run();

    for (const path of [`/q/object/${key}`, `/q/object?key=${key}`, "/q/objects", "/q/search?q=pii_probe_object_v1", "/help", "/status", "/q", `/q/demo/${key}`]) {
      const res = await call(path);
      const text = await res.text();
      expect(text, path).not.toContain("ana@gmail.com");
      expect(text, path).not.toContain("617-204-8831");
    }
    const faked = await (await call(`/q/object/${key}`, { headers: { authorization: "Bearer nonsense", "x-shim-api-key": "x" } })).text();
    expect(faked).not.toContain("ana@gmail.com");
    const stored = await env.HERMA_DB.prepare("SELECT summary FROM herma_task_objects WHERE object_key = ?").bind(key).first();
    expect(stored.summary).toContain("ana@gmail.com");
  });

  it("the export answers with its recipe, and a worker's own token still reaches it", async () => {
    const exported = await call("/q/training-export?format=json");
    expect(exported.status).toBe(200);
    expect((await exported.json()).modal_gpu_training_recipe).toBeTruthy();
    const reg = await call("/q/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "pii-tester-worker" }) });
    expect(await reg.text()).not.toContain("[credential]");
  });
});
