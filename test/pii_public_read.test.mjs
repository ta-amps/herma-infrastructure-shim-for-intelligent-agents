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
  it("a no-key claim shows a Task's text and helpers through the layer; the store keeps the text", async () => {
    expect((await call("/q/pulse")).status).toBe(200);
    const made = await call("/q/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "pii-maker", title: "pii claim probe quince", prompt: "Reach ana@gmail.com or 617-204-8831, SSN 078-05-1120." }) });
    const body = await made.json();
    const tasks = body.enqueued_followup_tasks || body.enqueued_followup_verbs || [];
    const id = body.task_id || tasks[0]?.task_id || tasks[0];
    for (const init of [undefined, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "pii-claimer", task_id: id }) }]) {
      const path = init ? "/q/claim" : `/q/claim/pii-claimer?task_id=${id}&format=json`;
      const text = await (await call(path, init)).text();
      expect(text, path).toContain("fencing_token");
      expect(text, path).not.toContain("617-204-8831");
      expect(text, path).not.toContain("078-05-1120");
    }
    // The plain text form, for a browser or a read-only web tool.
    const plain = await (await call(`/q/claim/pii-claimer?task_id=${id}`, { headers: { accept: "text/plain" } })).text();
    expect(plain).toContain("FENCING_TOKEN:");
    expect(plain).not.toContain("617-204-8831");
    expect(plain).not.toContain("078-05-1120");
    const stored = await env.HERMA_DB.prepare("SELECT prompt FROM herma_durable_queue WHERE task_id = ?").bind(id).first();
    expect(stored.prompt).toContain("617-204-8831");
  });

  it("the export says what the public reads say: a refuted object stays with no weight, an opinion isn't a review", async () => {
    expect((await call("/q/pulse")).status).toBe(200);
    const nowIso = new Date().toISOString();
    const add = (key, verdict, evals) => env.HERMA_DB.prepare(
      `INSERT INTO herma_task_objects
       (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json, simhash64_hex, sha256_hash, eval_count, created_at, quality_milli, verification_verdict, search_hints_json)
       VALUES (?, ?, 1, 'procedure', 'public_commons', 'export-tester', 'seed_test', 'export label probe', '{"note":"x"}', '0000000000000001', ?, ?, ?, 910, ?, '{}')`,
    ).bind(key, key, "b".repeat(16), evals, nowIso, verdict).run();
    await add("export_refuted_v1", "REFUTED", 3);
    await add("export_opinion_v1", "UNREVIEWED", 3);
    await add("export_checked_v1", "CONFIRMED", 3);
    const { examples } = await (await call("/q/training-export?format=json&limit=200")).json();
    const row = (key) => examples.find((e) => e.example_id === `obj_${key}`);
    expect(row("export_refuted_v1").review_status).toBe("failed");
    expect(row("export_refuted_v1").sample_weight).toBe(0);
    expect(row("export_refuted_v1").confidence).toBeLessThan(0.1);
    expect(row("export_refuted_v1").evidence.join(" ")).toContain("wrong");
    expect(row("export_opinion_v1").confidence).toBeLessThan(row("export_checked_v1").confidence);
    expect(row("export_opinion_v1").confidence).toBeLessThan(0.5);
    const high = (await (await call("/q/training-export?format=json&limit=200&min_confidence=0.5")).json()).examples;
    expect(high.some((e) => e.example_id === "obj_export_checked_v1")).toBe(true);
    expect(high.some((e) => e.example_id === "obj_export_refuted_v1")).toBe(false);
    expect(row("export_opinion_v1").review_status).toBe("unreviewed");
    // Three evaluations from anyone earn no more weight than none.
    expect(row("export_opinion_v1").sample_weight).toBeLessThan(row("export_checked_v1").sample_weight);
    expect(row("export_checked_v1").review_status).toBe("reviewed");
    expect(JSON.stringify(examples)).not.toContain("verified_task_object");
    expect(JSON.stringify(examples)).not.toContain("peer_reviewed");
    // The client chooses; the export stays open by default.
    const chosen = (await (await call("/q/training-export?format=json&limit=200&review_state=reviewed,unreviewed")).json()).examples;
    expect(chosen.find((e) => e.example_id === "obj_export_refuted_v1")).toBeUndefined();
    expect(chosen.find((e) => e.example_id === "obj_export_opinion_v1")).toBeDefined();
  });

  it("a claim keeps what a worker needs: token, fence, ids, submit links, code, a public number", async () => {
    expect((await call("/q/pulse")).status).toBe(200);
    const prompt = "Labeled test. Reach 617-204-8831 about the form, when you have read it all.\nCrisis hotline 617-555-0199.\n```python\nprint(sum(range(10)))\n```\nRun `curl -s https://example.org/a?b=1` then report.";
    const made = await (await call("/q/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "pii-maker-2", title: "pii claim usable probe quince", prompt }) })).json();
    const tasks = made.enqueued_followup_tasks || made.enqueued_followup_verbs || [];
    const id = made.task_id || tasks[0]?.task_id || tasks[0];
    const reply = await (await call(`/q/claim/pii-usable-worker?task_id=${id}&format=json&verbose=1`)).json();
    expect(reply.lease.task_id).toBe(id);
    expect(reply.lease.prompt).not.toContain("617-204-8831");
    expect(reply.lease.prompt).toContain("617-555-0199");
    expect(reply.lease.prompt).toContain("print(sum(range(10)))");
    expect(reply.lease.prompt).toContain("`curl -s https://example.org/a?b=1`");
    expect(Number(reply.lease.fencing_token)).toBeGreaterThan(0);
    expect(reply.next.give_back_url).toContain(id);
    expect(JSON.stringify(reply)).not.toContain("[credential]");
    const profile = reply.bilateral_guidance.worker_profile;
    expect(profile.worker_uuid).toMatch(/\S/);
    const done = await call("/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "pii-usable-worker", worker_uuid: profile.worker_uuid, task_id: id, fencing_token: reply.lease.fencing_token, summary: "Done from the stripped copy." }) });
    expect(done.status).toBe(200);
  });
});
