import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../deploy/cloudflare/worker.js";
const SELF_FETCH = (request, bindings) => worker.fetch(request, bindings, { waitUntil() {}, passThroughOnException() {} });
import { needsFieldTeam } from "../deploy/cloudflare/priority_work_gateway.js";

describe("field work routing", () => {
  it("names work that needs people in a place", () => {
    for (const title of [
      "Field-team pickup: run live block 1 of the tactile orientation drill",
      "Recruit a field partner with existing shelter-site relationships",
      "NGO: Collect genuine shelter inverter trip logs at 2+ consented sites",
    ]) expect(needsFieldTeam(title)).toBe(true);
  });
  it("leaves desk work alone", () => {
    for (const title of ["Write a timed facilitator script for the ED-mode desk drill", "Verify quickstart steps"]) {
      expect(needsFieldTeam(title)).toBe(false);
    }
  });
});

describe("open work limits, in the running worker", () => {
  const limits = { ...env, OPEN_WORK_LIMITS: "on" };
  const post = (path, body) =>
    SELF_FETCH(new Request(`https://shim.teleionlabs.com${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), limits);

  it("a late worker can't close a Task under a newer holder, a title-only follow-up is refused, and a cap applies", async () => {
    const maker = `limits-maker-${Date.now()}`;
    const made = await (await post("/q/enqueue", { agent_id: maker, title: "limits test Task", prompt: "A labeled test Task for the open work limits.", category: "limits-test" })).json();
    const tid = made.enqueued_followup_tasks[0].task_id;
    expect(made.enqueued_followup_tasks[0].priority).toBeLessThanOrEqual(60);
    const titleOnly = await (await post("/q/enqueue", { agent_id: maker, title: "just a title" })).json();
    expect(titleOnly.rejected_followup_tasks?.length).toBe(1);
    expect(titleOnly.enqueued_followup_tasks.length).toBe(0);

    const first = await (await post("/q/claim", { agent_id: `${maker}-a`, task_id: tid, lease_seconds: 1 })).json();
    expect(first.lease.task_id).toBe(tid);
    expect(first.pulse).toBeUndefined();
    await new Promise((r) => setTimeout(r, 1500));
    const second = await (await post("/q/claim", { agent_id: `${maker}-b`, task_id: tid })).json();
    expect(second.lease.fencing_token).toBeGreaterThan(first.lease.fencing_token);
    const late = await post("/q/submit", { agent_id: `${maker}-a`, task_id: tid, fencing_token: first.lease.fencing_token, summary: "Late answer from an expired lease, a test.", task_objects: [{ object_key: `limits_${Date.now()}_v1`, summary: "a late object for the test", payload: { a: 1 } }] });
    expect(late.status).toBe(409);
    const done = await post("/q/submit", { agent_id: `${maker}-b`, task_id: tid, fencing_token: second.lease.fencing_token, summary: "The current holder finishes the Task normally.", task_objects: [{ object_key: `limits_ok_${Date.now()}_v1`, summary: "an object from no-key work", payload: { a: 1 } }] });
    expect(done.status).toBe(200);
    const out = await done.json();
    expect(out.auto_enqueued_index_and_review_verbs).toBeUndefined();
  });

  it("a worker that lets a Task go is not handed it again by a plain claim", async () => {
    const who = `limits-release-${Date.now()}`;
    const claimed = await (await post("/q/claim", { agent_id: who, lease_seconds: 60 })).json();
    if (!claimed.lease) return;
    const released = await post("/q/release", { agent_id: who, task_id: claimed.lease.task_id, fencing_token: claimed.lease.fencing_token, reason: "no tools for it" });
    expect(released.status).toBe(200);
    const next = await (await post("/q/claim", { agent_id: who, lease_seconds: 60 })).json();
    expect(next.lease?.task_id).not.toBe(claimed.lease.task_id);
  });
});

describe("lease details", () => {
  it("a stranger reading a Task or a refusal sees no holder or fence, even with a made-up key header", async () => {
    const { withoutLeaseDetails } = await import("../deploy/cloudflare/worker.js");
    const on = { ...env, OPEN_WORK_LIMITS: "on" };
    const task = () => new Response(JSON.stringify({ task: { task_id: "t", leased_by: "a", fencing_token: 3, state: "leased" } }), { headers: { "content-type": "application/json" } });
    const req = new Request("https://x/q/task/t", { headers: { "x-herma-key": "made-up" } });
    const out = await (await withoutLeaseDetails(req, task(), on)).json();
    expect(out.task).toEqual({ task_id: "t", state: "leased" });
    const refused = new Response(JSON.stringify({ code: "stale_fencing_token", detail: "Stale (9) for task t (expected=3).", expected_fencing_token: 3 }), { status: 409, headers: { "content-type": "application/json" } });
    const body = await (await withoutLeaseDetails(new Request("https://x/q/submit", { method: "POST" }), refused, on)).json();
    expect(body.expected_fencing_token).toBeUndefined();
    expect(body.detail).not.toContain("expected=");
    const stored = new Response(JSON.stringify({ payload: { fencing_token: 7 } }), { headers: { "content-type": "application/json" } });
    expect((await (await withoutLeaseDetails(new Request("https://x/q/object/k"), stored, on)).json()).payload.fencing_token).toBe(7);
    const chat = new Response(JSON.stringify({ reply: "lease_status=active, fencing_token=4" }), { headers: { "content-type": "application/json" } });
    expect((await (await withoutLeaseDetails(new Request("https://x/q/chat", { method: "POST" }), chat, on)).text())).not.toContain("=4");
    const own = new Response(JSON.stringify({ lease: { fencing_token: 3 } }), { headers: { "content-type": "application/json" } });
    expect((await (await withoutLeaseDetails(new Request("https://x/q/claim", { method: "POST" }), own, on)).json()).lease.fencing_token).toBe(3);
  });
});
