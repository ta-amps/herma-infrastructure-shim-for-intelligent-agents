// Service round 4 (Nov 7, 2026): fixes from the worker runs of Nov 6.
//   item 2  the claim's evaluation candidates leave out the caller's own Tasks and Task Objects;
//   item 3  D10: an evaluation keeps its sent verdict (sent_verdict) and says why the shown verdict stays UNREVIEWED;
//   item 4  builds_on keeps the full key (up to 128 characters), not 72;
//   item 5  a no-key follow-up keeps its sent priority inside 1..60, and the reply says when it changed one;
//   item 6  D13: /q/feedback keeps unknown fields in extra_fields and names them; identity fields are never kept;
//   item 7  more than 10 follow-ups in one submit get advice in the reply, never a refusal;
//   item 8  D8/D9 producer_agent and needs_people in lists, D11 task_url on self_seed, D14 human_links_method.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { needsFieldTeam } from "../deploy/cloudflare/priority_work_gateway.js";

const SELF_FETCH = (request, bindings) => worker.fetch(request, bindings, { waitUntil() {}, passThroughOnException() {} });
const ORIGIN = "https://shim.teleionlabs.com";
const open = { ...env, OPEN_WORK_LIMITS: "on" };
const call = (path, init = {}, bindings = env) => SELF_FETCH(new Request(`${ORIGIN}${path}`, init), bindings);
const post = (path, body, bindings = env) =>
  call(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, bindings);
let n = 0;
const unique = (p) => `${p}-${Date.now().toString(36)}${(n += 1)}`;
const seed = (agent, key, extra = {}, bindings = env) =>
  post(
    "/q/submit",
    {
      agent_id: agent,
      task_id: "self_seed",
      summary: "A small reusable note for round 4",
      task_objects: [{ object_key: key, category: "worker_issue_report", summary: "A note for the round 4 tests", payload: { note: "kept" } }],
      ...extra,
    },
    bindings
  );

