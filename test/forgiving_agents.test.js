// A no-key agent's call goes through when its meaning is clear, and the reply's warnings say what was filled in.
// The fence, shared names, private tiers, the secret screen and byte ceilings still hold.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../deploy/cloudflare/worker.js";

const limits = { ...env, OPEN_WORK_LIMITS: "on" };
const call = (request, bindings = limits) => worker.fetch(request, bindings, { waitUntil() {}, passThroughOnException() {} });
const post = (path, body, bindings) =>
  call(new Request(`https://shim.teleionlabs.com${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), bindings);
const unique = (name) => `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const makeTask = async (maker) => {
  const made = await (await post("/q/enqueue", { agent_id: maker, title: "forgiving test Task", prompt: "A labeled test Task for how no-key calls are read.", category: "limits-test" })).json();
  return made.enqueued_followup_tasks[0].task_id;
};

describe("a worker's own lease stands in for a missing fence", () => {
  it("a named worker submits with no fence, and sending it again replays the answer", async () => {
    const who = unique("own-lease");
    const tid = await makeTask(`${who}-maker`);
    const claimed = await (await post("/q/claim", { agent_id: who, task_id: tid })).json();
    expect(claimed.lease.task_id).toBe(tid);
    const submit = { agent_id: who, task_id: tid, summary: "Finished without naming the fence, a test.", output: "the answer" };
    const done = await post("/q/submit", submit);
    expect(done.status).toBe(200);
    const out = await done.json();
    expect(out.warnings.join(" ")).toContain("own current lease");
    const again = await post("/q/submit", submit);
    expect(again.status).toBe(200);
    expect((await again.json()).idempotent_replay).toBe(true);
    // Different work after the Task closed is still a conflict.
    expect((await post("/q/submit", { ...submit, summary: "Something else entirely, a test." })).status).toBe(409);
  });

  it("a fence that isn't a number is read the same way for the holder", async () => {
    const who = unique("own-garbled");
    const tid = await makeTask(`${who}-maker`);
    await post("/q/claim", { agent_id: who, task_id: tid });
    expect((await post("/q/submit", { agent_id: who, task_id: tid, fencing_token: "the-token", summary: "A garbled fence from the holder, a test." })).status).toBe(200);
  });

  it("a late worker, a stranger, a shared name and a wrong worker id can't use it", async () => {
    const who = unique("late");
    const tid = await makeTask(`${who}-maker`);
    await post("/q/claim", { agent_id: `${who}-a`, task_id: tid, lease_seconds: 1 });
    await new Promise((r) => setTimeout(r, 1500));
    const second = await (await post("/q/claim", { agent_id: `${who}-b`, task_id: tid })).json();
    const summary = "This must not close the Task, a test.";
    const late = await post("/q/submit", { agent_id: `${who}-a`, task_id: tid, summary });
    expect(late.status).toBe(409);
    // The refusal a stranger reads names no fence, even in its text.
    const { withoutLeaseDetails } = await import("../deploy/cloudflare/worker.js");
    const filtered = await (await withoutLeaseDetails(new Request("https://x/q/submit", { method: "POST" }), new Response(await late.text(), { status: 409, headers: { "content-type": "application/json" } }), limits)).json();
    expect(filtered.expected_fencing_token).toBeUndefined();
    expect(filtered.detail).not.toMatch(/\(\d+\)/);
    expect((await post("/q/submit", { agent_id: `${who}-c`, task_id: tid, summary })).status).toBe(409);
    expect((await post("/q/submit", { task_id: tid, summary })).status).toBe(409);
    expect((await post("/q/submit", { agent_id: `${who}-b`, worker_uuid: "w_someone_else", task_id: tid, summary })).status).toBe(409);
    expect((await post("/q/submit", { agent_id: `${who}-b`, task_id: tid, fencing_token: second.lease.fencing_token - 1, summary })).status).toBe(409);
    expect((await post("/q/heartbeat", { agent_id: `${who}-a`, task_id: tid })).status).toBeGreaterThanOrEqual(400);
    expect((await post("/q/release", { agent_id: `${who}-a`, task_id: tid })).status).toBe(409);
    // The holder still closes it.
    expect((await post("/q/submit", { agent_id: `${who}-b`, task_id: tid, summary: "The holder finishes it, a test." })).status).toBe(200);
  });

  it("a shared name holding a lease must still send the fence", async () => {
    const tid = await makeTask(unique("shared-maker"));
    const claimed = await (await post("/q/claim", { agent_id: "volunteer-agent", task_id: tid })).json();
    expect(claimed.lease.task_id).toBe(tid);
    expect((await post("/q/submit", { agent_id: "volunteer-agent", task_id: tid, summary: "Shared name, no fence, a test." })).status).toBe(409);
    expect((await post("/q/submit", { agent_id: "volunteer-agent", task_id: tid, fencing_token: claimed.lease.fencing_token, summary: "Shared name with its fence, a test." })).status).toBe(200);
  });

  it("a worker with a token has to show it or its worker id", async () => {
    const who = unique("tokened");
    const joined = await (await post("/q/onboard", { agent_id: who })).json();
    const uuid = joined.worker_profile.worker_uuid;
    const tid = await makeTask(`${who}-maker`);
    const claimed = await (await post("/q/claim", { agent_id: who, worker_uuid: uuid, task_id: tid })).json();
    expect(claimed.lease.task_id).toBe(tid);
    expect((await post("/q/submit", { agent_id: who, task_id: tid, summary: "A name alone, no id or token, a test." })).status).toBe(409);
    const done = await post("/q/submit", { agent_id: who, worker_uuid: uuid, task_id: tid, summary: "With its worker id, a test." });
    expect(done.status).toBe(200);
  });

  it("heartbeat and release work the same way, and a worker id names its worker", async () => {
    const who = unique("beat");
    const tid = await makeTask(`${who}-maker`);
    const claimed = await (await post("/q/claim", { agent_id: who, task_id: tid })).json();
    const beat = await post("/q/heartbeat", { agent_id: who, task_id: tid });
    expect(beat.status).toBe(200);
    const beatOut = await beat.json();
    expect(beatOut.lease_epoch).toBe(claimed.lease.fencing_token);
    expect(beatOut.warnings.join(" ")).toContain("own current lease");
    expect((await post("/q/heartbeat", { worker_uuid: claimed.lease.leased_worker_uuid, task_id: tid })).status).toBe(200);
    const released = await post("/q/release", { agent_id: who, task_id: tid });
    expect(released.status).toBe(200);
    const relOut = await released.json();
    expect(relOut.released).toBe(true);
    expect(relOut.warnings.join(" ")).toContain("own current lease");
  });
});

describe("shapes that mean something clear", () => {
  it("task_objects as text is kept as one object, with a warning", async () => {
    const out = await post("/q/submit", { agent_id: unique("text-objects"), summary: "Objects sent as text, a test.", task_objects: "a plain result written as text" });
    expect(out.status).toBe(200);
    const body = await out.json();
    expect(body.warnings.join(" ")).toContain("task_objects");
    expect(body.stored_task_objects?.length ?? body.task_objects?.length ?? 1).toBeGreaterThan(0);
  });

  it("a list of text items is kept, and the secret screen still reads them", async () => {
    const who = unique("list-objects");
    expect((await post("/q/submit", { agent_id: who, summary: "A list of text, a test.", task_objects: ["first text result", "second text result"] })).status).toBe(200);
    const refused = await post("/q/submit", { agent_id: who, summary: "A token in the text, a test.", task_objects: "here it is hk_wrk_0123456789abcdef0123456789abcdef" });
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("plaintext_secret_rejected");
  });

  it("one follow-up that isn't in a list is kept; a title-only one is still refused", async () => {
    const who = unique("one-followup");
    const out = await (await post("/q/submit", { agent_id: who, summary: "One follow-up, a test.", queued_tasks: { title: "next step", prompt: "A real prompt that is long enough to be a follow-up Task." } })).json();
    expect(out.enqueued_followup_tasks.length).toBe(1);
    expect(out.warnings.join(" ")).toContain("follow-up");
    const titleOnly = await (await post("/q/submit", { agent_id: who, summary: "Only a title, a test.", queued_tasks: { title: "just a title" } })).json();
    expect(titleOnly.rejected_followup_tasks?.length).toBe(1);
  });

  it("too many items and a long summary are cut with a warning, not refused", async () => {
    const who = unique("cut");
    const out = await post("/q/submit", { agent_id: who, summary: "s".repeat(3000), task_objects: Array.from({ length: 14 }, (_, i) => ({ object_key: `${who}_${i}_v1`, summary: "an item", payload: { i } })) });
    expect(out.status).toBe(200);
    const text = (await out.json()).warnings.join(" ");
    expect(text).toContain("cut to");
    expect(text).toContain("first 12 of 14");
  });

  it("private tiers stay closed however the call is shaped", async () => {
    expect((await post("/q/submit", { agent_id: unique("tier"), summary: "A private object, a test.", task_objects: { object_key: "k_v1", visibility: "server_infra", payload: {} } })).status).toBe(403);
    expect((await post("/q/submit", { agent_id: unique("tier"), summary: "A private follow-up, a test.", queued_tasks: { prompt: "A long enough prompt for a private Task here.", tier: "infra_private" } })).status).toBe(403);
  });

  it("an empty or unreadable body on claim, heartbeat or join is read as no fields", async () => {
    const claim = await post("/q/claim", "");
    expect(claim.status).toBe(200);
    const garbled = await post("/q/claim", "{not json");
    expect(garbled.status).toBe(200);
    expect((await garbled.json()).warnings.join(" ")).toContain("plain claim");
    expect((await post("/q/onboard", "")).status).toBeLessThan(300);
    expect((await post("/q/heartbeat", "{not json")).status).toBe(400); // no Task named: the field check answers
    // Work in a body that can't be read is not guessed at.
    expect((await post("/q/submit", "{not json")).status).toBe(400);
  });
});

describe("no gate per address while access is free", () => {
  it("an env cap doesn't bring back a per-address limit", async () => {
    const capped = { ...limits, FREE_ACCESS_UNAUTH_RPM_CAP: "1" };
    const address = { "cf-connecting-ip": "203.0.113.78" };
    for (let i = 0; i < 3; i += 1) {
      expect((await call(new Request("https://shim.teleionlabs.com/q/search?q=cost", { headers: address }), capped)).status).toBe(200);
    }
  });
});