describe("service round 4", { timeout: 180000 }, () => {
  it("item 2: evaluation candidates never list the caller's own Tasks or Task Objects", async () => {
    const maker = unique("r4-maker");
    const other = unique("r4-other");
    const mine = `r4_mine_${Date.now().toString(36)}_v1`;
    expect((await seed(maker, mine)).status).toBe(200);
    expect((await seed(other, `r4_theirs_${Date.now().toString(36)}_v1`)).status).toBe(200);
    // An unevaluated Task made by the maker.
    const tid = `verb_r4_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    await env.HERMA_DB.prepare(
      "INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, eval_count) VALUES (?, 'public_general', 'public_commons', 10, 'r4 own task', 'A Task made by the maker for the candidate test.', '0', ?, ?, ?, 'done', 0)"
    ).bind(tid, maker, now, now).run();
    const claimed = await (await post("/q/claim", { agent_id: maker, slot: "eval" })).json();
    const cands = claimed.evaluation_candidates || claimed.task?.evaluation_candidates || claimed.bilateral_guidance?.evaluation_candidates;
    expect(cands, JSON.stringify(Object.keys(claimed))).toBeTruthy();
    expect(cands.own_work_left_out).toBe(true);
    expect(cands.task_objects_to_evaluate.some((o) => o.producer_agent === maker || o.object_key === mine)).toBe(false);
    expect(cands.tasks_to_evaluate.some((t) => t.task_id === tid || t.producer_agent === maker)).toBe(false);
    expect(cands.tasks_to_evaluate.every((t) => !("producer_worker_uuid" in t))).toBe(true);
    // The other agent can see the maker's work.
    const seen = await (await post("/q/claim", { agent_id: other, slot: "eval" })).json();
    const theirs = seen.evaluation_candidates || seen.task?.evaluation_candidates || seen.bilateral_guidance?.evaluation_candidates;
    expect(theirs.task_objects_to_evaluate.some((o) => o.producer_agent === other)).toBe(false);
    for (const out of [claimed, seen]) {
      const lease = out.lease || out.task;
      if (lease?.task_id && lease?.fencing_token != null) {
        await post("/q/release", { agent_id: lease.leased_by || out.agent_id || maker, task_id: lease.task_id, lease_epoch: lease.fencing_token, reason: "round 4 test" });
      }
    }
  });

  it("item 3 (D10): a peer's REPRODUCED is kept as sent_verdict and the reply and the read explain the shown verdict", async () => {
    const maker = unique("r4-vmaker");
    const key = `r4_verdict_${Date.now().toString(36)}_v1`;
    await seed(maker, key);
    const peer = unique("r4-peer");
    const out = await (
      await post("/q/submit", {
        agent_id: peer,
        task_id: "self_seed",
        summary: "An evaluation",
        evaluations: [{ target_kind: "object", target_id: key, verification_verdict: "REPRODUCED", rationale: "Ran it" }],
      })
    ).json();
    const ev = out.applied_evaluations.find((e) => e.target_id === key);
    expect(ev.sent_verdict).toBe("REPRODUCED");
    expect(ev.shown_verdict).toBe("UNREVIEWED");
    expect(ev.verification_verdict).toBe("UNREVIEWED");
    expect(ev.verdict_note).toContain("sent_verdict");
    const row = await env.HERMA_DB.prepare("SELECT verification_verdict, sent_verdict FROM herma_evaluations WHERE target_id = ? ORDER BY id DESC LIMIT 1").bind(key).first();
    expect(row).toEqual({ verification_verdict: "UNREVIEWED", sent_verdict: "REPRODUCED" });
    const read = await (await call(`/q/object/${key}`, { headers: { accept: "application/json" } })).json();
    const shown = (read.evaluations || []).find((e) => e.sent_verdict === "REPRODUCED");
    expect(shown.verdict_note).toContain("REPRODUCED");
    // An evaluation with no verdict stores an empty sent_verdict and no note.
    const plain = await (await post("/q/submit", { agent_id: unique("r4-peer2"), task_id: "self_seed", summary: "e", evaluations: [{ target_id: key, rationale: "fine" }] })).json();
    expect(plain.applied_evaluations[0].sent_verdict).toBeUndefined();
  });

  it("item 4: builds_on keeps a key of up to 128 characters", async () => {
    const agent = unique("r4-long");
    const longKey = `r4_${"x".repeat(100)}_${Date.now().toString(36)}_v1`.slice(0, 128);
    expect(longKey.length).toBeGreaterThan(72);
    await seed(agent, longKey);
    const child = `r4_child_${Date.now().toString(36)}_v1`;
    await post("/q/submit", {
      agent_id: agent,
      task_id: "self_seed",
      summary: "builds on a long key",
      task_objects: [{ object_key: child, category: "worker_issue_report", summary: "child", builds_on: [longKey], payload: { a: 1 } }],
    });
    const edge = await env.HERMA_DB.prepare("SELECT target_object_key FROM herma_object_edges WHERE source_object_key = ?").bind(child).first();
    expect(edge.target_object_key).toBe(longKey);
  });

  it("item 5: a no-key ngo follow-up keeps its sent priority in 1..60, and says when it changed it", async () => {
    const agent = unique("r4-prio");
    const prompt = (p) => `Write the follow-up step ${p} for the round 4 priority test, as desk work.`;
    const out = await (
      await seed(agent, `r4_prio_${Date.now().toString(36)}_v1`, {
        followup_tasks: [60, 65, 55, 45].map((p) => ({ title: `r4 follow-up ${p}`, prompt: prompt(p), tier: "ngo_priority", priority: p })),
      }, open)
    ).json();
    const got = out.enqueued_followup_tasks.map((t) => t.priority);
    expect(got).toEqual([60, 60, 55, 45]);
    const changed = out.enqueued_followup_tasks[1];
    expect(changed.sent_priority).toBe(65);
    expect(changed.priority_note).toContain("65");
    expect(out.enqueued_followup_tasks[2].priority_note).toBeUndefined();
    const stored = await env.HERMA_DB.prepare("SELECT priority FROM herma_durable_queue WHERE task_id = ?").bind(out.enqueued_followup_tasks[3].task_id).first();
    expect(stored.priority).toBe(45);
  });

  it("item 7: more than 10 follow-ups get advice in the reply and nothing is refused", async () => {
    const agent = unique("r4-bulk");
    const tasks = Array.from({ length: 11 }, (_, i) => ({ title: `r4 bulk ${i}`, prompt: `Bulk follow-up number ${i} for the round 4 advice test.` }));
    const out = await (await seed(agent, `r4_bulk_${Date.now().toString(36)}_v1`, { followup_tasks: tasks })).json();
    expect(out.ok).toBe(true);
    expect(out.followup_advice.code).toBe("many_followups");
    expect(out.followup_advice.advisory_only).toBe(true);
    expect(out.followup_advice.sent_followups).toBe(11);
    expect(out.enqueued_followup_tasks.length).toBe(11);
    // Review M2: follow-ups sent at the top level and inside task_objects count together.
    const mixed = await (
      await post("/q/submit", {
        agent_id: agent,
        task_id: "self_seed",
        summary: "mixed follow-ups",
        followup_tasks: tasks.slice(0, 5),
        task_objects: [{ object_key: `r4_mixed_${Date.now().toString(36)}_v1`, category: "worker_issue_report", summary: "m", payload: { a: 1 }, followups: tasks.slice(5, 11) }],
      })
    ).json();
    expect(mixed.followup_advice?.sent_followups).toBe(11);
    const few = await (await seed(agent, `r4_few_${Date.now().toString(36)}_v1`, { followup_tasks: tasks.slice(0, 3) })).json();
    expect(few.followup_advice).toBeUndefined();
  });

  it("item 6 (D13): /q/feedback keeps unknown fields, names them, and never keeps identity fields", async () => {
    const agent = unique("r4-fb");
    const res = await post("/q/feedback", {
      agent_id: agent,
      kind: "service_defects",
      summary: "Round 4 feedback summary",
      observation: "The observation text for round 4.",
      details: "A details field the old code dropped",
      items: [{ id: "D1", text: "first" }, { id: "D2", text: "second" }],
      worker_token: "wt_0123456789abcdef0123",
      email: "jane.roe@corp-mail.io",
      note: "Call me at jane.roe@corp-mail.io",
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.kept_extra_fields).toEqual(expect.arrayContaining(["details", "items"]));
    expect(out.kept_extra_fields).not.toContain("worker_token");
    expect(out.kept_extra_fields).not.toContain("agent_id");
    const stored = await env.HERMA_DB.prepare("SELECT payload_json FROM herma_task_objects WHERE object_key = ? ORDER BY id DESC LIMIT 1").bind(out.stored_object_key).first();
    const payload = JSON.parse(stored.payload_json);
    expect(payload.extra_fields.details).toBe("A details field the old code dropped");
    expect(payload.extra_fields.items[1].id).toBe("D2");
    expect(payload.summary).toBe("Round 4 feedback summary");
    expect(payload.observation).toBe("The observation text for round 4.");
    expect(JSON.stringify(payload)).not.toContain("wt_0123456789abcdef0123");
    // Review M1: a personal-data field is not kept (and named), and a kept value has its email removed.
    expect(out.dropped_fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: "email" })]));
    expect(payload.extra_fields.email).toBeUndefined();
    expect(JSON.stringify(payload.extra_fields)).not.toContain("jane.roe@corp-mail.io");
    // Over the size limit: the field is named in dropped_fields.
    const big = await (await post("/q/feedback", { agent_id: agent, observation: "big extra", a: "x".repeat(3000), b: "y".repeat(3000), c: "z".repeat(3000) })).json();
    if (big.ok) {
      const names = [...(big.kept_extra_fields || []), ...(big.dropped_fields || []).map((d) => d.field)];
      expect(names).toEqual(expect.arrayContaining(["a", "b", "c"]));
    }
  });

  it("item 8: producer_agent and needs_people in the lists, task_url on self_seed, and POST for human links", async () => {
    expect(needsFieldTeam("Native-speaker read-aloud of the Spanish v2 Huerta quiz")).toBe(true);
    expect(needsFieldTeam("Hub volunteer: perform LP-T1 physical trial")).toBe(true);
    expect(needsFieldTeam("Write a desk summary of the quiz")).toBe(false);
    const agent = unique("r4-list");
    const tid = `verb_r4l_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    await call("/q/pulse");
    await env.HERMA_DB.prepare(
      "INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, min_capability_milli) VALUES (?, 'public_general', 'public_commons', 89, 'r4 list task', 'Desk work for the list test.', '0', ?, ?, ?, 'ready', 0)"
    ).bind(tid, agent, now, now).run();
    const list = await (await call("/q/tasks?state=ready&max_results=200", { headers: { accept: "application/json" } })).json();
    const row = list.tasks.find((t) => t.task_id === tid);
    if (row) expect(row.producer_agent).toBe(agent);
    const next = await (await call(`/q/next?agent_id=${unique("r4-next")}`, { headers: { accept: "application/json" } })).json();
    for (const t of next.tasks || []) {
      expect(t).toHaveProperty("producer_agent");
      expect(t.needs_people).toBe(false);
    }
    const seeded = await (await seed(unique("r4-seed"), `r4_seed_${Date.now().toString(36)}_v1`)).json();
    expect(seeded.task_url).toBeNull();
    expect(seeded.task_url_note).toContain("self_seed");
    const connect = await (await call("/connect.json")).json();
    const block = Object.values(connect).find((v) => v && typeof v === "object" && "human_links" in v);
    expect(block.human_links_method).toBe("POST");
  });
});
